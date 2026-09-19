import { BufferedSink } from '@/core/log/bufferedSink';

/**
 * 浏览器侧的落盘出口：File System Access API。
 *
 * 用它而不是「攒在内存里，停止时一次性下载」，正是因为录制要服务的场景是
 * 挂一夜等偶发异常 —— 攒在内存里的话，容量问题原封不动地搬了个家。
 *
 * **类型是自己声明的**：`showSaveFilePicker` 至今不在 lib.dom 里（只有 Chromium
 * 实现了它），照 any 用会被 ESLint 的 no-unsafe-* 挡下，也确实不该那样用。
 */

interface WritableFileStream {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

interface SaveFileHandle {
  readonly name: string;
  createWritable: () => Promise<WritableFileStream>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>;

function picker(): SaveFilePicker | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof candidate === 'function' ? (candidate as SaveFilePicker) : null;
}

/**
 * 当前环境能不能把录制直接写进文件。
 *
 * Web Serial 与 File System Access 都只有 Chromium 实现，实际上是同进同出；
 * 但 VS Code 的 webview 里前者要靠宿主、后者根本没有，所以这条判断仍然必要。
 */
export function isFileRecordingSupported(): boolean {
  return picker() !== null;
}

export interface OpenedFileSink {
  sink: BufferedSink;
  /** 用户最终选定的文件名，回执给日志用。 */
  name: string;
}

/**
 * 让用户挑一个文件并打开写入流。用户取消时返回 null。
 *
 * **必须由用户手势直接调用**（按钮的 click 处理器里），否则浏览器会拒绝弹选择器。
 */
export async function openFileSink(
  suggestedName: string,
  onError: (message: string) => void,
): Promise<OpenedFileSink | null> {
  const showSaveFilePicker = picker();
  if (!showSaveFilePicker) return null;

  let handle: SaveFileHandle;
  try {
    handle = await showSaveFilePicker({
      suggestedName,
      types: [{ description: 'Log file', accept: { 'text/plain': ['.log', '.txt'] } }],
    });
  } catch (error) {
    // 用户按了取消 —— 这是正常操作，不是错误，不该在日志里留下任何东西
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    onError(error instanceof Error ? error.message : String(error));
    return null;
  }

  const writable = await handle.createWritable();
  const sink = new BufferedSink(
    {
      write: (chunk) => writable.write(chunk),
      close: () => writable.close(),
    },
    onError,
  );
  return { sink, name: handle.name };
}
