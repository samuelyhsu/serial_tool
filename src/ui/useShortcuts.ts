import { useEffect } from 'react';
import { latestEntryId } from '@/store/logStore';
import { useConnectionStore } from '@/store/connectionStore';
import { useUiStore } from '@/store/uiStore';
import type { Messages } from '@/i18n';
import { saveLogFile } from './logActions';

/**
 * 全局快捷键。
 *
 * 挑选原则是「手离开键盘才做得到的高频动作」：连断串口、找东西、定住画面看一眼。
 * **破坏性的不给快捷键** —— 「清空」有二次确认，配上快捷键只会把误触变便宜。
 *
 * 组合的选法受两头夹击：
 *  - 浏览器保留了一批（Ctrl+L / K / E / N / T / W、Alt+F / Alt+E 的菜单），
 *    页面 preventDefault 对它们无效，只能绕开；
 *  - VS Code 的 webview 里 Ctrl+F / S / O 有被编辑器抢走的可能（见 README）。
 * 所以核心动作用 `Alt+字母` —— 两边都没占，也与既有的 `Alt+数字`（发第 N 条预设）
 * 天然分得开。Ctrl+F / Ctrl+S 保留是因为它们是肌肉记忆，值得冒这个险。
 *
 * 认 `event.code` 而不是 `event.key`：按住 Alt 时 key 在部分键盘布局下已经不是
 * 那个字母了（macOS 上 Option+S 直接变成 ß）—— 既有的 Alt+数字 也栽过同一个坑。
 */

/** 快捷键要聚焦的输入框，靠这个属性找得到。 */
export const FOCUS_TARGET_ATTR = 'data-focus-target';
export type FocusTarget = 'filter' | 'send';

function focusInput(target: FocusTarget): void {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[${FOCUS_TARGET_ATTR}="${target}"]`,
  );
  if (!element) return;
  element.focus();
  // 选中已有内容：聚焦过去多半是要换一个词，而不是接着上一个词往后打
  element.select();
}

export function useShortcuts(messages: Messages): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // 输入法组字途中不认快捷键，否则选字用的按键会被当成命令
      if (event.isComposing) return;

      const ui = useUiStore.getState();
      const mod = event.ctrlKey || event.metaKey;

      if (mod && !event.altKey && !event.shiftKey) {
        switch (event.code) {
          case 'KeyO': {
            const connection = useConnectionStore.getState();
            // 没选端口、或环境根本不支持时不拦这个键：让浏览器的「打开文件」照常
            if (!connection.supported || connection.selectedPortKey === null) return;
            event.preventDefault();
            void connection.toggleConnection();
            return;
          }
          case 'KeyF':
            event.preventDefault();
            focusInput('filter');
            return;
          case 'KeyS':
            event.preventDefault();
            saveLogFile(ui.view, messages);
            return;
          default:
            return;
        }
      }

      if (!event.altKey || mod || event.shiftKey) return;

      switch (event.code) {
        case 'KeyS':
          event.preventDefault();
          focusInput('send');
          return;
        case 'KeyP':
          event.preventDefault();
          ui.togglePause(latestEntryId());
          return;
        case 'KeyH':
          event.preventDefault();
          ui.setView(ui.view === 'text' ? 'hex' : 'text');
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [messages]);
}
