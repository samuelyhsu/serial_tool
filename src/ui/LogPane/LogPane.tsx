import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { resolveFraming, type FrameMode } from '@/core/framing/frameAssembler';
import { logFileName, type TimestampMode } from '@/core/log/logLine';
import { downloadText } from '@/lib/download';
import {
  latestEntryId,
  logText,
  LOG_CAPACITY_MIN,
  selectRows,
  useLogStore,
  type LogRow,
} from '@/store/logStore';
import { useConnectionStore } from '@/store/connectionStore';
import { useRecordStore } from '@/store/recordStore';
import { useUiStore } from '@/store/uiStore';
import { FormatToggle } from '../FormatToggle';
import { useConfirm } from '../useConfirm';
import { CapacityInput } from './CapacityInput';
import { IdleFrameInput } from './IdleFrameInput';
import { useMessages } from '../useMessages';
import styles from './LogPane.module.css';

/**
 * 最多渲染多少行。
 *
 * 没有虚拟滚动，这些行是实打实的 DOM 节点，且每次攒批提交（60ms）都要重新 reconcile
 * 一遍，所以它挡的是渲染成本、而非存储量 —— 缓冲里存着 capacity 条（可配置），
 * 超出这里的部分靠列表顶部的提示告诉用户「还在，导出可取」。
 */
const RENDER_LIMIT = 1000;
/** 清空的二次确认窗口：这么久没有再按一次就当作放弃。 */
/** 距底部多少像素以内算作「贴底」。 */
const BOTTOM_THRESHOLD = 24;

const ARROWS: Record<LogRow['kind'], string> = { rx: '◀', tx: '▶', sys: '·' };

/**
 * 暂停刷新的状态。
 *
 * **来源必须区分开**：往上滚是「我要看看刚才那段」，滚回底部就该自己恢复；
 * 点按钮是「我要它停在这」，那就得一直停到再点一次为止 —— 滚回底部把它悄悄恢复了，
 * 正是用户按那个按钮想避免的事。
 *
 * `upTo` 是冻结那一刻最后一条日志的编号：暂停期间只渲染它及更早的条目，
 * 新数据照收照存，只是不往画面上刷。
 */
interface Paused {
  source: 'manual' | 'scroll';
  upTo: number;
}

