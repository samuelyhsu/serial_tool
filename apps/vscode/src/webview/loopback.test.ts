import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeTransport } from '../../../../tests/fakeTransport';
import { LOG_CAPACITY_PREF_KEY } from '@/core/buffer/logCapacity';
import type { NodePortInfo } from '@/core/transport/nodePortRegistry';
import type { ConnectionOptions } from '@/core/transport/types';
import { PortLeases } from '../host/portLeases';
import { PortsTreeProvider } from '../host/portsView';
import { PortWatcher } from '../host/portWatcher';
import { handleRequest } from '../host/rpc';
import { SessionHost } from '../host/sessionHost';
import type * as connectionModule from '@/store/connectionStore';
import type * as logModule from '@/store/logStore';
import type * as presetModule from '@/store/presetStore';
import type * as recordModule from '@/store/recordStore';
import type * as sendModule from '@/store/sendStore';
import type * as tasksModule from '@/store/tasksStore';
import type { HostEvent, HostRequest } from '../shared/protocol';
import type { VsCodeApi } from './vscodePlatform';

/**
 * 回环测试：把 webview 侧的 store 与宿主侧的会话**直接对接**跑一遍。
 *
 * 在此之前两侧各测各的，中间那段协议是盲区 —— 而真正逃出去的 bug 恰恰藏在接缝里：
 * 周期任务的调用点漏传了 frames，于是任务退化成在 webview 里跑，面板一隐藏就停。
 * 两侧的单元测试当时**全是绿的**，因为各自都没错，错的是没人把它们接起来看过。
 *
 * 这里唯一被替换掉的是最底下的串口（FakeTransport）和 VS Code 的消息通道，
 * 中间的 store → 客户端 → 协议 → 宿主 → 会话 → 分帧 全是真代码。
 */

const OPTIONS: ConnectionOptions = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
};

const PORTS: NodePortInfo[] = [
  { path: 'COM3', vendorId: '1a86', productId: '7523', serialNumber: 'SN1' },
  { path: 'COM4', vendorId: '0403', productId: '6001', serialNumber: 'SN2' },
];

type ConnectionModule = typeof connectionModule;
type SendModule = typeof sendModule;
type PresetModule = typeof presetModule;
type TasksModule = typeof tasksModule;
type LogModule = typeof logModule;
type RecordModule = typeof recordModule;

interface Loopback {
  transports: FakeTransport[];
  /** 宿主侧的会话。用来模拟「命令面板 / 快捷键」这类不经过界面的入口。 */
  host: SessionHost;
  transport: () => FakeTransport;
  leases: PortLeases;
  watcher: PortWatcher;
  /** 宿主收到的偏好写入，按到达顺序。扩展里它们会落进 globalState，并转给活动栏的端口视图。 */
  prefWrites: [key: string, value: unknown][];
  /** 录制真正写进「文件」的行。录制跑在宿主，所以面板隐藏期间它也该继续涨。 */
  recorded: string[];
  connection: ConnectionModule;
  send: SendModule;
  preset: PresetModule;
  tasks: TasksModule;
  log: LogModule;
  /** 等消息在两侧之间跑完一圈。 */
  settle: () => Promise<void>;
  /**
   * 模拟面板被隐藏。
   *
   * VS Code 会把隐藏的 webview 整个销毁，它那一侧的定时器、闭包、状态全部消失。
   * 在同一个进程里没法真的销毁一个模块，但可以还原这件事的**本质**：把两侧之间的
   * 通道掐断。此后 webview 里跑的任何东西都到不了串口，而宿主里跑的照旧。
   */
  hidePanel: () => void;
  /**
   * 模拟面板被隐藏后再显示：界面整个重新求值，再把宿主的快照回放进去。用的是建面板那一刻的
   * HTML，即宿主没来得及把新偏好烙进去时的情形（见 host/panelHtml.ts）—— 回放不该依赖那一步。
   * 新界面同样不连着宿主，只用来看回放出来的结果。
   */
  rebuildPanel: () => Promise<{ log: LogModule; record: RecordModule }>;
}

let disposeHost: (() => void) | null = null;

