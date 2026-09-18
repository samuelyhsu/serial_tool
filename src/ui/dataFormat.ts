/**
 * 数据格式标签。
 *
 * TXT / HEX 是格式标识符，不是可翻译文案 —— 就像 UTF-8、JSON、CRC16 一样，
 * 中英文界面下都显示同一个词。因此它们不放进 i18n 目录：放进去只会让某天
 * 有人把 TXT 翻回「文本」，界面上就又出现两套叫法了。
 */
export const FORMAT_LABEL = {
  text: 'TXT',
  hex: 'HEX',
} as const;

export type DataFormat = keyof typeof FORMAT_LABEL;

/**
 * 结束符标签。与 TXT / HEX 同理：`\r\n` 是转义写法而不是可翻译文案。
 * 单条发送与每条预设共用，两处显示同一个词。
 */
export const EOL_LABEL = {
  none: '—',
  crlf: '\\r\\n',
  lf: '\\n',
  cr: '\\r',
} as const;

/**
 * 校验和在窄处的短名：`CRC-16/IBM-3740 (CCITT-FALSE)` → `IBM-3740`。
 * 预设行的帧尾徽标只有几十像素，全名靠 title 给。
 */
export function shortChecksumLabel(label: string): string {
  return (label.split('/')[1] ?? label).split(' ')[0] ?? label;
}
