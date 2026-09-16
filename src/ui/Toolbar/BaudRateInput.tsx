import { useEffect, useId, useRef, useState } from 'react';
import { BAUD_RATES, isValidBaudRate, useConnectionStore } from '@/store/connectionStore';
import { useMessages } from '../useMessages';
import styles from './Toolbar.module.css';

/** 展开全部档位时先高亮的档：与当前值相等的那档，没有就取第一个不小于它的，让列表滚到附近。 */
function nearestIndex(value: number): number {
  const index = BAUD_RATES.findIndex((rate) => rate >= value);
  return index === -1 ? BAUD_RATES.length - 1 : index;
}

/**
 * 波特率输入：一个既能从建议列表里选、又能直接输入任意值的组合框。
 *
 * 用一个控件而不是「下拉框 + 一个『自定义』开关」，是为了让常用档位和自定义值共用
 * 同一个入口 —— 多一个开关就多一个要维护的状态和一次多余的点击。
 *
 * 列表有两种状态，区分的是「用户这次打没打字」，而不是输入框里有没有值：
 *  - 点展开按钮或按 ↓ 打开：列出全部档位，高亮当前值。
 *  - 边打字边展开：只列出以已输入数字开头的档位。
 * 不用 `<input list>` + `<datalist>` 正是因为它分不清这两种情况：浏览器总按输入框当前值筛选
 * （Chromium 是前缀匹配），框里是 115200 时点开只剩 115200 / 1152000 两项。
 *
 * 用 text 而不是 number：number 自带的 ±1 微调按钮和滚轮改值对波特率毫无意义，还容易误触。
 *
 * 输入过程中值可能是空串或半截数字，所以本地留一份草稿，只有合法时才提交到 store；
 * 不合法时把输入框标红，但保留用户已经打进去的内容，不做打断式的纠正。
 */
export function BaudRateInput({ disabled }: { disabled: boolean }): React.JSX.Element {
  const t = useMessages();
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const baudRate = useConnectionStore((s) => s.options.baudRate);
  const setOptions = useConnectionStore((s) => s.setOptions);

  const [draft, setDraft] = useState(() => String(baudRate));
  const [open, setOpen] = useState(false);
  /** 打字筛选用的前缀；null 表示列出全部档位。 */
  const [query, setQuery] = useState<string | null>(null);
  /** 高亮项在 `visible` 里的下标；-1 表示没有高亮，此时 Enter 保留输入框里的值。 */
  const [active, setActive] = useState(-1);

  // store 里的值被别处改动时（例如将来从配置恢复）同步过来；
  // 但不要打断正在输入的内容 —— 草稿解析后与 store 一致就保持原样
  useEffect(() => {
    setDraft((current) => (Number(current) === baudRate ? current : String(baudRate)));
  }, [baudRate]);

  // 端口打开后控件被禁用，悬着的列表也要收起
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const visible: readonly number[] = query
    ? BAUD_RATES.filter((rate) => String(rate).startsWith(query))
    : BAUD_RATES;
  const valid = isValidBaudRate(Number(draft)) && draft.trim() !== '';
  const expanded = open && !disabled && visible.length > 0;

  useEffect(() => {
    if (expanded && active >= 0)
      listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [expanded, active]);

  const openAll = (): void => {
    setQuery(null);
    setActive(nearestIndex(valid ? Number(draft) : baudRate));
    setOpen(true);
  };

  const choose = (rate: number): void => {
    setDraft(String(rate));
    setOptions({ baudRate: rate });
    setOpen(false);
  };

  const optionId = (rate: number): string => `${listId}-${rate}`;
  const activeRate = expanded ? visible[active] : undefined;

  return (
    <>
      <label className="label" htmlFor={inputId}>
        {t.baud}
      </label>
      <div
        className={styles.baudCombo}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          setOpen(false);
          // 失焦时若仍不合法，回退到最后一个有效值，别把非法状态留在界面上
          if (!valid) setDraft(String(baudRate));
        }}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={activeRate === undefined ? undefined : optionId(activeRate)}
          className={`field ${styles.baudInput} ${valid ? '' : 'field--invalid'}`}
          value={draft}
          disabled={disabled}
          aria-invalid={!valid}
          title={t.baudTip}
          onChange={(event) => {
            // 粘贴 "115,200" 这类带分隔符的值也能用
            const next = event.target.value.replace(/\D/g, '');
            setDraft(next);
            const parsed = Number(next);
            if (next !== '' && isValidBaudRate(parsed)) setOptions({ baudRate: parsed });
            // 不预先高亮第一个匹配项：否则打完一个自定义值按 Enter，会被换成某个候选档
            setQuery(next);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            switch (event.key) {
              case 'ArrowDown':
                event.preventDefault();
                if (!expanded) openAll();
                else setActive((i) => Math.min(i + 1, visible.length - 1));
                break;
              case 'ArrowUp':
                event.preventDefault();
                if (!expanded) openAll();
                else setActive((i) => Math.max(i - 1, 0));
                break;
              case 'Enter':
                if (expanded) {
                  event.preventDefault();
                  if (activeRate === undefined) setOpen(false);
                  else choose(activeRate);
                }
                break;
              case 'Escape':
                if (expanded) {
                  event.preventDefault();
                  setOpen(false);
                }
                break;
            }
          }}
        />
        <button
          type="button"
          className={styles.baudToggle}
          tabIndex={-1}
          disabled={disabled}
          aria-label={t.baudOptions}
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          // 焦点留在输入框，键盘操作与失焦收起才接得上
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (expanded) {
              setOpen(false);
            } else {
              inputRef.current?.focus();
              openAll();
            }
          }}
        >
          <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {expanded && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={t.baudOptions}
            className={styles.baudList}
          >
            {visible.map((rate, index) => (
              <li
                key={rate}
                id={optionId(rate)}
                role="option"
                aria-selected={rate === baudRate}
                data-active={index === active || undefined}
                className={styles.baudOption}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(rate)}
              >
                {rate}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
