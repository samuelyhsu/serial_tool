import type { BufferedSink } from '@/core/log/bufferedSink';
import { logFileName } from '@/core/log/logLine';
import { FrameRecorder } from '@/core/log/recorder';
import { TaskScheduler } from '@/core/scheduler/taskScheduler';
import type { SessionNotice } from '@/core/session/notices';
import { SerialSession, type SessionEvents } from '@/core/session/serialSession';
import { TransportError } from '@/core/transport/errors';
import type { PortDescriptor } from '@/core/transport/portDescriptor';
import { describePorts, portKey } from '@/core/transport/portRegistry';
import type { ConnectionOptions } from '@/core/transport/types';
import { isWebSerialSupported, WebSerialTransport } from '@/core/transport/webSerialTransport';
import { isFileRecordingSupported, openFileSink } from '@/lib/fileSink';
import { createPortLeases } from '@/lib/portLease';
import type { Platform, RecorderLike, SessionLike, TasksLike } from './platform';

/**
 * 浏览器运行环境。
 *
 * 这里集中了整个应用对 `navigator.serial` 的全部依赖 —— 之前它们散在
 * connectionStore 里，把 store 钉死在了浏览器上。搬出来之后 store 只认 Platform 接口，
 * 同一套界面才能既跑在网页里、又跑在 VS Code 的 webview 里。
 */

/**
 * 会话，外加一条「往日志里说句话」的出口。
 *
 * 录制的回执要走通知（i18n 在渲染时才发生），而通知的接收方是 store 通过
 * setHandlers 交进来的 —— 这里把它捞出来给录制器用。
 */
interface WebSession {
  session: SessionLike;
  notify: (notice: SessionNotice) => void;
}

function createSession(recorder: FrameRecorder): WebSession {
  let describe: (options: ConnectionOptions) => string = () => '';
  let handlers: Partial<SessionEvents> = {};

  const session = new SerialSession<SerialPort>({
    createTransport: (port) => new WebSerialTransport(port),
    // 重连时按稳定 key 重新解析端口对象（缺陷 D1）
    resolvePort: async (key) => {
      if (!isWebSerialSupported()) return undefined;
      const ports = await navigator.serial.getPorts();
      return ports.find((port) => portKey(port) === key);
    },
    describeConfig: (options) => describe(options),
  });

  const wrapped: SessionLike = {
    setHandlers: (next) => {
      handlers = next;
      session.setHandlers({
        ...next,
        // 录制挂在帧产生的这一侧，store 因此完全不必知道有录制这回事 ——
        // 与 VS Code 里「录制在宿主」的接法是同一个位置
        onFrame: (direction, bytes) => {
          recorder.record(direction, bytes, Date.now());
          next.onFrame?.(direction, bytes);
        },
      });
    },
    setConfigDescriber: (next) => {
      describe = next;
    },
    open: async (key, options) => {
      const ports = await navigator.serial.getPorts();
      const port = ports.find((item) => portKey(item) === key);
      // 端口已经不在授权列表里（拔掉了、或撤销了授权）：这不是「打开失败」，
      // 而是「这台设备现在不存在」，交给 store 去刷新列表
      if (!port) throw new TransportError('invalid-state', `Port ${key} is no longer available`);
      await session.open(port, key, options);
    },
    close: () => session.close(),
    // 失败原因界面已经从通知里拿到了
    send: async (bytes) => {
      await session.send(bytes);
    },
    setFraming: (config) => session.setFraming(config),
    setReconnectSettings: (settings) => session.setReconnectSettings(settings),
    get pendingBytes() {
      return session.pendingBytes;
    },
    dispose: () => {
      void session.dispose();
    },
  };

  return { session: wrapped, notify: (notice) => handlers.onNotice?.(notice) };
}

/**
 * 浏览器侧的录制器。
 *
 * 落盘走 File System Access：用户选一次文件，此后一直往里追加。
 * 页面被关掉时来不及 close()，所以 pagehide 至少把攒着的那一批推进写入队列。
 */
function createRecorder(
  recorder: FrameRecorder,
  notify: (notice: SessionNotice) => void,
): {
  api: RecorderLike;
  flush: () => void;
} {
  let sink: BufferedSink | null = null;

  const api: RecorderLike = {
    supported: isFileRecordingSupported(),
    status: () => recorder.status,

    start: async (view) => {
      const opened = await openFileSink(logFileName(), (message) =>
        notify({ code: 'record-error', message }),
      );
      if (!opened) return false;
      sink = opened.sink;
      recorder.start(opened.sink, opened.name, view, Date.now());
      notify({ code: 'record-started', target: opened.name });
      return true;
    },

    stop: async () => {
      const finished = await recorder.stop();
      sink = null;
      if (finished.target !== null) {
        notify({ code: 'record-stopped', target: finished.target, lines: finished.lines });
      }
    },

    subscribe: (listener) => recorder.subscribe(listener),
  };

  return { api, flush: () => sink?.flush() };
}

function createTasks(): TasksLike {
  const scheduler = new TaskScheduler();
  const listeners = new Set<(running: string[]) => void>();
  const emit = (): void => {
    const running = scheduler.runningIds();
    for (const listener of listeners) listener(running);
  };

  return {
    start: (id, spec) => {
      scheduler.start(id, spec);
      emit();
    },
    stop: (id) => {
      scheduler.stop(id);
      emit();
    },
    stopAll: () => {
      scheduler.stopAll();
      emit();
    },
    update: (id, patch) => {
      if (patch.intervalMs !== undefined) scheduler.updateInterval(id, patch.intervalMs);
      // frames 在浏览器里用不上：执行体每一拍都重读最新状态，内容改动本来就即时生效
    },
    runningIds: () => scheduler.runningIds(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createWebPlatform(): Platform {
  const supported = isWebSerialSupported();
  const frameRecorder = new FrameRecorder();
  const { session, notify } = createSession(frameRecorder);
  const recorder = createRecorder(frameRecorder, notify);

  // 页面被关掉时 close() 已经来不及了（异步的一律作废），冲一次缓冲是能做到的极限
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => recorder.flush());
  }

  return {
    kind: 'web',
    supported,
    session,
    tasks: createTasks(),
    leases: createPortLeases(),
    recorder: recorder.api,

    listPorts: async () => {
      if (!supported) return [];
      return describePorts(await navigator.serial.getPorts());
    },

    requestPort: async (): Promise<PortDescriptor> => {
      if (!supported) throw new TransportError('unsupported', 'Web Serial is not available');
      const port = await navigator.serial.requestPort();
      const key = portKey(port);
      const ports = describePorts(await navigator.serial.getPorts());
      // 刚授权的端口理应出现在列表里；万一没有，也要把它描述出来交回去
      return ports.find((item) => item.key === key) ?? describePorts([port])[0]!;
    },

    watchPorts: (onChange) => {
      if (!supported) return () => undefined;
      navigator.serial.addEventListener('connect', onChange);
      navigator.serial.addEventListener('disconnect', onChange);
      return () => {
        navigator.serial.removeEventListener('connect', onChange);
        navigator.serial.removeEventListener('disconnect', onChange);
      };
    },

    // 浏览器里没有第二份历史：日志只在 logStore 的环形缓冲里，它清完就干净了
    clearLog: () => undefined,
  };
}
