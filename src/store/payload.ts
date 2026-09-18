import { checksumBytes, findChecksum, type ChecksumId } from '@/core/checksum';
import { formatEscaped, parseEscaped, type EscapeError } from '@/core/codec/escape';
import { formatHex, tryParseHex, type HexParseError } from '@/core/codec/hex';

export type PayloadMode = 'text' | 'hex';

/**
 * 报文解析失败的原因。两种模式各有各的解析器，错误也就各有各的形状，
 * 用 source 分辨 —— 翻译时要说的话完全不同（「第 3 个字符不是十六进制数字」
 * 对着一段 TXT 报文毫无意义）。
 */
export type PayloadError =
  | { source: 'hex'; error: HexParseError }
  | { source: 'escape'; error: EscapeError };

export type BytesResult = { ok: true; bytes: Uint8Array } | { ok: false; error: PayloadError };

export type ConvertResult = { ok: true; data: string } | { ok: false; error: PayloadError };

/**
 * 报文文本 → 字节。
 *
 * TXT 不是「原样 UTF-8 编码」而是**带转义**的（见 codec/escape.ts）：
 * 串口上要发的东西常常带控制字符，而输入框里打不出来。
 */
export function payloadToBytes(data: string, mode: PayloadMode): BytesResult {
  if (mode === 'hex') {
    const parsed = tryParseHex(data);
    return parsed.ok ? parsed : { ok: false, error: { source: 'hex', error: parsed.error } };
  }
  const parsed = parseEscaped(data);
  return parsed.ok ? parsed : { ok: false, error: { source: 'escape', error: parsed.error } };
}

/**
 * 在文本与 HEX 之间转换发送内容 —— 缺陷 D3 的修复。
 *
 * 原型的转换是单向且有损的：`onTxHex` 把文本转成 HEX，`onTxAscii` 却什么都不做；
 * 预设的模式切换用 `asciiStr(toBytes(data, true))`，把每个不可打印字节变成 "."，
 * 再切回去数据就永久没了（.dc.html:803、839）。
 *
 * 现在两个方向都无损，也就没有「拒绝切换」这回事了：任何字节都写得回 TXT ——
 * 控制字符写成 `\r` 这类，其余写成 `\xHH`。在有转义之前，HEX → TXT 遇到非 UTF-8
 * 只能拒绝，用户得自己想办法。唯一还会失败的是**当前内容本身就解析不通过**。
 */
export function convertPayload(data: string, from: PayloadMode, to: PayloadMode): ConvertResult {
  if (from === to) return { ok: true, data };

  const parsed = payloadToBytes(data, from);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    data: to === 'hex' ? formatHex(parsed.bytes) : formatEscaped(parsed.bytes),
  };
}

export const EOL_SEQUENCES = {
  none: '',
  crlf: '\r\n',
  lf: '\n',
  cr: '\r',
} as const;

export type EolKey = keyof typeof EOL_SEQUENCES;
export const EOL_KEYS = Object.keys(EOL_SEQUENCES) as EolKey[];

/**
 * 组装最终要写出去的字节。
 *
 * 两种模式各有自己的「帧尾」，互斥：
 *  - TXT：追加结束符（CR/LF 之类），在编码之前拼进字符串；
 *  - HEX：追加校验和，按所选算法对**载荷字节**计算，再按该算法的约定字节序展开。
 *
 * 两者默认都是「无」—— 工具不该在用户没要求时擅自往报文里塞字节。
 */
export function buildFrame(
  data: string,
  mode: PayloadMode,
  eol: EolKey = 'none',
  checksum: ChecksumId = 'none',
): BytesResult {
  if (mode === 'text') return payloadToBytes(data + EOL_SEQUENCES[eol], 'text');

  const payload = payloadToBytes(data, 'hex');
  if (!payload.ok) return payload;

  const algorithm = findChecksum(checksum);
  if (!algorithm) return payload;

  const suffix = checksumBytes(payload.bytes, algorithm);
  const merged = new Uint8Array(payload.bytes.length + suffix.length);
  merged.set(payload.bytes, 0);
  merged.set(suffix, payload.bytes.length);
  return { ok: true, bytes: merged };
}
