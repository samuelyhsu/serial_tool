import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetLogStoreForTests,
  DEFAULT_LOG_CAPACITY,
  LOG_CAPACITY_MIN,
  allEntries,
  flushPendingEntries,
  useLogStore,
} from '@/store/logStore';
import { useUiStore } from '@/store/uiStore';
import { LogPane } from '@/ui/LogPane/LogPane';
import { StatusBar } from '@/ui/StatusBar/StatusBar';
import { setSelectorMessages } from '@/store/logStore';
import { messagesFor } from '@/i18n';

const encoder = new TextEncoder();

function feed(text: string): void {
  useLogStore.getState().appendFrame('rx', encoder.encode(text));
}

function currentRows(): string[] {
  const log = screen.getByRole('log');
  return [...log.querySelectorAll('[data-kind]')].map((el) => el.textContent ?? '');
}

/** 日志是攒批提交的（60ms），断言前要等提交发生。 */
async function rowTexts(expectedCount?: number): Promise<string[]> {
  return waitFor(() => {
    const rows = currentRows();
    if (expectedCount === undefined) expect(rows.length).toBeGreaterThan(0);
    else expect(rows).toHaveLength(expectedCount);
    return rows;
  });
}

describe('LogPane', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(messagesFor('zh'));
    useUiStore.setState({
      language: 'zh',
      view: 'text',
      filter: '',
      onlyMatch: false,
      showTx: true,
      timestampMode: 'none',
    });
  });

  afterEach(cleanup);

  it('没有数据时显示空态引导', () => {
    render(<LogPane />);
    expect(screen.getByText('无数据')).toBeInTheDocument();
    expect(screen.getByText(/点「选择端口」授权设备/)).toBeInTheDocument();
  });

  it('收到的帧会出现在日志里', async () => {
    render(<LogPane />);
    feed('+VER: SA-2100\r\n');
    expect(await rowTexts()).toEqual([expect.stringContaining('+VER: SA-2100')]);
  });

  /** 缺陷 D4 的端到端回归：原型这里会显示成一串点。 */
  it('设备发来的中文正确显示，而不是变成点', async () => {
    render(<LogPane />);
    feed('温度 24.6C\n');
    expect(await rowTexts()).toEqual([expect.stringContaining('温度 24.6C')]);
  });

  it('控制字符以转义形式显示，帧边界可见', async () => {
    render(<LogPane />);
    feed('OK\r\n');
    expect(await rowTexts()).toEqual([expect.stringContaining('OK\\r\\n')]);
  });

  it('切到 HEX 视图后同一帧显示为十六进制', async () => {
    render(<LogPane />);
    feed('AT');
    await rowTexts();

    await userEvent.click(screen.getByRole('button', { name: /^数据格式：/ }));
    expect(await rowTexts()).toEqual([expect.stringContaining('41 54')]);
  });

  it('过滤关键字被高亮，且所有匹配都标出来', async () => {
    render(<LogPane />);
    feed('OK OK OK\n');
    await rowTexts();

    await userEvent.type(screen.getByPlaceholderText('过滤 / 高亮关键字…'), 'OK');
    await waitFor(() => {
      expect(screen.getAllByText('OK')).toHaveLength(3);
    });
  });

  it('按下「仅匹配」后不含关键字的行被隐藏', async () => {
    render(<LogPane />);
    feed('alpha\n');
    feed('beta\n');
    await rowTexts();

    await userEvent.type(screen.getByPlaceholderText('过滤 / 高亮关键字…'), 'alpha');
    await userEvent.click(screen.getByRole('button', { name: '仅匹配' }));

    const texts = await rowTexts(1);
    expect(texts[0]).toContain('alpha');
  });

  it('取消「TX」后发送的行被隐藏', async () => {
    render(<LogPane />);
    useLogStore.getState().appendFrame('tx', encoder.encode('AT\r\n'));
    feed('OK\r\n');
    await rowTexts(2);

    await userEvent.click(screen.getByRole('checkbox', { name: 'TX' }));
    const remaining = await rowTexts(1);
    expect(remaining[0]).toContain('OK');
  });

  it('清空要按两下，第一下只是征询', async () => {
    render(<LogPane />);
    feed('data\n');
    const before = await rowTexts();

    await userEvent.click(screen.getByRole('button', { name: '清空' }));
    // 第一下什么都不该发生 —— 这一步不可撤销，最多 5000 条采集数据连同统计一起丢
    expect(currentRows()).toEqual(before);
    expect(useLogStore.getState().rxBytes).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: '确认清空？' }));
    await waitFor(() => {
      expect(useLogStore.getState().rxBytes).toBe(0);
      expect(useLogStore.getState().rxFrames).toBe(0);
    });
    expect(await rowTexts()).toEqual([expect.stringContaining('日志与统计已清空')]);

    // 清完就复位，下一次仍然要按两下
    expect(screen.getByRole('button', { name: '清空' })).toBeTruthy();
  });

  it('征询状态会自己超时复原，不会一直吊着一个危险按钮', async () => {
    render(<LogPane />);
    feed('data\n');
    await rowTexts();

    await userEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(screen.getByRole('button', { name: '确认清空？' })).toBeTruthy();

    // 3 秒的征询窗口是产品行为，如实等一次
    await waitFor(() => expect(screen.getByRole('button', { name: '清空' })).toBeTruthy(), {
      timeout: 5000,
    });
    expect(useLogStore.getState().rxBytes).toBeGreaterThan(0);
  });

  it('系统消息随语言切换重新翻译（保留结构化事件的好处）', async () => {
    render(<LogPane />);
    useLogStore.getState().appendNotice({ code: 'port-closed' });
    expect(await rowTexts()).toEqual([expect.stringContaining('串口已关闭')]);

    setSelectorMessages(messagesFor('en'));
    act(() => useUiStore.setState({ language: 'en' }));

    await waitFor(() => {
      expect(currentRows()).toEqual([expect.stringContaining('Port closed')]);
    });
  });
});

