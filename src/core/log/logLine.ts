import { escapeControlChars } from '../codec/display';
import { formatHex } from '../codec/hex';
import { StreamingUtf8Decoder } from '../codec/text';
import type { Direction } from '../session/serialSession';

/**
 * 一条日志的文本形态：界面渲染、导出、录制落盘三处共用同一套格式化。
 *
 * 放在 core 而不是 store 里，是因为**录制要在会话那一侧做**：VS Code 里帧产生在
 * 扩展宿主，webview 一被隐藏就销毁，录制若挂在界面上，切个标签页文件就断了。
 * 宿主进程碰不到 store，只能依赖这里。
 */

/** 字节在日志里的两种显示方式。 */
export type LogView = 'text' | 'hex';
/** 日志条目的三类来源：收、发、本工具自己的系统消息。 */
export type LogKind = Direction | 'sys';

const TAGS: Record<LogKind, string> = { rx: '[RX]', tx: '[TX]', sys: '[--]' };

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** `12:34:56.789` */
export function formatClock(date: Date): string {
  return (
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}`
  );
}

/** `2026-09-19` */
export function formatDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `2026-09-19 12:34:56.789` */
export function formatDateTime(date: Date): string {
  return `${formatDay(date)} ${formatClock(date)}`;
}

/**
 * 与上一帧的间隔，如 `+12ms` / `+1.234s`。
 *
 * 一秒以内用毫秒整数：协议时序要对的就是这个量级，写成 `+0.012s` 反而要数小数位。
 * 负值（时钟回拨、乱序回放）钳到 0，显示一个 `-3ms` 只会让人怀疑日志本身。
 */
export function formatDelta(deltaMs: number): string {
  const ms = Math.max(0, Math.round(deltaMs));
  return ms < 1000 ? `+${ms}ms` : `+${(ms / 1000).toFixed(3)}s`;
}

/** 一行日志的前缀标记，导出与录制共用。 */
export function directionTag(kind: LogKind): string {
  return TAGS[kind];
}

/**
 * 帧 → 日志正文。
 *
 * 之所以是个类：TXT 视图必须跨帧保持 UTF-8 解码状态，否则被分帧切开的汉字
 * 会在两帧里各自变成替换字符（缺陷 D4 的同一个坑）。两个方向各一份状态。
 */
export class FrameFormatter {
  readonly #decoders: Record<Direction, StreamingUtf8Decoder> = {
    rx: new StreamingUtf8Decoder(),
    tx: new StreamingUtf8Decoder(),
  };

  constructor(private readonly view: LogView = 'text') {}

  body(direction: Direction, bytes: Uint8Array): string {
    return this.view === 'hex'
      ? formatHex(bytes)
      : escapeControlChars(this.#decoders[direction].decode(bytes));
  }

  /** `2026-09-19 12:34:56.789 [RX] AT+VER?\r\n` */
  line(direction: Direction, bytes: Uint8Array, at: number): string {
    return `${formatDateTime(new Date(at))} ${directionTag(direction)} ${this.body(direction, bytes)}`;
  }

  reset(): void {
    this.#decoders.rx.reset();
    this.#decoders.tx.reset();
  }
}

/** 时间戳文件名后缀：`20260919-123456`。 */
export function fileStamp(date = new Date()): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** 日志文件名：导出与录制起的是同一种名字，`serial-20260919-123456.log`。 */
export function logFileName(date = new Date()): string {
  return `serial-${fileStamp(date)}.log`;
}
