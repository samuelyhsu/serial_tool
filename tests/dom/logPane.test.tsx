import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetLogStoreForTests,
  DEFAULT_LOG_CAPACITY,
  LOG_CAPACITY_MIN,
  useLogStore,
} from '@/store/logStore';
import { useUiStore } from '@/store/uiStore';
import { LogPane } from '@/ui/LogPane/LogPane';
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
      showTimestamp: false,
      autoScroll: true,
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

    await userEvent.click(screen.getByTitle('切换 TXT / HEX 模式'));
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

  it('勾选「仅匹配」后不含关键字的行被隐藏', async () => {
    render(<LogPane />);
    feed('alpha\n');
    feed('beta\n');
    await rowTexts();

    await userEvent.type(screen.getByPlaceholderText('过滤 / 高亮关键字…'), 'alpha');
    await userEvent.click(screen.getByRole('checkbox', { name: '仅匹配' }));

    const texts = await rowTexts(1);
    expect(texts[0]).toContain('alpha');
  });

  it('取消「显示发送」后 TX 行被隐藏', async () => {
    render(<LogPane />);
    useLogStore.getState().appendFrame('tx', encoder.encode('AT\r\n'));
    feed('OK\r\n');
    await rowTexts(2);

    await userEvent.click(screen.getByRole('checkbox', { name: '显示发送' }));
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

describe('LogPane 的缓冲容量与「更早的未显示」提示', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(messagesFor('zh'));
    useUiStore.setState({
      language: 'zh',
      view: 'text',
      filter: '',
      onlyMatch: false,
      showTx: true,
      showTimestamp: false,
      autoScroll: true,
    });
  });

  afterEach(cleanup);

  function capacityField(): HTMLInputElement {
    return screen.getAllByLabelText('缓冲')[0] as HTMLInputElement;
  }

  it('容量输入框显示当前容量，只有下限没有上限', () => {
    render(<LogPane />);
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
    render(<LogPane />);
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
    render(<LogPane />);
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
    render(<LogPane />);

    await user.clear(capacityField());
    await user.type(capacityField(), '99999{Enter}');
    expect(useLogStore.getState().capacity).toBe(99999);
    expect(capacityField().value).toBe('99999');
  });

  it('低于下限的输入被抬到下限，不会把非法值留在界面上', async () => {
    const user = userEvent.setup();
    render(<LogPane />);

    await user.clear(capacityField());
    await user.type(capacityField(), '1{Enter}');
    expect(useLogStore.getState().capacity).toBe(LOG_CAPACITY_MIN);
    expect(capacityField().value).toBe(String(LOG_CAPACITY_MIN));
  });

  it('空着失焦当作放弃编辑，回填当前值', async () => {
    const user = userEvent.setup();
    render(<LogPane />);
    await user.clear(capacityField());
    await user.tab();
    expect(capacityField().value).toBe(String(DEFAULT_LOG_CAPACITY));
    expect(useLogStore.getState().capacity).toBe(DEFAULT_LOG_CAPACITY);
  });

  it('缩容丢了记录时在日志里说清楚丢了多少', async () => {
    const user = userEvent.setup();
    render(<LogPane />);
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
    render(<LogPane />);
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
    render(<LogPane />);
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
    render(<LogPane />);
    act(() => feed('only-one'));
    await rowTexts(1);
    expect(screen.queryByText(/未在此显示/)).toBeNull();
  });
});
