import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEFT_PANE_MIN, RIGHT_PANE_MAX, RIGHT_PANE_MIN, useUiStore } from '@/store/uiStore';
import { Splitter } from '@/ui/Splitter/Splitter';

/**
 * jsdom 不做布局，clientWidth 恒为 0、getBoundingClientRect 全是 0 —— 而分隔条
 * 恰恰靠这两样算可用空间。不摆出一个像样的窗口，每次测到的都是「夹到下限」。
 */
const WINDOW_WIDTH = 1600;

function stubLayout(width: number): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(): number {
      return width;
    },
  });
}

function renderSplitter(width: number | null, windowWidth = WINDOW_WIDTH) {
  stubLayout(windowWidth);
  const onResize = vi.fn();
  render(
    <main>
      <div />
      <Splitter width={width} onResize={onResize} />
      <div />
    </main>,
  );
  const separator = screen.getByRole('separator');
  // 主区右边缘就是窗口右边：拖到 clientX = 右边缘 - 500 就是右栏 500 宽
  separator.parentElement!.getBoundingClientRect = (): DOMRect =>
    ({ right: windowWidth }) as DOMRect;
  return { onResize, separator };
}

beforeEach(() => {
  stubLayout(WINDOW_WIDTH);
  useUiStore.setState({ rightPaneWidth: null });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
});

describe('分栏拖动把手', () => {
  it('按 WAI-ARIA 的 splitter 模式报出自己的位置与范围', () => {
    const { separator } = renderSplitter(500);

    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('aria-valuenow', '500');
    expect(separator).toHaveAttribute('aria-valuemin', String(RIGHT_PANE_MIN));
    expect(separator).toHaveAttribute('aria-valuemax', String(RIGHT_PANE_MAX));
    expect(separator).toHaveAttribute('tabindex', '0');
  });

  /** 存过的宽度要在首帧就落到 DOM，否则会先闪一下样式表里的默认值。 */
  it('已保存的宽度直接写进 CSS 变量', () => {
    const { separator } = renderSplitter(520);

    expect(separator.parentElement!.style.getPropertyValue('--right-pane-width')).toBe('520px');
  });

  /** 没拖过就不该往 DOM 写：写了等于把样式表里的默认值复制一份，以后改默认值这页跟不上。 */
  it('没拖过时不碰 CSS 变量', () => {
    const { separator } = renderSplitter(null);

    expect(separator.parentElement!.style.getPropertyValue('--right-pane-width')).toBe('');
  });

  it('方向键微调：往左是让右栏变宽', async () => {
    const { separator, onResize } = renderSplitter(500);
    separator.focus();

    await userEvent.keyboard('{ArrowLeft}');
    expect(onResize).toHaveBeenLastCalledWith(516);

    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(onResize).toHaveBeenLastCalledWith(484);
  });

  it('Home / End 一步到两端', async () => {
    const { separator, onResize } = renderSplitter(500);
    separator.focus();

    await userEvent.keyboard('{Home}');
    expect(onResize).toHaveBeenLastCalledWith(RIGHT_PANE_MAX);

    await userEvent.keyboard('{End}');
    expect(onResize).toHaveBeenLastCalledWith(RIGHT_PANE_MIN);
  });

  it('拖到哪就多宽，松手才落库', () => {
    const { separator, onResize } = renderSplitter(500);

    fireEvent.pointerDown(separator, { pointerId: 1 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: WINDOW_WIDTH - 640 });

    // 拖动途中只改 DOM，不打扰 store
    expect(separator.parentElement!.style.getPropertyValue('--right-pane-width')).toBe('640px');
    expect(onResize).not.toHaveBeenCalled();

    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(onResize).toHaveBeenCalledExactlyOnceWith(640);
  });

  it('没按下去的时候移动指针不会改宽度', () => {
    const { separator, onResize } = renderSplitter(500);

    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 100 });

    expect(separator.parentElement!.style.getPropertyValue('--right-pane-width')).toBe('500px');
    expect(onResize).not.toHaveBeenCalled();
  });

  /** 拖到底也得给接收区留活路，否则日志区会被挤成一条缝。 */
  it('再怎么拖也给接收区留下最小宽度', () => {
    // 窗口要窄到让「留给接收区」比 RIGHT_PANE_MAX 更严，这条约束才显形
    const narrow = 1200;
    const { separator, onResize } = renderSplitter(500, narrow);

    fireEvent.pointerDown(separator, { pointerId: 1 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 0 });
    fireEvent.pointerUp(separator, { pointerId: 1 });

    expect(onResize).toHaveBeenCalledExactlyOnceWith(narrow - LEFT_PANE_MIN);
  });

  it('窗口够宽时夹在上限上', () => {
    const { separator, onResize } = renderSplitter(500);

    fireEvent.pointerDown(separator, { pointerId: 1 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 0 });
    fireEvent.pointerUp(separator, { pointerId: 1 });

    expect(onResize).toHaveBeenCalledExactlyOnceWith(RIGHT_PANE_MAX);
  });

  it('往回拖过头夹在下限上', () => {
    const { separator, onResize } = renderSplitter(500);

    fireEvent.pointerDown(separator, { pointerId: 1 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: WINDOW_WIDTH - 10 });
    fireEvent.pointerUp(separator, { pointerId: 1 });

    expect(onResize).toHaveBeenCalledExactlyOnceWith(RIGHT_PANE_MIN);
  });
});