describe('正则过滤', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(messagesFor('zh'));
    useUiStore.setState({
      language: 'zh',
      view: 'text',
      filter: '',
      filterKind: 'text',
      onlyMatch: true,
      showTx: true,
      timestampMode: 'none',
    });
  });

  afterEach(cleanup);

  function regexToggle(): HTMLElement {
    return screen.getByRole('button', { name: '正则匹配' });
  }

  it('默认是子串模式，开关没按下', () => {
    render(<LogPane />);
    expect(regexToggle()).toHaveAttribute('aria-pressed', 'false');
  });

  it('打开之后过滤词按正则解释', async () => {
    render(<LogPane />);
    feed('AT+VER');
    feed('OK');
    await rowTexts(2);

    await userEvent.click(regexToggle());
    await userEvent.type(screen.getByRole('textbox', { name: /过滤/ }), '^AT');

    expect((await rowTexts(1)).join()).toContain('AT+VER');
  });

  // 一边打字一边看着行数忽然归零，只会让人以为数据没了
  it('正则写到一半时不过滤，并把那句错误挂在框上', async () => {
    render(<LogPane />);
    feed('AT+VER');
    feed('OK');
    await rowTexts(2);

    await userEvent.click(regexToggle());
    const input = screen.getByRole('textbox', { name: /过滤/ });
    // user-event 会把 `[` 当成按键描述符，这里要的就是这个字面字符
    fireEvent.change(input, { target: { value: '[' } });

    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(await rowTexts(2)).toHaveLength(2);
    expect(input.getAttribute('title')).toMatch(/正则写错了/);
  });

  it('关掉之后元字符又变回普通字符', async () => {
    render(<LogPane />);
    feed('a.b');
    feed('axb');
    await rowTexts(2);

    await userEvent.type(screen.getByRole('textbox', { name: /过滤/ }), 'a.b');
    expect((await rowTexts(1)).join()).toContain('a.b');

    await userEvent.click(regexToggle());
    expect(await rowTexts(2)).toHaveLength(2);
  });
});

