import { RingBuffer } from '@/core/buffer/ringBuffer';
import {
  DEFAULT_LOG_CAPACITY,
  LOG_CAPACITY_PREF_KEY,
  parseLogCapacity,
} from '@/core/buffer/logCapacity';
import type { LogView } from '@/core/log/logLine';
import { logFileName } from '@/core/log/logLine';
import { FrameRecorder, type RecordSink } from '@/core/log/recorder';
import { FramePlan, type TaskFrame } from '@/core/scheduler/framePlan';
import { TaskScheduler } from '@/core/scheduler/taskScheduler';
import type { SendFailure, SessionNotice } from '@/core/session/notices';
import { SerialSession, type SessionState } from '@/core/session/serialSession';
import { TransportError } from '@/core/transport/errors';
import type { PortDescriptor } from '@/core/transport/portDescriptor';
import type { ConnectionOptions, Transport } from '@/core/transport/types';
import {
  FRAME_BATCH_MS,
  type FramePayload,
  type HostEvent,
  type RequestBody,
} from '../shared/protocol';
import type { PortLeases } from './portLeases';
import type { PortWatcher } from './portWatcher';

/**
 * 一个面板背后的一切：串口会话、日志环形缓冲、周期发送。
 *
 * **它活在宿主进程，不在 webview 里**，这是整个架构的支点。VS Code 的 webview
 * 一旦被隐藏就会被销毁：会话若放在 webview，用户切去看一眼代码回来就会发现
 * 串口断了、心跳停了、日志空了。放在宿主之后，面板只是一个可以随时重建的视图，
 * 重建时用 snapshot() 把历史回放回去即可。
 *
 * 多面板不需要在协议里编址：每个 WebviewPanel 有自己独立的 postMessage 通道，
 * 宿主拿 `Map<WebviewPanel, SessionHost>` 关联，一个 SessionHost 只服务一个面板。
 */

/**
 * 宿主侧日志容量的默认值，与 Web 版 logStore 共用同一个常量。
 *
 * **两侧必须一致**：webview 存一份、宿主存一份，宿主那份是面板重建后回放的来源。
 * 宿主留得比界面少，用户设了 10000 却在面板重建后只剩默认那些，会以为日志被吃掉了。
 */
export { DEFAULT_LOG_CAPACITY };

export interface SessionHostDeps {
  /** 面板 id，同时是占用表里的持有者标识。 */
  id: string;
  leases: PortLeases;
  watcher: PortWatcher;
  /** 按设备路径建传输层。注入进来，测试里换成 FakeTransport。 */
  createTransport: (path: string) => Transport;
  /** 把消息发给这个面板自己的 webview。 */
  post: (message: HostEvent) => void;
  /** 打开浏览器/编辑器的端口选择器，返回用户选中的端口。 */
  pickPort: () => Promise<PortDescriptor | undefined>;
  /**
   * 让用户挑一个录制文件，返回路径；取消返回 undefined。
   *
   * 与 createRecordSink 分成两件事，是因为只有前者要弹对话框：测试里换掉它就能
   * 在没有 UI 的环境下把整条录制链路跑完。
   */
  pickRecordFile: (suggestedName: string) => Promise<string | undefined>;
  /** 按路径建一个落盘出口。写入失败通过 onError 回来，会变成一条日志里的通知。 */
  createRecordSink: (path: string, onError: (message: string) => void) => RecordSink;
  readPrefs: () => Record<string, unknown>;
  writePref: (key: string, value: unknown) => void;
  language: string;
  defaultOptions: ConnectionOptions;
  now?: () => number;
}

