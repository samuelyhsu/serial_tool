import { create } from 'zustand';
import type { HexParseError } from '@/core/codec/hex';
import { BUILTIN_PRESET_KEYS, type BuiltinPresetKey, type Messages } from '@/i18n/types';
import { saveSoon } from '@/lib/persist';
import { readLayeredJson, readStoredJson } from '@/lib/storage';
import { useConnectionStore } from './connectionStore';
import { useLogStore } from './logStore';
import { buildFrame, convertPayload, type PayloadMode } from './payload';
import { presetTask, SEQUENCE_TASK, useTasksStore } from './tasksStore';

export interface Preset {
  id: string;
  /** 内置预设的翻译键；用户改名后置 null，此后不再随语言变化（缺陷 D16）。 */
  labelKey: BuiltinPresetKey | null;
  name: string;
  data: string;
  mode: PayloadMode;
  intervalMs: number;
  inSequence: boolean;
}

/**
 * 预设分组，界面上是一个标签页。
 *
 * 分组只记标题，预设本身仍按顺序排在 presets 里：第 i 组就是第 i 个 PRESET_TAB_SIZE 条。
 * 顺序循环、周期任务、交给宿主执行这些按整列工作的逻辑，因此都不必知道分组的存在。
 */
export interface PresetTab {
  id: string;
  /** 用户起的标题；null 表示没改过名，显示当前语言的默认标题（与预设的 labelKey 同理）。 */
  title: string | null;
}

/** 2 起带分组；1 是分组之前的一整列预设，导入与读取存量数据时仍然认。 */
export const PRESET_EXPORT_VERSION = 2;

/**
 * 每组固定 10 条。
 *
 * 固定条数换来的是不需要新增/删除行的按钮，每行也就能压成密度一致的一行；
 * 总量不够时新建一个分组，而不是把几十行堆在一个滚动区里。
 */
export const PRESET_TAB_SIZE = 10;
/** 新用户默认几组；旧版分页数据迁移过来时也至少保留这么多组。 */
export const PRESET_DEFAULT_TABS = 3;
/** 标签页上放不下更长的标题。 */
export const PRESET_TAB_TITLE_MAX = 16;

const DEFAULT_INTERVAL_MS = 1000;

let counter = 0;
const nextId = (): string => `p${++counter}`;
const nextTabId = (): string => `t${++counter}`;

const BUILTINS: readonly Omit<Preset, 'id' | 'name'>[] = [
  { labelKey: 'queryVersion', data: 'AT+VER?', mode: 'text', intervalMs: 1000, inSequence: true },
  { labelKey: 'readStatus', data: 'AT+STATUS?', mode: 'text', intervalMs: 500, inSequence: true },
  {
    labelKey: 'readTempHumidity',
    data: '01 03 00 00 00 02 C4 0B',
    mode: 'hex',
    intervalMs: 1000,
    inSequence: true,
  },
  {
    labelKey: 'readVoltage',
    data: '01 04 00 10 00 01 70 0D',
    mode: 'hex',
    intervalMs: 800,
    inSequence: true,
  },
  {
    labelKey: 'heartbeat',
    data: 'AA 55 01 00 FF',
    mode: 'hex',
    intervalMs: 2000,
    inSequence: false,
  },
  {
    labelKey: 'relayOn',
    data: '01 05 00 00 FF 00 8C 3A',
    mode: 'hex',
    intervalMs: 1000,
    inSequence: false,
  },
  {
    labelKey: 'relayOff',
    data: '01 05 00 00 00 00 CD CA',
    mode: 'hex',
    intervalMs: 1000,
    inSequence: false,
  },
  { labelKey: 'outputEnable', data: 'AT+OUT=1', mode: 'text', intervalMs: 1000, inSequence: false },
  { labelKey: 'saveConfig', data: 'AT+SAVE', mode: 'text', intervalMs: 1000, inSequence: false },
  { labelKey: 'softReset', data: 'AT+RST', mode: 'text', intervalMs: 1000, inSequence: false },
];

