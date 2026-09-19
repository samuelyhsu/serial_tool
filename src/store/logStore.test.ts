import { beforeEach, describe, expect, it } from 'vitest';
import { LOG_CAPACITY_PREF_KEY, parseLogCapacity } from '@/core/buffer/logCapacity';
import { encodeUtf8 } from '@/core/codec/text';
import { messagesFor } from '@/i18n';
import { flushPersist } from '@/lib/persist';
import {
  __resetLogStoreForTests,
  allEntries,
  consumeThroughputWindow,
  DEFAULT_LOG_CAPACITY,
  entryBody,
  flushPendingEntries,
  latestEntryId,
  LOG_CAPACITY_CEILING,
  LOG_CAPACITY_MIN,
  selectRows,
  setSelectorMessages,
  useLogStore,
} from './logStore';

const zh = messagesFor('zh');

function bodies(): string[] {
  flushPendingEntries();
  return allEntries()
    .filter((entry) => entry.kind !== 'sys')
    .map((entry) => entryBody(entry, 'text', zh));
}

describe('logStore', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(zh);
  });

  it('入库时就完成解码，跨帧被切开的汉字能拼回来', () => {
    const bytes = encodeUtf8('温度');
    const store = useLogStore.getState();
    store.appendFrame('rx', bytes.slice(0, 2));
    store.appendFrame('rx', bytes.slice(2));

    const parts = bodies();
    expect(parts).toHaveLength(2);
    expect(parts.join('')).toBe('温度');
  });

  it('收发两个方向的解码互不串扰', () => {
    const store = useLogStore.getState();
    const rx = encodeUtf8('温度');
    const tx = encodeUtf8('湿度');
    store.appendFrame('rx', rx.slice(0, 2));
    store.appendFrame('tx', tx.slice(0, 2));
    store.appendFrame('rx', rx.slice(2));
    store.appendFrame('tx', tx.slice(2));

    flushPendingEntries();
    const entries = allEntries();
    expect(
      entries
        .filter((e) => e.kind === 'rx')
        .map((e) => e.text)
        .join(''),
    ).toBe('温度');
    expect(
      entries
        .filter((e) => e.kind === 'tx')
        .map((e) => e.text)
        .join(''),
    ).toBe('湿度');
  });

  /**
   * appendFrame 是攒批的（60ms），导出日志前若不先落盘，最近这一批会漏出文件。
   */
  it('flushPendingEntries 把攒批中的条目立即提交', () => {
    useLogStore.getState().appendFrame('rx', encodeUtf8('data\n'));
    expect(allEntries()).toHaveLength(0);

    flushPendingEntries();
    expect(allEntries()).toHaveLength(1);
  });

  it('系统消息立即提交，不等攒批', () => {
    useLogStore.getState().appendMessage('端口已授权');
    expect(allEntries().map((entry) => entry.text)).toEqual(['端口已授权']);
  });

  it('系统消息保留结构化事件，可随语言重新翻译', () => {
    useLogStore.getState().appendNotice({ code: 'port-closed' });
    const entry = allEntries()[0]!;
    expect(entryBody(entry, 'text', messagesFor('zh'))).toBe('串口已关闭');
    expect(entryBody(entry, 'text', messagesFor('en'))).toBe('Port closed');
  });

  it('统计按方向累加，clear 后归零', () => {
    const store = useLogStore.getState();
    store.appendFrame('rx', encodeUtf8('abc'));
    store.appendFrame('tx', encodeUtf8('de'));
    flushPendingEntries();

    expect(useLogStore.getState().rxBytes).toBe(3);
    expect(useLogStore.getState().txBytes).toBe(2);
    expect(useLogStore.getState().rxFrames).toBe(1);
    expect(useLogStore.getState().txFrames).toBe(1);

    useLogStore.getState().clear();
    expect(useLogStore.getState().rxBytes).toBe(0);
    expect(allEntries()).toHaveLength(0);
  });

  it('HEX 视图惰性计算并缓存', () => {
    useLogStore.getState().appendFrame('rx', Uint8Array.of(0x01, 0xab));
    flushPendingEntries();
    const entry = allEntries()[0]!;

    expect(entry.hexCache).toBeNull();
    expect(entryBody(entry, 'hex', zh)).toBe('01 AB');
    expect(entry.hexCache).toBe('01 AB');
  });

  it('速率窗口取走后清零', () => {
    const store = useLogStore.getState();
    store.addThroughput('rx', 120);
    store.addThroughput('rx', 80);
    expect(consumeThroughputWindow()).toBe(200);
    expect(consumeThroughputWindow()).toBe(0);
  });

  it('发送方向不计入接收速率', () => {
    useLogStore.getState().addThroughput('tx', 500);
    expect(consumeThroughputWindow()).toBe(0);
  });
});

