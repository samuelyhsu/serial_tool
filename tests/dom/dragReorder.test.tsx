import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetLogStoreForTests } from '@/store/logStore';
import { usePresetStore } from '@/store/presetStore';
import { useUiStore } from '@/store/uiStore';
import { PresetPane } from '@/ui/PresetPane/PresetPane';

/**
 * 按住左键拖动重排：分组标签横着拖，预设行竖着拖。
 *
 * jsdom 不做布局，`getBoundingClientRect()` 一律是全零 —— 拖拽要按中线判位置，
 * 所以每个元素的矩形都得自己填。填的是「一排等宽的标签」「一列等高的行」这两种
 * 最普通的形状，够验证判定逻辑了。
 */

const TAB_WIDTH = 100;
const ROW_HEIGHT = 30;

function layoutHorizontally(nodes: HTMLElement[]): void {
  nodes.forEach((node, index) => {
    node.getBoundingClientRect = () =>
      ({ left: index * TAB_WIDTH, width: TAB_WIDTH, top: 0, height: 20 }) as DOMRect;
  });
}

function layoutVertically(nodes: HTMLElement[]): void {
  nodes.forEach((node, index) => {
    node.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: index * ROW_HEIGHT, height: ROW_HEIGHT }) as DOMRect;
  });
}

