import { TransportError } from '@/core/transport/errors';
import type {
  CloseReason,
  ConnectionOptions,
  InputSignals,
  OutputSignals,
  Transport,
  TransportEvents,
  TransportState,
} from '@/core/transport/types';
import { WriteQueue } from '@/core/transport/writeQueue';

/**
 * Node（`serialport`）之上的 Transport 实现 —— 桌面端唯一接触原生串口 API 的地方，
 * 与浏览器端的 webSerialTransport.ts 一一对应。
 *
 * 生命周期语义与 Web 版**必须完全一致**，否则上层的 SerialSession / 重连控制器
 * 会在两个运行环境里表现不同：
 *  - close() 幂等，并发调用汇流到同一次拆卸；
 *  - 打开途中被 close() 时，先等打开流程走完再拆，绝不并行（否则端口会被孤儿会话独占）；
 *  - 设备掉线走 `remote`，本地主动关走 `local`，出错走 `error`。
 *
 * 这里不直接 import serialport，而是把「怎么打开一个口」注入进来：
 * 一来测试不需要真实硬件，二来原生模块加载失败时可以在更外层给出可操作的提示。
 */

/** 传输层需要的最小端口能力。真实实现见 openNodePort()，测试里换成假的。 */
export interface NodePortHandle {
  onData: (listener: (chunk: Uint8Array) => void) => void;
  onError: (listener: (error: Error) => void) => void;
  /** 端口关闭。`disconnected` 为真表示设备被拔了，而不是我们主动关的。 */
  onClose: (listener: (info: { disconnected: boolean }) => void) => void;
  write: (data: Uint8Array, callback: (error?: Error | null) => void) => void;
  /** serialport 的 port.set()。字段名是它自己的那一套，映射在传输层里做。 */
  set: (
    signals: { dtr?: boolean; rts?: boolean; brk?: boolean },
    callback: (error?: Error | null) => void,
  ) => void;
  /** serialport 的 port.get()。它不报 ringIndicator，见 getSignals()。 */
  get: (
    callback: (
      error: Error | null,
      status?: { cts?: boolean; dsr?: boolean; dcd?: boolean },
    ) => void,
  ) => void;
  close: (callback: (error?: Error | null) => void) => void;
  /** 解除全部监听。拆卸时调用，避免关闭过程本身又触发一轮回调。 */
  dispose: () => void;
}

export type OpenNodePort = (path: string, options: ConnectionOptions) => Promise<NodePortHandle>;

/**
 * 打开失败的原因是不是「端口正被占着」。
 *
 * 认的是 @serialport/bindings-cpp 在 C++ 里写死的两个串，都由它默认开启的 `lock` 选项产生：
 *  - Windows：以独占方式 CreateFile，被别的进程开着时报 `Opening COM3: Access denied`；
 *  - Linux / macOS：flock(LOCK_EX | LOCK_NB) 失败时报 `Error <strerror> Cannot lock port`。
 *    前半段 strerror 随 locale 变，所以只认后缀。flock 是建议锁，只拦得住同样加锁的
 *    程序（另一个窗口里的本扩展一定拦得住），这也是提示里只说「可能」的原因。
 *
 * Linux 上 `Error Permission denied Cannot open …` 是没进 dialout 组，不是占用，刻意不认。
 */
export function isPortInUseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(': Access denied') || message.includes('Cannot lock port');
}

export class NodeSerialTransport implements Transport {
  #state: TransportState = 'closed';
  #port: NodePortHandle | null = null;
  /** 在途的打开流程。close() 必须先等它走完，否则会与它竞争。 */
  #openTask: Promise<void> | null = null;
  /** 在途的关闭流程。本地 close() 与「设备掉线」共用，保证端口只关一次。 */
  #closeTask: Promise<void> | null = null;
  #handlers = new Set<Partial<TransportEvents>>();
  #queue: WriteQueue;