describe('日志缓冲容量', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(zh);
  });

  function feed(count: number): void {
    const { appendFrame } = useLogStore.getState();
    for (let i = 0; i < count; i += 1) appendFrame('rx', encodeUtf8(`f${i}`));
    flushPendingEntries();
  }

  it('默认容量是 10000', () => {
    expect(useLogStore.getState().capacity).toBe(DEFAULT_LOG_CAPACITY);
    expect(DEFAULT_LOG_CAPACITY).toBe(10000);
  });

  it('缩容立即丢掉最旧的，返回丢弃条数', () => {
    feed(2500);
    const dropped = useLogStore.getState().setCapacity(1000);
    expect(dropped).toBe(1500);
    const kept = bodies();
    expect(kept).toHaveLength(1000);
    expect(kept[0]).toBe('f1500'); // 留下的是最新那批
    expect(kept.at(-1)).toBe('f2499');
  });

  it('容量没超出时缩容不丢东西，返回 0', () => {
    feed(500);
    expect(useLogStore.getState().setCapacity(1000)).toBe(0);
    expect(bodies()).toHaveLength(500);
  });

  it('扩容后能装下更多，旧记录一条不少', () => {
    useLogStore.getState().setCapacity(1000);
    feed(1000);
    expect(useLogStore.getState().setCapacity(3000)).toBe(0);
    feed(1000);
    const kept = bodies();
    expect(kept).toHaveLength(2000);
    expect(kept[0]).toBe('f0');
  });

  it('攒批中的条目先入库再缩容，最终条数与设定值一致', () => {
    const { appendFrame } = useLogStore.getState();
    // 故意不 flush：这些还在 pending 里，容量却是照 ring 的规模算的
    for (let i = 0; i < 3000; i += 1) appendFrame('rx', encodeUtf8(`p${i}`));
    useLogStore.getState().setCapacity(1000);
    const kept = bodies();
    expect(kept).toHaveLength(1000);
    expect(kept.at(-1)).toBe('p2999'); // 最新的那条必须还在
  });

  it('低于下限与非整数被拒，容量不变', () => {
    const before = useLogStore.getState().capacity;
    for (const bad of [0, -1, LOG_CAPACITY_MIN - 1, 1.5, Number.NaN]) {
      expect(useLogStore.getState().setCapacity(bad)).toBe(0);
    }
    expect(useLogStore.getState().capacity).toBe(before);
  });

  /**
   * 上限交给使用者把握，这里只挡物理上不成立的值：JS 数组长度过了 2^32-1，
   * new Array(n) 会抛 RangeError，把 setCapacity 整个打断。
   */
  it('远超默认的大容量照收，超出数组长度上限的被拒', () => {
    expect(useLogStore.getState().setCapacity(200_000)).toBe(0);
    expect(useLogStore.getState().capacity).toBe(200_000);

    expect(useLogStore.getState().setCapacity(LOG_CAPACITY_CEILING + 1)).toBe(0);
    expect(useLogStore.getState().capacity).toBe(200_000); // 没被打断，也没变

    expect(useLogStore.getState().setCapacity(Number.MAX_SAFE_INTEGER)).toBe(0);
    expect(useLogStore.getState().capacity).toBe(200_000);
  });

  it('容量变化会推进 version，让渲染选择器的缓存失效', () => {
    feed(10);
    const before = useLogStore.getState().version;
    useLogStore.getState().setCapacity(5000);
    expect(useLogStore.getState().version).toBeGreaterThan(before);
  });

  /**
   * 断言的是真正落盘的那个键和那段文本，而不是再经过一次存储层读回来 ——
   * 读写都过同一层，前缀对不对、值是不是字符串，这条测试就看不出来了。
   */
  it('容量落盘成宿主按同一套规则读得懂的样子', () => {
    useLogStore.getState().setCapacity(1234);
    flushPersist();
    expect(parseLogCapacity(localStorage.getItem(LOG_CAPACITY_PREF_KEY))).toBe(1234);
  });
});