/** 元素中心，拖拽的起点 —— 从 (0,0) 按下的话，往回拖只剩几个像素，够不着阈值。 */
function center(node: HTMLElement): { x: number; y: number } {
  const rect = node.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * 一次完整的拖拽：按下 → 移到目标点 → 松手。
 * 只给要动的那一轴，另一轴保持不动 —— 纵向拖拽要求纵向位移占优，
 * 顺手把横坐标也挪了的话会被当成选文本。
 */
function drag(node: HTMLElement, to: { x?: number; y?: number }): void {
  const from = center(node);
  fireEvent.pointerDown(node, { button: 0, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(window, { clientX: to.x ?? from.x, clientY: to.y ?? from.y });
  fireEvent.pointerUp(window);
}

function tabs(): HTMLElement[] {
  return within(screen.getByRole('tablist')).getAllByRole('tab');
}

function dataInputs(): HTMLElement[] {
  return screen.getAllByRole('textbox', { name: /数据/ });
}

function titles(): string[] {
  return tabs().map((tab) => tab.textContent ?? '');
}

describe('拖动重排', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    useUiStore.setState({ language: 'zh' });
    // 整份换回初始状态：重排会改顺序、还会把默认标题固化下来，留到下一条用例就串味了
    usePresetStore.setState(usePresetStore.getInitialState(), true);
  });

  afterEach(cleanup);

  describe('分组标签（横向）', () => {
    it('把第一组拖到第三组的位置', () => {
      render(<PresetPane />);
      const before = titles();
      layoutHorizontally(tabs());

      // 落点越过第三个标签的中线
      drag(tabs()[0]!, { x: TAB_WIDTH * 2 + TAB_WIDTH / 2 + 1 });

      expect(titles()[2]).toBe(before[0]);
      expect(titles()[0]).toBe(before[1]);
    });

    it('往回拖同样对', () => {
      render(<PresetPane />);
      const before = titles();
      layoutHorizontally(tabs());

      drag(tabs()[2]!, { x: 1 });

      expect(titles()[0]).toBe(before[2]);
    });

    /** 点击是用来切换分组的，按下去没挪动就不该被当成拖拽。 */
    it('没越过阈值的微小移动不重排', () => {
      render(<PresetPane />);
      const before = titles();
      layoutHorizontally(tabs());

      const from = center(tabs()[0]!);
      fireEvent.pointerDown(tabs()[0]!, { button: 0, clientX: from.x, clientY: from.y });
      fireEvent.pointerMove(window, { clientX: from.x + 3, clientY: from.y });
      fireEvent.pointerUp(window);

      expect(titles()).toEqual(before);
    });

    /**
     * 未改名的分组，标签文字是**按位置**生成的（「分组 1」「分组 2」…）。
     * 重排前不把它们固化下来，拖完文字还留在原地、内容却换了位置 ——
     * 用户只会以为拖拽没生效。
     */
    it('拖动会把默认标题固化，文字跟着内容走', () => {
      render(<PresetPane />);
      expect(usePresetStore.getState().tabs.every((tab) => tab.title === null)).toBe(true);
      layoutHorizontally(tabs());

      drag(tabs()[0]!, { x: TAB_WIDTH * 2 + TAB_WIDTH / 2 + 1 });

      const stored = usePresetStore.getState().tabs.map((tab) => tab.title);
      expect(stored).toEqual(['分组 2', '分组 3', '分组 1', '分组 4', '分组 5']);
      expect(titles()).toEqual(stored);
    });

    it('Alt+←→ 也能挪，走的是同一条路', () => {
      render(<PresetPane />);
      const before = titles();
      tabs()[0]!.focus();

      fireEvent.keyDown(tabs()[0]!, { key: 'ArrowRight', altKey: true });

      expect(titles()[1]).toBe(before[0]);
      // 不带 Alt 的 ←→ 仍然只是切换选中项
      fireEvent.keyDown(tabs()[1]!, { key: 'ArrowRight' });
      expect(titles()[1]).toBe(before[0]);
    });

    it('右键按下不触发拖拽 —— 那是上下文菜单的', () => {
      render(<PresetPane />);
      const before = titles();
      layoutHorizontally(tabs());

      const from = center(tabs()[0]!);
      fireEvent.pointerDown(tabs()[0]!, { button: 2, clientX: from.x, clientY: from.y });
      fireEvent.pointerMove(window, { clientX: TAB_WIDTH * 3, clientY: from.y });
      fireEvent.pointerUp(window);

      expect(titles()).toEqual(before);
    });
  });

  describe('预设行（纵向，手柄是数据框）', () => {
    function firstColumn(): string[] {
      return dataInputs().map((input) => (input as HTMLInputElement).value);
    }

    it('按住数据框往下拖，整行跟着换位', () => {
      render(<PresetPane />);
      const before = firstColumn();
      layoutVertically(dataInputs());

      drag(dataInputs()[0]!, { y: ROW_HEIGHT * 2 + ROW_HEIGHT / 2 + 1 });

      expect(firstColumn()[2]).toBe(before[0]);
      expect(firstColumn()[0]).toBe(before[1]);
    });

    it('往上拖同样对', () => {
      render(<PresetPane />);
      const before = firstColumn();
      layoutVertically(dataInputs());

      drag(dataInputs()[2]!, { y: 1 });

      expect(firstColumn()[0]).toBe(before[2]);
    });

    /**
     * **这一条是纵向拖拽能不能落地的关键。**
     *
     * 数据框里按住左键横向拖是「选文本」，天天要用。横向位移更大时必须放手，
     * 否则用户想复制一段报文，结果把行给挪了。
     *
     * 落点要同时满足两件事：横向位移更大（该被挡住），**并且纵向已经够跨行**。
     * 只满足前一条的话，即便守卫失效也算不出新位置 —— 测到的是「没动」，
     * 而不是「被挡住了」。这条一开始就是那样的假绿，把守卫删掉照样通过。
     */
    it('横向拖动是在选文本，不重排', () => {
      render(<PresetPane />);
      const before = firstColumn();
      layoutVertically(dataInputs());

      const from = center(dataInputs()[0]!);
      fireEvent.pointerDown(dataInputs()[0]!, { button: 0, clientX: from.x, clientY: from.y });
      // 竖走 65（够越过第三行中线），横走 100 —— 主轴仍是横的
      fireEvent.pointerMove(window, { clientX: from.x + 100, clientY: ROW_HEIGHT * 2 + 20 });
      fireEvent.pointerUp(window);

      expect(firstColumn()).toEqual(before);
    });

    it('竖向位移占优时才接管', () => {
      render(<PresetPane />);
      const before = firstColumn();
      layoutVertically(dataInputs());

      const from = center(dataInputs()[0]!);
      fireEvent.pointerDown(dataInputs()[0]!, { button: 0, clientX: from.x, clientY: from.y });
      // 竖着越过第二行中线，横向只挪一点：主轴是竖的
      fireEvent.pointerMove(window, {
        clientX: from.x + 10,
        clientY: ROW_HEIGHT + ROW_HEIGHT / 2 + 1,
      });
      fireEvent.pointerUp(window);

      expect(firstColumn()[1]).toBe(before[0]);
    });
  });
});
