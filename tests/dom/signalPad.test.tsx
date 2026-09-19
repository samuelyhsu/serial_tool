import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputSignals, OutputSignals } from '@/core/transport/types';
import { DEFAULT_OUTPUT_SIGNALS, useConnectionStore } from '@/store/connectionStore';
import { useUiStore } from '@/store/uiStore';
import { SignalPad } from '@/ui/Toolbar/SignalPad';

/**
 * 信号线这一组是「手动把板子拉进 bootloader」唯一的入口，所以三件事要钉住：
 * 端口没开时不能点、点一下只动那一条线、输入线是只读的灯。
 */

const OFF: InputSignals = {
  clearToSend: false,
  dataCarrierDetect: false,
  dataSetReady: false,
  ringIndicator: false,
};

function setup(options: { open: boolean; inputs?: InputSignals }): {
  setSignals: ReturnType<typeof vi.fn>;
  sendBreak: ReturnType<typeof vi.fn>;
} {
  const setSignals = vi.fn((_: OutputSignals) => Promise.resolve());
  const sendBreak = vi.fn(() => Promise.resolve());

  useConnectionStore.setState({
    sessionState: options.open ? 'open' : 'closed',
    outputSignals: DEFAULT_OUTPUT_SIGNALS,
    sendBreak,
    readInputSignals: () => Promise.resolve(options.inputs ?? OFF),
    toggleOutputLine: async (line) => {
      const next = !useConnectionStore.getState().outputSignals[line];
      useConnectionStore.setState((state) => ({
        outputSignals: { ...state.outputSignals, [line]: next },
      }));
      await setSignals({ [line]: next });
    },
  });

  render(<SignalPad />);
  return { setSignals, sendBreak };
}

describe('控制信号线', () => {
  beforeEach(() => {
    useUiStore.setState({ language: 'zh' });
  });

  afterEach(() => {
    cleanup();
    useConnectionStore.setState({ outputSignals: DEFAULT_OUTPUT_SIGNALS });
  });

  it('端口没打开时三个按钮都不能点', () => {
    setup({ open: false });
    for (const label of ['DTR', 'RTS', 'BRK']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    }
  });

  it('打开后 DTR / RTS 显示驱动默认的「已拉起」', () => {
    setup({ open: true });
    expect(screen.getByRole('button', { name: 'DTR' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'RTS' })).toHaveAttribute('aria-pressed', 'true');
  });

  // 一次把两条线都写一遍，在带自动下载电路的板子上就是一次意外复位
  it('点一下只下发被点的那一条线', async () => {
    const { setSignals } = setup({ open: true });
    await userEvent.click(screen.getByRole('button', { name: 'DTR' }));

    expect(setSignals).toHaveBeenCalledWith({ dataTerminalReady: false });
    expect(screen.getByRole('button', { name: 'DTR' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'RTS' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('BRK 走脉冲那条路，不是翻转某条线', async () => {
    const { sendBreak, setSignals } = setup({ open: true });
    await userEvent.click(screen.getByRole('button', { name: 'BRK' }));

    expect(sendBreak).toHaveBeenCalledTimes(1);
    expect(setSignals).not.toHaveBeenCalled();
  });

  it('输入线亮的那几盏来自读数', async () => {
    setup({
      open: true,
      inputs: { ...OFF, clearToSend: true, dataSetReady: true },
    });

    await waitFor(() => {
      expect(screen.getByText('CTS')).toHaveAttribute('data-on', 'true');
    });
    expect(screen.getByText('DSR')).toHaveAttribute('data-on', 'true');
    expect(screen.getByText('DCD')).toHaveAttribute('data-on', 'false');
    expect(screen.getByText('RI')).toHaveAttribute('data-on', 'false');
  });

  // 只读的东西不该长得能按
  it('输入线不是按钮', () => {
    setup({ open: true });
    for (const label of ['CTS', 'DSR', 'DCD', 'RI']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });

  it('端口没打开时不去轮询，灯全灭', () => {
    const readInputSignals = vi.fn(() => Promise.resolve(OFF));
    useConnectionStore.setState({ sessionState: 'closed', readInputSignals });
    render(<SignalPad />);

    expect(readInputSignals).not.toHaveBeenCalled();
    expect(screen.getByText('CTS')).toHaveAttribute('data-on', 'false');
  });
});
