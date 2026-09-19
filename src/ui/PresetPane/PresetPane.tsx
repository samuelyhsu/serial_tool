import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Messages } from '@/i18n';
import { downloadText } from '@/lib/download';
import { useConnectionStore } from '@/store/connectionStore';
import { useLogStore } from '@/store/logStore';
import {
  isBlankTab,
  parseImportedPresets,
  PRESET_TAB_TITLE_MAX,
  presetLabel,
  presetTabTitle,
  tabPresets,
  usePresetStore,
  type Preset,
  type SequenceStep,
} from '@/store/presetStore';
import { isTaskRunning, presetTask, SEQUENCE_TASK, useTasksStore } from '@/store/tasksStore';
import { FormatToggle } from '../FormatToggle';
import { useConfirm } from '../useConfirm';
import { useMessages } from '../useMessages';
import styles from './PresetPane.module.css';

/**
 * 这一区全部的键盘操作，说给列头那个 `?` 听。
 *
 * 由两条就近提示拼出来，而不是另写一条完整的 —— 三份说同一批键位的文案，
 * 改一个键就得改三处，漏掉哪处都没人看得见。
 */
function keyboardHints(t: Messages): string {
  return [t.rowKeyHint, t.tabHint].join(' · ');
}

export function PresetPane(): React.JSX.Element {
  const t = useMessages();
  const tabsId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  // 一个 file input 服务两个菜单项：点的是哪个决定文件进来之后是替换还是追加
  const importMode = useRef<'replace' | 'append'>('replace');
  const [query, setQuery] = useState('');
  // null 表示菜单收着。不是布尔，因为打开的方式决定焦点落在哪一项
  const [menuFocus, setMenuFocus] = useState<MenuFocus | null>(null);

  const presets = usePresetStore((s) => s.presets);
  const tabs = usePresetStore((s) => s.tabs);
  const activeTab = usePresetStore((s) => s.activeTab);
  const issues = usePresetStore((s) => s.issues);
  const replaceAll = usePresetStore((s) => s.replaceAll);
  const appendAll = usePresetStore((s) => s.appendAll);
  const exportPayload = usePresetStore((s) => s.exportPayload);
  const toggleSequence = usePresetStore((s) => s.toggleSequence);
  // 节奏三项归 store 管，才能跟着预设一起持久化
  const gapMs = usePresetStore((s) => s.sequenceGapMs);
  const setGapMs = usePresetStore((s) => s.setSequenceGapMs);
  const step = usePresetStore((s) => s.sequenceStep);
  const setStep = usePresetStore((s) => s.setSequenceStep);
  const repeat = usePresetStore((s) => s.sequenceRepeat);
  const setRepeat = usePresetStore((s) => s.setSequenceRepeat);

  const running = useTasksStore((s) => s.running);
  const stopAll = useTasksStore((s) => s.stopAll);
  const isOpen = useConnectionStore((s) => s.sessionState) === 'open';

  // 顺序循环跨分组生效：勾选的含义是「参与循环」，与当前看的是哪一组无关
  const inSequenceCount = presets.filter((preset) => preset.inSequence).length;
  const visiblePresets = tabPresets(presets, activeTab);
  const sequenceRunning = isTaskRunning(running, SEQUENCE_TASK);
  const tabDomId = (tabId: string): string => `${tabsId}-${tabId}`;
  const panelId = `${tabsId}-panel`;

  /**
   * 搜索跨全部分组 —— 真实的场景是「记得有条指令叫 xxx，不记得在哪一组」。
   * 命中项按分组分节列出，不必再猜它属于谁。null 表示没在搜索。
   */
  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return null;
    return tabs
      .map((tab, index) => ({
        tab,
        index,
        hits: tabPresets(presets, index).filter(
          (preset) =>
            presetLabel(preset, t).toLowerCase().includes(needle) ||
            preset.data.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.hits.length > 0);
  }, [query, tabs, presets, t]);

  const onExport = useCallback(() => {
    downloadText('serial-presets.json', exportPayload(), 'application/json');
    useLogStore.getState().appendMessage(t.exportedPresets);
  }, [exportPayload, t]);

  const onPickFile = useCallback((mode: 'replace' | 'append') => {
    importMode.current = mode;
    fileRef.current?.click();
  }, []);

  const onImportFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const mode = importMode.current;
      event.target.value = '';
      if (!file) return;

      void file.text().then((raw) => {
        const result = parseImportedPresets(raw);
        const log = useLogStore.getState();
        if (!result.ok) {
          log.appendMessage(t.importFailed(result.reason));
          return;
        }
        if (mode === 'append') {
          appendAll(result);
          log.appendMessage(t.appendedPresets(result.presets.length));
        } else {
          replaceAll(result);
          log.appendMessage(t.importedPresets(result.presets.length));
        }
        if (result.skipped > 0) {
          // 原型是静默截断的；跳过了多少条必须让用户知道（缺陷 D17）
          log.appendMessage(t.importFailed(`${result.skipped} skipped`));
        }
      });
    },
    [appendAll, replaceAll, t],
  );

  const onStopAll = useCallback(() => {
    stopAll();
    useLogStore.getState().appendMessage(t.stoppedAll);
  }, [stopAll, t]);

  return (
    <aside className={styles.pane} aria-label={t.multiSend}>
      <div className={styles.head}>
        <PresetTabs
          tabDomId={tabDomId}
          panelId={panelId}
          onRequestRemove={() => setMenuFocus('remove')}
        />

        <div className={styles.headActions}>
          {/* 搜索留在外面：它是攒到几十条之后天天要用的，不值得多点一下菜单 */}
          <input
            type="search"
            className={`field field--sunk field--sm ${styles.search}`}
            value={query}
            placeholder={t.searchPresets}
            aria-label={t.searchPresets}
            onChange={(event) => setQuery(event.target.value)}
          />
          {/*
            Alt+↑↓ 调顺序、F2 重命名都**没有鼠标入口**，不说的话没人找得到。
            放在头部而不是列头里：这一排是常驻的动作区，眼睛本来就会扫到。
          */}
          <span
            className={styles.kbdHint}
            role="note"
            aria-label={keyboardHints(t)}
            title={keyboardHints(t)}
          >
            ?
          </span>
          <PresetMenu
            focus={menuFocus}
            setFocus={setMenuFocus}
            onPickFile={onPickFile}
            onExport={onExport}
          />
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
        <span>{t.colPeriod}</span>
        <span className={styles.columnLoop}>{t.colLoop}</span>
      </div>

      <div
        className={styles.list}
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabs[activeTab] ? tabDomId(tabs[activeTab].id) : undefined}
      >
        {found === null ? (
          visiblePresets.map((preset) => (
            <PresetRow
              key={preset.id}
              preset={preset}
              movable
              invalid={issues[preset.id] !== undefined}
              looping={isTaskRunning(running, presetTask(preset.id))}
              canSend={isOpen}
            />
          ))
        ) : found.length === 0 ? (
          <p className={styles.noMatch}>{t.noMatch}</p>
        ) : (
          found.map(({ tab, index, hits }) => (
            <Fragment key={tab.id}>
              {/* 命中项脱离了原来的位置，所以得标出它来自哪一组 */}
              <div className={styles.groupLabel}>{presetTabTitle(tab, index, t)}</div>
              {hits.map((preset) => (
                <PresetRow
                  key={preset.id}
                  preset={preset}
                  movable={false}
                  invalid={issues[preset.id] !== undefined}
                  looping={isTaskRunning(running, presetTask(preset.id))}
                  canSend={isOpen}
                />
              ))}
            </Fragment>
          ))
        )}
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
          {/* 步间隔的两种取法放在同一个下拉里，选「每条」时右边的统一间隔自动失效 ——
              两个各自独立的控件会让人以为它们叠加 */}
          <select
            className={`field field--sm ${styles.stepSelect}`}
            aria-label={t.gapMode}
            value={step}
            onChange={(event) => setStep(event.target.value as SequenceStep)}
          >
            <option value="gap">{t.gapModeUniform}</option>
            <option value="each">{t.gapModeEach}</option>
          </select>
          <input
            type="number"
            className={`field field--sunk field--sm ${styles.gapInput}`}
            value={gapMs}
            min={10}
            step={10}
            aria-label={t.gap}
            disabled={step === 'each'}
            title={step === 'each' ? t.gapModeEachHint : undefined}
            onChange={(event) => setGapMs(Number(event.target.value))}
          />
          <span className="label">ms</span>
          <span className="label" aria-hidden="true">
            ×
          </span>
          <input
            type="number"
            className={`field field--sunk field--sm ${styles.repeatInput}`}
            value={repeat}
            min={0}
            step={1}
            aria-label={t.repeat}
            title={t.repeatHint}
            onChange={(event) => setRepeat(Number(event.target.value))}
          />
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
  /** 在有内容的分组上按了 Delete：删除入口在菜单里，把菜单打开让人看见要确认什么。 */
  onRequestRemove: () => void;
}

