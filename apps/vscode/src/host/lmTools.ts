import * as vscode from 'vscode';
import { escapeControlChars } from '@/core/codec/display';
import { formatHex, tryParseHex } from '@/core/codec/hex';
import { decodeUtf8, encodeUtf8, isLosslessUtf8 } from '@/core/codec/text';
import type { SendFailure } from '@/core/session/notices';
import type { SessionState } from '@/core/session/serialSession';
import type { PortDescriptor } from '@/core/transport/portDescriptor';
import type { FramePayload } from '../shared/protocol';
import { hostText } from './hostText';

/**
 * 给 AI 聊天（agent 模式、`#` 引用）用的工具，走 Language Model Tool API。
 *
 * 值得做的理由：宿主里本来就攒着一份结构化的帧（方向、时间戳、原始字节），agent 帮人
 * 调设备时可以自己读输出、发命令，不必让人在聊天和面板之间来回复制。
 *
 * 刻意**不提供打开 / 关闭端口**：打开串口可能让开发板复位（不少板子的自动复位电路接在
 * DTR 上），这种副作用留给人在面板上决定。发送只作用于已经打开的口，并定制了确认框，
 * 让人看清要往哪个口发哪些字节。
 *
 * 写给模型的文字一律英文。出错时直接抛带说明的 Error，模型据此改参数重试
 * （https://code.visualstudio.com/api/extension-guides/ai/tools）。
 */

/** 与 package.json 的 contributes.languageModelTools 一一对应，由 manifest.test.ts 钉住。 */
export const LM_TOOL_NAMES = {
  listPorts: 'list_serial_ports',
  readOutput: 'get_serial_output',
  send: 'send_serial_data',
} as const;

export interface LmSession {
  readonly portKey: string | null;
  readonly state: SessionState;
  readonly frameCount: number;
  recentFrames: (count: number) => readonly FramePayload[];
  send: (bytes: Uint8Array) => Promise<SendFailure | null>;
}

export interface LmToolDeps {
  listPorts: () => Promise<readonly PortDescriptor[]>;
  sessions: () => Iterable<LmSession>;
  /** 扩展跑在远端时的远端名；枚举到的是那台机器的串口，模型得知道。 */
  remote: string | undefined;
}

const DEFAULT_FRAMES = 50;
/** 一次交给模型的帧数上限。再多就是在烧上下文，该让模型缩小范围再问。 */
const MAX_FRAMES = 1000;
/** 确认框里预览的字节数。太长的报文人也看不过来，总数另外写明。 */
const PREVIEW_BYTES = 64;
const PREVIEW_CHARS = 200;

type SelectedSession = LmSession & { readonly portKey: string };

/** 同一个口可能被几个面板选中（只有一个能真的开着），优先开着的那个。 */
function panelFor(sessions: readonly LmSession[], portKey: string): SelectedSession | undefined {
  const matches = sessions.filter((s): s is SelectedSession => s.portKey === portKey);
  return matches.find((s) => s.state !== 'closed') ?? matches[0];
}

/** 没给端口时，只有「恰好一个口被面板选中」才替模型做主。 */
function resolveSession(sessions: Iterable<LmSession>, port: string | undefined): SelectedSession {
  const all = [...sessions];
  const keys = [...new Set(all.flatMap((s) => (s.portKey === null ? [] : [s.portKey])))];
  if (keys.length === 0) {
    throw new Error(
      'No Serial Tool panel has a port selected. Ask the user to open a port in a Serial Tool panel first.',
    );
  }

  const target = port ?? (keys.length === 1 ? keys[0] : undefined);
  if (target === undefined) {
    throw new Error(
      `Several Serial Tool panels have ports selected (${keys.join(', ')}). Call again with "port" set to one of them.`,
    );
  }

  const session = panelFor(all, target);
  if (!session) {
    throw new Error(
      `No Serial Tool panel is using port "${target}". Ports selected in panels: ${keys.join(', ')}.`,
    );
  }
  return session;
}

function field(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null
    ? (input as Record<string, unknown>)[key]
    : undefined;
}

// 模型给的参数不可信：VS Code 不保证按 inputSchema 校验过，类型参数只是个声明
function optionalString(input: unknown, key: string): string | undefined {
  const value = field(input, key);
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`"${key}" must be a string.`);
  return value;
}

function optionalChoice<T extends string>(
  input: unknown,
  key: string,
  choices: readonly T[],
  fallback: T,
): T {
  const value = field(input, key);
  if (value === undefined) return fallback;
  const choice = choices.find((item) => item === value);
  if (choice === undefined) throw new Error(`"${key}" must be one of: ${choices.join(', ')}.`);
  return choice;
}

function frameCountOf(input: unknown): number {
  const value = field(input, 'maxFrames');
  if (value === undefined) return DEFAULT_FRAMES;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('"maxFrames" must be a positive integer.');
  }
  return Math.min(value, MAX_FRAMES);
}

const ENCODINGS = ['text', 'hex'] as const;
type Encoding = (typeof ENCODINGS)[number];

function formatFrame(frame: FramePayload, format: Encoding): string {
  let body: string;
  if (format === 'hex') body = formatHex(frame.bytes);
  else if (isLosslessUtf8(frame.bytes)) body = escapeControlChars(decodeUtf8(frame.bytes));
  // 解不成文本的帧硬转会得到一串替换字符，模型什么也看不出来
  else body = `[hex] ${formatHex(frame.bytes)}`;
  return `${new Date(frame.at).toISOString()} ${frame.direction.toUpperCase()} ${body}`;
}

interface SendRequest {
  port: string | undefined;
  bytes: Uint8Array;
  encoding: Encoding;
  data: string;
}