/** `prefs` 是建面板时扩展宿主 globalState 里已有的偏好。 */
async function loopback(options: { prefs?: Record<string, unknown> } = {}): Promise<Loopback> {
  vi.resetModules();

  const transports: FakeTransport[] = [];
  const leases = new PortLeases();
  const watcher = new PortWatcher({ list: () => Promise.resolve(PORTS), intervalMs: 60_000 });
  await watcher.refresh();

  let hidden = false;
  // 这一套回环收尾之后，还有异步的尾巴会回来：界面里攒批的偏好写入、还没处理完的请求。
  // 它们回来时下一条用例已经开始，甚至整个文件的 jsdom 都已拆掉，再往 window 派发就是
  // 一个测试之外的未处理错误（CI 机器慢一点时真的出现过：window is not defined）
  let closed = false;
  const prefWrites: [string, unknown][] = [];
  const recorded: string[] = [];
  const prefs: Record<string, unknown> = { ...options.prefs };
  // 与 extension.ts 的 renderHtml 一样，只在建面板时烙一次
  document.body.innerHTML = '<div id="root"></div>';
  document.getElementById('root')!.dataset.prefs = JSON.stringify(prefs);

  // 宿主 → webview：VS Code 那边是 webview.postMessage，这里就是一个 message 事件
  const post = (event: HostEvent): void => {
    if (hidden || closed) return;
    window.dispatchEvent(new MessageEvent('message', { data: event }));
  };

  const host = new SessionHost({
    id: 'panel-loopback',
    leases,
    watcher,
    createTransport: () => {
      const transport = new FakeTransport();
      transports.push(transport);
      return transport;
    },
    post,
    pickPort: () => Promise.resolve(undefined),
    pickRecordFile: () => Promise.resolve('capture.log'),
    createRecordSink: () => ({
      write: (line) => recorded.push(line),
      close: () => Promise.resolve(),
    }),
    readPrefs: () => prefs,
    writePref: (key, value) => {
      prefs[key] = value;
      prefWrites.push([key, value]);
    },
    language: 'zh',
    defaultOptions: OPTIONS,
  });
  const activeHost = host;
  disposeHost = () => {
    closed = true;
    activeHost.dispose();
    watcher.stop();
  };

  // webview → 宿主：走的是扩展里同一段请求处理代码
  const api: VsCodeApi = {
    postMessage: (message) => {
      // 面板被隐藏后 webview 已经不存在了，它发不出任何东西
      if (hidden || closed) return;
      void handleRequest(activeHost, message as HostRequest).then((response) => {
        if (closed) return;
        window.dispatchEvent(new MessageEvent('message', { data: response }));
      });
    },
    getState: () => undefined,
    setState: (state) => state,
  };

  // 用真实的 bootstrap 装环境：`acquireVsCodeApi` 换成回环的那一头即可。
  // 初始化顺序本身就出过两次问题（store 早于 setPlatform 求值、快照早于界面到达），
  // 让测试跑真代码而不是另抄一份接线，才可能把这类问题挡在这里。
  vi.stubGlobal('acquireVsCodeApi', () => api);
  const bootstrap = await import('./bootstrap');
  const view = await import('./applySnapshot');
  bootstrap.attachView(view);

  const connection = await import('@/store/connectionStore');
  const unwatch = connection.watchPortChanges();
  const previousDispose = disposeHost;
  disposeHost = () => {
    unwatch();
    previousDispose?.();
  };

  const settle = async (): Promise<void> => {
    // 消息在两侧之间跑的是微任务，多让几轮确保跑完一圈
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };
  await settle();

  return {
    transports,
    recorded,
    host: activeHost,
    transport: () => transports[transports.length - 1]!,
    leases,
    watcher,
    prefWrites,
    connection,
    send: await import('@/store/sendStore'),
    preset: await import('@/store/presetStore'),
    tasks: await import('@/store/tasksStore'),
    log: await import('@/store/logStore'),
    settle,
    hidePanel: () => {
      hidden = true;
    },
    rebuildPanel: async () => {
      hidden = true;
      vi.resetModules();
      const bootstrap = await import('./bootstrap');
      const log = await import('@/store/logStore');
      const record = await import('@/store/recordStore');
      const view = await import('./applySnapshot');
      bootstrap.attachView(view);
      const snapshot = activeHost.snapshot();
      if (snapshot.type !== 'snapshot') throw new Error('unreachable');
      // 走真实路径把快照送进去，而不是直接调 applySnapshot：运行环境自己也存着
      // 一份状态（录制就在那儿），绕过客户端的那条路只能恢复 store 里的那一半
      window.dispatchEvent(new MessageEvent('message', { data: snapshot }));
      log.flushPendingEntries();
      return { log, record };
    },
  };
}