/** 空行的名字按它在组内的位置编号。 */
function blankPreset(indexInTab: number): Preset {
  return {
    id: nextId(),
    labelKey: null,
    name: `#${indexInTab + 1}`,
    data: '',
    mode: 'text',
    intervalMs: DEFAULT_INTERVAL_MS,
    inSequence: false,
  };
}

/** 与 blankPreset 生成的一模一样（编号不论），也就是没有任何用户改动。 */
function isBlank(preset: Preset): boolean {
  return (
    preset.labelKey === null &&
    preset.data === '' &&
    preset.mode === 'text' &&
    preset.intervalMs === DEFAULT_INTERVAL_MS &&
    !preset.inSequence &&
    /^#\d+$/.test(preset.name)
  );
}

/** 没改过标题、每一行都是空行（presets 传这一组的那几条）：删它不会丢任何用户数据。 */
export function isBlankTab(tab: PresetTab, presets: readonly Preset[]): boolean {
  return tab.title === null && presets.every(isBlank);
}

/** 分组与预设总是成对出现：presets 恒为 tabs.length × PRESET_TAB_SIZE 条。 */
export interface PresetCollection {
  tabs: PresetTab[];
  presets: Preset[];
}

function blankTab(): PresetCollection {
  return {
    tabs: [{ id: nextTabId(), title: null }],
    presets: Array.from({ length: PRESET_TAB_SIZE }, (_, index) => blankPreset(index)),
  };
}

const PRESETS_KEY = 'presets';
/** 顺序循环的间隔单独存：它不是预设内容，不该混进导出文件的格式里。 */
const SEQUENCE_GAP_KEY = 'sequenceGapMs';
const DEFAULT_SEQUENCE_GAP_MS = 300;

/**
 * 当前选中的分组按分层作用域存（见 lib/storage.ts）：每个页面记自己的，新开的页面沿用
 * 最后一次的选择。要记住它，是因为 VS Code 里面板一隐藏就销毁重建 —— 不记的话，
 * 每切一次编辑器标签都会回到第一组。
 */
const ACTIVE_TAB_KEY = 'presetTab';

/** 越界（比如别的页面删过分组）就夹到最后一组，不是非负整数就回到第一组。 */
function loadActiveTab(tabCount: number): number {
  const raw = readLayeredJson<unknown>(ACTIVE_TAB_KEY, 0);
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
    ? Math.min(raw, tabCount - 1)
    : 0;
}

function loadSequenceGap(): number {
  const raw = readStoredJson<unknown>(SEQUENCE_GAP_KEY, null);
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 10
    ? raw
    : DEFAULT_SEQUENCE_GAP_MS;
}

/** 第 index 组的那 PRESET_TAB_SIZE 条。 */
export function tabPresets(presets: readonly Preset[], index: number): readonly Preset[] {
  return presets.slice(index * PRESET_TAB_SIZE, (index + 1) * PRESET_TAB_SIZE);
}

/** 导出与本地持久化共用同一套字段，因此两者的还原路径也完全一致。 */
function serializePresets(tabs: readonly PresetTab[], presets: readonly Preset[]): unknown {
  return {
    version: PRESET_EXPORT_VERSION,
    tabs: tabs.map((tab, index) => ({
      title: tab.title,
      presets: tabPresets(presets, index).map((preset) => ({
        name: preset.name,
        labelKey: preset.labelKey,
        data: preset.data,
        mode: preset.mode,
        intervalMs: preset.intervalMs,
        inSequence: preset.inSequence,
      })),
    })),
  };
}

/**
 * 从 localStorage 还原预设。
 *
 * 直接复用导入用的校验器：存量数据和用户手里的 JSON 文件面对的风险是一样的
 * （旧版本字段、被手改、被别的标签页写坏），没有理由维护两套校验。
 * 校验不通过就整体退回内置示例，而不是让半截数据进到界面里。
 */
function loadCollection(): PresetCollection {
  const result = validatePresetPayload(readStoredJson<unknown>(PRESETS_KEY, null));
  return result.ok ? { tabs: result.tabs, presets: result.presets } : defaultCollection();
}

