/**
 * 一个周期任务要发的内容与节奏。
 *
 * 任务持有一份帧列表而不是一个闭包，是为了能**整个交给扩展宿主执行**：面板一隐藏，
 * webview 连同它的定时器一起被销毁，只有内容也在那一头，循环才跑得下去。
 *
 * 「第几拍发哪一帧、下一拍等多久、跑到头没有」这三件事由这里算，两个运行环境共用。
 * 各写一份必然长歪 —— 浏览器里全对、切到 VS Code 就差一拍，而两边各自的单元测试
 * 都会是绿的（周期发送漏传 frames 那个 bug 就是这么逃出去的）。
 */

export interface TaskFrame {
  bytes: Uint8Array;
  /** 发这一帧之前等多久。不给就用任务的 intervalMs。 */
  delayMs?: number;
}

export class FramePlan {
  readonly #frames: readonly TaskFrame[];
  readonly #repeat: number;

  /** repeat 是整条队列跑几遍，0（默认）表示一直跑。 */
  constructor(frames: readonly TaskFrame[], repeat = 0) {
    this.#frames = frames;
    this.#repeat = Math.max(0, Math.trunc(repeat) || 0);
  }

  /** 部分更新时要把没改的那一半原样带过去，所以两者都读得到。 */
  get frames(): readonly TaskFrame[] {
    return this.#frames;
  }

  get repeat(): number {
    return this.#repeat;
  }

  /** 第 tick 拍要发的帧。单条循环是长度 1 的列表，取模之后永远是同一帧。 */
  at(tick: number): TaskFrame | undefined {
    if (this.#frames.length === 0) return undefined;
    return this.#frames[tick % this.#frames.length];
  }

  /** 第 tick 拍之前单独定的延时；没定就是 undefined，由调用方回落到任务周期。 */
  delayBefore(tick: number): number | undefined {
    return this.at(tick)?.delayMs;
  }

  /**
   * 第 tick 拍是不是最后一拍。
   *
   * 调用方在**发完**这一拍之后停掉任务，而不是等下一拍到点再停 ——
   * 否则「跑一遍就停」的序列会在末尾白亮一个间隔，看上去像卡住了。
   */
  isFinal(tick: number): boolean {
    if (this.#repeat === 0 || this.#frames.length === 0) return false;
    return tick + 1 >= this.#frames.length * this.#repeat;
  }
}
