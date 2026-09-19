export type TransportErrorKind =
  | 'unsupported'
  | 'invalid-state'
  | 'open-failed'
  /** 打开失败，且底层明确说端口正被占着。目前只有 Node 传输层能从底层错误里辨认出来。 */
  | 'in-use'
  | 'no-writable'
  | 'read'
  | 'write'
  | 'close-failed'
  /** 控制信号线读写失败（DTR / RTS / Break，以及 CTS 这些输入线）。 */
  | 'signals'
  | 'backpressure';

/**
 * 传输层错误。原型有 8 处 `catch (e) {}` 把失败静默吞掉（缺陷 D6），
 * 这里所有失败都归一成带 kind 的错误对象，交给上层决定是记日志还是触发重连。
 */
export class TransportError extends Error {
  constructor(
    readonly kind: TransportErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TransportError';
  }

  static from(error: unknown, kind: TransportErrorKind, prefix: string): TransportError {
    if (error instanceof TransportError) return error;
    const detail = error instanceof Error ? error.message : String(error);
    return new TransportError(kind, `${prefix}: ${detail}`, { cause: error });
  }
}
