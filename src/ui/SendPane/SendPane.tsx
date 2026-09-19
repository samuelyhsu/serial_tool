import { useId, useMemo } from 'react';
import { CHECKSUM_ALGORITHMS, checksumBytes, findChecksum } from '@/core/checksum';
import { formatEscaped } from '@/core/codec/escape';
import { formatHex } from '@/core/codec/hex';
import { useConnectionStore } from '@/store/connectionStore';
import { useLogStore } from '@/store/logStore';
import { buildFrame, payloadToBytes } from '@/store/payload';
import { useSendStore } from '@/store/sendStore';
import { isTaskRunning, SINGLE_TASK, useTasksStore } from '@/store/tasksStore';
import { payloadErrorText } from '../dataFormat';
import { FormatToggle } from '../FormatToggle';
import { SendHistory } from './SendHistory';
import { useMessages } from '../useMessages';
import styles from './SendPane.module.css';

export function SendPane(): React.JSX.Element {
  const t = useMessages();
  const editorId = useId();
  const checksumId = useId();
  const intervalId = useId();

  const payload = useSendStore((s) => s.payload);
  const mode = useSendStore((s) => s.mode);
  const checksum = useSendStore((s) => s.checksum);
  const intervalMs = useSendStore((s) => s.intervalMs);
  const parseError = useSendStore((s) => s.parseError);
  const modeIssue = useSendStore((s) => s.modeIssue);

  const setPayload = useSendStore((s) => s.setPayload);
  const setMode = useSendStore((s) => s.setMode);
  const setChecksum = useSendStore((s) => s.setChecksum);
  const setIntervalMs = useSendStore((s) => s.setIntervalMs);
  const sendOnce = useSendStore((s) => s.sendOnce);
  const toggleLoop = useSendStore((s) => s.toggleLoop);
  const recallHistory = useSendStore((s) => s.recallHistory);

  const running = useTasksStore((s) => s.running);
  const looping = isTaskRunning(running, SINGLE_TASK);
  const isOpen = useConnectionStore((s) => s.sessionState) === 'open';

  // 真正会写到串口上的字节：TXT 下转义已经解析完，HEX 下含校验和。
  // 显示成「N 字节」的必须是这个数，否则用户对不上抓包结果。
  const frame = useMemo(() => buildFrame(payload, mode, checksum), [payload, mode, checksum]);

  // 每次数据变更都重算所选校验和，直接显示将要追加的字节
  const checksumPreview = useMemo(() => {
    const algorithm = findChecksum(checksum);
    if (!algorithm || mode !== 'hex') return null;
    const parsed = payloadToBytes(payload, 'hex');
    if (!parsed.ok) return null;
    return formatHex(checksumBytes(parsed.bytes, algorithm));
  }, [payload, mode, checksum]);

  // 当前内容的问题优先于「刚才那次模式切换没成」
  const issue = parseError ?? modeIssue;
  const issueText = issue === null ? null : payloadErrorText(issue, t);

  const canSend = isOpen && frame.ok && frame.bytes.length > 0;

  /**
   * 复制的是**最终会发出去的那一串**，不是输入框里的原文 —— 这也是它要跟在
   * 字节数旁边的原因：两者说的是同一件事。TXT 写成规范化的转义（粘回来还是同样的
   * 字节，非 UTF-8 也不会坏），HEX 含校验和。
   */
  const onCopy = (): void => {
    if (!frame.ok) return;
    const text = mode === 'hex' ? formatHex(frame.bytes) : formatEscaped(frame.bytes);
    const log = useLogStore.getState();
    // VS Code 的 webview 里剪贴板未必给得了权限，失败要说一声而不是静悄悄没反应。
    // 连 API 都没有的环境（老 WebView、非安全上下文）走同一条提示
    const written = navigator.clipboard?.writeText(text);
    if (written === undefined) {
      log.appendMessage(t.copyFailed);
      return;
    }
    void written.then(
      () => log.appendMessage(t.copied),
      () => log.appendMessage(t.copyFailed),
    );
  };

  return (
    <section className={styles.pane} aria-label={t.singleSend}>
      <div className={styles.head}>
        <FormatToggle value={mode} onChange={setMode} />

        {/* 帧尾只有 HEX 还有：TXT 要追加什么直接写进报文里的转义 */}
        {mode === 'hex' ? (
          <>
            <label className="label" htmlFor={checksumId}>
              {t.checksum}
            </label>
            <select
              id={checksumId}
              className={`field field--sm ${styles.checksumSelect}`}
              value={checksum}
              onChange={(event) => setChecksum(event.target.value)}
            >
              <option value="none">{t.none}</option>
              {CHECKSUM_ALGORITHMS.map((algorithm) => (
                <option key={algorithm.id} value={algorithm.id}>
                  {algorithm.label}
                </option>
              ))}
            </select>
            {checksumPreview !== null ? (
              <span className={styles.checksumValue} title={t.checksumAppendTip}>
                {checksumPreview}
              </span>
            ) : null}
          </>
        ) : null}

        {/* 解析不通过时留一个占位，读数的位置才不会跟着报文的对错来回跳 */}
        <span className={styles.byteCount} title={t.byteCountTip}>
          {frame.ok ? `${frame.bytes.length} ${t.bytes}` : '—'}
        </span>

        <button
          type="button"
          className={`btn ${styles.copyBtn}`}
          title={t.copyPayloadTip}
          disabled={!frame.ok || frame.bytes.length === 0}
          onClick={onCopy}
        >
          {t.copyPayload}
        </button>
      </div>

      <div className={styles.editor}>
        <label className="visuallyHidden" htmlFor={editorId}>
          {t.payloadLabel}
        </label>
        <textarea
          id={editorId}
          className={styles.textarea}
          title={t.payloadTip}
          value={payload}
          spellCheck={false}
          placeholder={t.singlePlaceholder}
          aria-invalid={parseError !== null}
          onChange={(event) => setPayload(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void sendOnce();
              return;
            }
            // 翻历史用 Ctrl/Cmd+方向键，而不是光秃秃的方向键：这是个多行输入框，
            // 上下键得留给光标。Alt 也不行 —— 多条发送那边用它调顺序了
            if (
              (event.ctrlKey || event.metaKey) &&
              (event.key === 'ArrowUp' || event.key === 'ArrowDown')
            ) {
              event.preventDefault();
              recallHistory(event.key === 'ArrowUp' ? 1 : -1);
            }
          }}
        />

        <div className={styles.side}>
          <button
            type="button"
            className={styles.sendBtn}
            disabled={!canSend}
            onClick={() => void sendOnce()}
          >
            {t.send}
          </button>

          <SendHistory />

          <div className={styles.loopBox}>
            <label className="label" htmlFor={intervalId}>
              {t.period}
            </label>
            <input
              id={intervalId}
              type="number"
              className={`field field--sunk field--sm ${styles.loopInput}`}
              value={intervalMs}
              min={10}
              step={10}
              onChange={(event) => setIntervalMs(Number(event.target.value))}
            />
            <span className="label">ms</span>
            <button
              type="button"
              className={`btn ${styles.loopBtn} ${looping ? 'btn--on' : ''}`}
              aria-pressed={looping}
              disabled={!looping && !canSend}
              onClick={toggleLoop}
            >
              {looping ? t.stop : t.loop}
            </button>
          </div>
        </div>
      </div>

      {issueText ? (
        <div className={styles.message} role="alert">
          {issueText}
        </div>
      ) : null}
    </section>
  );
}
