import { create } from 'zustand';
import { findChecksum, type ChecksumId } from '@/core/checksum';
import { isRecord, pickEnum, pickInt, pickString, saveSoon } from '@/lib/persist';
import { readLayeredJson } from '@/lib/storage';
import { useConnectionStore } from './connectionStore';
import { useLogStore } from './logStore';
import {
  buildFrame,
  convertPayload,
  payloadToBytes,
  type PayloadError,
  type PayloadMode,
} from './payload';
import { SINGLE_TASK, useTasksStore } from './tasksStore';

const SEND_KEY = 'sendPane';
const HISTORY_KEY = 'sendHistory';
const MODES: readonly PayloadMode[] = ['text', 'hex'];

/**
 * 发送历史保留多少条。
 *
 * 够用来翻回「刚才那条」和几条常用指令；再多的话该去多条发送里存成预设了 ——
 * 那边是有名字、能编排顺序的，历史只是个随手可及的回溯。
 */
export const SEND_HISTORY_MAX = 20;

/**
 * 单条报文超过这么长就不进历史。
 *
 * 历史要落到 localStorage 里，而报文本身没有长度上限（粘一段固件进去也合法）。
 * 截断存进去会毁掉内容，不如不记 —— 那种一次性的长报文本来也不是要反复发的。
 */
export const SEND_HISTORY_MAX_LENGTH = 4096;

/** 一条发送历史。带上模式，填回输入框时格式才不会错。 */
export interface SendHistoryEntry {
  payload: string;
  mode: PayloadMode;
}

function loadHistory(): SendHistoryEntry[] {
  const raw = readLayeredJson<unknown>(HISTORY_KEY, null);
  if (!Array.isArray(raw)) return [];
  const entries: SendHistoryEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const payload = pickString(item, 'payload', '');
    if (payload === '' || payload.length > SEND_HISTORY_MAX_LENGTH) continue;
    entries.push({ payload, mode: pickEnum(item, 'mode', MODES, 'text') });
    if (entries.length >= SEND_HISTORY_MAX) break;
  }
  return entries;
}

const DEFAULTS = {
  payload: 'AT+VER?',
  mode: 'text' as PayloadMode,
  // 默认不追加任何东西：不该在用户没要求时擅自改动报文
  checksum: 'none' as ChecksumId,
  intervalMs: 1000,
};

/**
 * 还原发送区。校验和的取值来自算法目录而不是固定枚举：
 * 目录里增删条目时，存量里那个已不存在的 id 会自动退回 'none'。
 */
function loadSendState(): typeof DEFAULTS {
  const raw = readLayeredJson<unknown>(SEND_KEY, null);
  const checksum = pickString(raw, 'checksum', DEFAULTS.checksum);
  return {
    payload: pickString(raw, 'payload', DEFAULTS.payload),
    mode: pickEnum(raw, 'mode', MODES, DEFAULTS.mode),
    checksum: checksum === 'none' || findChecksum(checksum) ? checksum : DEFAULTS.checksum,
    intervalMs: pickInt(raw, 'intervalMs', DEFAULTS.intervalMs, (v) => v >= 10),
  };
}

const restored = loadSendState();

interface SendState {
  payload: string;
  mode: PayloadMode;
  /** 发过的报文，最近的在前。只记真的写出去了的（见 sendOnce）。 */
  history: SendHistoryEntry[];
  /**
   * 正在翻历史时停在第几条；-1 表示没在翻，输入框里是用户自己的内容。
   *
   * 用户一动输入框游标就作废 —— 翻到一半改了两个字，再按一次「上一条」
   * 应该从头开始翻，而不是接着上一次的位置跳走、把改的东西弄丢。
   */
  historyCursor: number;
  /** 开始翻之前输入框里的东西，翻回头时原样还给用户。 */
  historyDraft: SendHistoryEntry | null;
  /** HEX 模式下自动追加的校验和；'none' 表示不追加。 */
  checksum: ChecksumId;
  intervalMs: number;
  /** 当前内容解析不通过的原因，null 表示没问题。TXT 也会有 —— 转义可能写错。 */
  parseError: PayloadError | null;
  /** 最近一次模式切换被拒绝的原因；用户再次编辑即清除。 */
  modeIssue: PayloadError | null;

  setPayload: (payload: string) => void;
  setMode: (mode: PayloadMode) => void;
  setChecksum: (checksum: ChecksumId) => void;
  setIntervalMs: (intervalMs: number) => void;
  frameBytes: () => Uint8Array | null;
  /** 把当前内容记进历史。由 sendOnce 调用，界面不直接用。 */
  rememberSent: () => void;
  sendOnce: () => Promise<void>;
  toggleLoop: () => void;
  /** 往更早（+1）或更近（-1）翻一条。到头就停住，不绕回去。 */
  recallHistory: (delta: 1 | -1) => void;
  /** 直接取用第 index 条（历史列表里点一下）。 */
  applyHistory: (index: number) => void;
  clearHistory: () => void;
}

function validate(payload: string, mode: PayloadMode): PayloadError | null {
  const result = payloadToBytes(payload, mode);
  return result.ok ? null : result.error;
}

