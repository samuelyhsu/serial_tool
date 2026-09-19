import { describe, expect, it } from 'vitest';
import { createMatcher, MAX_SPANS_PER_ROW, type Span } from './matcher';

function spansOf(pattern: string, kind: 'text' | 'regex', body: string): Span[] {
  const result = createMatcher(pattern, kind);
  if (!result.ok) throw new Error(`unexpected failure: ${result.error}`);
  return result.matcher?.find(body) ?? [];
}

describe('子串匹配', () => {
  it('空过滤词不产生匹配器 —— 不过滤也不高亮', () => {
    const result = createMatcher('   ', 'text');
    expect(result).toEqual({ ok: true, matcher: null });
  });

  it('标出全部匹配，不只是第一处', () => {
    expect(spansOf('ab', 'text', 'ab-ab')).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
  });

  it('不区分大小写', () => {
    expect(spansOf('AT', 'text', 'at+ver')).toEqual([{ start: 0, end: 2 }]);
  });

  it('匹配区间互不重叠', () => {
    expect(spansOf('aa', 'text', 'aaaa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('正则元字符在子串模式下就是普通字符', () => {
    expect(spansOf('a.b', 'text', 'axb a.b')).toEqual([{ start: 4, end: 7 }]);
  });
});

describe('正则匹配', () => {
  it('按正则找', () => {
    expect(spansOf('a+', 'regex', 'baaab')).toEqual([{ start: 1, end: 4 }]);
  });

  it('与子串模式一样不区分大小写', () => {
    expect(spansOf('^at', 'regex', 'AT+VER')).toEqual([{ start: 0, end: 2 }]);
  });

  it('非法正则交回那句错误，而不是抛出去', () => {
    const result = createMatcher('[', 'regex');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/character class|\[/i);
  });

  /**
   * `a*` 对着任何位置都能匹配空串，而零长匹配不推进 lastIndex ——
   * exec 会在原地打转成死循环。这条要是红了，界面是整个卡死，不是显示不对。
   */
  it('零长匹配不会卡死', () => {
    expect(spansOf('a*', 'regex', 'bbbab')).toEqual([{ start: 3, end: 4 }]);
  });

  it('整个模式只能匹配空串时一个区间都不产生', () => {
    expect(spansOf('x*', 'regex', 'abc')).toEqual([]);
  });

  // 每一处都是一个 DOM 节点，一行上千处乘以渲染的一千行，界面直接卡死
  it('一行里的匹配处数有上限', () => {
    const spans = spansOf('.', 'regex', 'x'.repeat(MAX_SPANS_PER_ROW + 50));
    expect(spans).toHaveLength(MAX_SPANS_PER_ROW);
  });

  it('子串模式同样有上限', () => {
    const spans = spansOf('x', 'text', 'x'.repeat(MAX_SPANS_PER_ROW + 50));
    expect(spans).toHaveLength(MAX_SPANS_PER_ROW);
  });

  it('同一个匹配器可以反复使用，lastIndex 不会串味', () => {
    const result = createMatcher('a', 'regex');
    if (!result.ok || !result.matcher) throw new Error('unreachable');
    expect(result.matcher.find('a')).toEqual([{ start: 0, end: 1 }]);
    expect(result.matcher.find('a')).toEqual([{ start: 0, end: 1 }]);
  });
});
