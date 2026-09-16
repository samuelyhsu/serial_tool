import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BAUD_RATE_MAX,
  BAUD_RATES,
  DEFAULT_OPTIONS,
  isValidBaudRate,
  useConnectionStore,
} from '@/store/connectionStore';
import { useUiStore } from '@/store/uiStore';
import { BaudRateInput } from '@/ui/Toolbar/BaudRateInput';

function baudInput(): HTMLInputElement {
  return screen.getByLabelText('波特率');
}

function toggle(): HTMLButtonElement {
  return screen.getByRole('button', { name: '常用波特率' });
}

function options(): HTMLElement[] {
  return within(screen.getByRole('listbox')).getAllByRole('option');
}

function activeOption(): string | null {
  const id = baudInput().getAttribute('aria-activedescendant');
  return id === null ? null : (document.getElementById(id)?.textContent ?? null);
}

describe('波特率', () => {
  beforeAll(() => {
    // jsdom 没有实现布局，也就没有 scrollIntoView
    Element.prototype.scrollIntoView = () => undefined;
  });

  beforeEach(() => {
    useUiStore.setState({ language: 'zh' });
    useConnectionStore.setState({ options: { ...DEFAULT_OPTIONS } });
  });

  afterEach(cleanup);

  it('候选列表覆盖 50 ~ 4000000，且严格升序无重复', () => {
    const rates = [...BAUD_RATES];
    expect(rates[0]).toBe(50);
    expect(rates.at(-1)).toBe(4000000);
    expect(new Set(rates).size).toBe(rates.length);
    expect([...rates].sort((a, b) => a - b)).toEqual(rates);
  });

  it('候选列表包含各类芯片与协议常用的档位', () => {
    const rates = new Set<number>(BAUD_RATES);
    const expected = [
      // Windows DCB 的 CBR_* 常量
      110, 300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 128000, 256000,
      // Linux termios 的 B* 常量（含 SPARC 专有档）
      50, 75, 134, 150, 200, 1800, 230400, 460800, 500000, 576000, 921600, 1000000, 1152000,
      1500000, 2000000, 2500000, 3000000, 3500000, 4000000, 76800, 153600, 307200, 614400,
      // CP210x AN205 Table 1 独有的档
      4000, 7200, 16000, 28800, 51200, 56000, 64000, 250000,
      // CH340 手册独有的档
      100, 900, 3600, 33600,
      // 协议 / 设备：MIDI、ESP8266 上电日志
      31250, 74880,
    ];
    for (const rate of expected) {
      expect(rates, String(rate)).toContain(rate);
    }
  });

  it('候选值全部合法', () => {
    for (const rate of BAUD_RATES) {
      expect(isValidBaudRate(rate), String(rate)).toBe(true);
    }
  });

  it('默认值是 115200', () => {
    render(<BaudRateInput disabled={false} />);
    expect(baudInput()).toHaveValue('115200');
  });

  it('没有 ±1 微调按钮', () => {
    render(<BaudRateInput disabled={false} />);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(baudInput()).toHaveAttribute('type', 'text');
  });

  /** 核心诉求：datalist 会按当前值筛选，输入框是 115200 时点开只剩 115200 / 1152000。 */
  it('输入框有值时展开，仍列出全部候选并标出当前值', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.click(toggle());

    expect(options().map((option) => Number(option.textContent))).toEqual([...BAUD_RATES]);
    const selected = options().filter((option) => option.getAttribute('aria-selected') === 'true');
    expect(selected.map((option) => option.textContent)).toEqual(['115200']);
    expect(baudInput()).toHaveFocus();
    expect(activeOption()).toBe('115200');
  });

  it('点击候选即提交并收起列表', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole('option', { name: '921600' }));

    expect(useConnectionStore.getState().options.baudRate).toBe(921600);
    expect(baudInput()).toHaveValue('921600');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('再点一次展开按钮收起列表', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.click(toggle());
    await userEvent.click(toggle());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('键盘：↓ 展开并停在当前值，↑↓ 移动，Enter 提交', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.click(baudInput());

    await userEvent.keyboard('{ArrowDown}');
    expect(baudInput()).toHaveAttribute('aria-expanded', 'true');
    expect(activeOption()).toBe('115200');

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(activeOption()).toBe('128000');

    await userEvent.keyboard('{Enter}');
    expect(useConnectionStore.getState().options.baudRate).toBe(128000);
    expect(baudInput()).toHaveValue('128000');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('当前值不在列表里时，展开全部后停在紧邻的更高一档', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.clear(baudInput());
    await userEvent.type(baudInput(), '100001');
    await userEvent.keyboard('{Escape}{ArrowDown}');
    expect(options()).toHaveLength(BAUD_RATES.length);
    expect(activeOption()).toBe('115200');
  });

  it('打字时自动展开，只列出以已输入数字开头的档位', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.clear(baudInput());
    await userEvent.type(baudInput(), '15');

    expect(options().map((option) => option.textContent)).toEqual(['150', '153600', '1500000']);
    // 不预先高亮：没按方向键就没有候选被「选中待提交」
    expect(activeOption()).toBeNull();
  });

  it('打字筛选后按 Enter 保留输入的值，而不是换成第一个候选', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.clear(baudInput());
    await userEvent.type(baudInput(), '1152');
    expect(options().map((option) => option.textContent)).toEqual(['115200', '1152000']);

    await userEvent.keyboard('{Enter}');
    expect(baudInput()).toHaveValue('1152');
    expect(useConnectionStore.getState().options.baudRate).toBe(1152);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('打字筛选后可用 ↓ 在匹配项里选择', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.clear(baudInput());
    await userEvent.type(baudInput(), '1152');

    await userEvent.keyboard('{ArrowDown}');
    expect(activeOption()).toBe('115200');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(activeOption()).toBe('1152000');

    await userEvent.keyboard('{Enter}');
    expect(useConnectionStore.getState().options.baudRate).toBe(1152000);
  });

  it('没有匹配的档位时不显示列表', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.clear(baudInput());
    await userEvent.type(baudInput(), '12345');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(baudInput()).toHaveAttribute('aria-expanded', 'false');
  });

  it('筛选过后再点展开按钮，恢复列出全部档位', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.clear(baudInput());
    await userEvent.type(baudInput(), '15');
    await userEvent.click(toggle()); // 收起
    await userEvent.click(toggle()); // 重新展开

    expect(options()).toHaveLength(BAUD_RATES.length);
  });

  it('把输入删空时列出全部档位', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.type(baudInput(), '{Backspace>6/}');
    expect(options()).toHaveLength(BAUD_RATES.length);
  });

  it('Escape 收起列表，不改值', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.click(toggle());
    await userEvent.keyboard('{ArrowDown}{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(useConnectionStore.getState().options.baudRate).toBe(115200);
  });

  it('失焦收起列表', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.click(toggle());
    await userEvent.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  /** 核心诉求：不在候选列表里的值也能用。 */
  it('可以输入候选列表里没有的自定义值', async () => {
    render(<BaudRateInput disabled={false} />);
    const input = baudInput();

    await userEvent.clear(input);
    await userEvent.type(input, '12345');
    expect(useConnectionStore.getState().options.baudRate).toBe(12345);

    await userEvent.clear(input);
    await userEvent.type(input, '12000000');
    expect(useConnectionStore.getState().options.baudRate).toBe(12000000);
  });

  it('只保留数字，粘贴带分隔符的值也能用', async () => {
    render(<BaudRateInput disabled={false} />);
    const input = baudInput();

    await userEvent.clear(input);
    await userEvent.type(input, '9a6-0x0');
    expect(input).toHaveValue('9600');

    await userEvent.clear(input);
    await userEvent.click(input);
    await userEvent.paste('921,600');
    expect(input).toHaveValue('921600');
    expect(useConnectionStore.getState().options.baudRate).toBe(921600);
  });

  it('输入过程中的中间值不会被纠正或打断', async () => {
    render(<BaudRateInput disabled={false} />);
    const input = baudInput();

    await userEvent.clear(input);
    await userEvent.type(input, '115');
    // 115 本身合法，会被提交；但界面上仍是用户打进去的内容，没有被改写
    expect(input).toHaveValue('115');

    await userEvent.type(input, '200');
    expect(input).toHaveValue('115200');
  });

  it('清空输入不会把 0 写进配置', async () => {
    render(<BaudRateInput disabled={false} />);
    await userEvent.clear(baudInput());

    expect(useConnectionStore.getState().options.baudRate).toBe(115200);
    expect(baudInput()).toHaveAttribute('aria-invalid', 'true');
  });

  it('失焦时若仍非法则回退到最后一个有效值', async () => {
    render(<BaudRateInput disabled={false} />);
    const input = baudInput();

    await userEvent.clear(input);
    await userEvent.tab();

    expect(input).toHaveValue('115200');
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('端口打开期间不可修改', () => {
    render(<BaudRateInput disabled />);
    expect(baudInput()).toBeDisabled();
    expect(toggle()).toBeDisabled();
  });

  it('展开中被禁用时收起列表', async () => {
    const { rerender } = render(<BaudRateInput disabled={false} />);
    await userEvent.click(toggle());
    rerender(<BaudRateInput disabled />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('isValidBaudRate', () => {
  it('接受正整数', () => {
    expect(isValidBaudRate(1)).toBe(true);
    expect(isValidBaudRate(115200)).toBe(true);
    expect(isValidBaudRate(3000000)).toBe(true);
    expect(isValidBaudRate(BAUD_RATE_MAX)).toBe(true);
  });

  it('拒绝 0、负数、小数与越界值', () => {
    // 规范要求 baudRate 大于 0
    expect(isValidBaudRate(0)).toBe(false);
    expect(isValidBaudRate(-9600)).toBe(false);
    expect(isValidBaudRate(9600.5)).toBe(false);
    expect(isValidBaudRate(BAUD_RATE_MAX + 1)).toBe(false);
  });

  it('拒绝 NaN 与无穷大', () => {
    expect(isValidBaudRate(Number.NaN)).toBe(false);
    expect(isValidBaudRate(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