/**
 * 分组标签页，按 WAI-ARIA 的 tabs 模式：只有选中的那个进 Tab 键序列，
 * 左右方向键 / Home / End 切换分组，焦点跟着走。双击或 F2 改名。
 *
 * 新建与删除不在这里 —— 它们跟导入导出一样是偶尔才用一次的动作，常驻在头部
 * 只会把标签条挤没（见 PresetMenu）。Delete 键仍然管用：没动过的空分组直接删掉
 * （多点了一下「新建」很常见），有内容的则把菜单叫出来。
 */
function PresetTabs({ tabDomId, panelId, onRequestRemove }: TabsProps): React.JSX.Element {
  const t = useMessages();
  const tabs = usePresetStore((s) => s.tabs);
  const presets = usePresetStore((s) => s.presets);
  const activeTab = usePresetStore((s) => s.activeTab);
  const selectTab = usePresetStore((s) => s.selectTab);
  const renameTab = usePresetStore((s) => s.renameTab);
  const removeTab = usePresetStore((s) => s.removeTab);

  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // 同步可读的「正在改谁」：按 Esc 收起输入框时若浏览器随后补发一次 blur，不能再提交
  const editing = useRef<string | null>(null);
  // 改完名、删完组之后要聚焦的标签。输入框或被删的标签一消失，焦点就掉到页面上，
  // 键盘用户得从头 Tab 过来；标签按钮要等这一轮渲染完才在，所以放到 effect 里做
  const pendingFocus = useRef<number | null>(null);

  useEffect(() => {
    if (renamingId === null) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renamingId]);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    buttons.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  });

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

  const onDelete = (index: number): void => {
    const tab = tabs[index];
    if (!tab || tabs.length <= 1) return;
    if (!isBlankTab(tab, tabPresets(presets, index))) {
      onRequestRemove();
      return;
    }
    removeTab(tab.id);
    pendingFocus.current = usePresetStore.getState().activeTab;
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
    } else if (event.key === 'Delete') {
      event.preventDefault();
      onDelete(index);
    }
  };

  return (
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
              pendingFocus.current = index;
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
            title={t.tabHint}
            onClick={() => selectTab(index)}
            onDoubleClick={() => startRename(index)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {presetTabTitle(tab, index, t)}
          </button>
        ),
      )}
    </div>
  );
}