function defaultCollection(): PresetCollection {
  // 第一组是内置示例（恰好 10 条），其余各组是空行
  const collection: PresetCollection = {
    tabs: [{ id: nextTabId(), title: null }],
    presets: BUILTINS.map((preset) => ({ ...preset, id: nextId(), name: '' })),
  };
  while (collection.tabs.length < PRESET_DEFAULT_TABS) {
    const blank = blankTab();
    collection.tabs.push(...blank.tabs);
    collection.presets.push(...blank.presets);
  }
  return collection;
}

/** 内置预设显示当前语言的名字，用户改过名的显示自定义名。 */
export function presetLabel(preset: Preset, messages: Messages): string {
  return preset.labelKey ? messages.presetNames[preset.labelKey] : preset.name;
}

/** 没改过名的分组显示当前语言的默认标题，按位置编号。 */
export function presetTabTitle(tab: PresetTab, index: number, messages: Messages): string {
  return tab.title ?? messages.presetTabTitle(index + 1);
}

export type PresetIssue =
  | { id: string; kind: 'lossy' }
  | { id: string; kind: 'parse'; error: HexParseError };

interface PresetState {
  /** 按分组顺序排列，恒为 tabs.length × PRESET_TAB_SIZE 条。 */
  presets: readonly Preset[];
  tabs: readonly PresetTab[];
  /** 当前显示的分组，从 0 开始。 */
  activeTab: number;
  /** 顺序循环两条之间的间隔。 */
  sequenceGapMs: number;
  /** 每条预设当前的问题（HEX 解析失败 / 模式切换被拒），按 id 索引。 */
  issues: Readonly<Record<string, PresetIssue>>;

  rename: (id: string, name: string) => void;
  setData: (id: string, data: string) => void;
  setInterval: (id: string, intervalMs: number) => void;
  setInSequence: (id: string, inSequence: boolean) => void;
  toggleMode: (id: string) => void;

  sendOnce: (id: string) => Promise<void>;
  toggleLoop: (id: string) => void;
  setSequenceGapMs: (gapMs: number) => void;
  toggleSequence: () => void;

  selectTab: (index: number) => void;
  /** 标题的取值规则见 parseTabTitle；清洗后为空则不改。 */
  renameTab: (id: string, title: string) => void;
  /** 在末尾加一组空行并切换过去。 */
  addTab: () => void;
  /** 删掉一组连同它的预设，至少留一组；组里还在循环的预设一并停掉。 */
  removeTab: (id: string) => void;
  replaceAll: (collection: PresetCollection) => void;
  exportPayload: () => string;
}

function validate(preset: Preset): PresetIssue | null {
  if (preset.mode !== 'hex') return null;
  const result = buildFrame(preset.data, 'hex', 'none');
  return result.ok ? null : { id: preset.id, kind: 'parse', error: result.error };
}

function withIssue(
  issues: Readonly<Record<string, PresetIssue>>,
  id: string,
  issue: PresetIssue | null,
): Record<string, PresetIssue> {
  const next = { ...issues };
  if (issue) next[id] = issue;
  else delete next[id];
  return next;
}

let sequenceCursor = 0;

