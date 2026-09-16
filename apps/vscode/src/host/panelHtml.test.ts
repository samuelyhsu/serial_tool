import { describe, expect, it, vi } from 'vitest';
import { refreshHiddenPanels } from './panelHtml';

describe('refreshHiddenPanels', () => {
  it('隐藏着的面板重新生成 HTML，可见的一个都不碰', () => {
    const shown = { id: 'shown', visible: true };
    const hiddenA = { id: 'hidden-a', visible: false };
    const hiddenB = { id: 'hidden-b', visible: false };
    const render = vi.fn();

    refreshHiddenPanels([shown, hiddenA, hiddenB], render);

    expect(render.mock.calls.map(([panel]) => (panel as { id: string }).id)).toEqual([
      'hidden-a',
      'hidden-b',
    ]);
  });

  it('全部可见时什么都不做', () => {
    const render = vi.fn();

    refreshHiddenPanels([{ visible: true }, { visible: true }], render);

    expect(render).not.toHaveBeenCalled();
  });
});