export const useSendStore = create<SendState>()((set, get) => ({
  ...restored,
  history: loadHistory(),
  historyCursor: -1,
  historyDraft: null,
  // 存量内容可能在 HEX 模式下解析不通过，进来就要把错误标出来
  parseError: validate(restored.payload, restored.mode),
  modeIssue: null,

  setPayload: (payload) =>
    set((state) => ({
      payload,
      parseError: validate(payload, state.mode),
      modeIssue: null,
      // 用户一动输入框，这一轮翻历史就结束了
      historyCursor: -1,
      historyDraft: null,
    })),

  setMode: (mode) => {
    const state = get();
    if (state.mode === mode) return;

    const converted = convertPayload(state.payload, state.mode, mode);
    // 两个方向都无损了，只剩「当前内容本身就解析不通过」这一种失败（缺陷 D3 的后续）
    if (!converted.ok) {
      set({ modeIssue: converted.error });
      return;
    }
    set({
      mode,
      payload: converted.data,
      parseError: validate(converted.data, mode),
      modeIssue: null,
    });
  },

  setChecksum: (checksum) => set({ checksum }),

  setIntervalMs: (intervalMs) => {
    const clamped = Math.max(10, Math.round(intervalMs) || 10);
    set({ intervalMs: clamped });
    useTasksStore.getState().update(SINGLE_TASK, { intervalMs: clamped });
  },

  frameBytes: () => {
    const { payload, mode, checksum } = get();
    const result = buildFrame(payload, mode, checksum);
    return result.ok ? result.bytes : null;
  },

  sendOnce: async () => {
    const bytes = get().frameBytes();
    if (!bytes) return;
    // 只有真的写出去了才进历史：端口没开时那一下是被会话拒掉的，
    // 记进「发过什么」里只会让人以为发过了
    const wasOpen = useConnectionStore.getState().isOpen();
    await useConnectionStore.getState().send(bytes);
    if (wasOpen) get().rememberSent();
  },

  recallHistory: (delta) => {
    const { history, historyCursor, payload, mode, historyDraft } = get();
    if (history.length === 0) return;

    const next = historyCursor + delta;
    // 到头就停在原地。绕回另一头会让连按变成原地转圈，谁也数不清自己在第几条
    if (next < -1 || next >= history.length) return;

    // 第一次往前翻时把当前内容存下来，翻回 -1 时还给用户
    const draft = historyCursor === -1 ? { payload, mode } : historyDraft;
    const entry = next === -1 ? (draft ?? { payload, mode }) : history[next]!;

    set({
      historyCursor: next,
      historyDraft: next === -1 ? null : draft,
      payload: entry.payload,
      mode: entry.mode,
      parseError: validate(entry.payload, entry.mode),
      modeIssue: null,
    });
  },

  applyHistory: (index) => {
    const entry = get().history[index];
    if (!entry) return;
    set({
      payload: entry.payload,
      mode: entry.mode,
      parseError: validate(entry.payload, entry.mode),
      modeIssue: null,
      historyCursor: -1,
      historyDraft: null,
    });
  },

  clearHistory: () => set({ history: [], historyCursor: -1, historyDraft: null }),

  /** 把当前内容记进历史。重复的提到最前，而不是堆成一串一模一样的。 */
  rememberSent: () => {
    const { payload, mode, history } = get();
    if (payload === '' || payload.length > SEND_HISTORY_MAX_LENGTH) return;
    const rest = history.filter((entry) => entry.payload !== payload || entry.mode !== mode);
    set({ history: [{ payload, mode }, ...rest].slice(0, SEND_HISTORY_MAX) });
  },

  toggleLoop: () => {
    const tasks = useTasksStore.getState();
    if (tasks.running.includes(SINGLE_TASK)) {
      tasks.stop(SINGLE_TASK);
      return;
    }
    if (!useConnectionStore.getState().isOpen()) {
      useLogStore.getState().appendNotice({ code: 'not-open' });
      return;
    }
    const bytes = get().frameBytes();
    tasks.start(SINGLE_TASK, {
      intervalMs: get().intervalMs,
      // frames 交给会话所在的那一侧执行 —— 在 VS Code 里就是扩展宿主进程，
      // 面板被隐藏时 webview 连同定时器一起销毁，只有它能让循环继续跑下去。
      // 报文当前解析不通过就先给空列表，改对了由下面的订阅补进去。
      frames: bytes ? [{ bytes }] : [],
      // 浏览器侧的执行体：每次触发都读最新内容，循环期间改报文即时生效
      run: () => get().sendOnce(),
    });
  },
}));

useSendStore.subscribe(({ history }) => {
  saveSoon(HISTORY_KEY, history, 'layered');
});

useSendStore.subscribe(({ payload, mode, checksum, intervalMs }) => {
  // 分层作用域：在 A 页面打字不该让 B 页面的发送框跟着变（见 storage.ts）
  saveSoon(SEND_KEY, { payload, mode, checksum, intervalMs }, 'layered');

  // 循环期间改报文要即时生效。浏览器侧靠执行体重读状态自然就有；
  // 交给宿主执行时内容在那一头，必须显式推过去。
  const bytes = useSendStore.getState().frameBytes();
  useTasksStore.getState().update(SINGLE_TASK, { frames: bytes ? [{ bytes }] : [] });
});
