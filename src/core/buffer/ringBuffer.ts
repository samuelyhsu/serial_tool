/**
 * 定容环形缓冲（容量可在运行时调整）。
 *
 * 原型的日志是普通数组 + `log.splice(0, log.length - 2000)`，每次溢出都要搬移整个数组。
 * 环形缓冲把写入和淘汰都变成 O(1)，高频接收时不再产生数组churn（缺陷 D9）。
 */
export class RingBuffer<T> {
  #capacity: number;
  #items: (T | undefined)[];
  #start = 0;
  #size = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('RingBuffer capacity must be a positive integer');
    }
    this.#capacity = capacity;
    this.#items = new Array<T | undefined>(capacity);
  }

  get capacity(): number {
    return this.#capacity;
  }

  get size(): number {
    return this.#size;
  }

  /**
   * 改变容量，保留最新的 min(size, capacity) 项。
   *
   * 缩容时丢掉的是最旧的那些 —— 与 push 溢出时的淘汰方向一致，用户改小容量
   * 期待的是「只留最近这些」，而不是「把刚收到的截掉」。
   */
  resize(capacity: number): void {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('RingBuffer capacity must be a positive integer');
    }
    if (capacity === this.#capacity) return;
    const kept = this.recent(capacity);
    this.#items = new Array<T | undefined>(capacity);
    for (let i = 0; i < kept.length; i += 1) this.#items[i] = kept[i];
    this.#capacity = capacity;
    this.#start = 0;
    this.#size = kept.length;
  }

  push(item: T): void {
    if (this.#size < this.#capacity) {
      this.#items[(this.#start + this.#size) % this.#capacity] = item;
      this.#size += 1;
      return;
    }
    // 满了：覆盖最旧的一项，起点前移
    this.#items[this.#start] = item;
    this.#start = (this.#start + 1) % this.#capacity;
  }

  /** 按时间顺序取第 i 项，0 = 最旧。 */
  at(index: number): T | undefined {
    if (index < 0 || index >= this.#size) return undefined;
    return this.#items[(this.#start + index) % this.#capacity];
  }

  /** 最新的 count 项，按时间顺序返回。不复制整个缓冲。 */
  recent(count: number): T[] {
    const n = Math.min(count, this.#size);
    const out: T[] = new Array<T>(n);
    const offset = this.#size - n;
    for (let i = 0; i < n; i += 1) {
      out[i] = this.#items[(this.#start + offset + i) % this.#capacity]!;
    }
    return out;
  }

  toArray(): T[] {
    return this.recent(this.#size);
  }

  clear(): void {
    this.#items = new Array<T | undefined>(this.#capacity);
    this.#start = 0;
    this.#size = 0;
  }
}
