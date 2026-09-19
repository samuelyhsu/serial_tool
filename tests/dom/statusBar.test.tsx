import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messagesFor } from '@/i18n';
import {
  __resetLogStoreForTests,
  flushPendingEntries,
  setSelectorMessages,
  useLogStore,
} from '@/store/logStore';
import { useConnectionStore } from '@/store/connectionStore';
import { useUiStore } from '@/store/uiStore';
import { LogPane } from '@/ui/LogPane/LogPane';
import { StatusBar } from '@/ui/StatusBar/StatusBar';

const encoder = new TextEncoder();

function feed(direction: 'rx' | 'tx', text: string): void {
  useLogStore.getState().appendFrame(direction, encoder.encode(text));
}

/** 状态栏的读数由一个秒级时钟驱动，且只在端口打开时才启动。 */
function openPort(at = Date.now()): void {
  act(() => {
    useConnectionStore.setState({ sessionState: 'open', openedAt: at });
  });
}

function tick(seconds = 1): void {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

describe('状态栏的链路读数', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    __resetLogStoreForTests();
    setSelectorMessages(messagesFor('zh'));
    useUiStore.setState({ language: 'zh', view: 'text', filter: '', onlyMatch: false });
    useConnectionStore.setState({ sessionState: 'closed', openedAt: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /** 合在一起数的话，周期发送跑起来时分不清那些字节是自己发的还是对端回的。 */
  it('收发速率分开显示', () => {
    render(<StatusBar />);
    openPort();
    act(() => {
      useLogStore.getState().addThroughput('rx', 120);
      useLogStore.getState().addThroughput('tx', 40);
    });
    tick();

    expect(screen.getByText(/^RX /)).toHaveTextContent('120 B/s');
    expect(screen.getByText(/^TX /)).toHaveTextContent('40 B/s');
  });

  it('端口关着时不显示速率', () => {
    render(<StatusBar />);
    expect(screen.getByText(/^RX /)).not.toHaveTextContent('B/s');
  });

  /**
   * 「收了多少」回答不了「现在还在收吗」：字节数停着不动时，链路断了和对端本来就慢
   * 看起来一模一样。
   */
  it('静默时长从最后一帧接收数据起算', () => {
    render(<StatusBar />);
    openPort();
    act(() => {
      feed('rx', 'hello');
      flushPendingEntries();
    });
    tick();
    expect(screen.getByText('静默 1s')).toBeInTheDocument();

    tick(3);
    expect(screen.getByText('静默 4s')).toBeInTheDocument();

    // 再来一帧就重新起算 —— 否则它只是第二个「运行时长」
    act(() => {
      feed('rx', 'again');
      flushPendingEntries();
    });
    tick();
    expect(screen.getByText('静默 1s')).toBeInTheDocument();
  });

  /** 发送不算：对端一直不应答时，自己发得再欢也该是静默的。 */
  it('只发不收不会让静默时长归零', () => {
    render(<StatusBar />);
    openPort();
    tick(2);
    act(() => {
      feed('tx', 'ping');
      flushPendingEntries();
    });
    tick();

    expect(screen.getByText('未收到数据')).toBeInTheDocument();
  });

  it('超过一分钟的静默按分秒显示', () => {
    render(<StatusBar />);
    openPort();
    act(() => {
      feed('rx', 'x');
      flushPendingEntries();
    });
    tick(65);

    expect(screen.getByText('静默 1m05s')).toBeInTheDocument();
  });
});

describe('状态栏的缓冲占用', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(messagesFor('zh'));
    useUiStore.setState({ language: 'zh', view: 'text', filter: '', onlyMatch: false });
    useConnectionStore.setState({ sessionState: 'closed', openedAt: 0 });
  });

  afterEach(cleanup);

  it('已存条数跟着日志涨，端口关着时照样是对的', () => {
    render(<StatusBar />);
    const used = (): string | null =>
      screen.getByTitle(/日志缓冲已存/).querySelector('span:not([class*="label"])')?.textContent ??
      null;

    expect(used()).toBe('0');

    act(() => {
      feed('rx', 'one');
      feed('rx', 'two');
      flushPendingEntries();
    });
    expect(screen.getByTitle(/日志缓冲已存 2 条/)).toBeInTheDocument();
  });

  /** 存满之后最旧的会被悄悄丢掉，这件事此前在界面上完全看不见。 */
  it('存满时读数停在容量上并变成告警色', () => {
    act(() => {
      useLogStore.getState().setCapacity(1000);
    });
    render(<StatusBar />);

    act(() => {
      for (let i = 0; i < 1002; i += 1) feed('rx', `line-${i}`);
      flushPendingEntries();
    });

    const usage = screen.getByTitle(/日志缓冲已存 1000 条，容量 1000 条/);
    expect(usage).toBeInTheDocument();
    expect(usage.querySelector('[class*="bufferFull"]')).not.toBeNull();
  });
});

describe('状态栏的过滤命中数', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(messagesFor('zh'));
    useUiStore.setState({
      language: 'zh',
      view: 'text',
      filter: '',
      filterKind: 'text',
      onlyMatch: false,
      showTx: true,
      timestampMode: 'none',
      autoScroll: true,
    });
  });

  afterEach(cleanup);

  function renderBoth(): void {
    render(
      <>
        <LogPane />
        <StatusBar />
      </>,
    );
  }

  it('没有过滤词时不占位置', () => {
    renderBoth();
    expect(screen.queryByText(/命中/)).not.toBeInTheDocument();
  });

  /**
   * 过滤着却一行不剩时，「没匹配上」和「根本没数据」看起来一模一样 ——
   * 这两句话对着同一个空列表，指向完全不同的下一步。
   */
  it('一条都没匹配上时明说命中 0，而不是什么都不显示', async () => {
    renderBoth();
    act(() => {
      feed('rx', 'alpha');
      feed('rx', 'beta');
      flushPendingEntries();
    });

    act(() => useUiStore.getState().setFilter('zzz'));
    expect(await screen.findByText('命中 0')).toBeInTheDocument();
  });

  it('命中数跟着过滤词走', async () => {
    renderBoth();
    act(() => {
      feed('rx', 'alpha');
      feed('rx', 'alpine');
      feed('rx', 'beta');
      flushPendingEntries();
    });

    act(() => useUiStore.getState().setFilter('alp'));
    expect(await screen.findByText('命中 2')).toBeInTheDocument();
  });

  /** 扫描在凑够渲染上限时就停了，这时给出的是下界，不能写成确数。 */
  it('扫描被渲染上限截断时标成下界', async () => {
    renderBoth();
    act(() => {
      for (let i = 0; i < 1200; i += 1) feed('rx', 'hit');
      flushPendingEntries();
    });

    act(() => useUiStore.getState().setFilter('hit'));
    expect(await screen.findByText('命中 1000+')).toBeInTheDocument();
  });
});

describe('状态栏的语言与主题开关', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(messagesFor('zh'));
    useUiStore.setState({ language: 'zh', theme: 'dark', view: 'text', filter: '' });
  });

  afterEach(cleanup);

  it('语言按钮切换语言，并连带把状态栏自己的文案翻过去', async () => {
    const user = userEvent.setup();
    render(<StatusBar />);

    await user.click(screen.getByLabelText(/切换语言/));
    expect(useUiStore.getState().language).toBe('en');
    expect(screen.getByLabelText('Framing')).toBeInTheDocument();
  });

  it('主题按钮切换主题', async () => {
    const user = userEvent.setup();
    render(<StatusBar />);

    await user.click(screen.getByLabelText(/主题/));
    expect(useUiStore.getState().theme).toBe('light');
  });
});