export const usePresetStore = create<PresetState>()((set, get) => {
  const patch = (id: string, changes: Partial<Preset>): void =>
    set((state) => {
      const presets = state.presets.map((preset) =>
        preset.id === id ? { ...preset, ...changes } : preset,
      );
      const updated = presets.find((preset) => preset.id === id);
      return {
        presets,
        issues: updated ? withIssue(state.issues, id, validate(updated)) : state.issues,
      };
    });

  const initial = loadCollection();

  return {
    presets: initial.presets,
    tabs: initial.tabs,
    activeTab: loadActiveTab(initial.tabs.length),
    sequenceGapMs: loadSequenceGap(),
    issues: {},

    // 用户一改名就切断与内置翻译的关联，语言切换不会再覆盖他的命名
    rename: (id, name) => patch(id, { name, labelKey: null }),

    setData: (id, data) => patch(id, { data }),

    setInterval: (id, intervalMs) => {
      const clamped = Math.max(10, Math.round(intervalMs) || 10);
      patch(id, { intervalMs: clamped });
      useTasksStore.getState().update(presetTask(id), { intervalMs: clamped });
    },

    setInSequence: (id, inSequence) => patch(id, { inSequence }),

    toggleMode: (id) => {
      const preset = get().presets.find((item) => item.id === id);
      if (!preset) return;
      const target: PayloadMode = preset.mode === 'hex' ? 'text' : 'hex';
      const converted = convertPayload(preset.data, preset.mode, target);
      if (!converted.ok) {
        set((state) => ({
          issues: withIssue(
            state.issues,
            id,
            converted.reason === 'lossy'
              ? { id, kind: 'lossy' }
              : { id, kind: 'parse', error: converted.error },
          ),
        }));
        return;
      }
      patch(id, { mode: target, data: converted.data });
    },

    sendOnce: async (id) => {
      const preset = get().presets.find((item) => item.id === id);
      if (!preset) return;
      const result = buildFrame(preset.data, preset.mode, 'none');
      if (!result.ok) return;
      await useConnectionStore.getState().send(result.bytes);
    },

    toggleLoop: (id) => {
      const tasks = useTasksStore.getState();
      const taskId = presetTask(id);
      if (tasks.running.includes(taskId)) {
        tasks.stop(taskId);
        return;
      }
      if (!useConnectionStore.getState().isOpen()) {
        useLogStore.getState().appendNotice({ code: 'not-open' });
        return;
      }
      const preset = get().presets.find((item) => item.id === id);
      if (!preset) return;
      tasks.start(taskId, {
        intervalMs: preset.intervalMs,
        // 交给会话所在的那一侧执行；VS Code 里就是扩展宿主，面板隐藏也照跑
        frames: presetFrames(preset),
        run: () => get().sendOnce(id),
      });
    },

    setSequenceGapMs: (gapMs) => set({ sequenceGapMs: Math.max(10, Math.round(gapMs) || 10) }),

    toggleSequence: () => {
      const tasks = useTasksStore.getState();
      if (tasks.running.includes(SEQUENCE_TASK)) {
        tasks.stop(SEQUENCE_TASK);
        return;
      }
      if (!useConnectionStore.getState().isOpen()) {
        useLogStore.getState().appendNotice({ code: 'not-open' });
        return;
      }
      if (!get().presets.some((preset) => preset.inSequence)) return;

      sequenceCursor = 0;
      tasks.start(SEQUENCE_TASK, {
        intervalMs: get().sequenceGapMs,
        // 顺序循环也能交给宿主：把整条队列按勾选顺序交出去，它每一拍取下一条。
        // 队列在循环期间变化时由下面的订阅重新推送，游标不会跳回第一条。
        frames: sequenceFrames(get().presets),
        run: async () => {
          // 每次都取最新的勾选列表，循环期间增删预设不会错位
          const queue = get().presets.filter((preset) => preset.inSequence);
          if (queue.length === 0) return;
          const preset = queue[sequenceCursor % queue.length]!;
          sequenceCursor += 1;
          await get().sendOnce(preset.id);
        },
      });
    },

    selectTab: (index) =>
      set((state) => ({ activeTab: Math.min(state.tabs.length - 1, Math.max(0, index)) })),

    renameTab: (id, title) => {
      const clean = parseTabTitle(title);
      if (clean === null) return;
      set((state) => ({
        tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, title: clean } : tab)),
      }));
    },

    addTab: () =>
      set((state) => {
        const blank = blankTab();
        return {
          tabs: [...state.tabs, ...blank.tabs],
          presets: [...state.presets, ...blank.presets],
          activeTab: state.tabs.length,
        };
      }),

    removeTab: (id) => {
      const { tabs, presets } = get();
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index < 0 || tabs.length <= 1) return;

      const removed = new Set(tabPresets(presets, index).map((preset) => preset.id));
      // 订阅只给还在列表里的预设推新帧：删掉的那些若还在循环，交给宿主执行时
      // 会带着旧内容一直发下去，得在这里显式停掉
      const tasks = useTasksStore.getState();
      for (const presetId of removed) {
        if (tasks.running.includes(presetTask(presetId))) tasks.stop(presetTask(presetId));
      }

      set((state) => ({
        tabs: state.tabs.filter((tab) => tab.id !== id),
        presets: state.presets.filter((preset) => !removed.has(preset.id)),
        // 删的在选中组之前，选中的仍是原来那一组；删的正是选中组，落到顶上来的那一组
        activeTab:
          index < state.activeTab
            ? state.activeTab - 1
            : Math.min(state.activeTab, state.tabs.length - 2),
        issues: Object.fromEntries(
          Object.entries(state.issues).filter(([presetId]) => !removed.has(presetId)),
        ),
      }));
    },

    replaceAll: ({ tabs, presets }) => {
      useTasksStore.getState().stopAll();
      set({ tabs, presets, activeTab: 0, issues: {} });
    },

    exportPayload: () => JSON.stringify(serializePresets(get().tabs, get().presets), null, 2),
  };
});

