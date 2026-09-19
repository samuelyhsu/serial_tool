import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameRecorder, type RecordSink, type RecordingStatus } from './recorder';

function fakeSink(): RecordSink & { lines: string[]; closed: boolean } {
  const sink = {
    lines: [] as string[],
    closed: false,
    write(line: string) {
      sink.lines.push(line);
    },
    close() {
      sink.closed = true;
      return Promise.resolve();
    },
  };
  return sink;
}

const AT = new Date(2026, 8, 19, 12, 34, 56, 7).getTime();

describe('FrameRecorder', () => {
  let recorder: FrameRecorder;

  beforeEach(() => {
    recorder = new FrameRecorder();
  });

  it('没开始录制时记帧是空操作', () => {
    recorder.record('rx', new Uint8Array([0x41]), AT);
    expect(recorder.active).toBe(false);
    expect(recorder.status.lines).toBe(0);
  });

  it('开始时写一行文件头，说明格式与只录收发帧', () => {
    const sink = fakeSink();
    recorder.start(sink, 'a.log', 'text', AT);
    expect(sink.lines[0]).toBe(
      '# Serial Tool recording · started 2026-09-19 12:34:56.007 · format=TEXT · RX/TX frames only',
    );
    expect(recorder.status).toEqual<RecordingStatus>({
      active: true,
      target: 'a.log',
      lines: 0,
      startedAt: AT,
    });
  });

  it('逐帧落盘并计数', () => {
    const sink = fakeSink();
    recorder.start(sink, 'a.log', 'text', AT);
    recorder.record('rx', new Uint8Array([0x41]), AT);
    recorder.record('tx', new Uint8Array([0x42]), AT + 5);
    expect(sink.lines.slice(1)).toEqual([
      '2026-09-19 12:34:56.007 [RX] A',
      '2026-09-19 12:34:56.012 [TX] B',
    ]);
    expect(recorder.status.lines).toBe(2);
  });

  // 录制期间界面切 TXT/HEX 不该让文件中途换格式 —— 那样的文件没法再被解析
  it('格式在开始那一刻定死', () => {
    const sink = fakeSink();
    recorder.start(sink, 'a.log', 'hex', AT);
    recorder.record('rx', new Uint8Array([0x41, 0xff]), AT);
    expect(sink.lines[1]).toBe('2026-09-19 12:34:56.007 [RX] 41 FF');
  });

  it('停止后冲盘、状态归零，并交回停下来那一刻的读数', async () => {
    const sink = fakeSink();
    recorder.start(sink, 'a.log', 'text', AT);
    recorder.record('rx', new Uint8Array([0x41]), AT);
    const finished = await recorder.stop();
    expect(finished.lines).toBe(1);
    expect(finished.target).toBe('a.log');
    expect(sink.closed).toBe(true);
    expect(recorder.active).toBe(false);
    expect(recorder.status.lines).toBe(0);
    // 停下之后再来的帧不该写进已经关掉的文件
    recorder.record('rx', new Uint8Array([0x42]), AT);
    expect(sink.lines).toHaveLength(2);
  });

  it('重复停止是空操作', async () => {
    await expect(recorder.stop()).resolves.toEqual(recorder.status);
  });

  it('录制中再开一次会把上一份收尾', () => {
    const first = fakeSink();
    const second = fakeSink();
    recorder.start(first, 'a.log', 'text', AT);
    recorder.start(second, 'b.log', 'text', AT);
    expect(first.closed).toBe(true);
    expect(recorder.status.target).toBe('b.log');
  });

  it('状态变化会广播给订阅者', async () => {
    const seen: RecordingStatus[] = [];
    const unsubscribe = recorder.subscribe((status) => seen.push(status));
    recorder.start(fakeSink(), 'a.log', 'text', AT);
    recorder.record('rx', new Uint8Array([0x41]), AT);
    await recorder.stop();
    expect(seen.map((s) => [s.active, s.lines])).toEqual([
      [true, 0],
      [true, 1],
      [false, 0],
    ]);
    unsubscribe();
    recorder.start(fakeSink(), 'c.log', 'text', AT);
    expect(seen).toHaveLength(3);
  });

  it('跨帧的多字节字符在文件里也是完整的', () => {
    const sink = fakeSink();
    recorder.start(sink, 'a.log', 'text', AT);
    const bytes = new TextEncoder().encode('中');
    recorder.record('rx', bytes.slice(0, 2), AT);
    recorder.record('rx', bytes.slice(2), AT);
    expect(sink.lines[2]).toContain('中');
  });

  it('sink 关闭失败会抛回给调用方', async () => {
    const sink = fakeSink();
    sink.close = () => Promise.reject(new Error('disk full'));
    recorder.start(sink, 'a.log', 'text', AT);
    await expect(recorder.stop()).rejects.toThrow('disk full');
    // 即便冲盘失败，录制状态也已经落回空闲 —— 按钮不该卡在「录制中」
    expect(recorder.active).toBe(false);
  });

  it('起始时刻由调用方给，不读系统时钟', () => {
    const now = vi.spyOn(Date, 'now');
    recorder.start(fakeSink(), 'a.log', 'text', AT);
    expect(now).not.toHaveBeenCalled();
    now.mockRestore();
  });
});
