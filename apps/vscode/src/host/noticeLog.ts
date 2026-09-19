import type { SessionNotice } from '@/core/session/notices';

/**
 * 会话通知在输出面板里的那一行。
 *
 * 面板上的通知给正在看的人，输出面板里的这份给事后排查的人：面板关了、webview
 * 重建了它还在，用户报 issue 时贴得出来。所以措辞固定用英文、不跟显示语言走 ——
 * 贴进 issue 的日志要谁都看得懂。
 *
 * 返回 null 的是纯操作反馈，记下来只是噪音。
 */
export interface NoticeLogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
}

export function noticeLogEntry(notice: SessionNotice): NoticeLogEntry | null {
  switch (notice.code) {
    case 'port-opened':
      return { level: 'info', message: `opened (${notice.config})` };
    case 'port-closed':
      return { level: 'info', message: 'closed' };
    case 'open-failed':
      return {
        level: 'error',
        message: `open failed: ${notice.message}${notice.inUse ? ' (port in use)' : ''}`,
      };
    case 'connection-lost':
      return { level: 'warn', message: 'connection lost' };
    case 'reconnect-scheduled':
      return {
        level: 'info',
        message: `reconnect attempt ${notice.attempt}/${notice.max} in ${notice.delayMs}ms`,
      };
    case 'reconnect-succeeded':
      return { level: 'info', message: `reconnected on attempt ${notice.attempt}` };
    case 'reconnect-gave-up':
      return { level: 'warn', message: `gave up reconnecting after ${notice.attempts} attempts` };
    case 'read-error':
      return { level: 'error', message: `read error: ${notice.message}` };
    case 'write-error':
      return { level: 'error', message: `write error: ${notice.message}` };
    case 'write-dropped-backpressure':
      return {
        level: 'warn',
        message: `write dropped: ${notice.pendingBytes} bytes already pending`,
      };
    case 'port-busy':
      return { level: 'warn', message: 'port is held by another panel' };
    case 'record-started':
      return { level: 'info', message: `recording to ${notice.target}` };
    case 'record-stopped':
      return { level: 'info', message: `recording stopped (${notice.lines} lines)` };
    case 'record-error':
      return { level: 'error', message: `recording failed: ${notice.message}` };
    case 'not-open':
      return null;
  }
}