describe('selectRows 的 hiddenEarlier', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(zh);
  });

  const query = {
    version: 0,
    language: 'zh' as const,
    view: 'text' as const,
    filter: '',
    filterKind: 'text' as const,
    onlyMatch: false,
    showTx: true,
    timestampMode: 'none' as const,
    upTo: null,
    limit: 10,
  };

  function feed(count: number): void {
    const { appendFrame } = useLogStore.getState();
    for (let i = 0; i < count; i += 1) appendFrame('rx', encodeUtf8(`f${i}`));
    flushPendingEntries();
  }

  it('条目没超过 limit 时为 0', () => {
    feed(4);
    const { rows, hiddenEarlier } = selectRows({ ...query, version: 1 });
    expect(rows).toHaveLength(4);
    expect(hiddenEarlier).toBe(0);
  });

  it('被 limit 截断时报出更早的条数', () => {
    feed(25);
    const { rows, hiddenEarlier } = selectRows({ ...query, version: 1 });
    expect(rows).toHaveLength(10);
    // 渲染的是最新 10 条，剩下 15 条更早的仍在缓冲里
    expect(hiddenEarlier).toBe(15);
    expect(rows[0]?.segments[0]?.text).toBe('f15');
  });

  it('缩容后 hiddenEarlier 跟着变小 —— 那些记录是真的没了', () => {
    feed(1500);
    expect(selectRows({ ...query, version: 1 }).hiddenEarlier).toBe(1490);
    // 缩到下限，丢掉最旧的 500 条；渲染的仍是最新 10 条，更早的就只剩 990 条了
    expect(useLogStore.getState().setCapacity(LOG_CAPACITY_MIN)).toBe(500);
    expect(selectRows({ ...query, version: 2 }).hiddenEarlier).toBe(LOG_CAPACITY_MIN - 10);
  });

  it('导出拿得到 hiddenEarlier 说的那些条目', () => {
    feed(25);
    const { rows, hiddenEarlier } = selectRows({ ...query, version: 1 });
    // 提示文案承诺「它们仍在缓冲里，导出可取」，这里就是那个承诺
    expect(allEntries().filter((e) => e.kind !== 'sys')).toHaveLength(rows.length + hiddenEarlier);
  });
});

describe('时间列', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(zh);
  });

  const base = {
    version: 0,
    language: 'zh' as const,
    view: 'text' as const,
    filter: '',
    filterKind: 'text' as const,
    onlyMatch: false,
    showTx: true,
    upTo: null,
    limit: 10,
  };

  function feedAt(times: number[]): void {
    const { appendFrame } = useLogStore.getState();
    for (const [index, at] of times.entries()) appendFrame('rx', encodeUtf8(`f${index}`), at);
    flushPendingEntries();
  }

  it('间隔算的是与缓冲里上一条的差', () => {
    feedAt([1_000_000, 1_000_012, 1_001_512]);
    const { rows } = selectRows({ ...base, timestampMode: 'delta' });

    expect(rows.map((row) => row.timestamp)).toEqual(['', '+12ms', '+1.500s']);
  });

  /**
   * 隐藏 TX 行不该让剩下两条之间的间隔凭空变大：用户要的是链路上真实的时序，
   * 而不是「我现在恰好看得见的那几行之间的时序」。
   */
  it('隐藏 TX 行不会把间隔算大', () => {
    const { appendFrame } = useLogStore.getState();
    appendFrame('rx', encodeUtf8('a'), 1_000_000);
    appendFrame('tx', encodeUtf8('b'), 1_000_010);
    appendFrame('rx', encodeUtf8('c'), 1_000_020);
    flushPendingEntries();

    const { rows } = selectRows({ ...base, showTx: false, timestampMode: 'delta' });
    expect(rows.map((row) => row.timestamp)).toEqual(['', '+10ms']);
  });

  it('日期时间带日期，关闭时那一列是空的', () => {
    feedAt([new Date(2026, 8, 19, 12, 0, 0, 5).getTime()]);

    expect(selectRows({ ...base, timestampMode: 'datetime' }).rows[0]?.timestamp).toBe(
      '2026-09-19 12:00:00.005',
    );
    expect(selectRows({ ...base, timestampMode: 'none' }).rows[0]?.timestamp).toBe('');
  });

  // 模式是缓存键的一部分，否则切换模式后界面仍显示上一种
  it('换一种模式会重算，不吃上一次的缓存', () => {
    feedAt([1_000_000, 1_000_050]);

    expect(selectRows({ ...base, timestampMode: 'delta' }).rows[1]?.timestamp).toBe('+50ms');
    expect(selectRows({ ...base, timestampMode: 'none' }).rows[1]?.timestamp).toBe('');
  });
});

