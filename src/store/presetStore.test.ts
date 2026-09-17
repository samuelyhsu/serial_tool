import { beforeEach, describe, expect, it } from 'vitest';
import { en } from '@/i18n/en';
import { BUILTIN_PRESET_KEYS } from '@/i18n/types';
import { zh } from '@/i18n/zh';
import {
  parseImportedPresets,
  PRESET_DEFAULT_TABS,
  PRESET_TAB_SIZE,
  PRESET_TAB_TITLE_MAX,
  presetLabel,
  presetTabTitle,
  tabPresets,
  usePresetStore,
  type PresetCollection,
} from './presetStore';

function importOrThrow(raw: string): PresetCollection & { skipped: number } {
  const result = parseImportedPresets(raw);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function placeholderNames(from: number): string[] {
  return Array.from({ length: PRESET_TAB_SIZE - from }, (_, index) => `#${from + index + 1}`);
}

beforeEach(() => {
  usePresetStore.setState(usePresetStore.getInitialState(), true);
});

describe('预设导出 → 导入', () => {
  it('内置预设经过一轮往返后名字不丢', () => {
    // 内置预设的 name 是空串、名字来自翻译目录。导入端若丢掉 labelKey，
    // 这十条就会全部塌成兜底的 'preset'。
    const before = usePresetStore
      .getState()
      .presets.slice(0, 10)
      .map((preset) => presetLabel(preset, zh));

    const restored = importOrThrow(usePresetStore.getState().exportPayload());
    const after = restored.presets.slice(0, 10).map((preset) => presetLabel(preset, zh));

    expect(after).toEqual(before);
    expect(after).not.toContain('preset');
  });

  it('往返后内置预设仍随语言切换（labelKey 保住了才有这个性质）', () => {
    const restored = importOrThrow(usePresetStore.getState().exportPayload());
    expect(restored.presets[0]!.labelKey).toBe('queryVersion');
  });

  it('用户改过名的预设不会被误认成内置项', () => {
    const raw = JSON.stringify({
      version: 1,
      presets: [{ name: '电机自检', labelKey: 'queryVersion', data: 'AT+X', mode: 'text' }],
    });
    // name 非空即用户命名优先，labelKey 不该把它盖掉
    expect(presetLabel(importOrThrow(raw).presets[0]!, zh)).toBe('电机自检');
  });

  it('伪造的 labelKey 被拒绝，退回普通预设', () => {
    const raw = JSON.stringify({
      version: 1,
      presets: [{ name: '', labelKey: '__evil__', data: 'AT' }],
    });
    const preset = importOrThrow(raw).presets[0]!;
    expect(preset.labelKey).toBeNull();
    expect(presetLabel(preset, zh)).toBe('preset');
  });

  it('不足一组的补满 10 条，分组至少补到默认的三组', () => {
    const raw = JSON.stringify({ version: 1, presets: [{ name: 'a', data: 'AT' }] });
    const imported = importOrThrow(raw);
    expect(imported.tabs).toHaveLength(PRESET_DEFAULT_TABS);
    expect(imported.presets).toHaveLength(PRESET_DEFAULT_TABS * PRESET_TAB_SIZE);
  });
});

describe('分组', () => {
  it('默认三组、每组 10 条：第一组是内置示例，其余是按组内位置编号的空行', () => {
    const { tabs, presets } = usePresetStore.getState();
    expect(tabs).toHaveLength(PRESET_DEFAULT_TABS);
    expect(presets).toHaveLength(PRESET_DEFAULT_TABS * PRESET_TAB_SIZE);
    expect(tabPresets(presets, 0).map((preset) => preset.labelKey)).toEqual([
      ...BUILTIN_PRESET_KEYS,
    ]);
    expect(tabPresets(presets, 2).map((preset) => preset.name)).toEqual(placeholderNames(0));
  });

  it('新建分组追加 10 条空行并切过去', () => {
    usePresetStore.getState().addTab();
    const { tabs, presets, activeTab } = usePresetStore.getState();

    expect(tabs).toHaveLength(PRESET_DEFAULT_TABS + 1);
    expect(presets).toHaveLength((PRESET_DEFAULT_TABS + 1) * PRESET_TAB_SIZE);
    expect(activeTab).toBe(PRESET_DEFAULT_TABS);
    expect(tabs.at(-1)!.title).toBeNull();
    expect(tabPresets(presets, PRESET_DEFAULT_TABS).map((preset) => preset.name)).toEqual(
      placeholderNames(0),
    );
  });

  it('改名去掉首尾空白、截到上限；清洗后为空则不改', () => {
    const id = usePresetStore.getState().tabs[0]!.id;
    usePresetStore.getState().renameTab(id, `  ${'电'.repeat(40)}  `);
    expect(usePresetStore.getState().tabs[0]!.title).toBe('电'.repeat(PRESET_TAB_TITLE_MAX));

    usePresetStore.getState().renameTab(id, '   ');
    expect(usePresetStore.getState().tabs[0]!.title).toBe('电'.repeat(PRESET_TAB_TITLE_MAX));
  });

  /** 与内置预设同一条规则（缺陷 D16）：没改过名的跟着语言走，改过的是用户自己的。 */
  it('没改过名的分组标题随语言变化，改过的不变', () => {
    usePresetStore.getState().renameTab(usePresetStore.getState().tabs[0]!.id, '电机');
    const [renamed, untouched] = usePresetStore.getState().tabs;

    expect(presetTabTitle(renamed!, 0, en)).toBe('电机');
    expect(presetTabTitle(untouched!, 1, zh)).toBe('分组 2');
    expect(presetTabTitle(untouched!, 1, en)).toBe('Group 2');
  });

  it('切换分组时越界的序号夹到有效范围', () => {
    usePresetStore.getState().selectTab(99);
    expect(usePresetStore.getState().activeTab).toBe(PRESET_DEFAULT_TABS - 1);

    usePresetStore.getState().selectTab(-3);
    expect(usePresetStore.getState().activeTab).toBe(0);
  });
});

describe('带分组的导出 → 导入', () => {
  it('分组标题与各组内容往返后不变，没改过名的仍是 null', () => {
    const store = usePresetStore.getState();
    store.renameTab(store.tabs[1]!.id, '电机');
    store.setData(tabPresets(store.presets, 1)[3]!.id, 'AT+MOTOR');

    const imported = importOrThrow(usePresetStore.getState().exportPayload());

    expect(imported.tabs.map((tab) => tab.title)).toEqual([null, '电机', null]);
    expect(tabPresets(imported.presets, 1)[3]!.data).toBe('AT+MOTOR');
    expect(imported.skipped).toBe(0);
  });

  it('一组多于 10 条的部分计入跳过，不足的补空行', () => {
    const raw = JSON.stringify({
      version: 2,
      tabs: [
        {
          title: 'A',
          presets: Array.from({ length: 12 }, (_, index) => ({ name: `a${index}`, data: 'AT' })),
        },
        { title: 'B', presets: [{ name: 'b', data: 'AT' }] },
      ],
    });
    const imported = importOrThrow(raw);

    expect(imported.tabs.map((tab) => tab.title)).toEqual(['A', 'B']);
    expect(imported.presets).toHaveLength(2 * PRESET_TAB_SIZE);
    expect(tabPresets(imported.presets, 1).map((preset) => preset.name)).toEqual([
      'b',
      ...placeholderNames(1),
    ]);
    expect(imported.skipped).toBe(2);
  });

  it('标题不是字符串或全是空白时当作没起名', () => {
    const raw = JSON.stringify({
      version: 2,
      tabs: [
        { title: 42, presets: [{ data: 'AT' }] },
        { title: '   ', presets: [{ data: 'AT' }] },
      ],
    });
    expect(importOrThrow(raw).tabs.map((tab) => tab.title)).toEqual([null, null]);
  });

  it('一条有效预设都没有时整体拒绝', () => {
    const raw = JSON.stringify({ version: 2, tabs: [{ title: 'A', presets: [] }, 'broken'] });
    expect(parseImportedPresets(raw).ok).toBe(false);
  });
});

/** 分组之前（0.3.0 及更早）存下来的样子：一整列 50 条，前 10 条是内置示例，其余是按全局位置编号的空行。 */
function legacyPayload(edits: Record<number, Record<string, unknown>> = {}): string {
  const presets = Array.from({ length: 50 }, (_, index) => ({
    ...(index < 10
      ? { name: '', labelKey: BUILTIN_PRESET_KEYS[index], data: `AT+${index}` }
      : { name: `#${index + 1}`, labelKey: null, data: '' }),
    mode: 'text',
    intervalMs: 1000,
    inSequence: false,
    ...edits[index],
  }));
  return JSON.stringify({ version: 1, presets });
}

describe('旧版（分页）数据迁移', () => {
  it('后两页没用过：迁成默认的三组，内容原样保留', () => {
    const imported = importOrThrow(legacyPayload({ 12: { data: 'AT+PAGE2' } }));

    expect(imported.tabs).toHaveLength(PRESET_DEFAULT_TABS);
    expect(imported.tabs.every((tab) => tab.title === null)).toBe(true);
    expect(imported.presets[0]!.labelKey).toBe('queryVersion');
    expect(tabPresets(imported.presets, 1)[2]!.data).toBe('AT+PAGE2');
  });

  it('第五页用过：五组都保留，夹在中间没用过的第四页不删', () => {
    const imported = importOrThrow(legacyPayload({ 45: { name: '电机', data: 'AT+M' } }));

    expect(imported.tabs).toHaveLength(5);
    expect(tabPresets(imported.presets, 4)[5]!.name).toBe('电机');
    expect(tabPresets(imported.presets, 3).every((preset) => preset.data === '')).toBe(true);
  });

  it('名字没改过的占位行按组内位置重新编号（填了数据的也算），改过名的不动', () => {
    const imported = importOrThrow(legacyPayload({ 11: { data: 'AT+X' }, 13: { name: '自检' } }));

    expect(tabPresets(imported.presets, 1).map((preset) => preset.name)).toEqual([
      '#1',
      '#2',
      '#3',
      '自检',
      ...placeholderNames(4),
    ]);
  });

  it('超过 50 条的旧文件不再截断，每 10 条一组全部保留', () => {
    const presets = Array.from({ length: 63 }, (_, index) => ({ name: `c${index}`, data: 'AT' }));
    const imported = importOrThrow(JSON.stringify({ version: 1, presets }));

    expect(imported.tabs).toHaveLength(7);
    expect(imported.presets[62]!.name).toBe('c62');
    expect(imported.skipped).toBe(0);
  });

  it('原型导出的裸数组同样按旧格式迁移', () => {
    const imported = importOrThrow(JSON.stringify([{ name: 'x', data: 'AT', hex: false }]));

    expect(imported.tabs).toHaveLength(PRESET_DEFAULT_TABS);
    expect(imported.presets[0]!.name).toBe('x');
  });
});
