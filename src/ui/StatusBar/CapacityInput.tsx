import { useEffect, useRef, useState } from 'react';
import { LOG_CAPACITY_CEILING, LOG_CAPACITY_MIN } from '@/store/logStore';
import styles from './StatusBar.module.css';

interface Props {
  id: string;
  label: string;
  title: string;
  value: number;
  onCommit: (value: number) => void;
}

/**
 * 日志缓冲容量输入框。
 *
 * 与旁边的空闲时长输入框看着一样，但**提交时机必须不同**：那个边打边提交是安全的，
 * 改错了再改回来即可；容量不是 —— 缩容会立刻丢弃超出的旧记录，且不可撤销。
 * 边打边提交时，把 10000 改成 12000 的过程会途经「1」「12」「120」……其中
 * 「120」是合法值，于是缓冲在用户打完之前就被砍到 120 条，9880 条记录当场消失。
 *
 * 所以这里只在**失焦或回车**时提交一次，中途的按键一律只动本地草稿。
 * Esc 放弃编辑、回填当前生效值。
 */
export function CapacityInput({ id, label, title, value, onCommit }: Props): React.JSX.Element {
  const [draft, setDraft] = useState(() => String(value));
  /**
   * Esc 要放弃这次编辑，但它得靠 blur() 把焦点交出去，而 blur 会触发 commit。
   * setDraft 是异步的，commit 读到的仍是被放弃的草稿 —— 于是 Esc 反而把它提交了。
   * 用一个 ref 让紧随其后的那次 commit 直接跳过。
   */
  const abandoning = useRef(false);

  // store 里的值被别处改动时同步过来，但不打断正在输入的内容
  useEffect(() => {
    setDraft((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  const commit = (): void => {
    if (abandoning.current) {
      abandoning.current = false;
      return;
    }
    const parsed = Number(draft.trim());
    // 空串、非数字、越界一律视作放弃本次编辑，回填生效值，不把无效内容留在界面上
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    // 不设产品意义上的上限，只把值夹进物理可行区间：低于下限没有意义，
    // 高于数组长度上限则会让 new Array(n) 抛 RangeError
    const clamped = Math.min(LOG_CAPACITY_CEILING, Math.max(LOG_CAPACITY_MIN, Math.round(parsed)));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      id={id}
      type="number"
      className={`field field--sunk field--sm ${styles.capacityInput}`}
      value={draft}
      min={LOG_CAPACITY_MIN}
      step={1000}
      aria-label={label}
      title={title}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur(); // 失焦会触发 commit，不必在这里重复提交
        } else if (event.key === 'Escape') {
          abandoning.current = true;
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}