describe('暂停刷新', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(messagesFor('zh'));
    useUiStore.setState({
      language: 'zh',
      view: 'text',
      filter: '',
      onlyMatch: false,
      showTx: true,
      timestampMode: 'none',
    });
  });

  afterEach(cleanup);

  function pauseButton(): HTMLElement {
    return screen.getByRole('button', { name: /暂停|继续/ });
  }

  /** 让列表看起来可滚，并把滚动位置摆到指定处。jsdom 不做布局，只能自己填。 */
  function scrollTo(top: number): void {
    const list = screen.getByRole('log');
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
    list.scrollTop = top;
    fireEvent.scroll(list);
  }

  it('按下之后新数据不再出现在画面上，但仍在缓冲里', async () => {
    render(<LogPane />);
    feed('first');
    await rowTexts(1);

    await userEvent.click(pauseButton());
    feed('second');
    flushPendingEntries();

    await waitFor(() => expect(pauseButton()).toHaveAttribute('aria-pressed', 'true'));
    expect(currentRows().join()).not.toContain('second');
    expect(allEntries()).toHaveLength(2);
  });

  it('再按一次就接着刷，积压的一起出来', async () => {
    render(<LogPane />);
    await userEvent.click(pauseButton());
    feed('during');
    flushPendingEntries();

    await userEvent.click(pauseButton());
    expect((await rowTexts()).join()).toContain('during');
  });

  it('往上滚会自动暂停', async () => {
    render(<LogPane />);
    feed('a');
    await rowTexts(1);

    act(() => scrollTo(0));
    expect(pauseButton()).toHaveTextContent('继续');
  });

  it('滚回底部自动恢复', async () => {
    render(<LogPane />);
    feed('a');
    await rowTexts(1);

    act(() => scrollTo(0));
    act(() => scrollTo(800));
    expect(pauseButton()).toHaveTextContent('暂停');
  });

  /**
   * 这一条是整件事的要害：手动按下的暂停是「我要它停在这」，
   * 滚回底部把它悄悄恢复了，正是用户按那个按钮想避免的事。
   */
  it('手动按下的暂停，滚回底部也不会自己恢复', async () => {
    render(<LogPane />);
    feed('a');
    await rowTexts(1);

    await userEvent.click(pauseButton());
    act(() => scrollTo(0));
    act(() => scrollTo(800));

    expect(pauseButton()).toHaveTextContent('继续');
  });

  it('滚动暂停期间再按一次按钮，就变成手动暂停，滚回底部也不恢复', async () => {
    render(<LogPane />);
    feed('a');
    await rowTexts(1);

    act(() => scrollTo(0));
    // 此时已是滚动暂停，按一下是「恢复」；再按一下才是手动暂停
    await userEvent.click(pauseButton());
    await userEvent.click(pauseButton());
    act(() => scrollTo(800));

    expect(pauseButton()).toHaveTextContent('继续');
  });
});

describe('时间列的下拉框', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(messagesFor('zh'));
    useUiStore.setState({
      language: 'zh',
      view: 'text',
      filter: '',
      onlyMatch: false,
      showTx: true,
      timestampMode: 'time',
    });
  });

  afterEach(cleanup);

  function stamp(): HTMLElement {
    return screen.getByRole('combobox', { name: '时间' });
  }

  /** 控件在状态栏，被它改变的那一列在接收区。 */
  function renderBoth(): void {
    render(
      <>
        <LogPane />
        <StatusBar />
      </>,
    );
  }

  it('四种模式互斥，只有一个控件在管它', () => {
    renderBoth();
    expect(stamp()).toHaveValue('time');
    expect(
      [...stamp().querySelectorAll('option')].map((option) => option.getAttribute('value')),
    ).toEqual(['none', 'time', 'datetime', 'delta']);
  });

  it('换成日期时间后那一列带上日期', async () => {
    renderBoth();
    useLogStore.getState().appendFrame('rx', encoder.encode('hi'), new Date(2026, 8, 19).getTime());
    flushPendingEntries();

    await userEvent.selectOptions(stamp(), 'datetime');
    expect(await screen.findByText(/^2026-09-19 /)).toBeInTheDocument();
  });

  it('换成间隔后显示的是与上一条的差', async () => {
    renderBoth();
    const { appendFrame } = useLogStore.getState();
    appendFrame('rx', encoder.encode('a'), 1_000_000);
    appendFrame('rx', encoder.encode('b'), 1_000_030);
    flushPendingEntries();

    await userEvent.selectOptions(stamp(), 'delta');
    expect(await screen.findByText('+30ms')).toBeInTheDocument();
  });

  it('关掉之后那一列整个消失', async () => {
    renderBoth();
    useLogStore.getState().appendFrame('rx', encoder.encode('hi'));
    flushPendingEntries();

    await userEvent.selectOptions(stamp(), 'none');
    expect(screen.queryByText(/^\d{2}:\d{2}:\d{2}\./)).not.toBeInTheDocument();
  });
});

