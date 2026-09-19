/**
 * 日志过滤与高亮的匹配器。
 *
 * 两种模式：**子串**（大小写不敏感，一直是这样）和**正则**。抽成一个接口，
 * 是因为过滤与高亮要用同一份匹配结果 —— 分成两套写法迟早会出现
 * 「这一行被留下了，但一个字都没高亮」。
 */

export type MatcherKind = 'text' | 'regex';

/** 一处匹配在正文里的区间，`[start, end)`。 */
export interface Span {
  start: number;
  end: number;
}

export interface Matcher {
  /** 全部匹配区间，按出现顺序、互不重叠。 */
  find: (body: string) => Span[];
}

export type MatcherResult =
  /** `matcher` 为 null 表示过滤词是空的，不该过滤也不该高亮。 */
  { ok: true; matcher: Matcher | null } | { ok: false; error: string };

/**
 * 一行里最多标出多少处匹配。
 *
 * 每一处都是一个 DOM 节点。单帧上限 8 KB，一个 `.` 这样的正则能在一行里匹配上千次，
 * 照单全收就是几千个节点乘以渲染的一千行 —— 界面会直接卡死。超出的部分不再高亮，
 * 但这一行仍然算匹配（过滤结果不受影响）。
 */
export const MAX_SPANS_PER_ROW = 200;

export function createMatcher(pattern: string, kind: MatcherKind): MatcherResult {
  const needle = pattern.trim();
  if (needle.length === 0) return { ok: true, matcher: null };

  if (kind === 'text') {
    const lowered = needle.toLowerCase();
    return {
      ok: true,
      matcher: {
        find: (body) => findLiteral(body.toLowerCase(), lowered),
      },
    };
  }

  let regex: RegExp;
  try {
    // 与子串模式一样不区分大小写：同一个输入框里切换模式不该连带改变这条语义
    regex = new RegExp(needle, 'gi');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, matcher: { find: (body) => findRegex(regex, body) } };
}

function findLiteral(haystack: string, needle: string): Span[] {
  const spans: Span[] = [];
  let cursor = 0;
  for (;;) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) break;
    spans.push({ start: index, end: index + needle.length });
    cursor = index + needle.length;
    if (spans.length >= MAX_SPANS_PER_ROW) break;
  }
  return spans;
}

function findRegex(regex: RegExp, body: string): Span[] {
  const spans: Span[] = [];
  regex.lastIndex = 0;
  for (;;) {
    const match = regex.exec(body);
    if (match === null) break;
    if (match[0].length === 0) {
      // 零长匹配（`a*` 对着空位就是）不推进 lastIndex，exec 会在原地打转成死循环
      regex.lastIndex += 1;
      continue;
    }
    spans.push({ start: match.index, end: match.index + match[0].length });
    if (spans.length >= MAX_SPANS_PER_ROW) break;
  }
  return spans;
}
