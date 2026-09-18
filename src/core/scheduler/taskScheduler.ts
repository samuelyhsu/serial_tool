/**
 * 周期发送任务调度器。
 *
 * 替换原型的 `this.timers[key] = setInterval(...)`（.dc.html:815/847/904），修掉三个问题：
 *  - D11 重入堆积：setInterval 不管上一次有没有发完，到点就再发一次。这里加 busy 闸门，
 *    上一次未完成就跳过本 tick 并回调 onSkip，由 UI 提示「跟不上」。
 *  - D11 周期漂移：setInterval 的实际间隔会被主线程阻塞拖长且误差累积。这里用绝对时间轴
 *    重排 setTimeout，长时间运行不跑偏；落后太多时直接跳到下一个未来时刻，不做补发风暴。
 *  - D12 命名空间混用：原型把重连退避定时器和周期发送塞进同一个 map，点「全部停止」会把
 *    重连一起干掉。重连现在归 ReconnectController 管，这里只管周期发送。
 */

export interface PeriodicTaskSpec {
  intervalMs: number;
  /**
   * 第 tick 拍的执行体，tick 从 0 开始单调递增。
   *
   * 上一拍没跑完而被跳过时那个拍号就此作废，不会补发 —— 「跟不上」的时候
   * 少发一帧，好过攒一堆迟到的帧一起灌出去（缺陷 D11）。
   */
  run: (tick: number) => void | Promise<void>;
  /**
   * 第 tick 拍之前要等多久，不给就一律用 intervalMs。
   *
   * 它在那一拍**执行之前**被问到（排期总是领先执行一拍），所以实现必须按
   * 参数里的 tick 算，读一个「发到第几条了」的外部游标会整体错开一位。
   */
  nextIntervalMs?: (tick: number) => number | undefined;
  /** 默认 true：启动时立即发一次，与原型行为一致。 */
  runImmediately?: boolean;
  /** 上一次还没发完导致本次被跳过时触发。 */
  onSkip?: () => void;
  onError?: (error: unknown) => void;
}

interface TaskState {
  spec: PeriodicTaskSpec;
  timer: ReturnType<typeof setTimeout> | null;
  nextAt: number;
  busy: boolean;
  cancelled: boolean;
  /** 已经排到第几拍。排期领先执行一拍，执行用的拍号闭在各自的定时器里。 */
  tick: number;
}

export class TaskScheduler {
  readonly #tasks = new Map<string, TaskState>();

  get runningCount(): number {
    return this.#tasks.size;
  }

  runningIds(): string[] {
    return [...this.#tasks.keys()];
  }

  isRunning(id: string): boolean {
    return this.#tasks.has(id);
  }

  start(id: string, spec: PeriodicTaskSpec): void {
    this.stop(id);
    const state: TaskState = {
      spec,
      timer: null,
      nextAt: Date.now(),
      busy: false,
      cancelled: false,
      tick: 0,
    };
    this.#tasks.set(id, state);

    if (spec.runImmediately !== false) void this.#invoke(state, 0);
    this.#schedule(state);
  }

  /** 改周期，不打断已在运行的任务；下一次触发即生效。 */
  updateInterval(id: string, intervalMs: number): void {
    const state = this.#tasks.get(id);
    if (state) state.spec.intervalMs = Math.max(1, intervalMs);
  }

  stop(id: string): void {
    const state = this.#tasks.get(id);
    if (!state) return;
    state.cancelled = true;
    if (state.timer !== null) clearTimeout(state.timer);
    this.#tasks.delete(id);
  }

  stopAll(): void {
    for (const id of [...this.#tasks.keys()]) this.stop(id);
  }

  #schedule(state: TaskState): void {
    if (state.cancelled) return;
    const tick = state.tick + 1;
    state.tick = tick;
    const now = Date.now();
    const interval = Math.max(1, state.spec.nextIntervalMs?.(tick) ?? state.spec.intervalMs);
    // 绝对时间轴：不累积误差；但落后超过一个周期时直接对齐到未来，避免补发风暴
    state.nextAt = Math.max(now, state.nextAt + interval);
    state.timer = setTimeout(() => {
      if (state.cancelled) return;
      this.#schedule(state); // 先排下一次，周期不受 run() 耗时影响
      void this.#invoke(state, tick);
    }, state.nextAt - now);
  }

  async #invoke(state: TaskState, tick: number): Promise<void> {
    if (state.cancelled) return;
    if (state.busy) {
      state.spec.onSkip?.();
      return;
    }
    state.busy = true;
    try {
      await state.spec.run(tick);
    } catch (error) {
      state.spec.onError?.(error);
    } finally {
      state.busy = false;
    }
  }
}
