import { useEffect, useState } from 'react';
import type { InputSignals } from '@/core/transport/types';
import { SIGNAL_POLL_MS, useConnectionStore, type OutputLines } from '@/store/connectionStore';
import { useMessages } from '../useMessages';
import styles from './SignalPad.module.css';

/**
 * 控制信号线：DTR / RTS 两个开关、一个 Break 脉冲，外加四盏输入线指示灯。
 *
 * 这是「手动把板子拉进 bootloader」「复位 STM32」「用 Break 打断 U-Boot」唯一的入口 ——
 * 打开端口时驱动会不会拉 DTR 用户控制不了，只能在打开之后自己摆。
 *
 * **DTR / RTS 显示的是本工具最后一次设置的值**，不是从硬件读回来的：这两条是输出线，
 * 规范里就没有读回的接口。端口刚打开时它们显示驱动默认（都断言），直到用户点过为止。
 *
 * 线名（DTR、CTS…）不进 i18n：和 TXT / HEX 一样是行业缩写，翻译反而没人认得。
 */

/** 输入线的显示顺序，与 DB9 上的习惯一致。 */
const INPUT_LINES: readonly { key: keyof InputSignals; label: string }[] = [
  { key: 'clearToSend', label: 'CTS' },
  { key: 'dataSetReady', label: 'DSR' },
  { key: 'dataCarrierDetect', label: 'DCD' },
  { key: 'ringIndicator', label: 'RI' },
];

const OUTPUT_LINES: readonly { key: keyof OutputLines; label: string }[] = [
  { key: 'dataTerminalReady', label: 'DTR' },
  { key: 'requestToSend', label: 'RTS' },
];

export function SignalPad(): React.JSX.Element {
  const t = useMessages();
  const isOpen = useConnectionStore((s) => s.sessionState) === 'open';
  const outputs = useConnectionStore((s) => s.outputSignals);
  const toggleOutputLine = useConnectionStore((s) => s.toggleOutputLine);
  const sendBreak = useConnectionStore((s) => s.sendBreak);
  const readInputSignals = useConnectionStore((s) => s.readInputSignals);

  /**
   * 输入线的读数留在组件本地。
   *
   * 放进 store 的话，这个每秒一次的轮询会把订阅那份状态的整棵树一起唤醒 ——
   * 原型就是这么每 500ms 无条件 setState 的（缺陷 D8）。端口没开时定时器根本不启动。
   */
  const [inputs, setInputs] = useState<InputSignals | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setInputs(null);
      return;
    }
    let alive = true;
    const poll = (): void => {
      void readInputSignals().then((signals) => {
        if (alive) setInputs(signals);
      });
    };
    poll(); // 立刻读一次，不然刚打开的那一秒里四盏灯都是灭的
    const timer = setInterval(poll, SIGNAL_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [isOpen, readInputSignals]);

  return (
    <div className={styles.pad} role="group" aria-label={t.signals}>
      {OUTPUT_LINES.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          className={`btn ${styles.line} ${outputs[key] ? 'btn--on' : ''}`}
          disabled={!isOpen}
          aria-pressed={outputs[key]}
          title={t.outputLineTip}
          onClick={() => void toggleOutputLine(key)}
        >
          {label}
        </button>
      ))}

      <button
        type="button"
        className={`btn ${styles.line}`}
        disabled={!isOpen}
        title={t.breakTip}
        onClick={() => void sendBreak()}
      >
        BRK
      </button>

      <span className={styles.lamps} title={t.inputLineTip}>
        {INPUT_LINES.map(({ key, label }) => (
          <span key={key} className={styles.lamp} data-on={inputs?.[key] === true}>
            {label}
          </span>
        ))}
      </span>
    </div>
  );
}