export class SessionHost {
  readonly #session: SerialSession<string>;
  readonly #ring: RingBuffer<FramePayload>;
  readonly #scheduler = new TaskScheduler();
  /**
   * 录制归宿主所有。
   *
   * 和周期发送同一个理由：帧产生在这一侧，webview 一被隐藏就连同它的一切销毁。
   * 录制若挂在界面上，用户切去看一眼代码回来，文件就在那一刻断了 ——
   * 而录制存在的全部意义就是「挂一夜等一次偶发问题」。
   */
  readonly #recorder = new FrameRecorder();
  /** 攒批中的帧。1 Mbps 下每帧一条 postMessage 会把消息通道打满。 */
  #pending: FramePayload[] = [];
  /**
   * 每个周期任务要发的帧，以及它发到第几条了。
   *
   * 内容单独放在这张表里、而不是闭进任务的执行体，是为了「循环期间改报文即时生效」：
   * 换内容只是改这里一个值，不必停掉再重启任务 —— 重启会把节拍打回原点，
   * 用户改一个字节就多发一帧。
   */
  readonly #taskPlans = new Map<string, FramePlan>();
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #unwatch: (() => void) | null = null;
  #unlease: (() => void) | null = null;

  #selectedPortKey: string | null = null;
  #options: ConnectionOptions;
  #autoReconnect = true;
  #state: SessionState = 'closed';
  #openedAt = 0;

  constructor(private readonly deps: SessionHostDeps) {
    this.#options = deps.defaultOptions;
    // 存量偏好里的容量在建 ring 时就要读到：面板重建走的是同一条路，
    // 先按默认容量建再 resize 会把超出默认的那部分历史白丢一次。
    this.#ring = new RingBuffer<FramePayload>(
      parseLogCapacity(deps.readPrefs()[LOG_CAPACITY_PREF_KEY]) ?? DEFAULT_LOG_CAPACITY,
    );

