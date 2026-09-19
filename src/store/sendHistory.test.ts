import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStore } from './connectionStore';
import {
  SEND_HISTORY_MAX,
  SEND_HISTORY_MAX_LENGTH,
  useSendStore,
  type SendHistoryEntry,
} from './sendStore';

/**
 * 发送历史。
 *
 * 要害在「翻到一半改了两个字」这种半途而废的操作：游标必须作废，
 * 否则再按一次「上一条」会从旧位置跳走，把刚改的东西弄丢。
 */

function reset(state: Partial<ReturnType<typeof useSendStore.getState>> = {}): void {
  useSendStore.setState({
    payload: 'draft',
    mode: 'text',
    checksum: 'none',
    parseError: null,
    modeIssue: null,
    history: [],
    historyCursor: -1,
    historyDraft: null,
    ...state,
  });
}

function entries(...payloads: string[]): SendHistoryEntry[] {
  return payloads.map((payload) => ({ payload, mode: 'text' as const }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  reset();
  useConnectionStore.setState({ sessionState: 'open' });
});

describe('记录发过什么', () => {
  it('发出去之后进历史，最近的在前', async () => {
    reset({ payload: 'A' });
    await useSendStore.getState().sendOnce();
    useSendStore.setState({ payload: 'B' });
    await useSendStore.getState().sendOnce();

    expect(useSendStore.getState().history.map((entry) => entry.payload)).toEqual(['B', 'A']);
  });

  // 端口没开时那一下是被会话拒掉的，记进「发过什么」只会让人以为发过了
  it('端口没开时不记', async () => {
    useConnectionStore.setState({ sessionState: 'closed' });
    await useSendStore.getState().sendOnce();

    expect(useSendStore.getState().history).toHaveLength(0);
  });

  it('重复的提到最前，而不是堆成一串一模一样的', async () => {
    reset({ payload: 'A' });
    await useSendStore.getState().sendOnce();
    useSendStore.setState({ payload: 'B' });
    await useSendStore.getState().sendOnce();
    useSendStore.setState({ payload: 'A' });
    await useSendStore.getState().sendOnce();

    expect(useSendStore.getState().history.map((entry) => entry.payload)).toEqual(['A', 'B']);
  });

  it('同样的字符在两种模式下是两条 —— 它们是不同的字节', async () => {
    reset({ payload: 'AB', mode: 'text' });
    await useSendStore.getState().sendOnce();
    useSendStore.setState({ mode: 'hex' });
    await useSendStore.getState().sendOnce();

    expect(useSendStore.getState().history).toHaveLength(2);
  });

  it('超过上限就丢掉最旧的', async () => {
    for (let i = 0; i < SEND_HISTORY_MAX + 5; i += 1) {
      useSendStore.setState({ payload: `cmd${i}` });
      await useSendStore.getState().sendOnce();
    }

    const { history } = useSendStore.getState();
    expect(history).toHaveLength(SEND_HISTORY_MAX);
    expect(history[0]?.payload).toBe(`cmd${SEND_HISTORY_MAX + 4}`);
  });

  // 截断存进去会毁掉内容，不如不记
  it('过长的报文不进历史', async () => {
    reset({ payload: 'x'.repeat(SEND_HISTORY_MAX_LENGTH + 1) });
    await useSendStore.getState().sendOnce();

    expect(useSendStore.getState().history).toHaveLength(0);
  });

  it('解析不通过时压根没发出去，也不记', async () => {
    reset({ payload: 'ZZ', mode: 'hex' });
    await useSendStore.getState().sendOnce();

    expect(useSendStore.getState().history).toHaveLength(0);
  });
});

describe('翻历史', () => {
  it('往前翻依次取更早的', () => {
    reset({ payload: 'draft', history: entries('A', 'B') });
    const store = useSendStore.getState();

    store.recallHistory(1);
    expect(useSendStore.getState().payload).toBe('A');
    useSendStore.getState().recallHistory(1);
    expect(useSendStore.getState().payload).toBe('B');
  });

  it('翻回头把草稿原样还回来', () => {
    reset({ payload: 'draft', history: entries('A') });

    useSendStore.getState().recallHistory(1);
    useSendStore.getState().recallHistory(-1);

    expect(useSendStore.getState().payload).toBe('draft');
    expect(useSendStore.getState().historyCursor).toBe(-1);
  });

  // 绕回另一头会让连按变成原地转圈，谁也数不清自己在第几条
  it('到头就停住，不绕回去', () => {
    reset({ payload: 'draft', history: entries('A') });

    useSendStore.getState().recallHistory(1);
    useSendStore.getState().recallHistory(1);
    expect(useSendStore.getState().payload).toBe('A');

    useSendStore.getState().recallHistory(-1);
    useSendStore.getState().recallHistory(-1);
    expect(useSendStore.getState().payload).toBe('draft');
  });

  it('历史为空时什么都不做', () => {
    reset({ payload: 'draft' });
    useSendStore.getState().recallHistory(1);
    expect(useSendStore.getState().payload).toBe('draft');
  });

  /**
   * 翻到一半改了两个字，再按一次「上一条」应该从头开始翻 ——
   * 接着上一次的位置跳走，等于把刚改的东西弄丢。
   */
  it('用户一动输入框，这一轮翻历史就结束', () => {
    reset({ payload: 'draft', history: entries('A', 'B') });

    useSendStore.getState().recallHistory(1);
    useSendStore.getState().setPayload('A modified');
    expect(useSendStore.getState().historyCursor).toBe(-1);

    useSendStore.getState().recallHistory(1);
    expect(useSendStore.getState().payload).toBe('A');
    // 现在的草稿是改过的那份
    useSendStore.getState().recallHistory(-1);
    expect(useSendStore.getState().payload).toBe('A modified');
  });

  it('翻到 HEX 的那条会连模式一起切过去', () => {
    reset({ payload: 'draft', mode: 'text', history: [{ payload: 'AA BB', mode: 'hex' }] });

    useSendStore.getState().recallHistory(1);
    expect(useSendStore.getState().mode).toBe('hex');
    expect(useSendStore.getState().parseError).toBeNull();
  });

  it('点列表里的一条直接取用，并结束这一轮', () => {
    reset({ payload: 'draft', history: entries('A', 'B') });

    useSendStore.getState().applyHistory(1);
    expect(useSendStore.getState().payload).toBe('B');
    expect(useSendStore.getState().historyCursor).toBe(-1);
  });

  it('点一个不存在的下标不会把输入框清掉', () => {
    reset({ payload: 'draft', history: entries('A') });
    useSendStore.getState().applyHistory(9);
    expect(useSendStore.getState().payload).toBe('draft');
  });

  it('清空历史之后再翻什么都不会发生', () => {
    reset({ payload: 'draft', history: entries('A') });
    useSendStore.getState().clearHistory();
    useSendStore.getState().recallHistory(1);

    expect(useSendStore.getState().history).toHaveLength(0);
    expect(useSendStore.getState().payload).toBe('draft');
  });
});

describe('历史的持久化', () => {
  it('刷新后还在，且只认形状对的条目', async () => {
    localStorage.setItem(
      'wst.sendHistory',
      JSON.stringify([
        { payload: 'A', mode: 'hex' },
        { payload: '', mode: 'text' },
        { mode: 'text' },
        'nope',
        { payload: 'B', mode: 'bogus' },
      ]),
    );

    vi.resetModules();
    const store = await import('./sendStore');
    const { history } = store.useSendStore.getState();

    expect(history).toEqual([
      { payload: 'A', mode: 'hex' },
      // 模式不认得就退回 text，而不是整条丢掉
      { payload: 'B', mode: 'text' },
    ]);
  });

  it('存量不是数组时当作空历史', async () => {
    localStorage.setItem('wst.sendHistory', JSON.stringify({ payload: 'A' }));

    vi.resetModules();
    const store = await import('./sendStore');
    expect(store.useSendStore.getState().history).toHaveLength(0);
  });
});