/* ---------------- 导入：显式校验（缺陷 D17） ---------------- */

export type ImportResult =
  | ({ ok: true; skipped: number } & PresetCollection)
  | { ok: false; reason: string };

/**
 * 原型只检查「是不是数组」，字段一律 `String(p.name || 'cmd')` 硬转，
 * 超过 64 条静默截断，也没有版本号（.dc.html:860-878）。
 * 这里逐条校验，非法条目跳过并计数，让用户知道导入了什么、丢了什么。
 */
export function parseImportedPresets(raw: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'JSON syntax error' };
  }
  return validatePresetPayload(parsed);
}

/** 校验已解析出来的结构。导入文件与读取 localStorage 共用。 */
export function validatePresetPayload(parsed: unknown): ImportResult {
  if (isRecord(parsed) && Array.isArray(parsed.tabs)) return validateTabs(parsed.tabs);

  const items = Array.isArray(parsed)
    ? parsed // 兼容原型导出的裸数组
    : isRecord(parsed) && Array.isArray(parsed.presets)
      ? parsed.presets // 分组之前的格式（version 1）
      : null;

  if (!items) return { ok: false, reason: 'expected an array of presets' };
  return validatePages(items);
}

/** 带分组的格式：每组各自校验，不足 PRESET_TAB_SIZE 条补空行，多出的计入跳过。 */
function validateTabs(rawTabs: readonly unknown[]): ImportResult {
  const collection: PresetCollection = { tabs: [], presets: [] };
  let skipped = 0;
  let parsedCount = 0;

  for (const rawTab of rawTabs) {
    if (!isRecord(rawTab) || !Array.isArray(rawTab.presets)) {
      skipped += 1;
      continue;
    }
    const group: Preset[] = [];
    for (const item of rawTab.presets) {
      const preset = group.length < PRESET_TAB_SIZE ? parsePresetItem(item) : null;
      if (preset) group.push(preset);
      else skipped += 1;
    }
    parsedCount += group.length;
    while (group.length < PRESET_TAB_SIZE) group.push(blankPreset(group.length));
    collection.tabs.push({ id: nextTabId(), title: parseTabTitle(rawTab.title) });
    collection.presets.push(...group);
  }

  if (parsedCount === 0) return { ok: false, reason: 'no valid preset in file' };
  return { ok: true, ...collection, skipped };
}

/**
 * 分组之前的格式：一整列预设，当时按每页 10 条分页显示。
 *
 * 按原来的页切成分组，末尾完全没用过的空页去掉（至少留 PRESET_DEFAULT_TABS 组）——
 * 旧版固定 5 页，原样照搬的话大多数人会凭空多出两个空分组。
 */
