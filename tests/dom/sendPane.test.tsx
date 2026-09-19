import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allEntries, __resetLogStoreForTests } from '@/store/logStore';
import { useSendStore } from '@/store/sendStore';
import { useUiStore } from '@/store/uiStore';
import { SendPane } from '@/ui/SendPane/SendPane';

describe('发送历史', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    useUiStore.setState({ language: 'zh' });
    useSendStore.setState({
      payload: 'draft',
      mode: 'text',
      checksum: 'none',
      intervalMs: 1000,
      parseError: null,
      modeIssue: null,
      history: [
        { payload: 'AT+VER?', mode: 'text' },
        { payload: 'AA BB', mode: 'hex' },
      ],
      historyCursor: -1,
      historyDraft: null,
    });
  });

  afterEach(cleanup);

  it('历史为空时按钮是禁用的', () => {
    useSendStore.setState({ history: [] });
    render(<SendPane />);
    expect(screen.getByRole('button', { name: '历史' })).toBeDisabled();
  });

  it('点开列出发过的，带上 TXT / HEX 标记', async () => {
    render(<SendPane />);
    await userEvent.click(screen.getByRole('button', { name: '历史' }));

    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('TXT');
    expect(items[0]).toHaveTextContent('AT+VER?');
    expect(items[1]).toHaveTextContent('HEX');
  });

  it('点一条就填回输入框，模式跟着切', async () => {
    render(<SendPane />);
    await userEvent.click(screen.getByRole('button', { name: '历史' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /AA BB/ }));

    expect(useSendStore.getState().payload).toBe('AA BB');
    expect(useSendStore.getState().mode).toBe('hex');
  });

  it('清空之后按钮回到禁用', async () => {
    render(<SendPane />);
    await userEvent.click(screen.getByRole('button', { name: '历史' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '清空历史' }));

    expect(screen.getByRole('button', { name: '历史' })).toBeDisabled();
  });

  /** 这是个多行输入框，光秃秃的上下键得留给光标。 */
  it('输入框里 Ctrl+↑ / Ctrl+↓ 翻历史', async () => {
    render(<SendPane />);
    const editor = screen.getByRole('textbox', { name: '发送内容' });
    editor.focus();

    await userEvent.keyboard('{Control>}{ArrowUp}{/Control}');
    expect(useSendStore.getState().payload).toBe('AT+VER?');

    await userEvent.keyboard('{Control>}{ArrowDown}{/Control}');
    expect(useSendStore.getState().payload).toBe('draft');
  });

  it('不按 Ctrl 的方向键不动历史', async () => {
    render(<SendPane />);
    const editor = screen.getByRole('textbox', { name: '发送内容' });
    editor.focus();

    await userEvent.keyboard('{ArrowUp}');
    expect(useSendStore.getState().payload).toBe('draft');
  });
});

