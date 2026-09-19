import { describe, expect, it } from 'vitest';
import {
  directionTag,
  fileStamp,
  formatClock,
  formatDateTime,
  formatDay,
  formatDelta,
  FrameFormatter,
  logFileName,
} from './logLine';

const AT = new Date(2026, 8, 19, 12, 34, 56, 7);

describe('时间格式化', () => {
  it('时钟补足毫秒三位', () => {
    expect(formatClock(AT)).toBe('12:34:56.007');
  });

  it('日期与日期时间', () => {
    expect(formatDay(AT)).toBe('2026-09-19');
    expect(formatDateTime(AT)).toBe('2026-09-19 12:34:56.007');
  });

  it('文件名用紧凑时间戳', () => {
    expect(fileStamp(AT)).toBe('20260919-123456');
    expect(logFileName(AT)).toBe('serial-20260919-123456.log');
  });
});

describe('帧间隔', () => {
  it('一秒以内用毫秒整数', () => {
    expect(formatDelta(0)).toBe('+0ms');
    expect(formatDelta(12.4)).toBe('+12ms');
    expect(formatDelta(999)).toBe('+999ms');
  });

  it('一秒起用秒', () => {
    expect(formatDelta(1000)).toBe('+1.000s');
    expect(formatDelta(1234)).toBe('+1.234s');
  });

  // 时钟回拨或乱序回放时算出负数，显示 -3ms 只会让人怀疑日志本身
  it('负值钳到零', () => {
    expect(formatDelta(-5)).toBe('+0ms');
  });
});

describe('FrameFormatter', () => {
  it('TXT 视图转义控制字符', () => {
    const formatter = new FrameFormatter('text');
    expect(formatter.body('rx', new Uint8Array([0x41, 0x0d, 0x0a]))).toBe('A\\r\\n');
  });

  it('HEX 视图按字节展开', () => {
    expect(new FrameFormatter('hex').body('rx', new Uint8Array([0x0a, 0xff]))).toBe('0A FF');
  });

  // 被分帧切开的汉字必须跨帧还原，这正是流式解码器存在的理由
  it('跨帧保持 UTF-8 解码状态', () => {
    const formatter = new FrameFormatter('text');
    const bytes = new TextEncoder().encode('中');
    expect(formatter.body('rx', bytes.slice(0, 2))).toBe('');
    expect(formatter.body('rx', bytes.slice(2))).toBe('中');
  });

  it('两个方向各有独立的解码状态', () => {
    const formatter = new FrameFormatter('text');
    const bytes = new TextEncoder().encode('中');
    formatter.body('rx', bytes.slice(0, 2));
    // tx 的半个字符不该被 rx 的残留字节污染
    expect(formatter.body('tx', new Uint8Array([0x41]))).toBe('A');
    expect(formatter.body('rx', bytes.slice(2))).toBe('中');
  });

  it('reset 之后解码状态清空', () => {
    const formatter = new FrameFormatter('text');
    const bytes = new TextEncoder().encode('中');
    formatter.body('rx', bytes.slice(0, 2));
    formatter.reset();
    expect(formatter.body('rx', new Uint8Array([0x41]))).toBe('A');
  });

  it('整行带日期、方向标记与正文', () => {
    const formatter = new FrameFormatter('text');
    expect(formatter.line('tx', new Uint8Array([0x41]), AT.getTime())).toBe(
      '2026-09-19 12:34:56.007 [TX] A',
    );
  });

  it('方向标记', () => {
    expect(directionTag('rx')).toBe('[RX]');
    expect(directionTag('tx')).toBe('[TX]');
    expect(directionTag('sys')).toBe('[--]');
  });
});
