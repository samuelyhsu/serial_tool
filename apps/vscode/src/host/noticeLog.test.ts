import { describe, expect, it } from 'vitest';
import type { SessionNotice, SessionNoticeCode } from '@/core/session/notices';
import { noticeLogEntry } from './noticeLog';

/** 按 code 穷举：core 新增一种通知时这里编译不过，逼着决定它该不该进日志、记什么级别。 */
const samples: { [K in SessionNoticeCode]: Extract<SessionNotice, { code: K }> } = {
  'port-opened': { code: 'port-opened', config: '115200 8N1' },
  'port-closed': { code: 'port-closed' },
  'open-failed': { code: 'open-failed', message: 'Access denied' },
  'connection-lost': { code: 'connection-lost' },
  'reconnect-scheduled': { code: 'reconnect-scheduled', attempt: 2, max: 10, delayMs: 800 },
  'reconnect-succeeded': { code: 'reconnect-succeeded', attempt: 3 },
  'reconnect-gave-up': { code: 'reconnect-gave-up', attempts: 10 },
  'read-error': { code: 'read-error', message: 'EIO' },
  'write-error': { code: 'write-error', message: 'EIO' },
  'write-dropped-backpressure': { code: 'write-dropped-backpressure', pendingBytes: 4096 },
  'not-open': { code: 'not-open' },
  'port-busy': { code: 'port-busy' },
  'record-started': { code: 'record-started', target: 'a.log' },
  'record-stopped': { code: 'record-stopped', target: 'a.log', lines: 12 },
  'record-error': { code: 'record-error', message: 'ENOSPC' },
};

describe('noticeLogEntry', () => {
  it('错误类通知记为 error，并带上底层原因', () => {
    for (const notice of [samples['open-failed'], samples['read-error'], samples['write-error']]) {
      const entry = noticeLogEntry(notice);
      expect(entry?.level).toBe('error');
      expect(entry?.message).toContain(notice.message);
    }
  });

  it('掉线、放弃重连、背压丢写、端口被占记为 warn', () => {
    for (const code of [
      'connection-lost',
      'reconnect-gave-up',
      'write-dropped-backpressure',
      'port-busy',
    ] as const) {
      expect(noticeLogEntry(samples[code])?.level).toBe('warn');
    }
  });

  it('端口被占导致的打开失败在日志里标出来', () => {
    const inUse = noticeLogEntry({ ...samples['open-failed'], inUse: true });
    expect(inUse?.message).toContain('port in use');
    expect(noticeLogEntry(samples['open-failed'])?.message).not.toContain('port in use');
  });

  it('「未打开就发送」只是操作反馈，不进日志', () => {
    expect(noticeLogEntry(samples['not-open'])).toBeNull();
  });

  it('措辞是纯 ASCII，不跟显示语言走', () => {
    for (const notice of Object.values(samples)) {
      const entry = noticeLogEntry(notice);
      if (entry) expect(entry.message).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});
