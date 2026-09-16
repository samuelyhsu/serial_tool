import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { downloadText } from '@/lib/download';
import { useConnectionStore } from '@/store/connectionStore';
import { useLogStore } from '@/store/logStore';
import {
  parseImportedPresets,
  PRESET_PAGE_SIZE,
  PRESET_PAGES,
  presetLabel,
  usePresetStore,
  type Preset,
} from '@/store/presetStore';
import { isTaskRunning, presetTask, SEQUENCE_TASK, useTasksStore } from '@/store/tasksStore';
import { FormatToggle } from '../FormatToggle';
import { useMessages } from '../useMessages';
import styles from './PresetPane.module.css';

export function PresetPane(): React.JSX.Element {
  const t = useMessages();
  const gapId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const presets = usePresetStore((s) => s.presets);
  const page = usePresetStore((s) => s.page);
  const setPage = usePresetStore((s) => s.setPage);
  const issues = usePresetStore((s) => s.issues);
  const replaceAll = usePresetStore((s) => s.replaceAll);
  const exportPayload = usePresetStore((s) => s.exportPayload);
  const toggleSequence = usePresetStore((s) => s.toggleSequence);
  // 间隔归 store 管，才能跟着预设一起持久化
  const gapMs = usePresetStore((s) => s.sequenceGapMs);
  const setGapMs = usePresetStore((s) => s.setSequenceGapMs);

  const running = useTasksStore((s) => s.running);
  const stopAll = useTasksStore((s) => s.stopAll);
  const isOpen = useConnectionStore((s) => s.sessionState) === 'open';

  // 顺序循环跨页生效：勾选的含义是「参与循环」，与当前看的是哪一页无关
  const inSequenceCount = presets.filter((preset) => preset.inSequence).length;
  const pagePresets = presets.slice(page * PRESET_PAGE_SIZE, (page + 1) * PRESET_PAGE_SIZE);
  const sequenceRunning = isTaskRunning(running, SEQUENCE_TASK);

  const onExport = useCallback(() => {
    downloadText('serial-presets.json', exportPayload(), 'application/json');
    useLogStore.getState().appendMessage(t.exportedPresets);
  }, [exportPayload, t]);

  const onImportFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      void file.text().then((raw) => {
        const result = parseImportedPresets(raw);
        const log = useLogStore.getState();
        if (!result.ok) {
          log.appendMessage(t.importFailed(result.reason));
          return;
        }
        replaceAll(result.presets);
        log.appendMessage(t.importedPresets(result.presets.length));
        if (result.skipped > 0) {
          // 原型是静默截断的；跳过了多少条必须让用户知道（缺陷 D17）
          log.appendMessage(t.importFailed(`${result.skipped} skipped`));
        }
      });
    },
    [replaceAll, t],
  );

  const onStopAll = useCallback(() => {
    stopAll();
    useLogStore.getState().appendMessage(t.stoppedAll);
  }, [stopAll, t]);

  return (
    <aside className={styles.pane} aria-label={t.multiSend}>
      <div className={styles.head}>
        <div className={styles.pager}>
          <button
            type="button"
            className={`btn ${styles.pageBtn}`}
            disabled={page === 0}
            aria-label={t.prevPage}
            onClick={() => setPage(page - 1)}
          >
            ‹
          </button>
          <span className={styles.pageLabel}>{t.pageIndicator(page + 1, PRESET_PAGES)}</span>
          <button
            type="button"
            className={`btn ${styles.pageBtn}`}
            disabled={page >= PRESET_PAGES - 1}
            aria-label={t.nextPage}
            onClick={() => setPage(page + 1)}
          >
            ›
          </button>
        </div>

        <div className={styles.headActions}>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            {t.import}
          </button>
          <button type="button" className="btn" onClick={onExport}>
            {t.export}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={onImportFile}
          />
        </div>
      </div>

      <div className={styles.columns}>
        <span>{t.colSequence}</span>
        <span>{t.colFormat}</span>
        <span>{t.colData}</span>
        <span>{t.colSend}</span>
        <span />
        <span>{t.colPeriod}</span>
        <span className={styles.columnLoop}>{t.colLoop}</span>
      </div>

      <div className={styles.list}>
        {pagePresets.map((preset) => (
          <PresetRow
            key={preset.id}
            preset={preset}
            invalid={issues[preset.id]?.kind === 'parse'}
            looping={isTaskRunning(running, presetTask(preset.id))}
            canSend={isOpen}
          />
        ))}
      </div>

      {/* 底部压成一行：说明 · 间隔 · 循环 · 全部停止。
          原来分两行（说明+间隔 / 两个大按钮）要 ~85px，窗口一矮就把预设列表挤没了。 */}
      <div className={styles.footer}>
        <span className={`label ${styles.footerTitle}`}>{t.sequenceLoop}</span>
        {/* 一行放不下时先让这条提示收省略号，右侧控件不换行、不压缩 */}
        <span className={styles.count} title={t.sequenceHint(inSequenceCount)}>
          {t.sequenceHint(inSequenceCount)}
        </span>

        <div className={styles.footerRight}>
          <label className="label" htmlFor={gapId}>
            {t.gap}
          </label>
          <input
            id={gapId}
            type="number"
            className={`field field--sunk field--sm ${styles.gapInput}`}
            value={gapMs}
            min={10}
            step={10}
            onChange={(event) => setGapMs(Number(event.target.value))}
          />
          <span className="label">ms</span>
          {/* 按钮上只放「循环 / 停止」，完整语义交给 aria-label，否则一行放不下 */}
          <button
            type="button"
            className={`btn ${styles.seqBtn} ${sequenceRunning ? 'btn--on' : ''}`}
            aria-pressed={sequenceRunning}
            aria-label={sequenceRunning ? t.stopSequence : t.startSequence}
            disabled={!sequenceRunning && (!isOpen || inSequenceCount === 0)}
            onClick={() => toggleSequence()}
          >
            {sequenceRunning ? t.stop : t.loop}
          </button>
          {/* 有循环在跑时才出现。它管的是全局 52 个周期任务（单条 + 顺序 + 每条预设各一），
              不是这一行的顺序循环 —— 常驻一个点不动的禁用红按钮既占位又容易被当成 Loop 的搭档。 */}
          {running.length > 0 ? (
            <button type="button" className="btn btn--danger" onClick={onStopAll}>
              {t.stopAll}
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

interface RowProps {
  preset: Preset;
  invalid: boolean;
  looping: boolean;
  canSend: boolean;
}

/**
 * 一条预设一行，列序固定：勾选 · 格式 · 数据 · 发送 · 周期 · 循环。
 *
 * 名称不单独占一列 —— 它就是发送按钮上的文字，点旁边的 ✎ 才切换成输入框改名，
 * 改完即收起。这样常态下一行只有六个控件，比原来的两行布局密度和可读性都更好。
 */
function PresetRow({ preset, invalid, looping, canSend }: RowProps): React.JSX.Element {
  const t = useMessages();
  const nameRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  const rename = usePresetStore((s) => s.rename);
  const setData = usePresetStore((s) => s.setData);
  const setInterval = usePresetStore((s) => s.setInterval);
  const setInSequence = usePresetStore((s) => s.setInSequence);
  const toggleMode = usePresetStore((s) => s.toggleMode);
  const sendOnce = usePresetStore((s) => s.sendOnce);
  const toggleLoop = usePresetStore((s) => s.toggleLoop);

  const label = presetLabel(preset, t);
  const empty = preset.data.trim() === '';

  // select() 按规范不移动焦点，必须先 focus()
  useEffect(() => {
    if (!renaming) return;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [renaming]);

  const commit = useCallback(() => {
    // 名称留空没有意义 —— 按钮上就没字了，保持原名
    if (draft.trim() !== '') rename(preset.id, draft);
    setRenaming(false);
  }, [rename, preset.id, draft]);

  return (
    <div className={styles.row} data-looping={looping}>
      <input
        type="checkbox"
        className={styles.seq}
        checked={preset.inSequence}
        aria-label={`${label} ${t.colSequence}`}
        onChange={(event) => setInSequence(preset.id, event.target.checked)}
      />

      <FormatToggle compact value={preset.mode} onChange={() => toggleMode(preset.id)} />

      <input
        className={styles.data}
        value={preset.data}
        spellCheck={false}
        placeholder={t.dataPlaceholder}
        aria-label={`${label} ${t.colData}`}
        aria-invalid={invalid}
        onChange={(event) => setData(preset.id, event.target.value)}
      />

      {renaming ? (
        <input
          ref={nameRef}
          className={styles.nameInput}
          value={draft}
          maxLength={16}
          aria-label={t.renamePreset}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setRenaming(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className={styles.sendBtn}
          disabled={!canSend || invalid || empty}
          title={label}
          onClick={() => void sendOnce(preset.id)}
        >
          {label}
        </button>
      )}

      <button
        type="button"
        className={styles.renameBtn}
        title={t.renamePreset}
        aria-label={`${t.renamePreset}: ${label}`}
        onClick={() => {
          setDraft(label);
          setRenaming(true);
        }}
      >
        ✎
      </button>

      <input
        type="number"
        className={`field field--sunk field--sm ${styles.intervalInput}`}
        value={preset.intervalMs}
        min={10}
        step={10}
        aria-label={`${label} ${t.colPeriod}`}
        onChange={(event) => setInterval(preset.id, Number(event.target.value))}
      />

      <button
        type="button"
        className={`btn ${styles.loopBtn} ${looping ? 'btn--on' : ''}`}
        aria-pressed={looping}
        aria-label={`${looping ? t.stop : t.loop}: ${label}`}
        disabled={!looping && (!canSend || invalid || empty)}
        onClick={() => toggleLoop(preset.id)}
      >
        {looping ? '■' : '↻'}
      </button>
    </div>
  );
}
