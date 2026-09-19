import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_VERSION } from '@/lib/appVersion';
import { __resetLogStoreForTests } from '@/store/logStore';
import { useUiStore } from '@/store/uiStore';
import { App } from '@/ui/App';

describe('App', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    useUiStore.setState({ language: 'zh', theme: 'dark', filter: '', view: 'text' });
  });

  afterEach(cleanup);

  it('渲染出五个主要区域', () => {
    render(<App />);
    expect(screen.getByText('串口助手')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '接收区' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '单条发送' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '多条发送' })).toBeInTheDocument();
  });

  /** 三个区不再显示标题，但区域名称仍在，屏幕阅读器照样能按名字跳转。 */
  it('三个区的名称不再作为标题显示出来', () => {
    render(<App />);
    for (const title of ['接收区', '单条发送', '多条发送']) {
      expect(screen.queryByText(title)).not.toBeInTheDocument();
    }
  });

  it('应用名与版本号在左下角：状态栏最前面那两项', () => {
    render(<App />);
    const statusBar = screen.getByRole('contentinfo');
    expect(statusBar.children[0]).toHaveTextContent('串口助手');
    expect(statusBar.children[1]).toHaveTextContent(`v${APP_VERSION}`);
  });

  /**
   * jsdom 没有 navigator.serial，正好等价于「浏览器不支持」的真实场景。
   * 原型此时会锁定演示模式让用户以为能用；这里必须如实说明环境要求。
   */
  it('浏览器不支持 Web Serial 时显示说明横幅而不是假装可用', () => {
    render(<App />);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('此浏览器不支持 Web Serial');
    expect(screen.getByRole('link', { name: /MDN/ })).toHaveAttribute(
      'href',
      expect.stringContaining('developer.mozilla.org'),
    );
  });

  it('不支持时「选择端口」和「打开」都是禁用的', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: '选择端口…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '打开' })).toBeDisabled();
  });

  /** 单端口语义：端口区只剩一个按钮，没有下拉框、没有授权计数、没有撤销按钮。 */
  it('未选端口时端口区只有一个控件', () => {
    render(<App />);
    expect(screen.queryByRole('combobox', { name: '端口' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '备注' })).not.toBeInTheDocument();
  });

  it('主题写到 documentElement 上，供 CSS 变量切换', async () => {
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe('dark');

    await userEvent.click(screen.getByRole('button', { name: '切换深色 / 浅色主题' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('语言切换后界面文案整体换成英文', async () => {
    render(<App />);
    expect(screen.getByText('分帧')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /切换语言|Switch language/ }));
    expect(screen.getByText('Framing')).toBeInTheDocument();
    expect(screen.queryByText('分帧')).not.toBeInTheDocument();
  });

  it('语言按钮显示要切过去的那种：中文界面是 EN，英文界面是 CN', async () => {
    render(<App />);
    const toggle = (): HTMLElement =>
      screen.getByRole('button', { name: /切换语言|Switch language/ });
    expect(toggle()).toHaveTextContent(/^EN$/);

    await userEvent.click(toggle());
    expect(toggle()).toHaveTextContent(/^CN$/);
  });

  it('内置预设名随语言切换，且不依赖名字比对', async () => {
    render(<App />);
    // 预设名现在显示在发送按钮上
    expect(screen.getByRole('button', { name: '查询版本' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /切换语言|Switch language/ }));
    expect(screen.getByRole('button', { name: 'Query version' })).toBeInTheDocument();
  });

  /** 缺陷 D16 的回归测试。 */
  it('用户改过名的预设不再被语言切换覆盖', async () => {
    render(<App />);
    // 改名从行内按 F2 进入：点发送按钮会真的把报文发出去
    screen.getAllByRole('textbox', { name: /数据/ })[0]!.focus();
    await userEvent.keyboard('{F2}');

    const nameInput = screen.getByRole('textbox', { name: '重命名发送按钮' });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, '我的指令{Enter}');

    await userEvent.click(screen.getByRole('button', { name: /切换语言|Switch language/ }));
    expect(screen.getByRole('button', { name: '我的指令' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Query version' })).not.toBeInTheDocument();
  });
});
