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

  it('不显示序号列', () => {
    render(<PresetPane />);
    expect(screen.queryByText('序')).not.toBeInTheDocument();
    expect(screen.queryByText('01')).not.toBeInTheDocument();
  });

  it('列顺序为：序列 · 格式 · 数据 · 帧尾 · 发送 · 周期 · 循环', () => {
    render(<PresetPane />);
    const headers = screen.getByText('序列').parentElement!.querySelectorAll('span');
    expect([...headers].map((h) => h.textContent).filter(Boolean)).toEqual([
      '序列',
      '格式',
      '数据',
      '帧尾',
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

  it('默认三个分组，第一个选中，列表归属于选中的分组', () => {
    render(<PresetPane />);
    expect(tabs().map((tab) => tab.textContent)).toEqual(['分组 1', '分组 2', '分组 3']);
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('分组 1');
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

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(tabs()[2]).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Home}');
    expect(tabs()[0]).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(tabs()[2]).toHaveFocus();
  });

  it('只有选中的分组在 Tab 键序列里', () => {
    render(<PresetPane />);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
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
    await userEvent.click(screen.getByRole('button', { name: '新建分组' }));

    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS + 1);
    expect(tabs().at(-1)).toHaveTextContent('分组 4');
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

    expect(tabs().map((tab) => tab.textContent)).toEqual(['电机', 'Group 2', 'Group 3']);
  });

  it('没动过的空分组点「−」直接删，选中与焦点落到顶上来的那一组', async () => {
    render(<PresetPane />);
    await userEvent.click(tabs()[1]!);
    await userEvent.click(screen.getByRole('button', { name: '删除分组「分组 2」' }));

    // 没改过名的标题按位置编号，原来的第三组现在是「分组 2」
    expect(tabs().map((tab) => tab.textContent)).toEqual(['分组 1', '分组 2']);
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs()[1]).toHaveFocus();
  });

  it('有内容的分组要按两下才删，第一下只是征询', async () => {
    render(<PresetPane />);
    await userEvent.click(screen.getByRole('button', { name: '删除分组「分组 1」' }));
    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS);

    await userEvent.click(screen.getByRole('button', { name: '确认删除？' }));
    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS - 1);
    expect(screen.queryByRole('button', { name: '查询版本' })).not.toBeInTheDocument();
  });

  it('征询状态会自己超时复原，不会一直吊着一个危险按钮', async () => {
    render(<PresetPane />);
    await userEvent.click(screen.getByRole('button', { name: '删除分组「分组 1」' }));
    expect(screen.getByRole('button', { name: '确认删除？' })).toBeInTheDocument();

    // 3 秒的征询窗口是产品行为，如实等一次
    await waitFor(
      () => expect(screen.getByRole('button', { name: '删除分组「分组 1」' })).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS);
  });

  it('换到别的分组，之前那次征询作废', async () => {
    render(<PresetPane />);
    await userEvent.dblClick(tabs()[1]!);
    const input = screen.getByRole('textbox', { name: '重命名分组' });
    await userEvent.clear(input);
    await userEvent.type(input, 'X{Enter}');
    await userEvent.click(screen.getByRole('button', { name: /^删除分组/ }));
    expect(screen.getByRole('button', { name: '确认删除？' })).toBeInTheDocument();

    // 切走再切回来：回来时不该还吊着上一次的征询，得重新按两下
    await userEvent.click(tabs()[0]!);
    await userEvent.click(tabs()[1]!);
    expect(screen.queryByRole('button', { name: '确认删除？' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除分组「X」' })).toBeInTheDocument();
    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS);
  });

  it('在选中的标签上按 Delete 与点「−」相同', async () => {
    render(<PresetPane />);
    act(() => {
      tabs()[0]!.focus();
    });
    await userEvent.keyboard('{End}{Delete}');

    expect(tabs()).toHaveLength(PRESET_DEFAULT_TABS - 1);
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs()[1]).toHaveFocus();
  });

  it('只剩一组时没有删除按钮，Delete 也不起作用', async () => {
    render(<PresetPane />);
    act(() => {
      const { tabs: current, removeTab } = usePresetStore.getState();
      removeTab(current[2]!.id);
      removeTab(current[1]!.id);
    });

    expect(screen.queryByRole('button', { name: /^删除分组/ })).not.toBeInTheDocument();
    act(() => {
      tabs()[0]!.focus();
    });
    await userEvent.keyboard('{Delete}');
    expect(tabs()).toHaveLength(1);
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
   * 帧尾徽标常态只占一个字符宽，点开才在行下方展开选择器 ——
   * 行高不因为多了这项能力而变，一屏还是那么多条。
   */
  it('帧尾徽标显示当前会追加什么，点开可改', async () => {
    render(<PresetPane />);
    const badge = within(rows()[0]!).getByRole('button', { name: /设置帧尾/ });
    expect(badge).toHaveTextContent('—');

    await userEvent.click(badge);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '结束符' }), 'crlf');

    expect(usePresetStore.getState().presets[0]!.eol).toBe('crlf');
    expect(badge).toHaveTextContent('\\r\\n');
  });

  it('HEX 行展开的是校验和', async () => {
    render(<PresetPane />);
    // 第三条内置示例是 Modbus 读温湿度，本来就是 HEX
    const badge = within(rows()[2]!).getByRole('button', { name: /设置帧尾/ });

    await userEvent.click(badge);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '校验和' }),
      'crc16-modbus',
    );

    expect(usePresetStore.getState().presets[2]!.checksum).toBe('crc16-modbus');
    expect(badge).toHaveTextContent('MODBUS');
  });

  it('再点一次徽标收起选择器', async () => {
    render(<PresetPane />);
    const badge = within(rows()[0]!).getByRole('button', { name: /设置帧尾/ });

    await userEvent.click(badge);
    expect(screen.getByRole('combobox', { name: '结束符' })).toBeInTheDocument();

    await userEvent.click(badge);
    expect(screen.queryByRole('combobox', { name: '结束符' })).not.toBeInTheDocument();
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
});
