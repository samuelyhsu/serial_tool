import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFileRecordingSupported, openFileSink } from './fileSink';

interface FakeWritable {
  chunks: string[];
  closed: boolean;
}

/** `rejectWith` 有值时模拟选择器失败（用户取消也是一种失败）。 */
function installPicker(rejectWith?: Error): FakeWritable {
  const writable: FakeWritable = { chunks: [], closed: false };
  vi.stubGlobal(
    'showSaveFilePicker',
    vi.fn(() => {
      if (rejectWith !== undefined) return Promise.reject(rejectWith);
      return Promise.resolve({
        name: 'picked.log',
        createWritable: () =>
          Promise.resolve({
            write: (data: string) => {
              writable.chunks.push(data);
              return Promise.resolve();
            },
            close: () => {
              writable.closed = true;
              return Promise.resolve();
            },
          }),
      });
    }),
  );
  return writable;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('浏览器侧的落盘出口', () => {
  it('没有 File System Access 时报不支持，并且不去弹任何东西', async () => {
    vi.stubGlobal('showSaveFilePicker', undefined);
    expect(isFileRecordingSupported()).toBe(false);
    await expect(openFileSink('a.log', () => undefined)).resolves.toBeNull();
  });

  it('有就报支持', () => {
    installPicker();
    expect(isFileRecordingSupported()).toBe(true);
  });

  it('选好文件后拿到可写的 sink，文件名回执用用户最终选的那个', async () => {
    const writable = installPicker();
    const opened = await openFileSink('suggested.log', () => undefined);
    expect(opened?.name).toBe('picked.log');

    opened!.sink.write('hello');
    await opened!.sink.close();
    expect(writable.chunks).toEqual(['hello\n']);
    expect(writable.closed).toBe(true);
  });

  // 按取消是一次明确的「算了」，不是错误，日志里不该留下任何东西
  it('用户取消时安静地返回 null', async () => {
    const onError = vi.fn();
    installPicker(new DOMException('The user aborted a request.', 'AbortError'));
    await expect(openFileSink('a.log', onError)).resolves.toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('其他失败要说一声', async () => {
    const onError = vi.fn();
    installPicker(new Error('no permission'));
    await expect(openFileSink('a.log', onError)).resolves.toBeNull();
    expect(onError).toHaveBeenCalledWith('no permission');
  });

  it('把建议文件名交给选择器', async () => {
    installPicker();
    await openFileSink('serial-20260919-123456.log', () => undefined);
    const picker = (globalThis as unknown as { showSaveFilePicker: ReturnType<typeof vi.fn> })
      .showSaveFilePicker;
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'serial-20260919-123456.log' }),
    );
  });
});
