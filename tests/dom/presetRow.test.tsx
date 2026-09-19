import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetLogStoreForTests } from '@/store/logStore';
import { PRESET_DEFAULT_TABS, PRESET_TAB_SIZE, usePresetStore } from '@/store/presetStore';
import { useTasksStore } from '@/store/tasksStore';
import { useUiStore } from '@/store/uiStore';
import { PresetPane } from '@/ui/PresetPane/PresetPane';

function rows(): HTMLElement[] {
  return screen.getAllByRole('checkbox').map((box) => box.closest('div') as HTMLElement);
}

function tabs(): HTMLElement[] {
  return screen.getAllByRole('tab');
}

/** 分组管理与导入导出都收在这个菜单里。 */
async function openMenu(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: '分组与文件' }));
}

describe('多条发送', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    useTasksStore.setState({ running: [] });
    useUiStore.setState({ language: 'zh' });
    usePresetStore.setState(usePresetStore.getInitialState(), true);
  });

  afterEach(cleanup);

  it('每组固定 10 条，行里没有新增和删除的按钮', () => {
    render(<PresetPane />);
    expect(rows()).toHaveLength(PRESET_TAB_SIZE);

    expect(screen.queryByRole('button', { name: '+ 新增' })).not.toBeInTheDocument();
    for (const row of rows()) {
      expect(within(row).queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
    }
  });

  /**
   * 帧尾不再是一个单独的设置项：要追加什么直接写在报文里，分隔符在中间的协议
   * 也就表达得出来了。写错了要当场标红，不能静默把反斜杠当普通字符发出去。
   */
  it('TXT 里转义写错时数据框标红，发送按钮禁用', async () => {
    render(<PresetPane />);
    const data = screen.getAllByRole('textbox')[0]!;

    await userEvent.clear(data);
    await userEvent.type(data, 'AT\\q');

    expect(data).toHaveAttribute('aria-invalid', 'true');
    expect(within(rows()[0]!).getByRole('button', { name: '查询版本' })).toBeDisabled();
  });

  it('不显示序号列', () => {
    render(<PresetPane />);
    expect(screen.queryByText('序')).not.toBeInTheDocument();
    expect(screen.queryByText('01')).not.toBeInTheDocument();
  });

  it('列顺序为：序列 · 格式 · 数据 · 发送 · 周期 · 循环', () => {
    render(<PresetPane />);
    const headers = screen.getByText('序列').parentElement!.querySelectorAll('span');
    const names = [...headers].map((h) => h.textContent).filter((text) => text && text !== '?');
    expect(names).toEqual([
      '序列',
      '格式',
      '数据',
      '发送',
      '周期 ms',
      '循环',
    ]);
  });

  /** 每条一行：一行里六个控件，不再是原来的两行布局。 */
  it('每条预设的控件都在同一行内', () => {
    render(<PresetPane />);
    const first = rows()[0]!;

    expect(within(first).getByRole('checkbox')).toBeInTheDocument();
    expect(within(first).getByTitle('切换 TXT / HEX 模式')).toBeInTheDocument();
    expect(within(first).getByRole('textbox', { name: /数据/ })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: '查询版本' })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: /重命名发送按钮/ })).toBeInTheDocument();
    expect(within(first).getByRole('spinbutton', { name: /周期/ })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: /循环/ })).toBeInTheDocument();
  });

  it('发送按钮上显示的就是预设名称', () => {
    render(<PresetPane />);
    expect(screen.getByRole('button', { name: '查询版本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '读取状态' })).toBeInTheDocument();
  });

  it('点 ✎ 切换成输入框改名，回车提交', async () => {
    render(<PresetPane />);
    await userEvent.click(screen.getByRole('button', { name: '重命名发送按钮: 查询版本' }));

    const input = screen.getByRole('textbox', { name: '重命名发送按钮' });
    expect(input).toHaveFocus();

    await userEvent.clear(input);
    await userEvent.type(input, '读版本号{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '读版本号' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('textbox', { name: '重命名发送按钮' })).not.toBeInTheDocument();
  });

  it('按 Esc 放弃改名', async () => {
    render(<PresetPane />);
    await userEvent.click(screen.getByRole('button', { name: '重命名发送按钮: 查询版本' }));
    await userEvent.type(screen.getByRole('textbox', { name: '重命名发送按钮' }), '别存{Escape}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '查询版本' })).toBeInTheDocument();
    });
  });

  it('名称留空时保持原名，不会出现没有文字的按钮', async () => {
    render(<PresetPane />);
    await userEvent.click(screen.getByRole('button', { name: '重命名发送按钮: 查询版本' }));

    const input = screen.getByRole('textbox', { name: '重命名发送按钮' });
    await userEvent.clear(input);
    await userEvent.type(input, '{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '查询版本' })).toBeInTheDocument();
    });
  });

  it('串口未打开时发送与循环都禁用', () => {
    render(<PresetPane />);
    expect(screen.getByRole('button', { name: '查询版本' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /^循环/ })[0]).toBeDisabled();
  });

  it('勾选框控制是否参与顺序循环', async () => {
    render(<PresetPane />);
    const before = usePresetStore.getState().presets.filter((p) => p.inSequence).length;

    await userEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(usePresetStore.getState().presets.filter((p) => p.inSequence)).toHaveLength(before - 1);
  });

  it('默认五个分组，第一个选中，列表归属于选中的分组', () => {
    render(<PresetPane />);
    expect(tabs().map((tab) => tab.textContent)).toEqual(
      Array.from({ length: PRESET_DEFAULT_TABS }, (_, index) => `分组 ${index + 1}`),
    );
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('分组 1');
  });

  /** 这几项都是偶尔用一次的，常驻在头部只会把天天要点的标签条挤没。 */
  it('头部平时只有搜索框和一个菜单按钮', () => {
    render(<PresetPane />);
    expect(screen.getByRole('searchbox', { name: '搜索预设' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分组与文件' })).toBeInTheDocument();
    for (const name of ['新建分组', '导入', '追加', '导出']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('菜单里方向键移动、Esc 收起并把焦点还回按钮', async () => {
    render(<PresetPane />);
    const button = screen.getByRole('button', { name: '分组与文件' });

    await userEvent.click(button);
    expect(screen.getByRole('menuitem', { name: '新建分组' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /^删除分组/ })).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('点分组只换显示的 10 条，总数不变', async () => {
    render(<PresetPane />);
    await userEvent.click(tabs()[1]!);

    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
    expect(rows()).toHaveLength(PRESET_TAB_SIZE);
    // 第二组是空行，第一组的内置预设不该还在
    expect(screen.queryByRole('button', { name: '查询版本' })).not.toBeInTheDocument();
    expect(usePresetStore.getState().presets).toHaveLength(PRESET_DEFAULT_TABS * PRESET_TAB_SIZE);
  });

  /** 标签页的键盘约定：方向键切换且焦点跟着走，到头回绕，Home / End 直达两端。 */
  it('方向键在分组间切换', async () => {
    render(<PresetPane />);
    act(() => {
      tabs()[0]!.focus();
    });

    await userEvent.keyboard('{ArrowRight}');
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs()[1]).toHaveFocus();

    // 从第二个往左两格：过了头就绕到最后一个
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(tabs().at(-1)).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Home}');
    expect(tabs()[0]).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(tabs().at(-1)).toHaveFocus();
  });

  it('只有选中的分组在 Tab 键序列里', () => {
    render(<PresetPane />);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([
      0,
      ...Array<number>(PRESET_DEFAULT_TABS - 1).fill(-1),
    ]);
  });

  it('双击分组标题改名，回车提交后焦点回到标签上', async () => {
    render(<PresetPane />);
    await userEvent.dblClick(tabs()[0]!);

    const input = screen.getByRole('textbox', { name: '重命名分组' });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('分组 1');

    await userEvent.clear(input);
    await userEvent.type(input, '电机{Enter}');

    expect(tabs()[0]).toHaveTextContent('电机');
    expect(tabs()[0]).toHaveFocus();
    expect(screen.queryByRole('textbox', { name: '重命名分组' })).not.toBeInTheDocument();
  });

  it('按 F2 也能改名，Esc 放弃', async () => {
    render(<PresetPane />);
    act(() => {
      tabs()[1]!.focus();
    });

    await userEvent.keyboard('{F2}');
    await userEvent.type(screen.getByRole('textbox', { name: '重命名分组' }), '别存{Escape}');

    expect(tabs()[1]).toHaveTextContent('分组 2');
    expect(usePresetStore.getState().tabs[1]!.title).toBeNull();
  });

  it('标题留空保持原标题', async () => {
    render(<PresetPane />);
    await userEvent.dblClick(tabs()[2]!);

    const input = screen.getByRole('textbox', { name: '重命名分组' });
    await userEvent.clear(input);
    await userEvent.type(input, '{Enter}');

    expect(tabs()[2]).toHaveTextContent('分组 3');
  });

  it('新建分组排在最后并自动选中，里面是空行', async () => {
    render(<PresetPane />);
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: '新建分组' }));

    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS + 1);
    expect(tabs().at(-1)).toHaveTextContent(`分组 ${PRESET_DEFAULT_TABS + 1}`);
    expect(tabs().at(-1)).toHaveAttribute('aria-selected', 'true');
    expect(within(rows()[0]!).getByRole('button', { name: '#1' })).toBeInTheDocument();
  });

  it('切到英文后没改过名的分组标题跟着换，改过的不变', async () => {
    render(<PresetPane />);
    await userEvent.dblClick(tabs()[0]!);
    await userEvent.type(
      screen.getByRole('textbox', { name: '重命名分组' }),
      '{Control>}a{/Control}电机{Enter}',
    );

    act(() => {
      useUiStore.setState({ language: 'en' });
    });

    expect(tabs().map((tab) => tab.textContent)).toEqual([
      '电机',
      ...Array.from({ length: PRESET_DEFAULT_TABS - 1 }, (_, index) => `Group ${index + 2}`),
    ]);
  });

  it('没动过的空分组从菜单里直接删，选中落到顶上来的那一组', async () => {
    render(<PresetPane />);
    await userEvent.click(tabs()[1]!);
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: '删除分组「分组 2」' }));

    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS - 1);
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('有内容的分组要按两下才删，第一下只是征询', async () => {
    render(<PresetPane />);
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: '删除分组「分组 1」' }));
    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS);

    await userEvent.click(screen.getByRole('menuitem', { name: '确认删除？' }));
    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS - 1);
    expect(screen.queryByRole('button', { name: '查询版本' })).not.toBeInTheDocument();
  });

  it('征询状态会自己超时复原，不会一直吊着一个危险菜单项', async () => {
    render(<PresetPane />);
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: '删除分组「分组 1」' }));
    expect(screen.getByRole('menuitem', { name: '确认删除？' })).toBeInTheDocument();

    // 3 秒的征询窗口是产品行为，如实等一次
    await waitFor(
      () => expect(screen.getByRole('menuitem', { name: '删除分组「分组 1」' })).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS);
  });

  it('收起菜单，之前那次征询作废', async () => {
    render(<PresetPane />);
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: /^删除分组/ }));
    expect(screen.getByRole('menuitem', { name: '确认删除？' })).toBeInTheDocument();

    // 关掉再打开：不该还吊着上一次的征询，得重新按两下
    await userEvent.keyboard('{Escape}');
    await openMenu();

    expect(screen.queryByRole('menuitem', { name: '确认删除？' })).not.toBeInTheDocument();
    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS);
  });

  it('空分组在标签上按 Delete 直接删掉', async () => {
    render(<PresetPane />);
    act(() => {
      tabs()[0]!.focus();
    });
    await userEvent.keyboard('{End}{Delete}');

    // 删的是最后一组，选中与焦点落到前一组
    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS - 1);
    expect(tabs().at(-1)).toHaveAttribute('aria-selected', 'true');
    expect(tabs().at(-1)).toHaveFocus();
  });

  it('只剩一组时删除项是灰的，Delete 也不起作用', async () => {
    render(<PresetPane />);
    act(() => {
      const { tabs: current, removeTab } = usePresetStore.getState();
      for (const tab of [...current].reverse()) removeTab(tab.id);
    });

    await openMenu();
    expect(screen.getByRole('menuitem', { name: /^删除分组/ })).toBeDisabled();

    await userEvent.keyboard('{Escape}');
    act(() => {
      tabs()[0]!.focus();
    });
    await userEvent.keyboard('{Delete}');
    expect(tabs()).toHaveLength(1);
  });

  /** 删除入口在菜单里，键盘按 Delete 就得把菜单叫出来 —— 否则「确认删除？」没地方显示。 */
  it('有内容的分组按 Delete 会打开菜单并落在删除项上', async () => {
    render(<PresetPane />);
    act(() => {
      tabs()[0]!.focus();
    });

    await userEvent.keyboard('{Delete}');

    expect(screen.getByRole('menuitem', { name: '删除分组「分组 1」' })).toHaveFocus();
    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS);
  });

  /** 勾选的含义是「参与顺序循环」，与当前看的是哪一组无关。 */
  it('顺序循环跨分组统计勾选项', async () => {
    render(<PresetPane />);
    const checked = usePresetStore.getState().presets.filter((preset) => preset.inSequence).length;
    expect(screen.getByText(`按序依次发送 ${checked} 条`)).toBeInTheDocument();

    await userEvent.click(tabs()[1]!);
    // 切到没有勾选项的第二组，统计仍然是全局的
    expect(screen.getByText(`按序依次发送 ${checked} 条`)).toBeInTheDocument();
  });

  /**
   * 「全部停止」管的是全局周期任务（单条发送 + 顺序循环 + 每条预设各一路），不是这一行的
   * 顺序循环，所以它跟着「有没有任务在跑」出现，而不是跟着 Loop 按钮的状态走。
   */
  it('有周期任务在跑时才出现全部停止', async () => {
    render(<PresetPane />);
    expect(screen.queryByRole('button', { name: '全部停止' })).not.toBeInTheDocument();

    // 单条发送区起的循环也算 —— 它不在这个面板里，同样得能被这个急停掐掉
    act(() => {
      useTasksStore.setState({ running: ['single'] });
    });

    await userEvent.click(screen.getByRole('button', { name: '全部停止' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '全部停止' })).not.toBeInTheDocument();
    });
  });

  it('在第二组里编辑不影响第一组', async () => {
    render(<PresetPane />);
    await userEvent.click(tabs()[1]!);

    const firstRowData = screen.getAllByRole('textbox')[0]!;
    await userEvent.type(firstRowData, 'AT+GROUP2');

    await userEvent.click(tabs()[0]!);
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('AT+VER?');
  });

  /**
   * 每行都摆着一个「周期」框，而它在顺序循环里一直是被忽略的 —— 用户没有理由
   * 知道这件事。现在两种取法摆在同一个下拉里，选哪个一目了然。
   */
  it('步间隔选「每条」时，统一间隔那一格失效', async () => {
    render(<PresetPane />);
    const gap = screen.getByRole('spinbutton', { name: '间隔' });
    expect(gap).toBeEnabled();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '步间隔' }), 'each');

    expect(gap).toBeDisabled();
    expect(usePresetStore.getState().sequenceStep).toBe('each');
  });

  it('遍数写进 store，0 表示一直循环', async () => {
    render(<PresetPane />);
    const repeat = screen.getByRole('spinbutton', { name: '重复遍数' });
    expect(repeat).toHaveValue(0);

    await userEvent.clear(repeat);
    await userEvent.type(repeat, '3');

    expect(usePresetStore.getState().sequenceRepeat).toBe(3);
  });

  /** 攒到几十条以后，「记得有条叫 xxx，不记得在哪一组」才是找指令的常态。 */
  it('搜索跨全部分组，命中项标出它来自哪一组', async () => {
    render(<PresetPane />);
    await userEvent.click(tabs()[1]!);
    await userEvent.type(screen.getAllByRole('textbox')[0]!, 'NEEDLE');
    await userEvent.click(tabs()[0]!);

    await userEvent.type(screen.getByRole('searchbox', { name: '搜索预设' }), 'needle');

    expect(rows()).toHaveLength(1);
    // 标签页上也有一个「分组 2」，要找的是列表里那个
    expect(within(screen.getByRole('tabpanel')).getByText('分组 2')).toBeInTheDocument();
  });

  it('按名称也能搜到，不只是数据', async () => {
    render(<PresetPane />);
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索预设' }), '查询版本');

    expect(rows()).toHaveLength(1);
  });

  it('搜不到时给一句话，而不是一片空白', async () => {
    render(<PresetPane />);
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索预设' }), 'zzzz');

    expect(screen.getByText('没有匹配的预设')).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  /** 一行已经排了七个控件，再塞两个箭头按钮数据框就没法看了，所以走快捷键。 */
  it('Alt+↑ 把一行往上挪一格', async () => {
    render(<PresetPane />);
    const second = usePresetStore.getState().presets[1]!;

    act(() => screen.getAllByRole('textbox')[1]!.focus());
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');

    expect(usePresetStore.getState().presets[0]!.id).toBe(second.id);
  });

  it('Alt+Shift+↓ 挪到下一个分组，并跟过去', async () => {
    render(<PresetPane />);
    const first = usePresetStore.getState().presets[0]!;

    act(() => screen.getAllByRole('textbox')[0]!.focus());
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}');

    expect(usePresetStore.getState().activeTab).toBe(1);
    expect(usePresetStore.getState().presets[PRESET_TAB_SIZE]!.id).toBe(first.id);
  });

  it('搜索结果里不接移动快捷键 —— 那里的顺序没有意义', async () => {
    render(<PresetPane />);
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索预设' }), '查询版本');
    const before = usePresetStore.getState().presets.map((preset) => preset.id);

    act(() => screen.getAllByRole('textbox')[0]!.focus());
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(usePresetStore.getState().presets.map((preset) => preset.id)).toEqual(before);
  });

});
