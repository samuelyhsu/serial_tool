import { describe, expect, it } from 'vitest';
import { formatEscaped, parseEscaped } from './escape';
import { encodeUtf8 } from './text';

function bytesOf(input: string): Uint8Array {
  const result = parseEscaped(input);
  if (!result.ok) throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
  return result.bytes;
}

/**
 * 按值比较。TextEncoder 交回来的 Uint8Array 与 Uint8Array.from 造的底层 buffer 不同，
 * toEqual 会卡在那上面，报「值看起来一样但不相等」。
 */
function expectBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect([...actual]).toEqual([...expected]);
}

describe('parseEscaped', () => {
  it('没有反斜杠时就是普通的 UTF-8 编码', () => {
    expectBytes(bytesOf('AT+VER?'), encodeUtf8('AT+VER?'));
    expectBytes(bytesOf('温度'), encodeUtf8('温度'));
  });

  it('认识常用的单字符转义', () => {
    expect(bytesOf('\\r\\n')).toEqual(Uint8Array.of(0x0d, 0x0a));
    expect(bytesOf('\\t\\0\\a\\b\\v\\f\\e')).toEqual(
      Uint8Array.of(0x09, 0x00, 0x07, 0x08, 0x0b, 0x0c, 0x1b),
    );
  });

  it('两个反斜杠是反斜杠本身', () => {
    expectBytes(bytesOf('C:\\\\temp'), encodeUtf8('C:\\temp'));
  });

  /** AT 指令最常见的写法，也是这套转义存在的全部理由。 */
  it('控制字符可以夹在报文中间，不止能放末尾', () => {
    expectBytes(bytesOf('AT+CIPSEND\\r\\n>data'), encodeUtf8('AT+CIPSEND\r\n>data'));
  });

  /** \xHH 插入的是字节：\xFF 就是 0xFF，不是 U+00FF 的 UTF-8 编码 C3 BF。 */
  it('\\xHH 插入的是字节而不是字符', () => {
    expect(bytesOf('\\xFF')).toEqual(Uint8Array.of(0xff));
    expect(bytesOf('\\x00\\x7F')).toEqual(Uint8Array.of(0x00, 0x7f));
    expect(bytesOf('\\xff')).toEqual(Uint8Array.of(0xff));
  });

  it('多字节字符与 \\xHH 可以混在一起', () => {
    expectBytes(
      bytesOf('温\\xFF度'),
      Uint8Array.of(...encodeUtf8('温'), 0xff, ...encodeUtf8('度')),
    );
  });

  /**
   * 不认识的转义一律报错。放过去的话 `\q` 会静默变成反斜杠加 q 两个字节，
   * 用户以为写的是某个控制字符，设备收到的却是别的东西。
   */
  it('不认识的转义报错，并指出是哪一个', () => {
    expect(parseEscaped('AT\\q')).toEqual({
      ok: false,
      error: { kind: 'unknown-escape', char: 'q', index: 2 },
    });
  });

  it('\\x 后面不是两位十六进制就报错', () => {
    expect(parseEscaped('\\xZZ')).toMatchObject({ ok: false, error: { kind: 'bad-hex-escape' } });
    expect(parseEscaped('\\xF')).toMatchObject({ ok: false, error: { kind: 'bad-hex-escape' } });
  });

  it('末尾落单的反斜杠报错', () => {
    expect(parseEscaped('AT\\')).toEqual({
      ok: false,
      error: { kind: 'dangling-backslash', index: 2 },
    });
  });

  it('空串是零字节', () => {
    expect(bytesOf('')).toEqual(new Uint8Array(0));
  });
});

describe('formatEscaped', () => {
  it('可打印的 ASCII 原样写出来', () => {
    expect(formatEscaped(encodeUtf8('AT+VER?'))).toBe('AT+VER?');
  });

  it('中文不会被拆成一串 \\xHH', () => {
    expect(formatEscaped(encodeUtf8('温度 25'))).toBe('温度 25');
  });

  it('控制字符优先写成短转义', () => {
    expect(formatEscaped(Uint8Array.of(0x0d, 0x0a, 0x09))).toBe('\\r\\n\\t');
  });

  it('没有短写法的不可打印字节写成 \\xHH', () => {
    expect(formatEscaped(Uint8Array.of(0x01, 0x1f, 0x7f))).toBe('\\x01\\x1F\\x7F');
  });

  it('反斜杠写成两个，否则读回来就不是原来那个字节了', () => {
    expect(formatEscaped(encodeUtf8('C:\\temp'))).toBe('C:\\\\temp');
  });

  /**
   * 这条是 HEX → TXT 模式切换的全部依据：**任何**字节都得写得回去、再解析回同一串。
   * 在有转义之前，这种报文只能拒绝切换。
   */
  it('不是合法 UTF-8 的字节序列照样无损', () => {
    const modbus = Uint8Array.of(0x01, 0x03, 0x00, 0x00, 0x00, 0x02, 0xc4, 0x0b);

    const text = formatEscaped(modbus);

    expect(text).toBe('\\x01\\x03\\x00\\x00\\x00\\x02\\xC4\\x0B');
    expect(bytesOf(text)).toEqual(modbus);
  });

  it('任取一段字节都能往返', () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(bytesOf(formatEscaped(all))).toEqual(all);
  });

  it('空字节数组是空串', () => {
    expect(formatEscaped(new Uint8Array(0))).toBe('');
  });
});