describe('SendPane', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    useUiStore.setState({ language: 'zh' });
    useSendStore.setState({
      payload: 'AT+VER?',
      mode: 'text',
      checksum: 'none',
      intervalMs: 1000,
      parseError: null,
      modeIssue: null,
    });
  });

  afterEach(cleanup);

  it('默认不追加结束符，发出去的就是载荷本身', () => {
    render(<SendPane />);
    expect(useSendStore.getState().frameBytes()).toHaveLength(7);
  });

  it('报文里的转义计入发送字节', () => {
    useSendStore.setState({ payload: String.raw`AT+VER?\r\n` });
    render(<SendPane />);
    // "AT+VER?" 7 字节 + CRLF 2 字节
    expect(useSendStore.getState().frameBytes()).toHaveLength(9);
  });

  /**
   * 「最终会发出去多少字节」是对着抓包看的时候唯一要对的那个数。
   * TXT 下转义已经解析完、HEX 下校验和已经计入，界面上的读数必须是那一串的长度。
   */
  it('标题行显示真正会发出去的字节数', async () => {
    render(<SendPane />);
    expect(screen.getByText('7 字节')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('发送内容'), String.raw`\r\n`);
    expect(screen.getByText('9 字节')).toBeInTheDocument();
  });

  it('报文解析不通过时读数位置留一个占位', async () => {
    useSendStore.setState({ payload: '', mode: 'hex' });
    render(<SendPane />);

    await userEvent.type(screen.getByLabelText('发送内容'), 'ZZ');

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/字节/)).not.toBeInTheDocument();
  });

  /** 格式标识仍然不显示：窄栏里堆无用信息。 */
  it('标题行不显示格式标识', () => {
    render(<SendPane />);
    expect(screen.queryByText(/· TXT/)).not.toBeInTheDocument();
  });

  it('文本 → HEX 切换是无损的', async () => {
    render(<SendPane />);
    await userEvent.click(screen.getByTitle('切换 TXT / HEX 模式'));
    expect(useSendStore.getState().payload).toBe('41 54 2B 56 45 52 3F');
    expect(useSendStore.getState().mode).toBe('hex');
  });

  /**
   * 缺陷 D3 的端到端回归：原型会把这个 Modbus 帧的不可打印字节全变成 "."。
   *
   * 有转义之前这边也只能拒绝切换（非 UTF-8 字节没法写成文本）。现在每个字节
   * 都写得成 \xHH，两个方向都无损，切换不再有「拒绝」这回事。
   */
  it('含非法 UTF-8 字节的报文照样切得成文本，一个字节不差', async () => {
    useSendStore.setState({ payload: '01 03 00 00 00 02 C4 0B', mode: 'hex' });
    render(<SendPane />);

    await userEvent.click(screen.getByTitle('切换 TXT / HEX 模式'));

    expect(useSendStore.getState().mode).toBe('text');
    expect(useSendStore.getState().payload).toBe('\\x01\\x03\\x00\\x00\\x00\\x02\\xC4\\x0B');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // 切回去还是原样
    await userEvent.click(screen.getByTitle('切换 TXT / HEX 模式'));
    expect(useSendStore.getState().payload).toBe('01 03 00 00 00 02 C4 0B');
  });

  it('HEX 格式非法时标红并说明原因，发送按钮禁用', async () => {
    useSendStore.setState({ payload: '', mode: 'hex' });
    render(<SendPane />);

    await userEvent.type(screen.getByLabelText('发送内容'), 'ZZ');

    expect(screen.getByRole('alert')).toHaveTextContent('不是十六进制数字');
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });

  it('串口未打开时发送按钮禁用', () => {
    render(<SendPane />);
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });

describe('复制按钮', () => {
  function stubClipboard(result: Promise<void> | undefined) {
    const writeText = vi.fn(() => result);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: result === undefined ? undefined : { writeText },
    });
    return writeText;
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  /**
   * 复制的是最终会发出去的那一串，不是输入框里的原文。TXT 写成规范化的转义 ——
   * 粘回来还是同样的字节，非 UTF-8 也不会在剪贴板里坏掉。
   */
  it('TXT 模式复制解析后的报文，不是输入框里的原文', async () => {
    const writeText = stubClipboard(Promise.resolve());
    // \x41 就是 A：复制出来的该是规范化之后的样子，照抄输入就看不出区别了
    useSendStore.setState({ payload: String.raw`\x41T\r\n`, mode: 'text' });
    render(<SendPane />);

    await userEvent.click(screen.getByRole('button', { name: '复制' }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith(String.raw`AT\r\n`);
  });

  it('HEX 模式复制的是含校验和的字节', async () => {
    const writeText = stubClipboard(Promise.resolve());
    useSendStore.setState({
      payload: '01 03 00 00 00 02',
      mode: 'hex',
      checksum: 'crc16-modbus',
    });
    render(<SendPane />);

    await userEvent.click(screen.getByRole('button', { name: '复制' }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith('01 03 00 00 00 02 C4 0B');
  });

  it('复制成功后在日志里说一声', async () => {
    stubClipboard(Promise.resolve());
    render(<SendPane />);

    await userEvent.click(screen.getByRole('button', { name: '复制' }));

    await waitFor(() => {
      expect(allEntries().at(-1)?.text).toBe('报文已复制到剪贴板');
    });
  });

  /** VS Code 的 webview 里剪贴板未必给得了权限，不能静悄悄地什么都不发生。 */
  it('剪贴板不可用时也要说一声', async () => {
    stubClipboard(Promise.reject(new Error('denied')));
    render(<SendPane />);

    await userEvent.click(screen.getByRole('button', { name: '复制' }));

    await waitFor(() => {
      expect(allEntries().at(-1)?.text).toBe('复制失败：剪贴板不可用');
    });
  });

  it('连剪贴板 API 都没有时同样给提示', async () => {
    stubClipboard(undefined);
    render(<SendPane />);

    await userEvent.click(screen.getByRole('button', { name: '复制' }));

    expect(allEntries().at(-1)?.text).toBe('复制失败：剪贴板不可用');
  });

  it('报文解析不通过时复制按钮禁用', () => {
    useSendStore.setState({ payload: 'ZZ', mode: 'hex' });
    render(<SendPane />);

    expect(screen.getByRole('button', { name: '复制' })).toBeDisabled();
  });
});
});
