import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOG_CAPACITY_PREF_KEY } from '@/core/buffer/logCapacity';
import type { ConnectionOptions } from '@/core/transport/types';
import { __resetPersistForTests } from '@/lib/persist';
import { __resetStorageBackendsForTests } from '@/lib/storage';
import {
  __resetLogStoreForTests,
  allEntries,
  flushPendingEntries,
  useLogStore,
} from '@/store/logStore';
import { useUiStore } from '@/store/uiStore';
import type { FramePayload, HostEvent } from '../shared/protocol';
import { applySnapshot } from './applySnapshot';
import { installPrefStore } from './prefStore';

const OPTIONS: ConnectionOptions = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
};

type Snapshot = Extract<HostEvent, { type: 'snapshot' }>;

function snapshot(language: string, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    kind: 'event',
    type: 'snapshot',
    ports: [],
    holders: {},
    selectedPortKey: null,
    options: OPTIONS,
    autoReconnect: false,
    state: 'closed',
    openedAt: 0,
    pendingBytes: 0,
    frames: [],
    runningTasks: [],
    prefs: {},
    language,
    ...overrides,
  };
}

function frames(count: number): FramePayload[] {
  return Array.from({ length: count }, (_, i) => ({
    direction: 'rx' as const,
    at: i,
    bytes: new Uint8Array([i & 0xff]),
  }));
}

/** 宿主把偏好烙在 #root 的 data-prefs 上，webview 开机即读（见 prefStore）。 */
function seedPrefs(prefs: Record<string, string>): void {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root');
  if (root) root.dataset.prefs = JSON.stringify(prefs);
  installPrefStore(() => undefined);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  __resetStorageBackendsForTests();
  document.body.innerHTML = '';
});

describe('快照回放的语言', () => {
  it('没存过偏好时采用宿主的显示语言', () => {
    seedPrefs({});
    useUiStore.setState({ language: 'zh' });

    applySnapshot(snapshot('en-us'));

    // webview 的 navigator.language 未必等于 VS Code 的显示语言，
    // 宿主传来的那个才准 —— 所以「没存过就用它」这条得留着
    expect(useUiStore.getState().language).toBe('en');
  });

  /**
   * 面板一隐藏 webview 就被销毁，重新显示时会重放快照。曾经这里是无条件覆盖，
   * 于是中文 VS Code 里手动切到英文的用户，每切一次标签页就被打回中文一次。
   */
  it('用户手动切过之后，快照不再覆盖他的选择', () => {
    seedPrefs({ 'wst.lang': 'en' });
    useUiStore.setState({ language: 'en' });

    applySnapshot(snapshot('zh-cn'));

    expect(useUiStore.getState().language).toBe('en');
  });

  it('反过来也一样：中文偏好不会被英文宿主冲掉', () => {
    seedPrefs({ 'wst.lang': 'zh' });
    useUiStore.setState({ language: 'zh' });

    applySnapshot(snapshot('en'));

    expect(useUiStore.getState().language).toBe('zh');
  });
});

describe('快照回放的日志容量', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
  });

  afterEach(() => {
    __resetPersistForTests();
  });

  it('回放前先对齐到最新设定，历史不会被重建时的旧容量截掉', () => {
    // 建面板时容量是 1000，之后调到了 2000：重建出来的界面只知道前者
    seedPrefs({ [LOG_CAPACITY_PREF_KEY]: '1000' });
    useLogStore.getState().setCapacity(1000);

    applySnapshot(
      snapshot('zh', { prefs: { [LOG_CAPACITY_PREF_KEY]: '2000' }, frames: frames(1500) }),
    );
    flushPendingEntries();

    expect(useLogStore.getState().capacity).toBe(2000);
    expect(allEntries()).toHaveLength(1500);
  });

  it('快照里没有容量设定、或设定不合法时维持现状', () => {
    seedPrefs({ [LOG_CAPACITY_PREF_KEY]: '1000' });
    useLogStore.getState().setCapacity(1000);

    applySnapshot(snapshot('zh'));
    applySnapshot(snapshot('zh', { prefs: { [LOG_CAPACITY_PREF_KEY]: '"many"' } }));

    expect(useLogStore.getState().capacity).toBe(1000);
  });
});
