import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameRecorder, type RecordSink } from '@/core/log/recorder';
import type { LogView } from '@/core/log/logLine';
import type { Platform } from './platform';

/**
 * 录制状态的真相源在运行环境里，store 只是它的镜子。
 *
 * 这条与周期任务同一个道理：界面若另存一份「是否在录」的布尔标志，
 * 迟早会出现「按钮显示在录、文件其实早停了」—— 尤其在 VS Code 里，
 * 录制跑在宿主进程，面板隐藏期间它一直在动，界面完全不知情。
 */

interface Harness {
  recorder: FrameRecorder;
  sink: RecordSink & { lines: string[] };
  /** 用户在文件对话框里选了什么；null 表示取消。 */
  target: { name: string | null };
  startedWith: LogView[];
}

function fakePlatform(harness: Harness): Platform {
  return {
    kind: 'web',
    supported: true,
    session: {
      setHandlers: () => undefined,
      setConfigDescriber: () => undefined,
      open: () => Promise.resolve(),
      close: () => Promise.resolve(),
      send: () => Promise.resolve(),
      setFraming: () => undefined,
      setReconnectSettings: () => undefined,
      pendingBytes: 0,
      dispose: () => undefined,
    },
    tasks: {
      start: () => undefined,
      stop: () => undefined,
      stopAll: () => undefined,
      update: () => undefined,
      runningIds: () => [],
      subscribe: () => () => undefined,
    },
    leases: {
      holders: () => ({}),
      claim: () => undefined,
      release: () => undefined,
      refresh: () => undefined,
      subscribe: () => () => undefined,
      dispose: () => undefined,
    },
    recorder: {
      supported: true,
      status: () => harness.recorder.status,
      start: (view) => {
        harness.startedWith.push(view);
        if (harness.target.name === null) return Promise.resolve(false);
        harness.recorder.start(harness.sink, harness.target.name, view, 0);
        return Promise.resolve(true);
      },
      stop: async () => {
        await harness.recorder.stop();
      },
      subscribe: (listener) => harness.recorder.subscribe(listener),
    },
    listPorts: () => Promise.resolve([]),
    requestPort: () => Promise.reject(new Error('not used')),
    watchPorts: () => () => undefined,
    clearLog: () => undefined,
  };
}

async function load(harness: Harness) {
  vi.resetModules();
  const platform = await import('./platform');
  platform.setPlatform(fakePlatform(harness));
  return {
    record: await import('./recordStore'),
    ui: await import('./uiStore'),
  };
}

let harness: Harness;

beforeEach(() => {
  const lines: string[] = [];
  harness = {
    recorder: new FrameRecorder(),
    sink: { lines, write: (line) => lines.push(line), close: () => Promise.resolve() },
    target: { name: 'a.log' },
    startedWith: [],
  };
  localStorage.clear();
  sessionStorage.clear();
});

describe('录制 store', () => {
  it('初始状态取自运行环境，不是另起一份默认值', async () => {
    harness.recorder.start(harness.sink, 'already.log', 'text', 0);
    const { record } = await load(harness);
    expect(record.useRecordStore.getState().status.target).toBe('already.log');
  });

  it('切换一次开始、再切一次停止', async () => {
    const { record } = await load(harness);
    await record.useRecordStore.getState().toggle();
    expect(record.useRecordStore.getState().status.active).toBe(true);

    await record.useRecordStore.getState().toggle();
    expect(record.useRecordStore.getState().status.active).toBe(false);
  });

  it('文件里的格式取点下这一刻的接收区视图', async () => {
    const { record, ui } = await load(harness);
    ui.useUiStore.getState().setView('hex');
    await record.useRecordStore.getState().toggle();
    expect(harness.startedWith).toEqual(['hex']);
  });

  // 之后界面再切 TXT/HEX 不该让已经开着的文件中途换格式
  it('开始之后再切视图，文件格式不跟着变', async () => {
    const { record, ui } = await load(harness);
    await record.useRecordStore.getState().toggle();
    ui.useUiStore.getState().setView('hex');
    harness.recorder.record('rx', new Uint8Array([0x41]), 0);
    expect(harness.sink.lines.at(-1)).toMatch(/\[RX\] A$/);
  });

  it('用户取消选文件时状态不变', async () => {
    harness.target.name = null;
    const { record } = await load(harness);
    await record.useRecordStore.getState().toggle();
    expect(record.useRecordStore.getState().status.active).toBe(false);
  });

  it('运行环境那边状态一变，界面立刻跟上 —— VS Code 里录制跑在宿主', async () => {
    const { record } = await load(harness);
    harness.recorder.start(harness.sink, 'host.log', 'text', 0);
    expect(record.useRecordStore.getState().status.target).toBe('host.log');

    harness.recorder.record('rx', new Uint8Array([0x41]), 0);
    expect(record.useRecordStore.getState().status.lines).toBe(1);
  });
});