describe('缓冲容量与「更早的未显示」提示', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(messagesFor('zh'));
    useUiStore.setState({
      language: 'zh',
      view: 'text',
      filter: '',
      onlyMatch: false,
      showTx: true,
      timestampMode: 'none',
    });
  });

  afterEach(cleanup);

  /** 容量控件在状态栏，缩容回执落在接收区的日志里 —— 两边都要渲染出来才走得通。 */
  function renderBoth(): void {
    render(
      <>
        <LogPane />
        <StatusBar />
      </>,
    );
  }

  function capacityField(): HTMLInputElement {
    return screen.getAllByLabelText('缓冲')[0] as HTMLInputElement;
  }

  it('容量输入框显示当前容量，只有下限没有上限', () => {
    renderBoth();
    const field = capacityField();
    expect(field.value).toBe(String(DEFAULT_LOG_CAPACITY));
    expect(field.min).toBe(String(LOG_CAPACITY_MIN));
    expect(field.max).toBe(''); // 上限交给使用者把握
  });

  /**
   * 这条盯的是缩容不可逆带来的陷阱：把 10000 改成 12000 要途经「1」「12」「120」，
   * 其中 120 是合法值。边打边提交的话，用户还没打完缓冲就已经被砍到 120 条了。
   */
  it('输入过程中不提交 —— 打字途经的合法值不会把缓冲砍掉', async () => {
    const user = userEvent.setup();
    renderBoth();
    const field = capacityField();

    await user.clear(field);
    await user.type(field, '120');
    expect(useLogStore.getState().capacity).toBe(DEFAULT_LOG_CAPACITY); // 还没提交

    await user.type(field, '00'); // 打完是 12000
    expect(useLogStore.getState().capacity).toBe(DEFAULT_LOG_CAPACITY);

    await user.tab(); // 失焦才提交
    expect(useLogStore.getState().capacity).toBe(12000);
  });

  it('回车提交，Esc 放弃并回填生效值', async () => {
    const user = userEvent.setup();
    renderBoth();
    const field = capacityField();

    await user.clear(field);
    await user.type(field, '5000{Enter}');
    expect(useLogStore.getState().capacity).toBe(5000);

    await user.clear(field);
    await user.type(field, '777{Escape}');
    expect(useLogStore.getState().capacity).toBe(5000);
    expect(capacityField().value).toBe('5000');
  });

  it('远大于默认的容量照收，不再被夹到某个上限', async () => {
    const user = userEvent.setup();
    renderBoth();

    await user.clear(capacityField());
    await user.type(capacityField(), '99999{Enter}');
    expect(useLogStore.getState().capacity).toBe(99999);
    expect(capacityField().value).toBe('99999');
  });

  it('低于下限的输入被抬到下限，不会把非法值留在界面上', async () => {
    const user = userEvent.setup();
    renderBoth();

    await user.clear(capacityField());
    await user.type(capacityField(), '1{Enter}');
    expect(useLogStore.getState().capacity).toBe(LOG_CAPACITY_MIN);
    expect(capacityField().value).toBe(String(LOG_CAPACITY_MIN));
  });

  it('空着失焦当作放弃编辑，回填当前值', async () => {
    const user = userEvent.setup();
    renderBoth();
    await user.clear(capacityField());
    await user.tab();
    expect(capacityField().value).toBe(String(DEFAULT_LOG_CAPACITY));
    expect(useLogStore.getState().capacity).toBe(DEFAULT_LOG_CAPACITY);
  });

  it('缩容丢了记录时在日志里说清楚丢了多少', async () => {
    const user = userEvent.setup();
    renderBoth();
    act(() => {
      for (let i = 0; i < 1500; i += 1) feed(`line-${i}`);
    });
    await rowTexts();

    await user.clear(capacityField());
    await user.type(capacityField(), '1000{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/丢弃了最旧的 500 条记录/)).toBeTruthy();
    });
  });

  it('没丢东西时只回执新容量，不吓唬人', async () => {
    const user = userEvent.setup();
    renderBoth();
    act(() => feed('one'));
    await rowTexts();

    await user.clear(capacityField());
    await user.type(capacityField(), '5000{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/日志缓冲容量已改为 5000 条/)).toBeTruthy();
    });
    expect(screen.queryByText(/丢弃了最旧的/)).toBeNull();
  });

  it('超出渲染上限时，列表顶部说明更早的还有多少条', async () => {
    renderBoth();
    act(() => {
      for (let i = 0; i < 1005; i += 1) feed(`line-${i}`);
    });
    // 渲染上限 1000，另外 5 条更早的仍在缓冲里
    await waitFor(() => {
      expect(screen.getByText(/更早的 5 条未在此显示/)).toBeTruthy();
    });
    expect(currentRows()).toHaveLength(1000);
  });

  it('条目没超过渲染上限时不显示这条提示', async () => {
    renderBoth();
    act(() => feed('only-one'));
    await rowTexts(1);
    expect(screen.queryByText(/未在此显示/)).toBeNull();
  });
});
