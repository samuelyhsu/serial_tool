import { logFileName, type LogView } from '@/core/log/logLine';
import type { Messages } from '@/i18n';
import { downloadText } from '@/lib/download';
import { logText, useLogStore } from '@/store/logStore';

/**
 * 把缓冲里的日志存成文件，并在日志里回执行数。
 *
 * 单独成文件是因为它有两个入口：接收区的「保存日志」按钮和 Ctrl+S。
 * 留在组件里的话，快捷键那一侧就得照抄一遍 —— 抄出来的那份迟早会和按钮长歪。
 */
export function saveLogFile(view: LogView, messages: Messages): void {
  const { text, lines } = logText(view, messages);
  downloadText(logFileName(), text);
  useLogStore.getState().appendMessage(messages.exportedLog(lines));
}
