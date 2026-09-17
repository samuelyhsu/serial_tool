import { useCallback, useEffect, useRef, useState } from 'react';

/** 第一下之后多久内再按才算数。 */
const CONFIRM_WINDOW_MS = 3000;

/**
 * 不可撤销的操作要按两下：第一下只是征询，窗口期内再按同一个才执行，超时自己复原，
 * 不会一直吊着一个危险按钮。
 *
 * 没有用 window.confirm：VS Code 的 webview 跑在没有 `allow-modals` 的 iframe 里，
 * 原生弹窗会被直接吞掉。浏览器里好用、扩展里静默失效是最糟的一种组合。
 *
 * key 区分征询的是哪一个：同一处有多个可删的对象时，换了对象就得重新征询。
 */
export function useConfirm<K extends string>(): {
  armed: K | null;
  confirm: (key: K, action: () => void) => void;
  reset: () => void;
} {
  const [armed, setArmed] = useState<K | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setArmed(null);
  }, []);

  // 面板隐藏即销毁，别把定时器留给一个已经卸载的组件
  useEffect(() => reset, [reset]);

  const confirm = useCallback(
    (key: K, action: () => void) => {
      if (armed === key) {
        reset();
        action();
        return;
      }
      if (timer.current !== null) clearTimeout(timer.current);
      setArmed(key);
      timer.current = setTimeout(() => {
        timer.current = null;
        setArmed(null);
      }, CONFIRM_WINDOW_MS);
    },
    [armed, reset],
  );

  return { armed, confirm, reset };
}
