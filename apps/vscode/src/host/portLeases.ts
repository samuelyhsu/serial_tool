/**
 * 端口占用表 —— 宿主进程里的权威版本，**权威只到本窗口为止**。
 *
 * 浏览器那套（src/lib/portLease.ts）只能靠 BroadcastChannel 互相通气，是尽力而为的；
 * 同一窗口的所有面板共用一个宿主进程、一张表，因此在窗口内这里是真正的仲裁者：
 * 谁先登记谁拿到，第二个面板连试都不用试。
 *
 * 跨窗口它看不见：VS Code 每个窗口各有自己的扩展宿主进程，也就各有一张表。刻意没做
 * 跨进程锁 —— serialport 默认就锁端口，另一个窗口本来就会在 open() 上失败，缺的只是
 * 让用户看懂那个失败（见 nodeSerialTransport.ts 的 isPortInUseError）；文件锁、共享状态
 * 这类方案带来的陈旧锁与崩溃后不释放，比它要解决的问题麻烦得多。
 *
 * 窗口内不需要加锁。JS 是单线程的，`acquire()` 从查表到写表之间不存在 await，
 * 两个面板同时点「打开」也会被自然串行化成先到先得。
 */
export class PortLeases {
  /** 设备路径 → 持有者（面板的 id）。 */
  readonly #byPath = new Map<string, string>();
  readonly #listeners = new Set<(holders: Readonly<Record<string, string>>) => void>();

  /** 尝试登记。已被别人占着返回 false；重复登记自己返回 true。 */
  acquire(path: string, holder: string): boolean {
    const current = this.#byPath.get(path);
    if (current !== undefined && current !== holder) return false;
    if (current === holder) return true;
    this.#byPath.set(path, holder);
    this.#emit();
    return true;
  }

  /** 谁占着这个口。没人占着返回 undefined。 */
  holderOf(path: string): string | undefined {
    return this.#byPath.get(path);
  }

  /**
   * 释放某个持有者的**全部**占用。
   *
   * 按持有者而不是按路径释放：面板关闭、扩展停用时，调用方手里只有面板 id，
   * 不该再去回忆它当时开的是哪个口 —— 那种「记账两处」的写法迟早会漏。
   */
  release(holder: string): void {
    let changed = false;
    for (const [path, current] of this.#byPath) {
      if (current !== holder) continue;
      this.#byPath.delete(path);
      changed = true;
    }
    if (changed) this.#emit();
  }

  holders(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.#byPath);
  }

  subscribe(listener: (holders: Readonly<Record<string, string>>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    const snapshot = this.holders();
    for (const listener of this.#listeners) listener(snapshot);
  }
}
