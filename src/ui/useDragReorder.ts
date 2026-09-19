import { useCallback, useState } from 'react';

/**
 * 按住左键拖动重排。分组标签（横向）与预设行（纵向）共用它。
 *
 * 两个要点，都是被具体场景逼出来的：
 *
 * - **越过阈值才接管**。按下即接管的话，普通的点击（切换分组、把光标放进输入框）
 *   会连带触发一次重排。
 * - **纵向拖拽要求纵向位移占优**（`dominantAxis`）。预设行的拖拽手柄是那个数据
 *   输入框，而在输入框里按住左键横向拖是**选文本** —— 那是天天要用的操作，
 *   不能被重排吃掉。横向为主就放手，交还给浏览器。
 *
 * 实时交换而不是拖完再落：每越过一个邻居的中线就调一次 `move`，元素跟着手指
 * 顺次让位。这要求列表用稳定的 key（preset.id / tab.id），React 才会移动 DOM 节点
 * 而不是重建 —— 重建会让被拖的那个节点引用失效，拖拽当场断掉。
 */

export type DragAxis = 'x' | 'y';

export interface DragReorderOptions {
  axis: DragAxis;
  /** 同一组里可拖的元素，按它们此刻的顺序。每次移动都会重新问一遍。 */
  items: () => HTMLElement[];
  /** 把第 from 个挪到第 to 个位置。 */
  move: (from: number, to: number) => void;
  /** 进入拖拽前要走的像素数。 */
  threshold?: number;
  /** 要求主轴位移占优才接管。输入框上的纵向拖拽必须开它，否则选不了文本。 */
  dominantAxis?: boolean;
}

const DEFAULT_THRESHOLD = 5;

export function useDragReorder({
  axis,
  items,
  move,
  threshold = DEFAULT_THRESHOLD,
  dominantAxis = false,
}: DragReorderOptions): {
  dragging: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
} {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return; // 只认左键：右键要留给上下文菜单
      const node = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;

      const onMove = (moveEvent: PointerEvent): void => {
        if (!active) {
          const along = axis === 'x' ? moveEvent.clientX - startX : moveEvent.clientY - startY;
          const across = axis === 'x' ? moveEvent.clientY - startY : moveEvent.clientX - startX;
          if (Math.abs(along) < threshold) return;
          // 横着拖是在选文本，放手交还给浏览器
          if (dominantAxis && Math.abs(across) >= Math.abs(along)) return;

          active = true;
          setDragging(true);
          // 判定这段路上可能已经选中了几个字，进入拖拽就把它清掉
          window.getSelection()?.removeAllRanges();
          document.body.style.userSelect = 'none';
        }

        const list = items();
        const from = list.indexOf(node);
        if (from < 0) return;
        // 插入点是「排在第几个元素之前」，取值 0..n；移到那个位置时，源元素自己
        // 先被摘走了，所以往后走的落点要减一 —— 不减的话拖到某个元素的左半，
        // 结果会排到它右边，与手指的位置差一格
        const insertAt = insertionIndex(list, moveEvent, axis);
        const to = insertAt > from ? insertAt - 1 : insertAt;
        if (to !== from) move(from, to);
      };

      const onEnd = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        if (active) document.body.style.userSelect = '';
        setDragging(false);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    [axis, items, move, threshold, dominantAxis],
  );

  return { dragging, onPointerDown };
}

/** 指针此刻该插在第几个元素之前（0..n）—— 按中线判。 */
function insertionIndex(list: readonly HTMLElement[], event: PointerEvent, axis: DragAxis): number {
  const position = axis === 'x' ? event.clientX : event.clientY;
  for (let index = 0; index < list.length; index += 1) {
    const rect = list[index]!.getBoundingClientRect();
    const middle = axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    if (position < middle) return index;
  }
  return list.length;
}
