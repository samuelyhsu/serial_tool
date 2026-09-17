import { describe, expect, it } from 'vitest';
import type {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelToolResult,
  MarkdownString,
} from 'vscode';
import type { SendFailure } from '@/core/session/notices';
import type { SessionState } from '@/core/session/serialSession';
import type { PortDescriptor } from '@/core/transport/portDescriptor';
import type { FramePayload } from '../shared/protocol';
import { hostText } from './hostText';
import { createLmTools, LM_TOOL_NAMES, type LmSession } from './lmTools';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

class FakeSession implements LmSession {
  readonly sent: Uint8Array[] = [];
  failure: SendFailure | null = null;

  constructor(
    readonly portKey: string | null,
    readonly state: SessionState,
    readonly frames: FramePayload[] = [],
  ) {}

  get frameCount(): number {
    return this.frames.length;
  }

  recentFrames(count: number): FramePayload[] {
    return this.frames.slice(-count);
  }

  send(bytes: Uint8Array): Promise<SendFailure | null> {
    if (!this.failure) this.sent.push(bytes);
    return Promise.resolve(this.failure);
  }
}

function port(key: string): PortDescriptor {
  return {
    key,
    label: `${key} - CH340 (1A86:7523)`,
    identity: `usb:1A86:7523:${key}`,
    ordinal: 0,
    chip: 'CH340',
    vendor: null,
    connected: true,
  };
}

function setup(sessions: FakeSession[], ports: PortDescriptor[] = [], remote?: string) {
  const tools = createLmTools({
    listPorts: () => Promise.resolve(ports),
    sessions: () => sessions,
    remote,
  });
  const token = {} as CancellationToken;

  return {
    invoke: async (name: string, input: unknown = {}): Promise<string> => {
      const result = (await tools[name]!.invoke(
        { input, toolInvocationToken: undefined },
        token,
      )) as LanguageModelToolResult;
      return (result.content[0] as LanguageModelTextPart).value;
    },
    prepare: async (name: string, input: unknown = {}) =>
      await tools[name]!.prepareInvocation!({ input }, token),
  };
}

const { listPorts, readOutput, send } = LM_TOOL_NAMES;

describe(listPorts, () => {
  it('列出端口，并标出哪些在面板里、状态如何', async () => {
    const { invoke } = setup([new FakeSession('COM3', 'open')], [port('COM3'), port('COM4')]);
    const text = await invoke(listPorts);

    expect(text).toContain('this machine');
    expect(text).toContain(
      '- COM3 | COM3 - CH340 (1A86:7523) | usb:1A86:7523:COM3 | selected in a panel, open',
    );
    expect(text).toContain(
      '- COM4 | COM4 - CH340 (1A86:7523) | usb:1A86:7523:COM4 | not in any panel',
    );
  });

  it('扩展跑在远端时说明这些是远端的口', async () => {
    const { invoke } = setup([], [], 'ssh-remote');
    expect(await invoke(listPorts)).toContain(
      'No serial ports found on the remote machine (ssh-remote)',
    );
  });

  it('面板选着、但设备已经不在的口也列出来，它的历史输出还读得到', async () => {
    const { invoke } = setup([new FakeSession('COM9', 'reconnecting')], [port('COM3')]);
    const text = await invoke(listPorts);

    expect(text).toContain('not present');
    expect(text).toContain('COM9');
  });
});

describe(readOutput, () => {
  it('只有一个面板时不必指定端口；按时间顺序，带方向，控制字符转义可见', async () => {
    const session = new FakeSession('COM3', 'open', [
      { direction: 'tx', at: 0, bytes: utf8('AT\r\n') },
      { direction: 'rx', at: 1000, bytes: utf8('OK\r\n') },
    ]);
    const text = await setup([session]).invoke(readOutput);

    expect(text.split('\n')).toEqual([
      'COM3 (open). Last 2 of 2 captured frames, oldest first (time, direction, data):',
      '1970-01-01T00:00:00.000Z TX AT\\r\\n',
      '1970-01-01T00:00:01.000Z RX OK\\r\\n',
    ]);
  });

  it('解不成文本的帧退回 HEX；要 HEX 时全部给 HEX', async () => {
    const session = new FakeSession('COM3', 'open', [
      { direction: 'rx', at: 0, bytes: new Uint8Array([0xff, 0x00]) },
      { direction: 'rx', at: 0, bytes: utf8('AT') },
    ]);
    const { invoke } = setup([session]);

    const text = await invoke(readOutput);
    expect(text).toContain('RX [hex] FF 00');
    expect(text).toContain('RX AT');
    expect(await invoke(readOutput, { format: 'hex' })).toContain('RX 41 54');
  });

  it('maxFrames 只取最近的几帧', async () => {
    const frames = [1, 2, 3, 4, 5].map((n) => ({
      direction: 'rx' as const,
      at: 0,
      bytes: utf8(`#${n}`),
    }));
    const text = await setup([new FakeSession('COM3', 'open', frames)]).invoke(readOutput, {
      maxFrames: 2,
    });

    expect(text).toContain('Last 2 of 5');
    expect(text).toContain('#4');
    expect(text).toContain('#5');
    expect(text).not.toContain('#3');
  });

  it('多个面板时必须指定端口，报错里列出可选的口', async () => {
    const { invoke } = setup([new FakeSession('COM3', 'open'), new FakeSession('COM4', 'open')]);

    await expect(invoke(readOutput)).rejects.toThrow('(COM3, COM4). Call again with "port"');
    expect(await invoke(readOutput, { port: 'COM4' })).toContain('COM4 (open)');
  });

  it('同一个口被几个面板选中时，读开着的那个', async () => {
    const { invoke } = setup([new FakeSession('COM3', 'closed'), new FakeSession('COM3', 'open')]);
    expect(await invoke(readOutput)).toContain('COM3 (open)');
  });

  it('没有可读的面板或参数不对时，抛出模型看得懂的错误', async () => {
    await expect(setup([]).invoke(readOutput)).rejects.toThrow(
      'No Serial Tool panel has a port selected',
    );

    const { invoke } = setup([new FakeSession('COM3', 'open'), new FakeSession(null, 'closed')]);
    await expect(invoke(readOutput, { port: 'COM9' })).rejects.toThrow(
      'No Serial Tool panel is using port "COM9". Ports selected in panels: COM3.',
    );
    await expect(invoke(readOutput, { maxFrames: 0 })).rejects.toThrow('"maxFrames"');
    await expect(invoke(readOutput, { format: 'bin' })).rejects.toThrow('"format" must be one of');
    await expect(invoke(readOutput, { port: 3 })).rejects.toThrow('"port" must be a string');
  });
});