    this.#session = new SerialSession<string>({
      createTransport: (path) => deps.createTransport(path),
      // 重连时按设备路径重新解析。路径还在列表里才算这台设备回来了 ——
      // 拔掉后 COM3 会从枚举里消失，此时不该傻等一个不存在的口
      resolvePort: (portKey) =>
        Promise.resolve(
          this.deps.watcher.current().some((port) => port.key === portKey) ? portKey : undefined,
        ),
      describeConfig: (options) => this.#describeConfig(options),
    });

    this.#session.setHandlers({
      onFrame: (direction, bytes) => this.#pushFrame(direction, bytes),
      onThroughput: (direction, byteCount) =>
        deps.post({ kind: 'event', type: 'throughput', direction, byteCount }),
      onNotice: (notice) => this.#notify(notice),
      onStateChange: (state) => this.#onStateChange(state),
    });

    this.#unwatch = deps.watcher.subscribe((ports) => {
      deps.post({
        kind: 'event',
        type: 'ports',
        ports: [...ports],
        holders: deps.leases.holders(),
      });
    });

    this.#unlease = deps.leases.subscribe((holders) => {
      deps.post({
        kind: 'event',
        type: 'ports',
        ports: [...deps.watcher.current()],
        holders,
      });
    });
  }

  /** 面板刚建好、或被隐藏后重建时，用它把状态与历史一次性交回去。 */
  snapshot(): HostEvent {
    this.#flush();
    return {
      kind: 'event',
      type: 'snapshot',
      ports: [...this.deps.watcher.current()],
      holders: this.deps.leases.holders(),
      selectedPortKey: this.#selectedPortKey,
      options: this.#options,
      autoReconnect: this.#autoReconnect,
      state: this.#state,
      openedAt: this.#openedAt,
      pendingBytes: this.pendingBytes,
      frames: this.#ring.toArray(),
      runningTasks: this.#scheduler.runningIds(),
      recording: this.#recorder.status,
      prefs: this.deps.readPrefs(),
      language: this.deps.language,
    };
  }

  get id(): string {
    return this.deps.id;
  }

  get portKey(): string | null {
    return this.#selectedPortKey;
  }

  get state(): SessionState {
    return this.#state;
  }

  /** 写队列的积压字节数。界面靠它显示背压，值在这一侧，只能捎回去。 */
  get pendingBytes(): number {
    return this.#session.pendingBytes;
  }

  get frameCount(): number {
    return this.#ring.size;
  }

  recentFrames(count: number): FramePayload[] {
    return this.#ring.recent(count);
  }

  /** 与 `session.send` 请求走同一条路，但把没写出去的原因交回来 —— AI 工具只看返回值。 */
  send(bytes: Uint8Array): Promise<SendFailure | null> {
    return this.#session.send(bytes);
  }

  /**
   * 连 / 断，用**本面板自己当前的参数**。
   *
   * 命令面板与快捷键走这里，而不是自己拼一条 `session.open` —— 那条路径手里没有参数，
   * 只能塞一份默认值进来，于是用户在界面上调好的波特率被静默换成 115200；
   * 更糟的是 `#options` 也跟着被写坏，面板下次重建时回放的还是这份错的。
   * 把参数留在唯一知道它的人手里，这个缺陷就没有入口了。
   */
  async toggle(): Promise<'opened' | 'closed' | 'no-port'> {
    if (this.#state !== 'closed') {
      await this.#close();
      return 'closed';
    }
    const portKey = this.#selectedPortKey;
    if (portKey === null) return 'no-port';
    await this.#open(portKey, this.#options);
    return 'opened';
  }

  async handle(body: RequestBody): Promise<unknown> {
    switch (body.method) {
      case 'ready':
        this.deps.post(this.snapshot());
        return undefined;

      case 'ports.refresh':
        await this.deps.watcher.refresh();
        return undefined;

      case 'ports.pick': {
        const port = await this.deps.pickPort();
        if (port) this.#select(port.key);
        return port ?? null;
      }

      case 'session.open':
        return this.#open(body.portKey, body.options);

      case 'session.close':
        await this.#close();
        return undefined;

      case 'session.send':
        await this.#session.send(body.bytes);
        return undefined;

      case 'session.setFraming':
        this.#session.setFraming(body.framing);
        return undefined;

      case 'session.setReconnect':
        this.#autoReconnect = body.enabled;
        this.#session.setReconnectSettings({ enabled: body.enabled });
        return undefined;

      case 'prefs.write':
        this.deps.writePref(body.key, body.value);
        // 容量是会话这边自己也要照做的偏好：界面那份 ring 在 webview 里，
        // 这份在宿主里，只改一边的话面板一重建就回到旧容量。
        if (body.key === LOG_CAPACITY_PREF_KEY) this.#applyCapacity(body.value);
        return undefined;

      case 'log.clear':
        // 攒批中那批也要丢。它们已经不在 ring 里了，留着只会在下一次 flush 时
        // 又推给界面 —— 用户看到的就是「清空后自己冒出来几行」。
        this.#ring.clear();
        this.#pending = [];
        return undefined;

      case 'record.start':
        return this.#startRecording(body.view);

      case 'record.stop':
        await this.#stopRecording();
        return undefined;

      case 'tasks.start':
        this.#startTask(body.taskId, body.frames, body.intervalMs, body.repeat);
        return undefined;

      case 'tasks.update':
        this.#updateTask(body.taskId, body.frames, body.intervalMs, body.repeat);
        return undefined;

      case 'tasks.stop':
        this.#stopTask(body.taskId);
        return undefined;

      case 'tasks.stopAll':
        this.#stopAllTasks();
        return undefined;
    }
  }

  dispose(): void {
    this.#scheduler.stopAll();
    this.#taskPlans.clear();
    // 面板关掉就该收尾：这是个长驻进程，留着一个没人管的写入流等于漏一个文件句柄，
    // 攒在缓冲里还没落盘的那几行也会跟着一起没
    void this.#stopRecording();
    this.#unwatch?.();
    this.#unlease?.();
    this.#unwatch = null;
    this.#unlease = null;
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
    this.#session.dispose();
    this.deps.leases.release(this.deps.id);
  }

  async #open(portKey: string, options: ConnectionOptions): Promise<void> {
    // 权威占用表说了算：本工具的另一个面板正开着这个口时，连试都不必试。
    // 外部程序（PuTTY 之类）占用的口这里看不见，仍然只能靠 open() 失败兜底。
    if (!this.deps.leases.acquire(portKey, this.deps.id)) {
      this.deps.post({ kind: 'event', type: 'notice', notice: { code: 'port-busy' } });
      throw new TransportError('invalid-state', `${portKey} is held by another panel`);
    }

    // 顺序要紧：先落参数再广播。反过来的话 #select 发出的 `selected` 带的是**上一次**
    // 的参数，界面照着它显示就与实际打开的对不上；而且同一个口换个波特率重开时
    // #select 还会因为 portKey 没变直接短路，界面连这一条都收不到
    this.#selectedPortKey = portKey;
    this.#options = options;
    this.#postSelected();
    this.#session.setReconnectSettings({ enabled: this.#autoReconnect });

    try {
      await this.#session.open(portKey, portKey, options);
      this.#openedAt = this.#now();
    } catch (error) {
      // 打开失败就把占用还回去，否则这个口会被一次失败的尝试锁死
      this.deps.leases.release(this.deps.id);
      this.#openedAt = 0;
      throw error;
    }
  }

  async #close(): Promise<void> {
    this.#stopAllTasks();
    await this.#session.close();
    this.#openedAt = 0;
  }

  #onStateChange(state: SessionState): void {
    this.#state = state;

    // 链路不再可用时周期发送必须跟着停，否则会持续刷「串口未打开」
    if (state === 'closed' || state === 'reconnecting') {
      this.#stopAllTasks();
    }
    // 'reconnecting' 期间端口仍归本面板所有（马上要重连回去），只有真正关闭才放手
    if (state === 'closed') {
      this.#openedAt = 0;
      this.deps.leases.release(this.deps.id);
      // 刚放掉的口应该立刻在别的面板里变成可选，不必等下一次轮询
      void this.deps.watcher.refresh();
    }

    this.deps.post({
      kind: 'event',
      type: 'state',
      state,
      openedAt: this.#openedAt,
      // 关闭时队列已排空，这条顺带把界面上的积压读数清零
      pendingBytes: this.pendingBytes,
    });
  }

  #startTask(taskId: string, frames: TaskFrame[], intervalMs: number, repeat?: number): void {
    // 允许以空列表启动：报文当前解析不通过时，浏览器版也是「循环转着但不发东西」，
    // 等用户把内容改对了再开始发。这里靠 update() 补上内容达到同样效果。
    this.#taskPlans.set(taskId, new FramePlan(frames, repeat));

    this.#scheduler.start(taskId, {
      intervalMs,
      run: (tick) => this.#runTask(taskId, tick),
      nextIntervalMs: (tick) => this.#taskPlans.get(taskId)?.delayBefore(tick),
      onError: () => {
        // 发送失败已经由 session 通过 write-error 通知写进日志了，这里不再重复
      },
    });
    this.#postTasks();
  }

  /** 发这一拍的帧。发哪一条、跑没跑到头都由 FramePlan 说了算，与 webview 侧同一套。 */
  #runTask(taskId: string, tick: number): Promise<void> {
    const plan = this.#taskPlans.get(taskId);
    const frame = plan?.at(tick);
    if (!plan || !frame) return Promise.resolve();
    // 失败原因已经作为通知推给界面了，调度器只管节拍
    return this.#session.send(frame.bytes).then(() => {
      // 跑够遍数就自己停；界面的按钮状态跟着 tasks 事件回落
      if (plan.isFinal(tick)) this.#stopTask(taskId);
    });
  }

  /**
   * 改运行中任务的内容、周期或遍数。任务没在跑时什么都不做。
   *
   * 拍号归调度器管，换内容不会把它打回原点 —— 顺序循环期间增删预设不该让队列
   * 跳回第一条，用户改一个字节也不该多发一帧。
   */
  #updateTask(taskId: string, frames?: TaskFrame[], intervalMs?: number, repeat?: number): void {
    if (!this.#scheduler.isRunning(taskId)) return;
    if (frames !== undefined || repeat !== undefined) {
      const plan = this.#taskPlans.get(taskId);
      this.#taskPlans.set(
        taskId,
        new FramePlan(frames ?? plan?.frames ?? [], repeat ?? plan?.repeat),
      );
    }
    if (intervalMs !== undefined) this.#scheduler.updateInterval(taskId, intervalMs);
  }

  #stopTask(taskId: string): void {
    this.#scheduler.stop(taskId);
    this.#taskPlans.delete(taskId);
    this.#postTasks();
  }

  #stopAllTasks(): void {
    this.#scheduler.stopAll();
    this.#taskPlans.clear();
    this.#postTasks();
  }

  #postTasks(): void {
    this.deps.post({ kind: 'event', type: 'tasks', running: this.#scheduler.runningIds() });
  }

  #select(portKey: string | null): void {
    if (this.#selectedPortKey === portKey) return;
    this.#selectedPortKey = portKey;
    this.#postSelected();
  }

  /** 把当前的选中端口与参数告诉界面。命令面板那条路径不经过界面，只能靠它同步。 */
  #postSelected(): void {
    this.deps.post({
      kind: 'event',
      type: 'selected',
      portKey: this.#selectedPortKey,
      options: this.#options,
      autoReconnect: this.#autoReconnect,
    });
  }

  #pushFrame(direction: FramePayload['direction'], bytes: Uint8Array): void {
    const frame: FramePayload = { direction, at: this.#now(), bytes };
    this.#recorder.record(direction, bytes, frame.at);
    this.#ring.push(frame);
    this.#pending.push(frame);
    this.#flushTimer ??= setTimeout(() => this.#flush(), FRAME_BATCH_MS);
  }

  #flush(): void {
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    if (this.#pending.length === 0) return;
    const items = this.#pending;
    this.#pending = [];
    this.deps.post({
      kind: 'event',
      type: 'frames',
      items,
      pendingBytes: this.pendingBytes,
    });
  }

  /**
   * 开始录制，返回是否真的开起来了。
   *
   * 用户在文件对话框里取消不算失败，也不该在日志里留下任何东西 —— 那是一次
   * 明确的「算了」，不是出错。
   */
  async #startRecording(view: LogView): Promise<boolean> {
    const path = await this.deps.pickRecordFile(logFileName());
    if (path === undefined) return false;
    const sink = this.deps.createRecordSink(path, (message) =>
      this.#notify({ code: 'record-error', message }),
    );
    this.#recorder.start(sink, path, view, this.#now());
    this.#notify({ code: 'record-started', target: path });
    this.#postRecording();
    return true;
  }

  async #stopRecording(): Promise<void> {
    if (!this.#recorder.active) return;
    const finished = await this.#recorder.stop();
    if (finished.target !== null) {
      this.#notify({ code: 'record-stopped', target: finished.target, lines: finished.lines });
    }
    this.#postRecording();
  }

  #postRecording(): void {
    this.deps.post({ kind: 'event', type: 'recording', status: this.#recorder.status });
  }

  /** 通知的唯一出口：会话自己发的和录制发的都走它。 */
  #notify(notice: SessionNotice): void {
    this.#flush(); // 通知是对操作的反馈，不该排在攒批的帧后面
    this.deps.post({ kind: 'event', type: 'notice', notice });
  }

  /** 容量偏好落到本地这份 ring 上。非法值忽略，缓冲维持现状。 */
  #applyCapacity(value: unknown): void {
    const capacity = parseLogCapacity(value);
    if (capacity !== null) this.#ring.resize(capacity);
  }

  #describeConfig(options: ConnectionOptions): string {
    const parity = options.parity === 'none' ? 'N' : options.parity === 'even' ? 'E' : 'O';
    const label =
      this.deps.watcher.current().find((port) => port.key === this.#selectedPortKey)?.label ??
      this.#selectedPortKey ??
      '—';
    return `${label} @ ${options.baudRate} ${options.dataBits}${parity}${options.stopBits}`;
  }

  #now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
