import { describe, expect, it } from 'vitest';
import { FramePlan } from './framePlan';

const a = { bytes: Uint8Array.of(0xa) };
const b = { bytes: Uint8Array.of(0xb) };

describe('FramePlan', () => {
  it('单条循环是长度 1 的列表，每一拍都是同一帧', () => {
    const plan = new FramePlan([a]);
    expect(plan.at(0)).toBe(a);
    expect(plan.at(7)).toBe(a);
  });

  it('顺序循环每拍前进一条，到头绕回第一条', () => {
    const plan = new FramePlan([a, b]);
    expect([0, 1, 2, 3].map((tick) => plan.at(tick))).toEqual([a, b, a, b]);
  });

  it('空队列没有帧可发', () => {
    expect(new FramePlan([]).at(0)).toBeUndefined();
  });

  it('没单独定延时就交回 undefined，由调用方回落到任务周期', () => {
    const plan = new FramePlan([a, { ...b, delayMs: 250 }]);
    expect(plan.delayBefore(0)).toBeUndefined();
    expect(plan.delayBefore(1)).toBe(250);
  });

  /** repeat 为 0 是一直跑，这也是单条循环与心跳的常态。 */
  it('不限遍数时永远不是最后一拍', () => {
    const plan = new FramePlan([a, b]);
    expect([0, 1, 100].map((tick) => plan.isFinal(tick))).toEqual([false, false, false]);
  });

  it('跑满 repeat 遍的最后一帧是最后一拍', () => {
    const plan = new FramePlan([a, b], 2);
    expect([0, 1, 2, 3].map((tick) => plan.isFinal(tick))).toEqual([false, false, false, true]);
  });

  it('只跑一遍时，队列的最后一条就结束', () => {
    const plan = new FramePlan([a, b], 1);
    expect(plan.isFinal(0)).toBe(false);
    expect(plan.isFinal(1)).toBe(true);
  });

  /**
   * 队列在运行途中被换掉（勾掉一条预设）时，按新的总数重新判定。
   * 拍号归调度器管，不会跟着内容一起回到原点。
   */
  it('换成更短的队列后，已经超过新总数的拍号立刻算到头', () => {
    expect(new FramePlan([a], 2).isFinal(3)).toBe(true);
  });
});
