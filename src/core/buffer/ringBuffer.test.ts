import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ringBuffer';

describe('RingBuffer', () => {
  it('未满时按插入顺序保存', () => {
    const ring = new RingBuffer<number>(4);
    ring.push(1);
    ring.push(2);
    expect(ring.size).toBe(2);
    expect(ring.toArray()).toEqual([1, 2]);
  });

  it('超出容量时淘汰最旧的一项，顺序仍然正确', () => {
    const ring = new RingBuffer<number>(3);
    for (const value of [1, 2, 3, 4, 5]) ring.push(value);
    expect(ring.size).toBe(3);
    expect(ring.toArray()).toEqual([3, 4, 5]);
    expect(ring.at(0)).toBe(3);
    expect(ring.at(2)).toBe(5);
  });

  it('recent 返回最新的 n 项且保持时间顺序', () => {
    const ring = new RingBuffer<number>(5);
    for (const value of [1, 2, 3, 4, 5, 6, 7]) ring.push(value);
    expect(ring.recent(3)).toEqual([5, 6, 7]);
    expect(ring.recent(99)).toEqual([3, 4, 5, 6, 7]);
  });

  it('越界访问返回 undefined', () => {
    const ring = new RingBuffer<number>(2);
    ring.push(1);
    expect(ring.at(-1)).toBeUndefined();
    expect(ring.at(1)).toBeUndefined();
  });

  it('clear 后恢复空态并可继续写入', () => {
    const ring = new RingBuffer<number>(2);
    ring.push(1);
    ring.push(2);
    ring.clear();
    expect(ring.size).toBe(0);
    ring.push(9);
    expect(ring.toArray()).toEqual([9]);
  });

  it('容量非法时构造抛错', () => {
    expect(() => new RingBuffer<number>(0)).toThrow(RangeError);
    expect(() => new RingBuffer<number>(1.5)).toThrow(RangeError);
  });

  it('扩容保留全部既有项，且仍从原顺序继续写入', () => {
    const ring = new RingBuffer<number>(3);
    for (const n of [1, 2, 3, 4]) ring.push(n); // 已绕过一圈：留下 2,3,4
    ring.resize(5);
    expect(ring.capacity).toBe(5);
    expect(ring.toArray()).toEqual([2, 3, 4]);
    ring.push(5);
    ring.push(6);
    expect(ring.toArray()).toEqual([2, 3, 4, 5, 6]);
    ring.push(7); // 到顶后继续淘汰最旧
    expect(ring.toArray()).toEqual([3, 4, 5, 6, 7]);
  });

  it('缩容丢掉最旧的，保留最新的那些', () => {
    const ring = new RingBuffer<number>(5);
    for (const n of [1, 2, 3, 4, 5]) ring.push(n);
    ring.resize(2);
    expect(ring.capacity).toBe(2);
    expect(ring.size).toBe(2);
    expect(ring.toArray()).toEqual([4, 5]);
    ring.push(6);
    expect(ring.toArray()).toEqual([5, 6]);
  });

  it('缩容后 at() 的下标仍从最旧的那项开始', () => {
    const ring = new RingBuffer<number>(4);
    for (const n of [1, 2, 3, 4]) ring.push(n);
    ring.resize(2);
    expect(ring.at(0)).toBe(3);
    expect(ring.at(1)).toBe(4);
    expect(ring.at(2)).toBeUndefined();
  });

  it('容量未变时 resize 是空操作', () => {
    const ring = new RingBuffer<number>(3);
    ring.push(1);
    ring.resize(3);
    expect(ring.toArray()).toEqual([1]);
  });

  it('resize 到非法容量抛错，且不动原有内容', () => {
    const ring = new RingBuffer<number>(3);
    ring.push(1);
    expect(() => ring.resize(0)).toThrow(RangeError);
    expect(() => ring.resize(2.5)).toThrow(RangeError);
    expect(ring.capacity).toBe(3);
    expect(ring.toArray()).toEqual([1]);
  });
});