export function LogPane(): React.JSX.Element {
  const t = useMessages();
  const filterId = useId();
  const modeId = useId();
  const idleId = useId();
  const capacityId = useId();
  const stampId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const version = useLogStore((s) => s.version);
  const clearAll = useLogStore((s) => s.clearAll);

  const language = useUiStore((s) => s.language);
  const view = useUiStore((s) => s.view);
  const timestampMode = useUiStore((s) => s.timestampMode);
  const autoScroll = useUiStore((s) => s.autoScroll);
  const showTx = useUiStore((s) => s.showTx);
  const filter = useUiStore((s) => s.filter);
  const onlyMatch = useUiStore((s) => s.onlyMatch);
  const filterKind = useUiStore((s) => s.filterKind);
  const idleFrameMs = useUiStore((s) => s.idleFrameMs);
  const frameMode = useUiStore((s) => s.frameMode);
  // 逐个订阅 action：selector 返回新对象会让 zustand 每次快照都不相等，触发无谓重渲染
  const setView = useUiStore((s) => s.setView);
  const setTimestampMode = useUiStore((s) => s.setTimestampMode);
  const setAutoScroll = useUiStore((s) => s.setAutoScroll);
  const setShowTx = useUiStore((s) => s.setShowTx);
  const setFilter = useUiStore((s) => s.setFilter);
  const setOnlyMatch = useUiStore((s) => s.setOnlyMatch);
  const setFilterKind = useUiStore((s) => s.setFilterKind);
  const setIdleFrameMs = useUiStore((s) => s.setIdleFrameMs);
  const setFrameMode = useUiStore((s) => s.setFrameMode);

  // 下拉框显示的必须是**实际生效**的模式，而不是存着的偏好：
  // 在 HEX 视图下选过的「按换行」并不生效，这时候还显示它就又变回了误导。
  const effectiveMode = resolveFraming({
    mode: frameMode,
    idleMs: idleFrameMs,
    textView: view === 'text',
  }).mode;

  const sessionState = useConnectionStore((s) => s.sessionState);
  const recording = useRecordStore((s) => s.status);
  const recordSupported = useRecordStore((s) => s.supported);
  const toggleRecord = useRecordStore((s) => s.toggle);
  const capacity = useLogStore((s) => s.capacity);
  const setCapacity = useLogStore((s) => s.setCapacity);

  const [paused, setPaused] = useState<Paused | null>(null);

  // 缺陷 D7：记忆化的选择器，重渲染不重算；输入过滤词时也只算一次
  const { rows, hiddenEarlier, filterError } = selectRows({
    version,
    language,
    view,
    filter,
    filterKind,
    onlyMatch,
    showTx,
    timestampMode,
    upTo: paused?.upTo ?? null,
    limit: RENDER_LIMIT,
  });

  /**
   * 缺陷 D15：原型在每次更新后无条件把滚动条拉到底，用户往上翻查历史时会被强行拽回。
   * 这里跟踪用户是否还贴着底部。
   */
  const [atBottom, setAtBottom] = useState(true);

  /**
   * 贴底状态变了，暂停跟着走。
   *
   * 内容变长本身**不会**触发 scroll 事件（scrollTop 没变），所以走到这里的都是
   * 真正的滚动 —— 用户滚的，或者「回到底部」按钮滚的。自动滚屏把视口钉在底部时
   * atBottom 一直是 true，不会误判成用户往上翻。
   */
  const updateAtBottom = useCallback((next: boolean) => {
    setAtBottom(next);
    setPaused((current) => {
      // 回到底部：只解除滚动引起的那一次；手动按下的要一直停到再按一次
      if (next) return current?.source === 'scroll' ? null : current;
      return current ?? { source: 'scroll', upTo: latestEntryId() };
    });
  }, []);

  const handleScroll = useCallback(() => {
    const element = listRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    updateAtBottom(distance <= BOTTOM_THRESHOLD);
  }, [updateAtBottom]);

  const scrollToBottom = useCallback(() => {
    const element = listRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    updateAtBottom(true);
  }, [updateAtBottom]);

  /**
   * 恢复刷新时回到底部，否则画面还停在半空中。
   *
   * 放在 effect 里而不是按钮的处理器里：只有这里能保证跑在「冻结的行已经换成
   * 最新那批」之后，按钮的处理器跑在那之前，滚过去的是旧的底部。
   */
  useEffect(() => {
    if (paused === null) scrollToBottom();
  }, [paused, scrollToBottom]);

  useLayoutEffect(() => {
    if (!autoScroll || !atBottom || paused !== null) return;
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [rows, autoScroll, atBottom, paused]);

  // 重新勾选「自动滚屏」时立即回到底部，符合直觉
  useEffect(() => {
    if (autoScroll) scrollToBottom();
  }, [autoScroll, scrollToBottom]);

  const saveLog = useCallback(() => {
    const { text, lines } = logText(view, t);
    downloadText(logFileName(), text);
    useLogStore.getState().appendMessage(t.exportedLog(lines));
  }, [view, t]);

  // 清空要按两下：缓冲里的全部采集数据连同统计一起丢、不可撤销，而按钮就紧挨着「保存日志」
  const { armed: confirmingClear, confirm } = useConfirm<'clear'>();

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

  const onClear = useCallback(() => {
    confirm('clear', () => {
      clearAll();
      useLogStore.getState().appendMessage(t.clearedLog);
    });
  }, [confirm, clearAll, t]);

  const showJump = !atBottom && rows.length > 0;

  return (
    <section className={styles.pane} aria-label={t.receive}>
      <div className={styles.toolbar}>
        <FormatToggle value={view} onChange={setView} />

        {/*
          时间 / 日期时间 / 间隔三者互斥，所以和分帧一样只给一个下拉框：
          关闭状态下它本身就写着当前显示的是哪一种，而且那一列的宽度不会
          因为多勾一个选项就跟着变。
        */}
        <label className="label" htmlFor={stampId}>
          {t.timestamp}
        </label>
        <select
          id={stampId}
          className={`field field--sm ${styles.stampSelect}`}
          value={timestampMode}
          title={t.timestampHint[timestampMode]}
          onChange={(event) => setTimestampMode(event.target.value as TimestampMode)}
        >
          <option value="none">{t.timestampNone}</option>
          <option value="time">{t.timestampTime}</option>
          <option value="datetime">{t.timestampDateTime}</option>
          <option value="delta">{t.timestampDelta}</option>
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(event) => setAutoScroll(event.target.checked)}
          />
          {t.autoScroll}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={showTx}
            onChange={(event) => setShowTx(event.target.checked)}
          />
          {t.showTx}
        </label>

        <span className={styles.divider} aria-hidden="true" />

        {/*
          分帧三者互斥，所以只给一个下拉框：关闭状态下它本身就写着当前模式，
          不需要用户去比对两个控件谁在生效。空闲时长只在选了「空闲超时」时才出现 ——
          同一时刻界面上永远只有一个跟分帧有关的可调项。
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

        <span className={styles.frameHint}>{t.framingHint[effectiveMode]}</span>

        <button
          type="button"
          className={`btn ${paused !== null ? 'btn--on' : ''}`}
          aria-pressed={paused !== null}
          title={t.pauseTip}
          onClick={() =>
            setPaused((current) => (current ? null : { source: 'manual', upTo: latestEntryId() }))
          }
        >
          {paused !== null ? `▶ ${t.resume}` : `⏸ ${t.pause}`}
        </button>

        {/* 暂停期间必须说清「数据还在收」，否则和「设备不发了」看起来一模一样 */}
        {paused !== null ? (
          <span className={styles.pausedNote} role="status">
            {t.pausedBacklog(Math.max(0, latestEntryId() - paused.upTo))}
          </span>
        ) : null}

        <div className={styles.toolbarRight}>
          <label className="visuallyHidden" htmlFor={filterId}>
            {t.filterPlaceholder}
          </label>
          <input
            id={filterId}
            className={`field ${styles.filterInput}`}
            value={filter}
            placeholder={filterKind === 'regex' ? t.filterRegexPlaceholder : t.filterPlaceholder}
            aria-invalid={filterError !== null}
            // 正则写错时把那句话原样挂在框上：说「无效正则」等于什么都没说
            title={filterError !== null ? t.filterRegexError(filterError) : t.filterTip}
            onChange={(event) => setFilter(event.target.value)}
          />
          <button
            type="button"
            className={`btn ${styles.regexToggle} ${filterKind === 'regex' ? 'btn--on' : ''}`}
            aria-pressed={filterKind === 'regex'}
            aria-label={t.filterRegex}
            title={t.filterRegexTip}
            onClick={() => setFilterKind(filterKind === 'regex' ? 'text' : 'regex')}
          >
            .*
          </button>
          <label className="check check--amber">
            <input
              type="checkbox"
              checked={onlyMatch}
              onChange={(event) => setOnlyMatch(event.target.checked)}
            />
            {t.onlyMatch}
          </label>

          <span className={styles.divider} aria-hidden="true" />

          <label className="label" htmlFor={capacityId}>
            {t.logCapacity}
          </label>
          <CapacityInput
            id={capacityId}
            label={t.logCapacity}
            title={t.logCapacityHint(LOG_CAPACITY_MIN)}
            value={capacity}
            onCommit={onCapacityCommit}
          />
          <span className="label">{t.logCapacityUnit}</span>

          <button
            type="button"
            className={`btn ${recording.active ? styles.recordOn : ''}`}
            title={recordSupported ? t.recordTip : t.recordUnsupported}
            disabled={!recordSupported}
            aria-pressed={recording.active}
            onClick={() => void toggleRecord()}
          >
            {recording.active ? `■ ${t.recording(recording.lines)}` : `● ${t.record}`}
          </button>

          <button type="button" className="btn" onClick={saveLog}>
            {t.saveLog}
          </button>
          <button type="button" className="btn btn--danger" onClick={onClear}>
            {confirmingClear ? t.confirmClear : t.clear}
          </button>
        </div>
      </div>

      <div ref={listRef} className={styles.list} onScroll={handleScroll} role="log">
        {rows.length === 0 ? (
          <div className={styles.empty}>
            <div>{t.noData}</div>
            {sessionState === 'closed' ? (
              <div className={styles.emptyHint}>{t.noDataHint}</div>
            ) : null}
          </div>
        ) : (
          <>
            {hiddenEarlier > 0 ? (
              <div className={styles.earlier}>{t.hiddenEarlier(hiddenEarlier)}</div>
            ) : null}
            {rows.map((row) => (
              <div key={row.id} className={styles.row} data-kind={row.kind}>
                {row.timestamp ? <span className={styles.time}>{row.timestamp}</span> : null}
                <span className={styles.arrow} aria-hidden="true">
                  {ARROWS[row.kind]}
                </span>
                <span className={styles.body}>
                  {row.segments.map((segment, index) =>
                    segment.hit ? (
                      <mark key={index} className={styles.hit}>
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={index}>{segment.text}</span>
                    ),
                  )}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {showJump ? (
        <button type="button" className={styles.jump} onClick={scrollToBottom}>
          {t.jumpToBottom}
        </button>
      ) : null}
    </section>
  );
}
