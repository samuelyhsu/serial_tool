import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConnectionOptions } from '@/core/transport/types';
import { __resetStorageBackendsForTests } from '@/lib/storage';
import { useUiStore } from '@/store/uiStore';
import type { HostEvent } from '../shared/protocol';
import { applySnapshot } from './applySnapshot';
import { installPrefStore } from './prefStore';

const OPTIONS: ConnectionOptions = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
};

function snapshot(language: string): Extract<HostEvent, { type: 'snapshot' }> {
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
  };
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