function validatePages(items: readonly unknown[]): ImportResult {
  if (items.length === 0) return { ok: false, reason: 'file contains no presets' };

  const parsed: Preset[] = [];
  let skipped = 0;
  for (const item of items) {
    const preset = parsePresetItem(item);
    if (preset) parsed.push(preset);
    else skipped += 1;
  }
  if (parsed.length === 0) return { ok: false, reason: 'no valid preset in file' };

  const pageCount = Math.max(PRESET_DEFAULT_TABS, Math.ceil(parsed.length / PRESET_TAB_SIZE));
  const pages: Preset[][] = [];
  for (let page = 0; page < pageCount; page += 1) {
    // 旧版空行的占位名按全局位置编号（#11 … #50）。名字没改过的（填没填数据都算）
    // 改成组内编号，否则同一组里会出现 #1、#12、#3 这样夹杂的名字
    const group = tabPresets(parsed, page).map((preset, index) =>
      preset.labelKey === null && preset.name === `#${page * PRESET_TAB_SIZE + index + 1}`
        ? { ...preset, name: `#${index + 1}` }
        : preset,
    );
    while (group.length < PRESET_TAB_SIZE) group.push(blankPreset(group.length));
    pages.push(group);
  }
  while (pages.length > PRESET_DEFAULT_TABS && pages[pages.length - 1]!.every(isBlank)) {
    pages.pop();
  }

  return {
    ok: true,
    tabs: pages.map(() => ({ id: nextTabId(), title: null })),
    presets: pages.flat(),
    skipped,
  };
}

function parsePresetItem(item: unknown): Preset | null {
  if (!isRecord(item) || typeof item.data !== 'string') return null;

  // 旧格式用 hex: boolean，新格式用 mode: 'text' | 'hex'
  const mode: PayloadMode =
    item.mode === 'hex' || item.mode === 'text' ? item.mode : item.hex === true ? 'hex' : 'text';

  const interval = Number(item.intervalMs ?? item.interval);
  // 内置预设的名字来自翻译目录、name 字段本就是空的：labelKey 丢掉的话，
  // 导出再导入回来就全变成兜底的 'preset'。
  // 但自定义名字优先 —— 与 rename() 同一条规则：一旦有自己的名字就切断内置翻译，
  // 否则手改过的文件导入回来会被内置译名盖掉。
  const named = typeof item.name === 'string' && item.name.trim() ? item.name : null;
  const labelKey = named ? null : toBuiltinKey(item.labelKey);
  const name = named ?? (labelKey ? '' : 'preset');

  return {
    id: nextId(),
    labelKey,
    name,
    data: item.data,
    mode,
    intervalMs: Number.isFinite(interval)
      ? Math.max(10, Math.round(interval))
      : DEFAULT_INTERVAL_MS,
    inSequence: item.inSequence === true || item.seq === true,
  };
}

/** 分组标题的取值规则：去掉首尾空白、截到上限，剩下空串就等于没起名。 */
function parseTabTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().slice(0, PRESET_TAB_TITLE_MAX);
  return clean === '' ? null : clean;
}

/** 只认识目录里确实存在的内置键，其余一律当作用户自定义预设。 */
function toBuiltinKey(value: unknown): BuiltinPresetKey | null {
  return typeof value === 'string' && (BUILTIN_PRESET_KEYS as readonly string[]).includes(value)
    ? (value as BuiltinPresetKey)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 一条预设对应的帧。内容解析不通过时没有帧可发。 */
function presetFrames(preset: Preset): Uint8Array[] {
  const result = buildFrame(preset.data, preset.mode, 'none');
  return result.ok ? [result.bytes] : [];
}

/** 顺序循环的队列：按勾选顺序排好的多条帧。 */
function sequenceFrames(presets: readonly Preset[]): Uint8Array[] {
  return presets.filter((preset) => preset.inSequence).flatMap(presetFrames);
}

usePresetStore.subscribe(({ presets, tabs, activeTab, sequenceGapMs }) => {
  saveSoon(PRESETS_KEY, serializePresets(tabs, presets));
  saveSoon(SEQUENCE_GAP_KEY, sequenceGapMs);
  saveSoon(ACTIVE_TAB_KEY, activeTab, 'layered');

  // 循环期间改预设内容 / 增删队列成员要即时生效。浏览器侧靠执行体重读状态自然就有；
  // 交给宿主执行时内容在那一头，必须显式推过去。
  const tasks = useTasksStore.getState();
  tasks.update(SEQUENCE_TASK, { frames: sequenceFrames(presets) });
  for (const preset of presets) {
    tasks.update(presetTask(preset.id), { frames: presetFrames(preset) });
  }
});
