/**
 * TXT 报文里的转义序列。
 *
 * 串口上真正要发的东西常常带控制字符 —— AT 指令的 CR LF、协议帧的 STX / ETX ——
 * 而输入框里打不出这些字节。让用户像写 C 字符串那样写 `AT+VER?\r\n`，比在旁边
 * 挂一个「结束符」下拉框表达力强得多：下拉框只能往末尾追加，而分隔符经常在中间
 * （`AT+CIPSEND=4\r\n>data`），多条预设更是一条一个样。
 *
 * `\xHH` 插入的是**字节**而不是字符：`\xFF` 就是 0xFF 一个字节，不是 U+00FF 的
 * UTF-8 编码（0xC3 0xBF）。普通文本仍按 UTF-8 编码，两者在同一个字节流里拼接。
 */

import { encodeUtf8, tryDecodeUtf8 } from './text';

/** 单字符转义。`e` 是 ESC，C 里没有但串口场景很常用。 */
const BYTE_OF: Readonly<Record<string, number>> = {
  '0': 0x00,
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  e: 0x1b,
  '\\': 0x5c,
};

const NAME_OF = new Map<number, string>(
  Object.entries(BYTE_OF).map(([name, byte]) => [byte, name]),
);

export type EscapeError =
  /** index 一律指向那个反斜杠，界面按它定位。 */
  | { kind: 'unknown-escape'; char: string; index: number }
  | { kind: 'bad-hex-escape'; index: number }
  | { kind: 'dangling-backslash'; index: number };

export type EscapeResult = { ok: true; bytes: Uint8Array } | { ok: false; error: EscapeError };

/**
 * 解析成字节。不认识的转义一律报错，**不**原样放过去。
 *
 * 放过去的话，`\q` 会静默变成反斜杠加 q 两个字节发出去 —— 用户以为自己写的是
 * 某个控制字符，设备收到的却是别的东西，而界面上没有任何迹象。
 */
export function parseEscaped(input: string): EscapeResult {
  const out: number[] = [];
  // 普通文本攒着一起编码：逐字符调 TextEncoder 会把多字节字符切碎
  let plain = '';
  const flush = (): void => {
    if (plain === '') return;
    for (const byte of encodeUtf8(plain)) out.push(byte);
    plain = '';
  };

  let i = 0;
  while (i < input.length) {
    const char = input[i]!;
    if (char !== '\\') {
      plain += char;
      i += 1;
      continue;
    }

    flush();
    const next = input[i + 1];
    if (next === undefined) {
      return { ok: false, error: { kind: 'dangling-backslash', index: i } };
    }

    if (next === 'x' || next === 'X') {
      const digits = input.slice(i + 2, i + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(digits)) {
        return { ok: false, error: { kind: 'bad-hex-escape', index: i } };
      }
      out.push(Number.parseInt(digits, 16));
      i += 4;
      continue;
    }

    const byte = BYTE_OF[next];
    if (byte === undefined) {
      return { ok: false, error: { kind: 'unknown-escape', char: next, index: i } };
    }
    out.push(byte);
    i += 2;
  }

  flush();
  return { ok: true, bytes: Uint8Array.from(out) };
}

/**
 * 反过来：字节写成带转义的文本。
 *
 * 这条路必须**永远无损**，因为 HEX → TXT 的模式切换靠它 —— 任何一个字节都得能
 * 写回去、再解析回同样的字节。所以整段不是合法 UTF-8 时退化成逐字节的 `\xHH`，
 * 而不是像以前那样拒绝切换。
 */
export function formatEscaped(bytes: Uint8Array): string {
  const text = tryDecodeUtf8(bytes);
  if (text === null) return [...bytes].map(hexEscape).join('');

  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const name = NAME_OF.get(code);
    if (name !== undefined) out += `\\${name}`;
    else if (code < 0x20 || code === 0x7f) out += hexEscape(code);
    else out += char;
  }
  return out;
}

function hexEscape(byte: number): string {
  return `\\x${byte.toString(16).toUpperCase().padStart(2, '0')}`;
}
