import { beforeEach, describe, expect, it } from 'vitest';
import { en } from '@/i18n/en';
import { BUILTIN_PRESET_KEYS } from '@/i18n/types';
import { zh } from '@/i18n/zh';
import {
  isBlankTab,
  parseImportedPresets,
  PRESET_DEFAULT_TABS,
  PRESET_TAB_SIZE,
  PRESET_TAB_TITLE_MAX,
  presetLabel,
  presetTabTitle,
  tabPresets,
  usePresetStore,
  type Preset,
  type PresetTab,
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

describe('删除分组', () => {
  it('连同这一组的预设一起删，其余分组与顺序不变', () => {
    const before = usePresetStore.getState().tabs;
    const thirdPresets = tabPresets(usePresetStore.getState().presets, 2).map(
      (preset) => preset.id,
    );

    usePresetStore.getState().removeTab(before[1]!.id);

    const { tabs, presets } = usePresetStore.getState();
    expect(tabs.map((tab) => tab.id)).toEqual(
      before.filter((_, index) => index !== 1).map((tab) => tab.id),
    );
    expect(presets).toHaveLength((PRESET_DEFAULT_TABS - 1) * PRESET_TAB_SIZE);
    expect(tabPresets(presets, 1).map((preset) => preset.id)).toEqual(thirdPresets);
  });

  it('至少留一组', () => {
    const first = usePresetStore.getState().tabs[0]!;
    // 从后往前删一遍：最后那次落在仅剩的一组上，应该被挡住
    for (const tab of [...usePresetStore.getState().tabs].reverse()) {
      usePresetStore.getState().removeTab(tab.id);
    }

    expect(usePresetStore.getState().tabs.map((tab) => tab.id)).toEqual([first.id]);
    expect(usePresetStore.getState().presets).toHaveLength(PRESET_TAB_SIZE);
  });

  it('删的在选中组之前，选中的仍是原来那一组', () => {
    const selected = usePresetStore.getState().tabs[2]!;
    usePresetStore.getState().selectTab(2);
    usePresetStore.getState().removeTab(usePresetStore.getState().tabs[0]!.id);

    const { tabs, activeTab } = usePresetStore.getState();
    expect(tabs[activeTab]!.id).toBe(selected.id);
  });

  it('删的正是选中组，选中落到顶上来的那一组', () => {
    const [, second, third] = usePresetStore.getState().tabs;
    usePresetStore.getState().selectTab(1);

    usePresetStore.getState().removeTab(second!.id);

    const after = usePresetStore.getState();
    expect(after.tabs[after.activeTab]!.id).toBe(third!.id);
  });

  it('删的是最后一组时选中落到前一组', () => {
    const before = usePresetStore.getState().tabs;
    usePresetStore.getState().selectTab(before.length - 1);

    usePresetStore.getState().removeTab(before.at(-1)!.id);

    const after = usePresetStore.getState();
    expect(after.tabs[after.activeTab]!.id).toBe(before.at(-2)!.id);
  });

  it('删掉的预设的错误标记一并清掉', () => {
    const doomed = tabPresets(usePresetStore.getState().presets, 1)[0]!;
    usePresetStore.getState().toggleMode(doomed.id);
    usePresetStore.getState().setData(doomed.id, 'ZZ');
    expect(usePresetStore.getState().issues[doomed.id]).toBeDefined();

    usePresetStore.getState().removeTab(usePresetStore.getState().tabs[1]!.id);
    expect(usePresetStore.getState().issues[doomed.id]).toBeUndefined();
  });

  it('没改过标题、每行都是空行的分组才算空', () => {
    const { tabs, presets } = usePresetStore.getState();
    expect(isBlankTab(tabs[0]!, tabPresets(presets, 0))).toBe(false);
    expect(isBlankTab(tabs[1]!, tabPresets(presets, 1))).toBe(true);

    usePresetStore.getState().renameTab(tabs[1]!.id, '电机');
    expect(isBlankTab(usePresetStore.getState().tabs[1]!, tabPresets(presets, 1))).toBe(false);

    usePresetStore.getState().setInterval(tabPresets(presets, 2)[0]!.id, 250);
    const after = usePresetStore.getState();
    expect(isBlankTab(after.tabs[2]!, tabPresets(after.presets, 2))).toBe(false);
  });
});

describe('带分组的导出 → 导入', () => {
  it('分组标题与各组内容往返后不变，没改过名的仍是 null', () => {
    const store = usePresetStore.getState();
    store.renameTab(store.tabs[1]!.id, '电机');
    store.setData(tabPresets(store.presets, 1)[3]!.id, 'AT+MOTOR');

    const imported = importOrThrow(usePresetStore.getState().exportPayload());

    expect(imported.tabs.map((tab) => tab.title)).toEqual(
      Array.from({ length: PRESET_DEFAULT_TABS }, (_, index) => (index === 1 ? '电机' : null)),
    );
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

describe('指令库的整理', () => {
  /**
   * 指令集是按项目攒的：手上一份电机的、一份传感器的。
   * 只有整体替换的话，两份永远拼不到一起。
   */
  it('追加导入接在现有分组之后，已有内容一条不动', () => {
    const firstLabel = presetLabel(usePresetStore.getState().presets[0]!, zh);
    const raw = JSON.stringify({
      version: 2,
      tabs: [{ title: '电机', presets: [{ name: 'go', data: 'G1' }] }],
    });

    usePresetStore.getState().appendAll(importOrThrow(raw));

    const after = usePresetStore.getState();
    expect(after.tabs).toHaveLength(PRESET_DEFAULT_TABS + 1);
    expect(after.tabs.at(-1)!.title).toBe('电机');
    expect(presetLabel(after.presets[0]!, zh)).toBe(firstLabel);
    // 跳到第一个新分组：追加完了总要看一眼进来的是什么
    expect(after.activeTab).toBe(PRESET_DEFAULT_TABS);
  });

  it('组内上下挪一格就是和相邻那条换位置', () => {
    const [a, b] = usePresetStore.getState().presets;

    usePresetStore.getState().movePreset(b!.id, -1);

    expect(
      usePresetStore
        .getState()
        .presets.slice(0, 2)
        .map((preset) => preset.id),
    ).toEqual([b!.id, a!.id]);
  });

  it('挪到组的边界外就不动，跨组得显式按 Shift', () => {
    const last = usePresetStore.getState().presets[PRESET_TAB_SIZE - 1]!;

    usePresetStore.getState().movePreset(last.id, 1);

    expect(usePresetStore.getState().presets[PRESET_TAB_SIZE - 1]!.id).toBe(last.id);
  });

  it('跨组挪到目标组的第一个空行，原位置补一行空的', () => {
    const moved = usePresetStore.getState().presets[0]!;

    expect(usePresetStore.getState().movePresetToTab(moved.id, 1)).toBe(true);

    const after = usePresetStore.getState();
    expect(tabPresets(after.presets, 1)[0]!.id).toBe(moved.id);
    expect(after.activeTab).toBe(1);
    // 每组恒为 PRESET_TAB_SIZE 条是别处都在依赖的前提，腾出来的位置不能留个洞
    expect(after.presets).toHaveLength(PRESET_DEFAULT_TABS * PRESET_TAB_SIZE);
    expect(after.presets[0]!.data).toBe('');
  });

  it('目标组满了就挪不过去，也不顶掉人家那一行', () => {
    const store = usePresetStore.getState();
    for (const preset of tabPresets(store.presets, 1)) store.setData(preset.id, 'X');

    const moved = usePresetStore.getState().presets[0]!;
    expect(usePresetStore.getState().movePresetToTab(moved.id, 1)).toBe(false);
    expect(usePresetStore.getState().presets[0]!.id).toBe(moved.id);
  });

  it('没有相邻分组时挪不动', () => {
    const store = usePresetStore.getState();
    expect(store.movePresetToTab(store.presets[0]!.id, -1)).toBe(false);
  });
});

describe('分组重排', () => {
  beforeEach(() => {
    usePresetStore.getState().replaceAll(buildTabs(3));
  });

  /** 三组，每组第一条的数据写成 g0 / g1 / g2，便于看出整段有没有跟着搬。 */
  function buildTabs(count: number): { tabs: PresetTab[]; presets: Preset[] } {
    const tabs: PresetTab[] = [];
    const presets: Preset[] = [];
    for (let g = 0; g < count; g += 1) {
      tabs.push({ id: `t${g}`, title: `G${g}` });
      for (let i = 0; i < PRESET_TAB_SIZE; i += 1) {
        presets.push({
          id: `p${g}-${i}`,
          labelKey: null,
          name: `#${i + 1}`,
          data: i === 0 ? `g${g}` : '',
          mode: 'text',
          intervalMs: 1000,
          inSequence: false,
        });
      }
    }
    return { tabs, presets };
  }

  function titles(): string[] {
    return usePresetStore.getState().tabs.map((tab) => tab.title ?? '');
  }

  /** 每组第一条的数据，用来确认内容跟着分组一起搬了。 */
  function firstOfEachTab(): string[] {
    const { presets, tabs } = usePresetStore.getState();
    return tabs.map((_, index) => tabPresets(presets, index)[0]?.data ?? '');
  }

  it('标题与内容一起搬 —— 分组只是 presets 的一段', () => {
    expect(usePresetStore.getState().moveTab(0, 2)).toBe(true);

    expect(titles()).toEqual(['G1', 'G2', 'G0']);
    expect(firstOfEachTab()).toEqual(['g1', 'g2', 'g0']);
  });

  it('往前拖同样对', () => {
    usePresetStore.getState().moveTab(2, 0);

    expect(titles()).toEqual(['G2', 'G0', 'G1']);
    expect(firstOfEachTab()).toEqual(['g2', 'g0', 'g1']);
  });

  it('拖的就是当前选中的那组，选中跟着走', () => {
    usePresetStore.getState().selectTab(0);
    usePresetStore.getState().moveTab(0, 2);

    expect(usePresetStore.getState().activeTab).toBe(2);
  });

  /** 拖别的分组不该让当前看着的内容在眼前换掉。 */
  it('拖别的分组，选中的仍是原来那一组', () => {
    usePresetStore.getState().selectTab(1);
    usePresetStore.getState().moveTab(0, 2);

    expect(usePresetStore.getState().activeTab).toBe(0);
    expect(titles()[0]).toBe('G1');
  });

  it('把后面的拖到前面，中间那些往后让一格', () => {
    usePresetStore.getState().selectTab(0);
    usePresetStore.getState().moveTab(2, 0);

    expect(usePresetStore.getState().activeTab).toBe(1);
  });

  it('原地不动、越界都当没发生', () => {
    expect(usePresetStore.getState().moveTab(1, 1)).toBe(false);
    expect(usePresetStore.getState().moveTab(0, 9)).toBe(false);
    expect(usePresetStore.getState().moveTab(-1, 0)).toBe(false);
    expect(titles()).toEqual(['G0', 'G1', 'G2']);
  });

  it('搬完每组仍是整整 PRESET_TAB_SIZE 条', () => {
    usePresetStore.getState().moveTab(0, 2);
    const { presets, tabs } = usePresetStore.getState();

    expect(presets).toHaveLength(tabs.length * PRESET_TAB_SIZE);
    for (let i = 0; i < tabs.length; i += 1) {
      expect(tabPresets(presets, i)).toHaveLength(PRESET_TAB_SIZE);
    }
  });
});