function parseSend(input: unknown): SendRequest {
  const data = field(input, 'data');
  if (typeof data !== 'string' || data.length === 0) {
    throw new Error('"data" must be a non-empty string.');
  }
  const encoding = optionalChoice(input, 'encoding', ENCODINGS, 'text');

  let bytes: Uint8Array;
  if (encoding === 'text') {
    bytes = encodeUtf8(data);
  } else {
    const parsed = tryParseHex(data);
    if (!parsed.ok) {
      const error = parsed.error;
      throw new Error(
        error.kind === 'invalid-char'
          ? `Invalid hex: "${error.char}" at position ${error.index + 1} is not a hex digit.`
          : `Invalid hex: "${error.token}" has an odd number of digits.`,
      );
    }
    bytes = parsed.bytes;
  }
  if (bytes.length === 0) throw new Error('"data" contains no bytes to send.');

  return { port: optionalString(input, 'port'), bytes, encoding, data };
}

function describeSendFailure(failure: SendFailure): string {
  switch (failure.code) {
    case 'not-open':
      return 'the port is no longer open.';
    case 'write-dropped-backpressure':
      return `the write queue is full (${failure.pendingBytes} bytes pending). Wait, then retry with less data.`;
    case 'write-error':
      return `the write failed: ${failure.message}.`;
  }
}

async function listPorts(deps: LmToolDeps): Promise<string> {
  const ports = await deps.listPorts();
  const sessions = [...deps.sessions()];
  const where = deps.remote === undefined ? 'this machine' : `the remote machine (${deps.remote})`;

  const lines =
    ports.length === 0
      ? [`No serial ports found on ${where}.`]
      : [
          `Serial ports on ${where} (key | label | identity | panel):`,
          ...ports.map((port) => {
            const panel = panelFor(sessions, port.key);
            const status = panel ? `selected in a panel, ${panel.state}` : 'not in any panel';
            return `- ${port.key} | ${port.label} | ${port.identity} | ${status}`;
          }),
        ];

  // 设备掉线后面板还留着它的历史输出，排查掉线原因时正需要读它
  const present = new Set(ports.map((port) => port.key));
  const absent = [
    ...new Set(
      sessions.flatMap((s) => (s.portKey === null || present.has(s.portKey) ? [] : [s.portKey])),
    ),
  ];
  if (absent.length > 0) {
    lines.push(
      `Panels also have these ports selected, which are not present right now (unplugged?); their captured output can still be read: ${absent.join(', ')}.`,
    );
  }
  return lines.join('\n');
}

function readOutput(deps: LmToolDeps, input: unknown): string {
  const session = resolveSession(deps.sessions(), optionalString(input, 'port'));
  const count = frameCountOf(input);
  const format = optionalChoice(input, 'format', ENCODINGS, 'text');

  const header = `${session.portKey} (${session.state}).`;
  const frames = session.recentFrames(count);
  if (frames.length === 0) return `${header} No frames captured yet.`;
  return [
    `${header} Last ${frames.length} of ${session.frameCount} captured frames, oldest first (time, direction, data):`,
    ...frames.map((frame) => formatFrame(frame, format)),
  ].join('\n');
}

async function send(deps: LmToolDeps, input: unknown): Promise<string> {
  const request = parseSend(input);
  const session = resolveSession(deps.sessions(), request.port);
  if (session.state !== 'open') {
    throw new Error(
      `${session.portKey} is not open (${session.state}). This tool cannot open ports; ask the user to open it in the Serial Tool panel.`,
    );
  }

  const failure = await session.send(request.bytes);
  if (failure) {
    throw new Error(`Nothing was sent to ${session.portKey}: ${describeSendFailure(failure)}`);
  }
  return `Sent ${request.bytes.length} bytes to ${session.portKey}. Use ${LM_TOOL_NAMES.readOutput} to read the response.`;
}

function prepareSend(deps: LmToolDeps, input: unknown): vscode.PreparedToolInvocation {
  const t = hostText();
  let request: SendRequest;
  let port: string;
  try {
    request = parseSend(input);
    port = resolveSession(deps.sessions(), request.port).portKey;
  } catch {
    // 输入有问题就不定制确认框：invoke 会原样抛出同一个错误交给模型，什么也不会发出去
    return { invocationMessage: t.lmSending('?') };
  }

  const preview = request.bytes.subarray(0, PREVIEW_BYTES);
  const message = new vscode.MarkdownString()
    .appendMarkdown(t.lmSendMessage(port, request.bytes.length))
    .appendCodeblock(
      formatHex(preview) + (request.bytes.length > PREVIEW_BYTES ? ' ...' : ''),
      'text',
    );
  // HEX 是精确的，但人读不出 "AT+RST" 这类命令，文本模式再附一份可读的
  if (request.encoding === 'text') {
    const text = escapeControlChars(request.data);
    message.appendCodeblock(
      text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)} ...` : text,
      'text',
    );
  }

  return {
    invocationMessage: t.lmSending(port),
    confirmationMessages: { title: t.lmSendTitle, message },
  };
}

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

export function createLmTools(deps: LmToolDeps): Record<string, vscode.LanguageModelTool<unknown>> {
  return {
    [LM_TOOL_NAMES.listPorts]: {
      prepareInvocation: () => ({ invocationMessage: hostText().lmListingPorts }),
      invoke: async () => textResult(await listPorts(deps)),
    },
    [LM_TOOL_NAMES.readOutput]: {
      prepareInvocation: () => ({ invocationMessage: hostText().lmReadingOutput }),
      invoke: ({ input }) => textResult(readOutput(deps, input)),
    },
    [LM_TOOL_NAMES.send]: {
      prepareInvocation: ({ input }) => prepareSend(deps, input),
      invoke: async ({ input }) => textResult(await send(deps, input)),
    },
  };
}