describe('渲染上界（暂停刷新靠它）', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(zh);
  });

  const base = {
    version: 0,
    language: 'zh' as const,
    view: 'text' as const,
    filter: '',
    filterKind: 'text' as const,
    onlyMatch: false,
    showTx: true,
    timestampMode: 'none' as const,
    limit: 100,
  };

  function feed(count: number, prefix = 'f'): void {
    const { appendFrame } = useLogStore.getState();
    for (let i = 0; i < count; i += 1) appendFrame('rx', encodeUtf8(`${prefix}${i}`));
    flushPendingEntries();
  }

  it('上界之后的条目不渲染，但仍在缓冲里', () => {
    feed(3);
    const upTo = latestEntryId();
    feed(2, 'later');

    const { rows } = selectRows({ ...base, upTo });
    expect(rows).toHaveLength(3);
    expect(allEntries()).toHaveLength(5);
  });

  /**
   * 光冻住 version 是不够的：暂停期间改一下过滤词，缓存键跟着变、重扫一遍，
   * 暂停之后到的行就冒出来了 —— 冻住的画面会突然往下跳。
   */
  it('暂停期间改过滤词，也只在冻结的那一段里找', () => {
    feed(2, 'old');
    const upTo = latestEntryId();
    feed(2, 'new');

    const { rows } = selectRows({ ...base, upTo, filter: 'new', onlyMatch: true });
    expect(rows).toHaveLength(0);
  });

  it('不设上界时一切照旧', () => {
    feed(3);
    expect(selectRows({ ...base, upTo: null }).rows).toHaveLength(3);
  });

  it('上界是缓存键的一部分，恢复刷新后立刻看到新数据', () => {
    feed(1);
    const upTo = latestEntryId();
    expect(selectRows({ ...base, upTo }).rows).toHaveLength(1);

    feed(1);
    expect(selectRows({ ...base, upTo }).rows).toHaveLength(1);
    expect(selectRows({ ...base, upTo: null }).rows).toHaveLength(2);
  });

  it('编号不随缓冲淘汰回退，两个读数相减就是新增条数', () => {
    feed(2);
    const before = latestEntryId();
    useLogStore.getState().setCapacity(1000);
    feed(5);

    expect(latestEntryId() - before).toBe(5);
  });
});

describe('正则过滤', () => {
  beforeEach(() => {
    __resetLogStoreForTests();
    setSelectorMessages(zh);
  });

  const base = {
    version: 0,
    language: 'zh' as const,
    view: 'text' as const,
    filter: '',
    filterKind: 'text' as const,
    onlyMatch: true,
    showTx: true,
    timestampMode: 'none' as const,
    upTo: null,
    limit: 100,
  };

  function feed(texts: string[]): void {
    const { appendFrame } = useLogStore.getState();
    for (const text of texts) appendFrame('rx', encodeUtf8(text));
    flushPendingEntries();
  }

  function bodies(selection: ReturnType<typeof selectRows>): string[] {
    return selection.rows.map((row) => row.segments.map((segment) => segment.text).join(''));
  }

  it('按正则只留下命中的行', () => {
    feed(['AT+VER', 'OK', 'ERROR 3']);
    const selection = selectRows({ ...base, filterKind: 'regex', filter: '^(AT|ERROR)' });

    expect(bodies(selection)).toEqual(['AT+VER', 'ERROR 3']);
    expect(selection.filterError).toBeNull();
  });

  it('命中的那一段被标成高亮', () => {
    feed(['temp=25C']);
    const { rows } = selectRows({ ...base, filterKind: 'regex', filter: '\\d+' });

    expect(rows[0]?.segments).toEqual([
      { text: 'temp=', hit: false },
      { text: '25', hit: true },
      { text: 'C', hit: false },
    ]);
  });

  /**
   * 正则写到一半几乎必然是非法的（敲下 `[` 那一刻就是）。此时把日志清空的话，
   * 用户看到的是行数忽然归零 —— 与「数据没了」无法区分。
   */
  it('正则非法时交回错误，但不过滤也不高亮', () => {
    feed(['AT+VER', 'OK']);
    const selection = selectRows({ ...base, filterKind: 'regex', filter: '[' });

    expect(bodies(selection)).toEqual(['AT+VER', 'OK']);
    expect(selection.filterError).not.toBeNull();
  });

  it('切回子串模式后元字符就是普通字符', () => {
    feed(['a.b', 'axb']);

    expect(bodies(selectRows({ ...base, filterKind: 'text', filter: 'a.b' }))).toEqual(['a.b']);
    expect(bodies(selectRows({ ...base, filterKind: 'regex', filter: 'a.b' }))).toEqual([
      'a.b',
      'axb',
    ]);
  });

  it('模式是缓存键的一部分，换一种立刻重算', () => {
    feed(['a.b', 'axb']);
    const first = selectRows({ ...base, filterKind: 'text', filter: 'a.b' });
    const second = selectRows({ ...base, filterKind: 'regex', filter: 'a.b' });

    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(2);
  });

  it('不勾「仅匹配」时只高亮不过滤', () => {
    feed(['AT+VER', 'OK']);
    const selection = selectRows({
      ...base,
      onlyMatch: false,
      filterKind: 'regex',
      filter: '^AT',
    });

    expect(bodies(selection)).toEqual(['AT+VER', 'OK']);
    expect(selection.rows[0]?.segments.some((segment) => segment.hit)).toBe(true);
  });
});
