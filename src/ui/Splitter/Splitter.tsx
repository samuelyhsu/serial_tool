import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  clampRightPaneWidth,
  LEFT_PANE_MIN,
  RIGHT_PANE_MAX,
  RIGHT_PANE_MIN,
} from '@/store/uiStore';
import { useMessages } from '../useMessages';
import styles from './Splitter.module.css';

/** 键盘每按一下挪多少像素。 */
const STEP = 16;

interface SplitterProps {
  /** 已保存的右栏宽度；null 表示没拖过，用样式表里的默认值。 */
  width: number | null;
  onResize: (width: number) => void;
}

/**
 * 左右分栏的拖动把手。
 *
 * 宽度写在 `--right-pane-width` 上，**拖动过程中直接改 DOM 上的这个变量、不经过 store**：
 * 每一帧都 setState 会连着日志列表一起重渲染，拖起来是顿的。只有松手（键盘则是每挪一下）
 * 才把最终值交出去持久化。
 *
 * 这个变量的写入权整个归这里，App 不设内联样式 —— 两边都写的话，拖动途中
 * 任何一次无关的重渲染都会把界面弹回上一个存过的宽度。
 *
 * 按 WAI-ARIA 的 window splitter 模式：可聚焦，左右方向键调整，Home / End 到两端。
 */
export function Splitter({ width, onResize }: SplitterProps): React.JSX.Element {
  const t = useMessages();
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // 当前实际宽度，给 aria-valuenow 和键盘调整当起点
  const [current, setCurrent] = useState<number | null>(width);

  /** 右栏此刻实际多宽。没拖过时这个数由样式表定，只能量。 */
  const measure = useCallback((): number => {
    const right = ref.current?.nextElementSibling;
    return right instanceof HTMLElement ? right.clientWidth : RIGHT_PANE_MIN;
  }, []);

  /** 写进 CSS 变量，交回夹紧之后的值。上限还要给接收区留下 LEFT_PANE_MIN。 */
  const apply = useCallback((next: number): number => {
    const main = ref.current?.parentElement;
    if (!main) return next;
    const ceiling = Math.max(RIGHT_PANE_MIN, main.clientWidth - LEFT_PANE_MIN);
    const clamped = Math.min(clampRightPaneWidth(next), ceiling);
    main.style.setProperty('--right-pane-width', `${clamped}px`);
    return clamped;
  }, []);

  // 存过的宽度要在首帧就落到 DOM 上，否则会先闪一下样式表里的默认值
  useLayoutEffect(() => {
    // 没拖过时只量一下报数，不往 DOM 写 —— 写了就等于把样式表里的默认值复制了一份
    setCurrent(width === null ? clampRightPaneWidth(measure()) : apply(width));
  }, [width, apply, measure]);

  const commit = (next: number): void => {
    const applied = apply(next);
    setCurrent(applied);
    onResize(applied);
  };

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label={t.resizePanes}
      aria-valuenow={current ?? undefined}
      aria-valuemin={RIGHT_PANE_MIN}
      aria-valuemax={RIGHT_PANE_MAX}
      tabIndex={0}
      title={t.resizePanes}
      className={styles.divider}
      data-dragging={dragging || undefined}
      onPointerDown={(event) => {
        // 捕获之后拖出把手范围也照样收得到事件。jsdom 没实现它，所以是可选调用
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        const main = ref.current?.parentElement;
        if (!main) return;
        // 右栏宽度 = 主区右边缘到指针的距离
        setCurrent(apply(main.getBoundingClientRect().right - event.clientX));
      }}
      onPointerUp={(event) => {
        if (!dragging) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        setDragging(false);
        onResize(current ?? measure());
      }}
      onKeyDown={(event) => {
        // 把手往左 = 右栏变宽
        const delta = event.key === 'ArrowLeft' ? STEP : event.key === 'ArrowRight' ? -STEP : 0;
        if (delta !== 0) {
          event.preventDefault();
          commit((current ?? measure()) + delta);
          return;
        }
        if (event.key === 'Home') {
          event.preventDefault();
          commit(RIGHT_PANE_MAX);
        } else if (event.key === 'End') {
          event.preventDefault();
          commit(RIGHT_PANE_MIN);
        }
      }}
    />
  );
}