  constructor(
    private readonly path: string,
    private readonly openPort: OpenNodePort,
    highWaterMark?: number,
  ) {
    this.#queue = new WriteQueue(
      (data) =>
        new Promise<void>((resolve, reject) => {
          const port = this.#port;
          if (!port) {
            reject(new TransportError('invalid-state', 'Port is not open for writing'));
            return;
          }
          port.write(data, (error) => {
            if (error) reject(TransportError.from(error, 'write', 'Write failed'));
            else resolve();
          });
        }),
      highWaterMark,
    );
  }

  get state(): TransportState {
    return this.#state;
  }

  get pendingBytes(): number {
    return this.#queue.pendingBytes;
  }

  subscribe(handlers: Partial<TransportEvents>): () => void {
    this.#handlers.add(handlers);
    return () => this.#handlers.delete(handlers);
  }

  async open(options: ConnectionOptions): Promise<void> {
    if (this.#state !== 'closed') {
      throw new TransportError('invalid-state', `Cannot open a port in "${this.#state}" state`);
    }
    this.#state = 'opening';

    const task = this.#openPort(options);
    this.#openTask = task;
    try {
      await task;
    } finally {
      if (this.#openTask === task) this.#openTask = null;
    }
  }

  async #openPort(options: ConnectionOptions): Promise<void> {
    let port: NodePortHandle;
    try {
      port = await this.openPort(this.path, options);
    } catch (error) {
      this.#state = 'closed';
      throw TransportError.from(
        error,
        isPortInUseError(error) ? 'in-use' : 'open-failed',
        `Failed to open ${this.path}`,
      );
    }

    // 打开过程中用户点了关闭：这条链路已经作废，开出来的口必须立刻还回去，
    // 否则它没有任何引用指向，会被独占到进程退出为止
    if (this.#state !== 'opening') {
      port.dispose();
      port.close(() => undefined);
      return;
    }

    this.#port = port;
    this.#queue.reset();

    port.onData((chunk) => {
      if (chunk.byteLength > 0) this.#emitData(chunk);
    });

    port.onError((error) => {
      if (this.#state === 'open') {
        this.#emitError(TransportError.from(error, 'read', 'Serial port error'));
      }
    });

    port.onClose((info) => {
      // 我们自己关的那次由 #teardown 收尾，这里只处理「不是我们关的」
      if (this.#state === 'open') void this.#shutdown(info.disconnected ? 'remote' : 'error');
    });

    this.#state = 'open';
  }

  async close(): Promise<void> {
    if (this.#state === 'opening') {
      await this.#openTask?.catch(() => undefined);
    }
    if (this.#state === 'closed') return;
    if (this.#closeTask) return this.#closeTask;
    return this.#shutdown('local');
  }

  /** 唯一的关闭出口：本地 close() 与「设备掉线」两条路径共用。 */
  #shutdown(reason: CloseReason): Promise<void> {
    const task = (async () => {
      this.#state = 'closing';
      await this.#teardown(reason);
      this.#state = 'closed';
      this.#emitClose(reason);
    })();
    this.#closeTask = task;
    return task.finally(() => {
      if (this.#closeTask === task) this.#closeTask = null;
    });
  }

  write(data: Uint8Array): Promise<void> {
    if (this.#state !== 'open') {
      return Promise.reject(new TransportError('invalid-state', 'Port is not open'));
    }
    return this.#queue.enqueue(data);
  }

  setSignals(signals: OutputSignals): Promise<void> {
    const port = this.#port;
    if (this.#state !== 'open' || !port) {
      return Promise.reject(new TransportError('invalid-state', 'Port is not open'));
    }
    // 只映射调用方真正提到的那几条线：serialport 的 set() 会把传进去的字段全写一遍，
    // 补上默认值等于顺手动了别的线 —— 在带自动下载电路的板子上就是一次意外复位
    const mapped: { dtr?: boolean; rts?: boolean; brk?: boolean } = {};
    if (signals.dataTerminalReady !== undefined) mapped.dtr = signals.dataTerminalReady;
    if (signals.requestToSend !== undefined) mapped.rts = signals.requestToSend;
    if (signals.break !== undefined) mapped.brk = signals.break;

    return new Promise<void>((resolve, reject) => {
      port.set(mapped, (error) => {
        if (error) reject(TransportError.from(error, 'signals', 'Failed to set control signals'));
        else resolve();
      });
    });
  }

  getSignals(): Promise<InputSignals> {
    const port = this.#port;
    if (this.#state !== 'open' || !port) {
      return Promise.reject(new TransportError('invalid-state', 'Port is not open'));
    }
    return new Promise<InputSignals>((resolve, reject) => {
      port.get((error, status) => {
        if (error) {
          reject(TransportError.from(error, 'signals', 'Failed to read control signals'));
          return;
        }
        resolve({
          clearToSend: status?.cts ?? false,
          dataCarrierDetect: status?.dcd ?? false,
          dataSetReady: status?.dsr ?? false,
          // serialport 的 get() 不报 RI（它的绑定层就没读这条线）。
          // 报一个恒假的值比假装拿到了强：界面上那盏灯永远不亮，而不是随机亮
          ringIndicator: false,
        });
      });
    });
  }

  /**
   * 先解监听、再排空写队列、最后关端口。
   *
   * 解监听必须排在最前：`close()` 本身会触发 'close' 事件，不先摘掉的话会绕回
   * #shutdown 再来一遍。设备已经掉线时端口其实已经没了，再去 close 只会拿到一个
   * 意料之中的错误，不必打扰用户。
   */
  async #teardown(reason: CloseReason): Promise<void> {
    const port = this.#port;
    this.#port = null;
    if (!port) return;

    port.dispose();
    await this.#queue.drain();
    this.#queue.reset();

    await new Promise<void>((resolve) => {
      port.close((error) => {
        if (error && reason === 'local') {
          // 关闭失败必须让用户看见：端口没真正释放，下次打开会失败
          this.#emitError(TransportError.from(error, 'close-failed', 'Failed to close port'));
        }
        resolve();
      });
    });
  }

  #emitData(chunk: Uint8Array): void {
    for (const handler of this.#handlers) handler.onData?.(chunk);
  }

  #emitError(error: TransportError): void {
    for (const handler of this.#handlers) handler.onError?.(error);
  }

  #emitClose(reason: CloseReason): void {
    for (const handler of this.#handlers) handler.onClose?.(reason);
  }
}