describe(send, () => {
  it('文本按 UTF-8 原样发出，不替模型补换行', async () => {
    const session = new FakeSession('COM3', 'open');
    const text = await setup([session]).invoke(send, { data: 'AT\r\n' });

    expect(session.sent).toEqual([utf8('AT\r\n')]);
    expect(text).toBe(`Sent 4 bytes to COM3. Use ${readOutput} to read the response.`);
  });

  it('HEX 按字节发出', async () => {
    const session = new FakeSession('COM3', 'open');
    await setup([session]).invoke(send, { data: 'AA 55 01', encoding: 'hex' });
    expect(session.sent).toEqual([new Uint8Array([0xaa, 0x55, 0x01])]);
  });

  it('端口没打开时拒绝，一个字节也不发 —— 这个工具不负责打开端口', async () => {
    const session = new FakeSession('COM3', 'closed');
    await expect(setup([session]).invoke(send, { data: 'AT' })).rejects.toThrow(
      'COM3 is not open (closed). This tool cannot open ports',
    );
    expect(session.sent).toEqual([]);
  });

  it('输入不合法时报错且不发', async () => {
    const session = new FakeSession('COM3', 'open');
    const { invoke } = setup([session]);

    await expect(invoke(send, { data: 'AABBC', encoding: 'hex' })).rejects.toThrow(
      'odd number of digits',
    );
    await expect(invoke(send, { data: 'ZZ', encoding: 'hex' })).rejects.toThrow(
      '"Z" at position 1',
    );
    await expect(invoke(send, { data: '   ', encoding: 'hex' })).rejects.toThrow(
      'no bytes to send',
    );
    await expect(invoke(send, { data: '' })).rejects.toThrow('"data" must be a non-empty string');
    expect(session.sent).toEqual([]);
  });

  /** 发送失败在会话层只是一条通知；不接住返回值的话，这里会对模型说「已发送」。 */
  it('底层没写出去时如实报错', async () => {
    const session = new FakeSession('COM3', 'open');
    session.failure = { code: 'write-dropped-backpressure', pendingBytes: 4096 };

    await expect(setup([session]).invoke(send, { data: 'AT' })).rejects.toThrow(
      'Nothing was sent to COM3: the write queue is full (4096 bytes pending)',
    );
  });

  it('确认框写明端口、字节数与 HEX；文本模式再附一份可读文本', async () => {
    const prepared = await setup([new FakeSession('COM3', 'open')]).prepare(send, {
      data: 'AT\r\n',
    });
    const message = prepared!.confirmationMessages!.message as MarkdownString;

    expect(prepared!.confirmationMessages!.title).toBe(hostText().lmSendTitle);
    expect(message.value).toContain(hostText().lmSendMessage('COM3', 4));
    expect(message.value).toContain('41 54 0D 0A');
    expect(message.value).toContain('AT\\r\\n');
  });

  it('超长报文的预览截断，字节总数照实写', async () => {
    const prepared = await setup([new FakeSession('COM3', 'open')]).prepare(send, {
      data: '00 '.repeat(100),
      encoding: 'hex',
    });
    const message = prepared!.confirmationMessages!.message as MarkdownString;

    expect(message.value).toContain(hostText().lmSendMessage('COM3', 100));
    expect(message.value).toContain('00 ...');
  });

  it('输入有问题时不定制确认框，留给 invoke 报错', async () => {
    const { prepare } = setup([new FakeSession('COM3', 'open')]);
    expect(
      (await prepare(send, { data: 'ZZ', encoding: 'hex' }))!.confirmationMessages,
    ).toBeUndefined();
    expect((await setup([]).prepare(send, { data: 'AT' }))!.confirmationMessages).toBeUndefined();
  });
});

it('写给模型的文字是纯 ASCII', async () => {
  const session = new FakeSession('COM3', 'open', [
    { direction: 'rx', at: 0, bytes: new Uint8Array([0x01, 0xff]) },
  ]);
  const { invoke } = setup([session, new FakeSession('COM4', 'closed')], [port('COM3')]);

  const outputs = [
    await invoke(listPorts),
    await invoke(readOutput, { port: 'COM3' }),
    await invoke(send, { port: 'COM3', data: 'AT' }),
    await invoke(readOutput).catch((error: Error) => error.message),
    await invoke(send, { port: 'COM4', data: 'AT' }).catch((error: Error) => error.message),
  ];
  for (const output of outputs) expect(output).toMatch(/^[\n\x20-\x7e]+$/);
});