/** 打开菜单时焦点落在哪一项：平时是第一项，按 Delete 叫出来时直接落到删除上。 */
type MenuFocus = 'first' | 'remove';

interface MenuProps {
  /** null 表示收起；否则是打开后要聚焦的那一项。 */
  focus: MenuFocus | null;
  setFocus: (focus: MenuFocus | null) => void;
  onPickFile: (mode: 'replace' | 'append') => void;
  onExport: () => void;
}

/**
 * 分组管理与导入导出。
 *
 * 这五项都是偶尔才用一次的（新建、删除分组，导入、追加、导出），常驻在头部的话
 * 加上搜索框要吃掉两百多像素，右栏里分组标签条就只剩两三个可见 ——
 * 标签条才是天天在点的东西。收进菜单之后头部只留搜索框和一个「⋯」。
 */
function PresetMenu({ focus, setFocus, onPickFile, onExport }: MenuProps): React.JSX.Element {
  const t = useMessages();
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);

  const tabs = usePresetStore((s) => s.tabs);
  const presets = usePresetStore((s) => s.presets);
  const activeTab = usePresetStore((s) => s.activeTab);
  const addTab = usePresetStore((s) => s.addTab);
  const removeTab = usePresetStore((s) => s.removeTab);
  const { armed, confirm, reset } = useConfirm<string>();

  const open = focus !== null;
  const activeTitle = tabs[activeTab] ? presetTabTitle(tabs[activeTab], activeTab, t) : '';
  const removeArmed = armed !== null && armed === tabs[activeTab]?.id;

  // 收起菜单就等于放弃这次征询：再打开时又是一个干净的删除项
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (focus === null) return;
    if (focus === 'remove') removeRef.current?.focus();
    else menuRef.current?.querySelector('button')?.focus();
  }, [focus]);

  const close = (): void => {
    setFocus(null);
    buttonRef.current?.focus();
  };

  /** 菜单内只有一个 Tab 停靠点，项间移动靠方向键（WAI-ARIA 的 menu 模式）。 */
  const moveFocus = (delta: number): void => {
    const items = [...(menuRef.current?.querySelectorAll('button:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(current + delta + items.length) % items.length];
    (next as HTMLButtonElement | undefined)?.focus();
  };

  /** 没动过的空分组直接删（多点了一下「新建」很常见），有内容的要按两下。 */
  const onRemove = (): void => {
    const tab = tabs[activeTab];
    if (!tab || tabs.length <= 1) return;
    if (isBlankTab(tab, tabPresets(presets, activeTab))) {
      removeTab(tab.id);
      close();
      return;
    }
    confirm(tab.id, () => {
      removeTab(tab.id);
      close();
    });
  };

  return (
    <div
      className={styles.menuWrap}
      onBlur={(event) => {
        // 焦点还在菜单里（在项之间移动）就不收
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setFocus(null);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`btn ${styles.menuBtn}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t.presetMenu}
        title={t.presetMenu}
        onClick={() => setFocus(open ? null : 'first')}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setFocus('first');
        }}
      >
        ⋯
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t.presetMenu}
          className={styles.menu}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
              return;
            }
            const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
            if (delta === 0) return;
            event.preventDefault();
            moveFocus(delta);
          }}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.menuItem}
            onClick={() => {
              addTab();
              close();
            }}
          >
            {t.newTab}
          </button>
          <button
            ref={removeRef}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={`${styles.menuItem} ${styles.menuDanger}`}
            disabled={tabs.length <= 1}
            onClick={onRemove}
          >
            {removeArmed ? t.confirmDeleteTab : t.deleteTab(activeTitle)}
          </button>

          <div role="separator" className={styles.menuSep} />

          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.menuItem}
            title={t.importHint}
            onClick={() => {
              onPickFile('replace');
              close();
            }}
          >
            {t.import}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.menuItem}
            title={t.appendHint}
            onClick={() => {
              onPickFile('append');
              close();
            }}
          >
            {t.append}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.menuItem}
            onClick={() => {
              onExport();
              close();
            }}
          >
            {t.export}
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface RowProps {
  preset: Preset;
  /** 组内序号，用来标出 Alt+N 快捷键；搜索结果里的行不属于任何位置，传 null。 */
  /** 搜索结果里顺序没有意义，那时不接移动快捷键。 */
  movable: boolean;
  invalid: boolean;
  looping: boolean;
  canSend: boolean;
}

/**
 * 一条预设一行，列序固定：勾选 · 格式 · 数据 · 帧尾 · 发送 · 周期 · 循环。
 *
 * 名称与帧尾都不摊开成控件：名称就是发送按钮上的文字（点 ✎ 改），帧尾只占一个徽标，
 * 点开才在行下方展开选择器。两者都是「设一次就不动」的东西，不值得为它们常驻下拉框
 * 把每行撑高一档 —— 行高一涨，一屏能看的预设就少几条。
 *
 * 调顺序同理走快捷键而不是箭头按钮：一行已经排了七个控件，再塞两个 18px 的箭头，
 * 数据框就只剩六十来像素，什么都看不清了。
 */
function PresetRow({ preset, movable, invalid, looping, canSend }: RowProps): React.JSX.Element {
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
  const movePreset = usePresetStore((s) => s.movePreset);
  const movePresetToTab = usePresetStore((s) => s.movePresetToTab);
  const tabCount = usePresetStore((s) => s.tabs.length);
  const activeTab = usePresetStore((s) => s.activeTab);

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

  const onRowKey = (event: React.KeyboardEvent): void => {
    // F2 挂在整行而不是发送按钮上：用鼠标聚焦发送按钮的唯一办法是点它，
    // 而点一下就把报文发出去了 —— 重命名不该带一次误发。
    // 点数据框（或 Tab 到行内任意控件）再按 F2 才是安全的路径。
    if (event.key === 'F2') {
      event.preventDefault();
      setDraft(label);
      setRenaming(true);
      return;
    }
    if (!movable || !event.altKey || event.ctrlKey || event.metaKey) return;
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();

    if (!event.shiftKey) {
      movePreset(preset.id, delta);
      return;
    }
    // 没有相邻分组就是键按空了，不必说什么；有分组却挪不过去才要解释
    const to = activeTab + delta;
    if (to < 0 || to >= tabCount) return;
    if (!movePresetToTab(preset.id, delta)) useLogStore.getState().appendMessage(t.tabFull);
  };

  return (
    <>
      <div className={styles.row} data-looping={looping} onKeyDown={onRowKey}>
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
          title={t.rowKeyHint}
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
            title={`${label} · ${t.rowKeyHint}`}
            onClick={() => void sendOnce(preset.id)}
          >
            {label}
          </button>
        )}

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
    </>
  );
}
