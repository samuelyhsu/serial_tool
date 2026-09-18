import { useId, useMemo } from 'react';
import { CHECKSUM_ALGORITHMS, checksumBytes, findChecksum } from '@/core/checksum';
import { formatHex } from '@/core/codec/hex';
import { useConnectionStore } from '@/store/connectionStore';
import { buildFrame, payloadToBytes } from '@/store/payload';
import { useSendStore } from '@/store/sendStore';
import { isTaskRunning, SINGLE_TASK, useTasksStore } from '@/store/tasksStore';
import { payloadErrorText } from '../dataFormat';
import { FormatToggle } from '../FormatToggle';
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
      </div>

      <div className={styles.editor}>
        <label className="visuallyHidden" htmlFor={editorId}>
          {t.payloadLabel}
        </label>
        <textarea
          id={editorId}
          className={styles.textarea}
          value={payload}
          spellCheck={false}
          placeholder={t.singlePlaceholder}
          aria-invalid={parseError !== null}
          onChange={(event) => setPayload(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void sendOnce();
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
