import { FrameFormatter, formatDateTime, type LogView } from './logLine';
import type { Direction } from '../session/serialSession';

/**
 * 把收发的帧实时写进文件。
 *
 * 存在的理由是环形缓冲装不下的那种用法：挂一夜等一次偶发异常。日志只活在内存里时，
 * 早上回来要找的那段早被挤掉了。
 *
 * **录制归会话那一侧所有**，和周期发送同理 —— VS Code 里帧产生在扩展宿主，
 * webview 一被隐藏就连同定时器和状态一起销毁，录制挂在界面上的话切个标签页文件就断了。
 * 这里只做「帧 → 行 + 计数 + 状态广播」，真正落盘由注入的 sink 负责：
 * 浏览器是 File System Access 的可写流，扩展宿主是 Node 的写入流。
 *
 * **只录 RX / TX 帧，不录系统消息**：notice 是结构化事件、翻译发生在渲染时
 * （见 i18n），宿主进程手里没有文案目录。为了几行「端口已打开」把 i18n 搬进 core
 * 不划算，文件头里因此写明了这一点。
 */

export interface RecordSink {
  /** 追加一行（不含换行符，由 sink 自己补）。写入失败交给 sink 自己上报。 */
  write: (line: string) => void;
  /** 冲掉缓冲并关闭。 */
  close: () => Promise<void>;
}

export interface RecordingStatus {
  active: boolean;
  /** 目标文件的显示名，未录制时为 null。 */
  target: string | null;
  /** 已写入的行数。 */
  lines: number;
  /** 开始时刻（毫秒），未录制时为 0。 */
  startedAt: number;
}

export const IDLE_RECORDING: RecordingStatus = {
  active: false,
  target: null,
  lines: 0,
  startedAt: 0,
};

export class FrameRecorder {
  #sink: RecordSink | null = null;
  #formatter = new FrameFormatter();
  #status: RecordingStatus = IDLE_RECORDING;
  readonly #listeners = new Set<(status: RecordingStatus) => void>();

  get status(): RecordingStatus {
    return this.#status;
  }

  get active(): boolean {
    return this.#sink !== null;
  }

  /**
   * 开始录制。已经在录时先把上一份收尾。
   *
   * `view` 在这一刻定死：录制期间用户在界面上切 TXT/HEX 不该让文件里的格式中途变样，
   * 那样的文件没法再被任何东西解析。
   */
  start(sink: RecordSink, target: string, view: LogView, at: number): void {
    if (this.#sink) void this.#sink.close();
    this.#sink = sink;
    // 新建而不是 reset：view 是它的构造参数，顺带也把解码状态清干净了
    this.#formatter = new FrameFormatter(view);
    this.#status = { active: true, target, lines: 0, startedAt: at };
    sink.write(
      `# Serial Tool recording · started ${formatDateTime(new Date(at))} · format=${view.toUpperCase()} · RX/TX frames only`,
    );
    this.#emit();
  }

  /** 记一帧。没在录制时是空操作 —— 调用点因此不必先问状态。 */
  record(direction: Direction, bytes: Uint8Array, at: number): void {
    const sink = this.#sink;
    if (!sink) return;
    sink.write(this.#formatter.line(direction, bytes, at));
    this.#status = { ...this.#status, lines: this.#status.lines + 1 };
    this.#emit();
  }

  /** 停止并冲盘。返回停下来的那一刻的状态，界面用它回执「录了多少行」。 */
  async stop(): Promise<RecordingStatus> {
    const sink = this.#sink;
    const finished = this.#status;
    if (!sink) return finished;
    this.#sink = null;
    this.#status = IDLE_RECORDING;
    this.#emit();
    await sink.close();
    return finished;
  }

  subscribe(listener: (status: RecordingStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#status);
  }
}
