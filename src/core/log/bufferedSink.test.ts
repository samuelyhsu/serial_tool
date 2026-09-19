import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferedSink, SINK_FLUSH_CHARS, SINK_FLUSH_MS, type SinkTarget } from './bufferedSink';

function fakeTarget(): SinkTarget & { chunks: string[]; closed: boolean } {
  const target = {
    chunks: [] as string[],
    closed: false,
    write(chunk: string) {
      target.chunks.push(chunk);
      return Promise.resolve();
    },
    close() {
      target.closed = true;
      return Promise.resolve();
    },
  };
  return target;
}

describe('BufferedSink', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('攒够时间才写一次，每行补上换行', async () => {
    const target = fakeTarget();
    const sink = new BufferedSink(target, () => undefined);
    sink.write('a');
    sink.write('b');
    expect(target.chunks).toHaveLength(0);
    vi.advanceTimersByTime(SINK_FLUSH_MS);
    await vi.runAllTimersAsync();
    expect(target.chunks).toEqual(['a\nb\n']);
  });

  it('攒够体量就不等计时器', async () => {
    const target = fakeTarget();
    const sink = new BufferedSink(target, () => undefined);
    sink.write('x'.repeat(SINK_FLUSH_CHARS));
    await vi.runAllTimersAsync();
    expect(target.chunks).toHaveLength(1);
  });

  it('关闭时冲掉剩余内容再关目标', async () => {
    const target = fakeTarget();
    const sink = new BufferedSink(target, () => undefined);
    sink.write('tail');
    await sink.close();
    expect(target.chunks).toEqual(['tail\n']);
    expect(target.closed).toBe(true);
  });

  it('空缓冲时不会写出空块', async () => {
    const target = fakeTarget();
    const sink = new BufferedSink(target, () => undefined);
    await sink.close();
    expect(target.chunks).toHaveLength(0);
  });

  // 并发写会让文件里的行交错，这是串行化存在的唯一理由
  it('写入串行化，顺序与写入顺序一致', async () => {
    const order: string[] = [];
    const target: SinkTarget = {
      write: (chunk) =>
        new Promise((resolve) =>
          setTimeout(() => {
            order.push(chunk);
            resolve();
          }, chunk.length),
        ),
      close: () => Promise.resolve(),
    };
    const sink = new BufferedSink(target, () => undefined);
    sink.write('slower-first');
    sink.flush();
    sink.write('b');
    sink.flush();
    await vi.runAllTimersAsync();
    expect(order).toEqual(['slower-first\n', 'b\n']);
  });

  // 磁盘满时每一批都会失败，报一次说明情况，刷屏没有新信息
  it('写入失败只上报第一次', async () => {
    const onError = vi.fn();
    const target: SinkTarget = {
      write: () => Promise.reject(new Error('disk full')),
      close: () => Promise.resolve(),
    };
    const sink = new BufferedSink(target, onError);
    sink.write('a');
    sink.flush();
    sink.write('b');
    sink.flush();
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('disk full');
  });

  it('写入失败不影响关闭', async () => {
    const target: SinkTarget = {
      write: () => Promise.reject(new Error('gone')),
      close: () => Promise.resolve(),
    };
    const sink = new BufferedSink(target, () => undefined);
    sink.write('a');
    await expect(sink.close()).resolves.toBeUndefined();
  });
});
