import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionState } from '@/core/session/serialSession';
import type { PortDescriptor } from '@/core/transport/portRegistry';
import { useConnectionStore } from '@/store/connectionStore';
import { useUiStore } from '@/store/uiStore';
import { Toolbar } from '@/ui/Toolbar/Toolbar';

const PORT: PortDescriptor = {
  key: 'port-1',
  ordinal: 1,
  identity: 'usb:1A86:7523#0',
  label: '#1 CH340 (1A86:7523)',
  chip: 'CH340',
  vendor: 'WCH 沁恒',
  connected: true,
};

function renderToolbar(sessionState: SessionState): void {
  useConnectionStore.setState({
    supported: true,
    ports: [PORT],
    selectedPortKey: PORT.key,
    sessionState,
  });
  render(<Toolbar />);
}

/**
 * 工具栏上表达连接状态的只剩这一个按钮。打开中、重连中这两个过渡态，
 * 以前只有旁边的状态灯看得出来，现在得由按钮自己表达。
 */
describe('连接按钮', () => {
  beforeEach(() => {
    useUiStore.setState({ language: 'zh' });
  });

  afterEach(cleanup);

  it('未连接时是可点的「打开」', () => {
    renderToolbar('closed');
    expect(screen.getByRole('button', { name: '打开' })).toBeEnabled();
  });

  it('打开过程中显示「打开中…」并禁用', () => {
    renderToolbar('opening');
    expect(screen.getByRole('button', { name: '打开中…' })).toBeDisabled();
  });

  it('已连接时是「关闭」', () => {
    renderToolbar('open');
    expect(screen.getByRole('button', { name: '关闭' })).toHaveAttribute('data-state', 'open');
  });

  it('重连中仍可点「关闭」停下来，按钮换色并提示正在重连', () => {
    renderToolbar('reconnecting');
    const button = screen.getByRole('button', { name: '关闭' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('data-state', 'reconnecting');
    expect(button).toHaveAttribute('title', '重连中…');
  });

  it('状态变化照样播报给屏幕阅读器，只是不显示出来', () => {
    renderToolbar('reconnecting');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('重连中…');
    expect(status).toHaveClass('visuallyHidden');
  });
});
