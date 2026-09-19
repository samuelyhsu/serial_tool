import { useEffect, useId, useRef, useState } from 'react';
import { useSendStore } from '@/store/sendStore';
import { FORMAT_LABEL } from '../dataFormat';
import { useMessages } from '../useMessages';
import styles from './SendHistory.module.css';

/**
 * 发过什么的下拉。
 *
 * 键盘那条路（Ctrl+↑ / Ctrl+↓）在输入框里，这里是给鼠标的那一份 —— 两条路
 * 走的是同一份 store 状态，不会各记各的。
 *
 * 列表里带上 TXT / HEX 标记：同一串字符在两种模式下是完全不同的字节，
 * 不标出来的话点回去可能发出去的根本不是那条。
 */

/** 一行里显示多少个字符。再长就看不清了，完整内容挂在 title 上。 */
const PREVIEW_MAX = 60;

function preview(payload: string): string {
  const flat = payload.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX)}…` : flat;
}

export function SendHistory(): React.JSX.Element {
  const t = useMessages();
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const history = useSendStore((s) => s.history);
  const applyHistory = useSendStore((s) => s.applyHistory);
  const clearHistory = useSendStore((s) => s.clearHistory);

  // 历史被清空后菜单里什么都不剩，留着一个空框没有意义
  useEffect(() => {
    if (history.length === 0) setOpen(false);
  }, [history.length]);

  useEffect(() => {
    if (open) wrapRef.current?.querySelector('button')?.focus();
  }, [open]);

  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div
      ref={wrapRef}
      className={styles.wrap}
      onBlur={(event) => {
        // 焦点还在菜单里（在项之间移动）就不收
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`btn ${styles.toggle}`}
        disabled={history.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={t.sendHistoryTip}
        onClick={() => setOpen((current) => !current)}
      >
        {t.sendHistory}
      </button>

      {open ? (
        <div id={menuId} className={styles.menu} role="menu">
          {history.map((entry, index) => (
            <button
              key={`${entry.mode}:${entry.payload}`}
              type="button"
              role="menuitem"
              className={styles.item}
              title={entry.payload}
              onClick={() => {
                applyHistory(index);
                close();
              }}
            >
              <span className={styles.badge}>{FORMAT_LABEL[entry.mode]}</span>
              <span className={styles.text}>{preview(entry.payload)}</span>
            </button>
          ))}

          <button
            type="button"
            role="menuitem"
            className={`${styles.item} ${styles.clear}`}
            onClick={() => {
              clearHistory();
              close();
            }}
          >
            {t.clearSendHistory}
          </button>
        </div>
      ) : null}
    </div>
  );
}
