import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { downloadText } from '@/lib/download';
import { useConnectionStore } from '@/store/connectionStore';
import { useLogStore } from '@/store/logStore';
import {
  parseImportedPresets,
  PRESET_TAB_TITLE_MAX,
  presetLabel,
  presetTabTitle,
  tabPresets,
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
  const tabsId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const presets = usePresetStore((s) => s.presets);
  const tabs = usePresetStore((s) => s.tabs);
  const activeTab = usePresetStore((s) => s.activeTab);
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

  // 顺序循环跨分组生效：勾选的含义是「参与循环」，与当前看的是哪一组无关
  const inSequenceCount = presets.filter((preset) => preset.inSequence).length;
  const visiblePresets = tabPresets(presets, activeTab);
  const sequenceRunning = isTaskRunning(running, SEQUENCE_TASK);
  const tabDomId = (tabId: string): string => `${tabsId}-${tabId}`;
  const panelId = `${tabsId}-panel`;

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
        replaceAll(result);
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
        <PresetTabs tabDomId={tabDomId} panelId={panelId} />

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

      <div
        className={styles.list}
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabs[activeTab] ? tabDomId(tabs[activeTab].id) : undefined}
      >
        {visiblePresets.map((preset) => (
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
          {/* 有循环在跑时才出现。它管的是全局所有周期任务（单条 + 顺序 + 每条预设各一），
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

interface TabsProps {
  tabDomId: (tabId: string) => string;
  panelId: string;
}

/**
 * 分组标签页，按 WAI-ARIA 的 tabs 模式：只有选中的那个进 Tab 键序列，
 * 左右方向键 / Home / End 切换分组，焦点跟着走。双击或 F2 改名，「+」新建。
 */
function PresetTabs({ tabDomId, panelId }: TabsProps): React.JSX.Element {
  const t = useMessages();
  const tabs = usePresetStore((s) => s.tabs);
  const activeTab = usePresetStore((s) => s.activeTab);
  const selectTab = usePresetStore((s) => s.selectTab);
  const renameTab = usePresetStore((s) => s.renameTab);
  const addTab = usePresetStore((s) => s.addTab);

  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // 同步可读的「正在改谁」：按 Esc 收起输入框时若浏览器随后补发一次 blur，不能再提交
  const editing = useRef<string | null>(null);
  // 用键盘提交或放弃后把焦点还给那个标签，否则焦点掉到页面上，键盘用户得从头 Tab 过来
  const refocus = useRef<number | null>(null);

  useEffect(() => {
    if (renamingId !== null) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocus.current !== null) {
      buttons.current[refocus.current]?.focus();
      refocus.current = null;
    }
  }, [renamingId]);

  // 新建的分组排在最后，标签一多就在可视区外；jsdom 没有 scrollIntoView
  useEffect(() => {
    buttons.current[activeTab]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  const startRename = (index: number): void => {
    const tab = tabs[index];
    if (!tab) return;
    editing.current = tab.id;
    setDraft(presetTabTitle(tab, index, t));
    setRenamingId(tab.id);
  };

  const finishRename = (save: boolean): void => {
    const id = editing.current;
    editing.current = null;
    if (save && id !== null) renameTab(id, draft);
    setRenamingId(null);
  };

  const onTabKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const last = tabs.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;

    if (target !== null) {
      event.preventDefault();
      selectTab(target);
      buttons.current[target]?.focus();
    } else if (event.key === 'F2') {
      event.preventDefault();
      startRename(index);
    }
  };

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label={t.presetTabs}>
        {tabs.map((tab, index) =>
          tab.id === renamingId ? (
            <input
              key={tab.id}
              ref={inputRef}
              className={styles.tabInput}
              value={draft}
              maxLength={PRESET_TAB_TITLE_MAX}
              aria-label={t.renameTab}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => finishRename(true)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== 'Escape') return;
                event.preventDefault();
                refocus.current = index;
                finishRename(event.key === 'Enter');
              }}
            />
          ) : (
            <button
              key={tab.id}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={tabDomId(tab.id)}
              className={styles.tab}
              aria-selected={index === activeTab}
              aria-controls={panelId}
              tabIndex={index === activeTab ? 0 : -1}
              title={t.renameTabHint}
              onClick={() => selectTab(index)}
              onDoubleClick={() => startRename(index)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {presetTabTitle(tab, index, t)}
            </button>
          ),
        )}
      </div>
      <button
        type="button"
        className={`btn ${styles.addTab}`}
        aria-label={t.newTab}
        title={t.newTab}
        onClick={addTab}
      >
        +
      </button>
    </>
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
