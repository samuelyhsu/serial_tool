import type { RecordSink } from './recorder';

/**
 * 攒批落盘。
 *
 * 1 Mbps 下一秒能来上千帧，每帧一次真实写入在浏览器那一侧就是上千次
 * `FileSystemWritableFileStream.write()` —— 每次都要过一遍文件系统，录制自己
 * 反倒成了瓶颈。这里按「时间」与「体量」两个闸门攒批，并把真实写入串行化：
 * 两次写入若并发，落到文件里的行就可能是交错的。
 */

export interface SinkTarget {
  write: (chunk: string) => Promise<void>;
  close: () => Promise<void>;
}

/** 攒批间隔。比日志渲染的 60ms 宽松：文件不需要跟着眼睛走。 */
export const SINK_FLUSH_MS = 250;
/** 攒到这么多字符就不等计时器了，免得高速链路下缓冲无限涨。 */
export const SINK_FLUSH_CHARS = 32768;

export class BufferedSink implements RecordSink {
  #buffer = '';
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** 串行化真实写入：并发写会让文件里的行交错。 */
  #chain: Promise<void> = Promise.resolve();
  #failed = false;

  constructor(
    private readonly target: SinkTarget,
    /** 写入失败只报第一次：磁盘满时后续每一批都会失败，刷屏没有任何新信息。 */
    private readonly onError: (message: string) => void,
  ) {}

  write(line: string): void {
    this.#buffer += line + '\n';
    if (this.#buffer.length >= SINK_FLUSH_CHARS) {
      this.flush();
      return;
    }
    this.#timer ??= setTimeout(() => this.flush(), SINK_FLUSH_MS);
  }

  /**
   * 把攒着的内容推进写入队列。
   *
   * 同步返回，不等写完 —— 页面卸载（pagehide）时只来得及做到这一步，
   * 等 Promise 的那一版在那条路径上等于什么都没做。
   */
  flush(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#buffer.length === 0) return;
    const chunk = this.#buffer;
    this.#buffer = '';
    this.#chain = this.#chain.then(async () => {
      try {
        await this.target.write(chunk);
      } catch (error) {
        if (!this.#failed) {
          this.#failed = true;
          this.onError(error instanceof Error ? error.message : String(error));
        }
      }
    });
  }

  async close(): Promise<void> {
    this.flush();
    await this.#chain;
    await this.target.close();
  }
}
