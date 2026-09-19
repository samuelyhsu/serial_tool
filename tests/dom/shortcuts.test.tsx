import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetLogStoreForTests, useLogStore } from '@/store/logStore';
import { useConnectionStore } from '@/store/connectionStore';
import { useUiStore } from '@/store/uiStore';
import { App } from '@/ui/App';

/**
 * 全局快捷键。
 *
 * 两件事值得专门盯着：
 *  - **别撞上既有的 Alt+数字**（发当前分组的第 N 条预设）；
 *  - **认 code 而不是 key**：按住 Alt 时 key 在部分键盘布局下已经不是那个字母了
 *    （macOS 上 Option+S 直接变成 ß）。测试里因此也按 code 派发。
 */

// jsdom 没有实现 URL.createObjectURL，真去下载会抛
vi.mock('@/lib/download', () => ({
  downloadText: vi.fn(),
  downloadBlob: vi.fn(),
}));

function press(code: string, modifiers: Partial<KeyboardEventInit> = {}): boolean {
  const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...modifiers });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('全局快捷键', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    useUiStore.setState({ language: 'zh', view: 'text', filter: '', paused: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('Ctrl+O 连 / 断', () => {
    it('选好端口时切换连接状态', () => {
      const toggleConnection = vi.fn(() => Promise.resolve());
      render(<App />);
      useConnectionStore.setState({
        supported: true,
        selectedPortKey: 'port-1',
        toggleConnection,
      });

      expect(press('KeyO', { ctrlKey: true })).toBe(true);
      expect(toggleConnection).toHaveBeenCalledTimes(1);
    });

    it('macOS 的 Cmd 一样认', () => {
      const toggleConnection = vi.fn(() => Promise.resolve());
      render(<App />);
      useConnectionStore.setState({ supported: true, selectedPortKey: 'p', toggleConnection });

      press('KeyO', { metaKey: true });
      expect(toggleConnection).toHaveBeenCalledTimes(1);
    });

    /** 没端口可开时不该把浏览器的「打开文件」也一起吃掉。 */
    it('没选端口时不拦这个键', () => {
      const toggleConnection = vi.fn(() => Promise.resolve());
      render(<App />);
      useConnectionStore.setState({ supported: true, selectedPortKey: null, toggleConnection });

      expect(press('KeyO', { ctrlKey: true })).toBe(false);
      expect(toggleConnection).not.toHaveBeenCalled();
    });

    it('环境不支持串口时同样不拦', () => {
      const toggleConnection = vi.fn(() => Promise.resolve());
      render(<App />);
      useConnectionStore.setState({ supported: false, selectedPortKey: 'p', toggleConnection });

      expect(press('KeyO', { ctrlKey: true })).toBe(false);
    });
  });

  it('Ctrl+F 跳到过滤框并选中已有内容', () => {
    render(<App />);
    useUiStore.setState({ filter: 'ERROR' });

    expect(press('KeyF', { ctrlKey: true })).toBe(true);
    const input = screen.getByRole('textbox', { name: /过滤/ });
    expect(document.activeElement).toBe(input);
  });

  it('Alt+S 跳到发送框', () => {
    render(<App />);

    expect(press('KeyS', { altKey: true })).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '发送内容' }));
  });

  it('Ctrl+S 存日志，并在日志里回执', async () => {
    const { downloadText } = await import('@/lib/download');
    render(<App />);

    expect(press('KeyS', { ctrlKey: true })).toBe(true);
    expect(downloadText).toHaveBeenCalledTimes(1);
    expect(useLogStore.getState().version).toBeGreaterThan(0);
  });

  it('Alt+P 暂停，再按一次继续', () => {
    render(<App />);

    press('KeyP', { altKey: true });
    expect(useUiStore.getState().paused?.source).toBe('manual');

    press('KeyP', { altKey: true });
    expect(useUiStore.getState().paused).toBeNull();
  });

  it('Alt+H 在 TXT 与 HEX 之间切', () => {
    render(<App />);

    press('KeyH', { altKey: true });
    expect(useUiStore.getState().view).toBe('hex');

    press('KeyH', { altKey: true });
    expect(useUiStore.getState().view).toBe('text');
  });

  describe('不该被触发的情形', () => {
    it('Alt+数字仍然归预设发送，不碰这些动作', () => {
      render(<App />);
      const before = useUiStore.getState().view;

      press('Digit1', { altKey: true });
      expect(useUiStore.getState().view).toBe(before);
      expect(useUiStore.getState().paused).toBeNull();
    });

    it('多按一个 Shift 就不认了 —— 留给将来的组合', () => {
      render(<App />);

      expect(press('KeyP', { altKey: true, shiftKey: true })).toBe(false);
      expect(useUiStore.getState().paused).toBeNull();
    });

    it('Ctrl 与 Alt 同时按下不认', () => {
      render(<App />);

      expect(press('KeyS', { ctrlKey: true, altKey: true })).toBe(false);
    });

    it('没有修饰键的字母原样交给输入框', () => {
      render(<App />);

      expect(press('KeyP')).toBe(false);
      expect(useUiStore.getState().paused).toBeNull();
    });

    // 输入法选字用的按键不能被当成命令
    it('输入法组字期间一概不认', () => {
      render(<App />);

      expect(press('KeyP', { altKey: true, isComposing: true })).toBe(false);
      expect(useUiStore.getState().paused).toBeNull();
    });

    it('不认得的组合不拦截', () => {
      render(<App />);
      expect(press('KeyZ', { ctrlKey: true })).toBe(false);
      expect(press('KeyZ', { altKey: true })).toBe(false);
    });
  });
});
