import { useCallback, useEffect, useId, useState } from 'react';
import { resolveFraming, type FrameMode } from '@/core/framing/frameAssembler';
import { APP_VERSION } from '@/lib/appVersion';
import { useConnectionStore } from '@/store/connectionStore';
import {
  consumeThroughputWindow,
  lastRxAt,
  LOG_CAPACITY_MIN,
  useLogStore,
  type ThroughputWindow,
} from '@/store/logStore';
import { useTasksStore } from '@/store/tasksStore';
import { useUiStore } from '@/store/uiStore';
import { useMessages } from '../useMessages';
import { CapacityInput } from './CapacityInput';
import { IdleFrameInput } from './IdleFrameInput';
import styles from './StatusBar.module.css';

const NO_WINDOW: ThroughputWindow = { rx: 0, tx: 0 };

/** 静默时长。超过一分钟就不再报秒数之外的精度，那时候关心的只是「很久了」。 */
function formatSilence(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * 状态栏自己持有秒级时钟。
 *
 * 原型把 `now` 和 `rate` 放在组件 state 里、每 500ms 无条件 setState（.dc.html:419-423），
 * 于是空闲时整棵树每秒重渲染两次 —— 缺陷 D8。这里时钟只驱动状态栏一个组件，
 * 而且端口关闭时根本不启动。
 *
 * 靠 store 订阅拿到的读数（缓冲占用、过滤命中）不搭这趟时钟：它们在端口关着时
 * 照样要是对的，挂到只在打开期间跑的 tick 上会停在最后一个值。
 */
export function StatusBar(): React.JSX.Element {
  const t = useMessages();
  const modeId = useId();
  const idleId = useId();
  const capacityId = useId();

  const rxBytes = useLogStore((s) => s.rxBytes);
  const txBytes = useLogStore((s) => s.txBytes);
  const rxFrames = useLogStore((s) => s.rxFrames);
  const txFrames = useLogStore((s) => s.txFrames);
  const size = useLogStore((s) => s.size);
  const capacity = useLogStore((s) => s.capacity);
  const setCapacity = useLogStore((s) => s.setCapacity);
  const matches = useLogStore((s) => s.filterMatches);

  const sessionState = useConnectionStore((s) => s.sessionState);
  const openedAt = useConnectionStore((s) => s.openedAt);
  const runningCount = useTasksStore((s) => s.running.length);

  const view = useUiStore((s) => s.view);
  const frameMode = useUiStore((s) => s.frameMode);
  const idleFrameMs = useUiStore((s) => s.idleFrameMs);
  const setFrameMode = useUiStore((s) => s.setFrameMode);
  const setIdleFrameMs = useUiStore((s) => s.setIdleFrameMs);
  const language = useUiStore((s) => s.language);
  const theme = useUiStore((s) => s.theme);
  const toggleLanguage = useUiStore((s) => s.toggleLanguage);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  const [uptimeSec, setUptimeSec] = useState(0);
  const [rate, setRate] = useState<ThroughputWindow>(NO_WINDOW);
  /** 距上一帧接收数据过了多久；-1 表示这次会话还没收到过。 */
  const [silenceMs, setSilenceMs] = useState(-1);
  /**
   * 写队列的积压量。
   *
   * 它不是 store 的状态而是会话的实时读数（浏览器里直接问传输层，VS Code 里是宿主
   * 捎回来的最后一次读数），所以搭这个本来就有的秒级时钟一起采 —— 为它单开一路
   * 订阅只会把空闲时静止的界面重新吵醒（缺陷 D8）。
   */
  const [queued, setQueued] = useState(0);

  const isOpen = sessionState === 'open';

  useEffect(() => {
    if (!isOpen || openedAt === 0) {
      setUptimeSec(0);
      setRate(NO_WINDOW);
      setSilenceMs(-1);
      setQueued(0);
      return;
    }
    const tick = setInterval(() => {
      setUptimeSec(Math.max(0, Math.floor((Date.now() - openedAt) / 1000)));
      setRate(consumeThroughputWindow());
      const last = lastRxAt();
      setSilenceMs(last === 0 ? -1 : Date.now() - last);
      setQueued(useConnectionStore.getState().pendingBytes());
    }, 1000);
    return () => clearInterval(tick);
  }, [isOpen, openedAt]);

  // 下拉框显示的必须是**实际生效**的模式，而不是存着的偏好：
  // 在 HEX 视图下选过的「按换行」并不生效，这时候还显示它就又变回了误导。
  const effectiveMode = resolveFraming({
    mode: frameMode,
    idleMs: idleFrameMs,
    textView: view === 'text',
  }).mode;

  /**
   * 缩容是破坏性的，所以结果必须回执到日志里：容量一改日志就短了一截，
   * 不说明的话与「数据丢了」无法区分。
   */
  const onCapacityCommit = useCallback(
    (value: number) => {
      const dropped = setCapacity(value);
      const { appendMessage } = useLogStore.getState();
      appendMessage(dropped > 0 ? t.capacityDropped(value, dropped) : t.capacityChanged(value));
    },
    [setCapacity, t],
  );

  const minutes = String(Math.floor(uptimeSec / 60)).padStart(2, '0');
  const seconds = String(uptimeSec % 60).padStart(2, '0');

  return (
    <footer className={styles.bar}>
      {/* 固定在左下角：反馈问题时先要知道用的是哪一版，内网离线包尤其说不清 */}
      <span className={styles.faint}>v{APP_VERSION}</span>
      <span className={styles.rx}>
        RX {rxBytes} B · {rxFrames} {t.frames}
        {isOpen ? ` · ${rate.rx} B/s` : ''}
      </span>
      <span className={styles.tx}>
        TX {txBytes} B · {txFrames} {t.frames}
        {isOpen ? ` · ${rate.tx} B/s` : ''}
      </span>
      <span>
        {t.uptime} {isOpen ? `${minutes}:${seconds}` : '--:--'}
      </span>
      {/*
        「收了多少」回答不了「现在还在收吗」：字节数停着不动时，链路断了和对端本来就慢
        看起来一模一样。这个读数是两者唯一的区别，所以它跟着运行时长一起常驻。
      */}
      {isOpen ? (
        <span className={styles.faint}>
          {silenceMs < 0 ? t.noRx : t.silentFor(formatSilence(silenceMs))}
        </span>
      ) : null}
      {/* 只在真的堵着时才占位置：平时它恒为 0，常驻只会让状态栏更难读 */}
      {queued > 0 ? <span className={styles.queued}>{t.queued(queued)}</span> : null}

      <span className={styles.divider} aria-hidden="true" />

      {/*
        分帧三者互斥，所以只给一个下拉框：关闭状态下它本身就写着当前模式，
        不需要用户去比对两个控件谁在生效。空闲时长只在选了「空闲超时」时才出现 ——
        同一时刻界面上永远只有一个跟分帧有关的可调项。

        当前模式的说明只挂在下拉框的 title 上，不再另占一段常驻文字：状态栏比
        接收区工具栏还窄，一段随选择变长变短的解释会把整条栏挤到折行。
      */}
      <label className="label" htmlFor={modeId}>
        {t.framing}
      </label>
      <select
        id={modeId}
        className={`field field--sm ${styles.modeSelect}`}
        value={effectiveMode}
        title={t.framingHint[effectiveMode]}
        onChange={(event) => setFrameMode(event.target.value as FrameMode)}
      >
        <option value="raw">{t.frameModeRaw}</option>
        <option value="idle">{t.frameModeIdle}</option>
        {/* 换行分帧只在 TXT 视图下有意义：HEX 视图里按 `\n` 切没有意义 */}
        {view === 'text' ? <option value="line">{t.frameModeLine}</option> : null}
      </select>

      {effectiveMode === 'idle' ? (
        <>
          <IdleFrameInput
            id={idleId}
            label={t.idleFrame}
            value={idleFrameMs}
            onCommit={setIdleFrameMs}
          />
          <span className="label">{t.idleFrameUnit}</span>
        </>
      ) : null}

      <span className={styles.divider} aria-hidden="true" />

      {/*
        容量输入框和「已存多少」放一起：改容量是一次性设置，但它的后果 —— 存满之后
        开始丢最旧的 —— 此前完全不可见，日志凭空变短与数据丢失看起来没有区别。
      */}
      <span className={styles.buffer} title={t.bufferUsage(size, capacity)}>
        <label className="label" htmlFor={capacityId}>
          {t.logCapacity}
        </label>
        <span className={size >= capacity ? styles.bufferFull : undefined}>{size}</span>
        <span className={styles.faint}>/</span>
        <CapacityInput
          id={capacityId}
          label={t.logCapacity}
          title={t.logCapacityHint(LOG_CAPACITY_MIN)}
          value={capacity}
          onCommit={onCapacityCommit}
        />
        <span className="label">{t.logCapacityUnit}</span>
      </span>

      {/* 过滤着却一行不剩时，「没匹配上」和「根本没数据」得能分开 */}
      {matches !== null ? (
        <span className={styles.matches}>{t.filterMatches(matches.count, matches.partial)}</span>
      ) : null}

      <span className={styles.right}>
        {runningCount > 0 ? t.runningTasks(runningCount) : t.noTimer}
      </span>

      {/* 一天按不到一次的全局偏好，从「打开串口」旁边挪到这里 */}
      <button type="button" className="btn" onClick={toggleLanguage} aria-label={t.switchLanguage}>
        {language === 'zh' ? 'EN' : 'CN'}
      </button>
      <button type="button" className="btn" onClick={toggleTheme} aria-label={t.switchTheme}>
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </footer>
  );
}