beforeEach(async () => {
  // 同 store/tasks.test.ts：攒批中的写入会跨用例落盘，先丢掉再清存储
  (await import('@/lib/persist')).__resetPersistForTests();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  disposeHost?.();
  disposeHost = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('webview ⇄ 扩展宿主 回环', () => {
  it('界面报到后拿到端口列表', async () => {
    const app = await loopback();

    expect(app.connection.useConnectionStore.getState().ports.map((port) => port.key)).toEqual([
      'COM3',
      'COM4',
    ]);
  });

  it('打开端口这条路径能一路走到传输层，并登记占用', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');

    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    expect(app.transports).toHaveLength(1);
    expect(app.transport().state).toBe('open');
    expect(app.leases.holderOf('COM3')).toBe('panel-loopback');
    expect(app.connection.useConnectionStore.getState().sessionState).toBe('open');
  });

  it('发送的字节真的落到串口上', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    await app.connection.useConnectionStore.getState().send(new Uint8Array([0x41, 0x42]));
    await app.settle();

    expect(app.transport().written).toEqual([new Uint8Array([0x41, 0x42])]);
  });

  it('设备发来的数据一路回到日志里', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    app.transport().emitData([0x68, 0x69]);
    await app.settle();
    // 宿主攒批 60ms 后才推过来
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.settle();
    app.log.flushPendingEntries();

    expect(app.log.allEntries().some((entry) => entry.text.includes('hi'))).toBe(true);
  });

  /**
   * 「清空」曾经只清 webview 这一侧，宿主的环形缓冲毫不知情 —— 面板一隐藏再显示，
   * snapshot() 就把用户明确清掉的日志原样灌了回来。
   *
   * 又一个只长在接缝上的缺陷：clear() 有测试、snapshot() 有测试，两侧各自都对，
   * 错的是没人把「清空之后面板重建」这条路走一遍。
   */
  it('清空日志会连宿主保留的那份一起丢，面板重建后不会又冒出来', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    app.transport().emitData([0x68, 0x69]);
    await app.settle();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.settle();
    app.log.flushPendingEntries();
    expect(app.log.allEntries()).not.toHaveLength(0);

    app.log.useLogStore.getState().clearAll();
    await app.settle();

    // 界面这一侧空了。这部分本来就是对的，真正的问题在下面
    expect(app.log.allEntries()).toHaveLength(0);

    // 宿主那一侧也必须空 —— 它才是面板重建后日志的来源
    const snapshot = app.host.snapshot();
    if (snapshot.type !== 'snapshot') throw new Error('unreachable');
    expect(snapshot.frames).toHaveLength(0);

    // 走一遍真实的重建路径：隐藏，然后把快照回放回来。清掉的东西不该复活
    app.hidePanel();
    const view = await import('./applySnapshot');
    view.applySnapshot(snapshot);
    app.log.flushPendingEntries();
    expect(app.log.allEntries()).toHaveLength(0);
  });

  /**
   * 这一条是整个回环测试存在的理由。
   *
   * 周期任务必须真的跑在宿主那一侧 —— 面板被隐藏时 webview 连同定时器一起销毁，
   * 只有宿主执行的任务才能继续。调用点漏传 frames 时两侧的单元测试全绿，
   * 只有把它们接起来才看得见「循环启动了，但宿主那边什么都没发生」。
   */
  it('周期发送真的跑在宿主那一侧', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    app.send.useSendStore.getState().setMode('hex');
    app.send.useSendStore.getState().setPayload('A5');
    app.send.useSendStore.getState().setIntervalMs(50);
    app.send.useSendStore.getState().toggleLoop();
    await app.settle();

    // 宿主侧的调度器在跑，webview 这边一个定时器都没有
    await new Promise((resolve) => setTimeout(resolve, 180));
    await app.settle();

    const sent = app.transport().written.filter((bytes) => bytes[0] === 0xa5);
    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(app.tasks.useTasksStore.getState().running).toContain(app.tasks.SINGLE_TASK);
  });

  /**
   * **这一条才是能抓住那个 bug 的用例。**
   *
   * 上面那条「周期发送真的跑在宿主那一侧」其实抓不住它：回环里两侧同在一个进程，
   * 就算任务跑在 webview，它的 send 照样能通过 RPC 把字节送到串口，测试照样绿。
   * 「跑在哪一侧」这个区别只有在 webview 被销毁时才显形 —— 所以必须先把面板隐藏掉。
   */
  it('面板被隐藏后周期发送仍在继续 —— 这是它必须跑在宿主的全部理由', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    app.send.useSendStore.getState().setMode('hex');
    app.send.useSendStore.getState().setPayload('A5');
    app.send.useSendStore.getState().setIntervalMs(40);
    app.send.useSendStore.getState().toggleLoop();
    await app.settle();
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 用户切到别的标签页：webview 连同它的定时器一起没了
    app.hidePanel();
    const before = app.transport().written.length;
    await new Promise((resolve) => setTimeout(resolve, 220));

    // 宿主那一侧的调度器不受影响，串口上照旧有东西出去
    expect(app.transport().written.length).toBeGreaterThan(before + 2);
  });

  /**
   * 信号线必须由宿主那一侧真的写下去。
   *
   * webview 里连 `navigator.serial` 都没有，界面上点 DTR 只是发一条 RPC；
   * 这条把整段接线跑一遍，顺带盯住「只动被提到的那条线」—— 那是 ESP32
   * 不被意外复位的全部保证。
   */
  it('点 DTR 会让宿主那边真的改那一条线，且只改那一条', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    await app.connection.useConnectionStore.getState().toggleOutputLine('dataTerminalReady');
    await app.settle();

    expect(app.transport().signalWrites).toEqual([{ dataTerminalReady: false }]);
    expect(app.connection.useConnectionStore.getState().outputSignals).toEqual({
      dataTerminalReady: false,
      requestToSend: true,
    });
  });

  it('Break 是一拉一放的脉冲，两次都走到宿主', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    await app.connection.useConnectionStore.getState().sendBreak();
    await app.settle();

    expect(app.transport().signalWrites).toEqual([{ break: true }, { break: false }]);
  });

  it('输入线的读数一路从宿主回到界面', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    app.transport().inputs = {
      clearToSend: true,
      dataCarrierDetect: false,
      dataSetReady: true,
      ringIndicator: false,
    };

    await expect(
      app.connection.useConnectionStore.getState().readInputSignals(),
    ).resolves.toMatchObject({ clearToSend: true, dataSetReady: true });
  });

  /**
   * 与上一条同一个道理，换成录制。
   *
   * 录制若挂在 webview 上，面板一隐藏文件就断了 —— 而「挂一夜等一次偶发异常」
   * 正是录制存在的全部理由，断掉的那一版在同进程的回环里照样是绿的。
   * 所以这里也必须先把面板隐藏掉，再看文件有没有继续长。
   */
  it('面板被隐藏后录制仍在写 —— 这是它必须跑在宿主的全部理由', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    const record = await import('@/store/recordStore');
    await record.useRecordStore.getState().toggle();
    await app.settle();
    expect(record.useRecordStore.getState().status.active).toBe(true);

    // 默认是空闲分帧，得等静默超时帧才成形
    app.transport().emitData([0x41]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await app.settle();

    // 用户切到别的标签页：webview 连同它的一切一起没了
    app.hidePanel();
    const before = app.recorded.length;
    app.transport().emitData([0x42]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await app.settle();

    expect(app.recorded.length).toBeGreaterThan(before);
    expect(app.recorded.at(-1)).toMatch(/\[RX\] B$/);
  });

  it('面板重建后录制按钮仍显示在录 —— 状态靠快照接回来', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    const record = await import('@/store/recordStore');
    await record.useRecordStore.getState().toggle();
    await app.settle();

    const rebuilt = await app.rebuildPanel();
    expect(rebuilt.record.useRecordStore.getState().status.active).toBe(true);
    expect(rebuilt.record.useRecordStore.getState().status.target).toBe('capture.log');
  });

  it('循环期间改报文，宿主随即发的是新内容', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    app.send.useSendStore.getState().setMode('hex');
    app.send.useSendStore.getState().setPayload('01');
    app.send.useSendStore.getState().setIntervalMs(50);
    app.send.useSendStore.getState().toggleLoop();
    await app.settle();
    await new Promise((resolve) => setTimeout(resolve, 80));

    app.send.useSendStore.getState().setPayload('02');
    await app.settle();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await app.settle();

    expect(app.transport().written.at(-1)).toEqual(new Uint8Array([0x02]));
  });

  it('停止循环后宿主那边也真的停了', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    app.send.useSendStore.getState().setIntervalMs(30);
    app.send.useSendStore.getState().toggleLoop();
    await app.settle();
    await new Promise((resolve) => setTimeout(resolve, 100));

    app.send.useSendStore.getState().toggleLoop();
    await app.settle();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const settled = app.transport().written.length;

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(app.transport().written).toHaveLength(settled);
  });

  it('关闭端口后占用被释放，链路也真的断了', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    expect(app.leases.holderOf('COM3')).toBeUndefined();
    expect(app.connection.useConnectionStore.getState().sessionState).toBe('closed');
    expect(app.transport().state).toBe('closed');
  });

  /**
   * 缺陷：`selected` 事件宿主一直在发，webview 这侧却没有任何人注册处理器
   * （SessionClient 声明了 onSelected、也派发了，vscodePlatform 的 setHandlers 漏了它）。
   * 于是命令面板/快捷键触发的连接对界面完全不可见 —— 界面显示一套参数、
   * 实际以另一套开着，谁也看不出来。
   */
  it('宿主那边换了端口与参数，界面跟着变', async () => {
    const app = await loopback();
    const store = app.connection.useConnectionStore;
    store.getState().selectPort('COM3');
    await app.settle();

    // 不经过界面：命令面板那条路径直接落在宿主上
    await app.host.handle({
      method: 'session.open',
      portKey: 'COM4',
      options: { ...OPTIONS, baudRate: 9600 },
    });
    await app.settle();

    expect(store.getState().selectedPortKey).toBe('COM4');
    expect(store.getState().options.baudRate).toBe(9600);
  });

  /** 背压读数在宿主那一侧，不捎回来的话界面上永远是 0。 */
  it('写队列的积压量一路回到界面', async () => {
    const app = await loopback();
    const store = app.connection.useConnectionStore;
    store.getState().selectPort('COM3');
    await store.getState().toggleConnection();
    await app.settle();

    expect(store.getState().pendingBytes()).toBe(0);

    app.transport().pendingBytes = 128;
    app.transport().emitData(new Uint8Array([0x41]));
    await vi.waitFor(() => {
      expect(store.getState().pendingBytes()).toBe(128);
    });
  });

  /**
   * 端口备注在面板里改、在活动栏里显示，中间隔着 prefStore → RPC → 宿主，键名与值的
   * 形状在这一路上都会变。两侧各自的单元测试只能拿「自己以为的形状」去测，
   * 对不上时各自照样是绿的。
   */
  it('面板里改了端口备注，活动栏的端口列表跟着显示', async () => {
    const app = await loopback();
    const aliases = await import('@/store/portAliasStore');
    const tree = new PortsTreeProvider({
      leases: app.leases,
      ensureWatcher: () => Promise.resolve(app.watcher),
      holderLabel: () => undefined,
      readPrefs: () => ({}),
    });
    const [port] = await tree.getChildren();

    aliases.usePortAliasStore.getState().setAlias(port!.identity, '温控板');
    await app.settle();

    // 扩展入口把宿主收到的每一条写入原样转给端口视图（extension.ts 的 writePref）
    for (const [key, value] of app.prefWrites) tree.applyPref(key, value);

    expect(tree.getTreeItem(port!).label).toBe('温控板 · COM3 · CH340 (1A86:7523)');
    tree.dispose();
  });

  /**
   * 日志容量得两侧一起跟上用户的设定，面板重建后回放才不会被截断，而两侧曾经各错一半：
   * 宿主拿不带前缀的键名、按数字去认这条偏好，一次都没认出来过；重建出来的界面则按
   * 建面板时的偏好定容量。两侧的单元测试当时都是绿的 —— 喂的都是自己以为的形状。
   */
  it('建面板后调过日志容量，宿主照着留，面板重建后回放的条数也对得上', async () => {
    const app = await loopback({ prefs: { [LOG_CAPACITY_PREF_KEY]: '1000' } });
    // 默认的空闲分帧会把一口气喂进去的数据并成一帧，条数就数不清了
    (await import('@/store/uiStore')).useUiStore.getState().setFrameMode('raw');
    const store = app.connection.useConnectionStore;
    store.getState().selectPort('COM3');
    await store.getState().toggleConnection();
    await app.settle();

    const hostKeeps = async (count: number): Promise<number> => {
      for (let i = 0; i < count; i += 1) app.transport().emitData([i & 0xff]);
      await new Promise((resolve) => setTimeout(resolve, 100)); // 宿主攒批
      await app.settle();
      const snapshot = app.host.snapshot();
      if (snapshot.type !== 'snapshot') throw new Error('unreachable');
      return snapshot.frames.length;
    };

    // 建面板时就存着的设定
    expect(await hostKeeps(1500)).toBe(1000);

    // 面板里调大，走真实的写入路径到宿主
    app.log.useLogStore.getState().setCapacity(2000);
    (await import('@/lib/persist')).flushPersist();
    await app.settle();
    expect(await hostKeeps(1500)).toBe(2000);

    const rebuilt = await app.rebuildPanel();
    expect(rebuilt.log.useLogStore.getState().capacity).toBe(2000);
    expect(rebuilt.log.allEntries()).toHaveLength(2000);
  });

  it('设备掉线的通知一路回到界面', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();
    app.connection.useConnectionStore.getState().setAutoReconnect(false);
    await app.settle();

    app.transport().emitUnplug('remote');
    await app.settle();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await app.settle();

    expect(app.connection.useConnectionStore.getState().sessionState).toBe('closed');
    expect(app.log.allEntries().some((entry) => entry.notice?.code === 'connection-lost')).toBe(
      true,
    );
  });

  /** 把两条预设摆进序列，其余全部取消勾选。 */
  function armSequence(app: Loopback): void {
    const store = app.preset.usePresetStore;
    for (const item of store.getState().presets) store.getState().setInSequence(item.id, false);
    const [a, b] = store.getState().presets;
    store.getState().setData(a!.id, 'AA');
    store.getState().setData(b!.id, 'BB');
    store.getState().setInSequence(a!.id, true);
    store.getState().setInSequence(b!.id, true);
  }

  function sentTexts(app: Loopback): string[] {
    const decoder = new TextDecoder();
    return app.transport().written.map((bytes) => decoder.decode(bytes));
  }

  /**
   * 「跑 N 遍就停」的判定必须也在宿主那一侧。
   *
   * 只在 webview 里数遍数的话，面板一隐藏计数就随它一起没了，序列会一直发到用户
   * 切回来为止 —— 而限定遍数要防的正是这件事。两侧的单元测试对此一律是绿的。
   */
  it('面板被隐藏后，跑够遍数的序列自己停了下来', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    armSequence(app);
    app.preset.usePresetStore.getState().setSequenceGapMs(20);
    app.preset.usePresetStore.getState().setSequenceRepeat(2);
    app.preset.usePresetStore.getState().toggleSequence();
    await app.settle();

    app.hidePanel();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(sentTexts(app)).toEqual(['AA', 'BB', 'AA', 'BB']);
  });

  /**
   * 每步延时同理：它随 frames 一起交出去，宿主照着走。
   * 只在 webview 侧算的话，面板一隐藏就退回统一间隔 —— 序列还在跑，节奏却变了，
   * 表现出来是「挂了一下午回来，设备被刷屏刷挂了」。
   */
  it('面板被隐藏后，每步延时仍按每条预设自己的周期走', async () => {
    const app = await loopback();
    app.connection.useConnectionStore.getState().selectPort('COM3');
    await app.connection.useConnectionStore.getState().toggleConnection();
    await app.settle();

    armSequence(app);
    const [a, b] = app.preset.usePresetStore.getState().presets;
    app.preset.usePresetStore.getState().setInterval(a!.id, 500);
    app.preset.usePresetStore.getState().setInterval(b!.id, 500);
    // 统一间隔故意调得极小：退回它的话 200ms 里会发出去十几条
    app.preset.usePresetStore.getState().setSequenceGapMs(10);
    app.preset.usePresetStore.getState().setSequenceStep('each');
    app.preset.usePresetStore.getState().toggleSequence();
    await app.settle();

    app.hidePanel();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(sentTexts(app)).toEqual(['AA']);
  });
});
