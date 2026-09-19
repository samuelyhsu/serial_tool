import { create } from 'zustand';
import {
  DEFAULT_LOG_CAPACITY,
  isValidLogCapacity,
  LOG_CAPACITY_CEILING,
  LOG_CAPACITY_KEY,
  LOG_CAPACITY_MIN,
  parseLogCapacity,
} from '@/core/buffer/logCapacity';
import { RingBuffer } from '@/core/buffer/ringBuffer';
import { formatHex } from '@/core/codec/hex';
import { directionTag, formatDateTime, formatStamp, FrameFormatter } from '@/core/log/logLine';
import type { LogKind, LogView, TimestampMode } from '@/core/log/logLine';
import { createMatcher, type MatcherKind, type Span } from '@/core/log/matcher';
import type { SessionNotice } from '@/core/session/notices';
import type { Direction } from '@/core/session/serialSession';
import type { Language, Messages } from '@/i18n';
import { saveSoon } from '@/lib/persist';
import { readStored } from '@/lib/storage';
import { platform } from './platform';

export {
  DEFAULT_LOG_CAPACITY,
  isValidLogCapacity,
  LOG_CAPACITY_CEILING,
  LOG_CAPACITY_KEY,
  LOG_CAPACITY_MIN,
};

export type { LogKind, LogView, TimestampMode };

export interface LogEntry {
  readonly id: number;
  readonly kind: LogKind;
  readonly time: Date;
  readonly bytes: Uint8Array | null;
  /** 入库时算好的文本视图（缺陷 D7：不在渲染路径上重算）。 */
  readonly text: string;
  /** 系统消息保留结构化事件，切换语言时可以重新翻译。 */
  readonly notice: SessionNotice | null;
  /** HEX 视图惰性计算并缓存，只有真正切到 HEX 的条目才会付出代价。 */
  hexCache: string | null;
}

function loadCapacity(): number {
  // 单值键，不走 pickInt 那套（那是给对象型偏好逐字段兜底用的）。
  // 非法/陈旧的存量值一律回退默认，与 persist 的读取约定一致。
  return parseLogCapacity(readStored(LOG_CAPACITY_KEY)) ?? DEFAULT_LOG_CAPACITY;
}

/** 攒批提交间隔：高波特率下把上千次 setState 压成每秒十几次。 */
const FLUSH_INTERVAL_MS = 60;

const ring = new RingBuffer<LogEntry>(loadCapacity());
/** 入库时算好的文本视图，跨帧保持解码状态（HEX 仍是惰性的，见 LogEntry.hexCache）。 */
const textFormatter = new FrameFormatter('text');

let nextId = 1;
let pending: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let rxWindow = 0;
let txWindow = 0;
let lastRxTime = 0;

export function entryHex(entry: LogEntry): string {
  if (entry.bytes === null) return '';
  entry.hexCache ??= formatHex(entry.bytes);
  return entry.hexCache;
}

export function entryBody(entry: LogEntry, view: LogView, messages: Messages): string {
  if (entry.kind === 'sys') {
    return entry.notice ? messages.notice(entry.notice) : entry.text;
  }
  return view === 'hex' ? entryHex(entry) : entry.text;
}

interface LogState {
  /** 每次提交自增，作为渲染选择器的缓存键。 */
  version: number;
  /** 环形缓冲容量。超出后自动丢弃最旧的记录。 */
  capacity: number;
  /** 缓冲里现存的条数。涨到 capacity 就意味着最旧的正在被丢弃。 */
  size: number;
  rxBytes: number;
  txBytes: number;
  rxFrames: number;
  txFrames: number;

  /**
   * 追加一帧。`at` 是帧的产生时刻（毫秒），不传就是此刻。
   *
   * 在 VS Code 里帧是从扩展宿主攒批送过来的，产生时刻在那边；用「收到消息的此刻」
   * 会让时间戳系统性地偏晚，回放历史日志时更是会把满缓冲的条目全打上同一个「现在」。
   */
  appendFrame: (direction: Direction, bytes: Uint8Array, at?: number) => void;
  /** 用一批历史帧整体替换当前日志。面板重建后回放宿主快照时用。 */
  resetFrames: (frames: readonly { direction: Direction; bytes: Uint8Array; at: number }[]) => void;
  appendNotice: (notice: SessionNotice) => void;
  appendMessage: (text: string) => void;
  addThroughput: (direction: Direction, byteCount: number) => void;
  /**
   * 过滤命中数，由接收区渲染后回推。null 表示当前没有过滤词。
   *
   * 它本该由状态栏自己算，但那要再扫一遍缓冲，而接收区刚刚扫过同一批条目 ——
   * 选择器是单槽记忆化的，两处各持一份查询条件只会互相把对方的缓存顶掉。
   */
  filterMatches: FilterMatches | null;
  setFilterMatches: (value: FilterMatches | null) => void;
  /**
   * 改变缓冲容量，返回因缩容被丢弃的记录条数。
   *
   * 返回值不是可有可无的：缩容不可撤销，界面要据此告诉用户「刚才没了多少条」，
   * 否则日志凭空变短，看起来和数据丢失没有区别。
   */
  setCapacity: (value: number) => number;
  /** 丢弃本地环形缓冲与统计。快照回放前也会走它，因此**不**碰运行环境那份历史。 */
  clear: () => void;
  /**
   * 用户点「清空」。除了本地那份，还要让运行环境丢掉它自己保留的历史。
   *
   * 与 clear() 分开不是洁癖：clear() 还被 resetFrames() 用来给快照回放让位，
   * 那条路径上要是顺手清了宿主，面板每重建一次就会把历史清一次。
   */
  clearAll: () => void;
}

export const useLogStore = create<LogState>()((set, get) => ({
  version: 0,
  capacity: ring.capacity,
  size: 0,
  rxBytes: 0,
  txBytes: 0,
  rxFrames: 0,
  txFrames: 0,

  appendFrame: (direction, bytes, at) => {
    pending.push({
      id: nextId++,
      kind: direction,
      time: at === undefined ? new Date() : new Date(at),
      // 环形缓冲要把这份字节留到被淘汰为止（最多 capacity 条）。驱动交付的视图
      // 可能只占一块大 backing buffer 的一小段，直接持有会把整块 buffer 一起 retain：
      // 高波特率下就是「每帧几字节、实际吃掉 bufferSize」的内存放大。
      // 视图已经独占整块 buffer 时不复制，常见情况下没有额外开销。
      bytes: bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice(),
      // 流式解码放在入库时做：解码器状态跨帧连续，被切开的多字节字符才能正确还原
      text: textFormatter.body(direction, bytes),
      notice: null,
      hexCache: null,
    });
    scheduleFlush();
  },

  appendNotice: (notice) => {
    pending.push({
      id: nextId++,
      kind: 'sys',
      time: new Date(),
      bytes: null,
      text: '',
      notice,
      hexCache: null,
    });
    flushNow(); // 系统消息是对用户操作的反馈，不该等 60ms
  },

  appendMessage: (text) => {
    pending.push({
      id: nextId++,
      kind: 'sys',
      time: new Date(),
      bytes: null,
      text,
      notice: null,
      hexCache: null,
    });
    flushNow();
  },

  resetFrames: (frames) => {
    useLogStore.getState().clear();
    const store = useLogStore.getState();
    for (const frame of frames) store.appendFrame(frame.direction, frame.bytes, frame.at);
    flushNow();
  },

  addThroughput: (direction, byteCount) => {
    if (direction === 'rx') rxWindow += byteCount;
    else txWindow += byteCount;
  },

  filterMatches: null,

  setFilterMatches: (value) =>
    set((state) => (sameMatches(state.filterMatches, value) ? state : { filterMatches: value })),

  setCapacity: (value) => {
    if (!isValidLogCapacity(value) || value === ring.capacity) return 0;
    // 先把攒批中的条目提交，否则缩容算的是「还没入库」的旧规模，
    // 紧接着的 flush 又会把刚被让出的位置重新填满，用户看到的条数对不上设定值
    flushNow();
    const dropped = Math.max(0, ring.size - value);
    ring.resize(value);
    saveSoon(LOG_CAPACITY_KEY, value);
    set((state) => ({ version: state.version + 1, capacity: value, size: ring.size }));
    return dropped;
  },

  clear: () => {
    ring.clear();
    pending = [];
    textFormatter.reset();
    rxWindow = 0;
    txWindow = 0;
    lastRxTime = 0;
    set((state) => ({
      version: state.version + 1,
      size: 0,
      rxBytes: 0,
      txBytes: 0,
      rxFrames: 0,
      txFrames: 0,
    }));
  },

  clearAll: () => {
    platform().clearLog();
    get().clear();
  },
}));

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, FLUSH_INTERVAL_MS);
}

function flushNow(): void {
  // 缺陷 D8：没有待处理数据就一次 setState 都不做，空闲时界面完全静止
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];

  let rxBytes = 0;
  let txBytes = 0;
  let rxFrames = 0;
  let txFrames = 0;
  for (const entry of batch) {
    ring.push(entry);
    if (entry.kind === 'rx') {
      rxBytes += entry.bytes?.length ?? 0;
      rxFrames += 1;
      // 取帧自身的时刻而不是此刻：VS Code 里帧是宿主攒批送来的，回放历史快照时
      // 用「现在」会把一段几分钟前的日志说成刚刚收到，静默时长直接归零
      lastRxTime = Math.max(lastRxTime, entry.time.getTime());
    } else if (entry.kind === 'tx') {
      txBytes += entry.bytes?.length ?? 0;
      txFrames += 1;
    }
  }

  useLogStore.setState((state) => ({
    version: state.version + 1,
    size: ring.size,
    rxBytes: state.rxBytes + rxBytes,
    txBytes: state.txBytes + txBytes,
    rxFrames: state.rxFrames + rxFrames,
    txFrames: state.txFrames + txFrames,
  }));
}

/**
 * 把攒批中的条目立即提交到环形缓冲。
 *
 * 导出日志前必须调用：条目最多会在 pending 里待 60ms，直接读 allEntries()
 * 会漏掉最近这一批。
 */
export function flushPendingEntries(): void {
  flushNow();
}

/**
 * 取走并清零收发速率统计窗口，由状态栏每秒调用一次。
 *
 * 两个方向分开数：周期发送跑起来时，一个合计读数说不清那些字节是自己发出去的
 * 还是对端回的 —— 而这恰恰是「设备到底有没有应答」的判据。
 */
export function consumeThroughputWindow(): ThroughputWindow {
  const window: ThroughputWindow = { rx: rxWindow, tx: txWindow };
  rxWindow = 0;
  txWindow = 0;
  return window;
}

export interface ThroughputWindow {
  rx: number;
  tx: number;
}

/**
 * 最后一帧接收数据的时刻（毫秒），从未收到过则为 0。
 *
 * 状态栏据此显示静默时长：字节计数停着不动时，人眼分不出是链路断了还是对端本来就慢。
 */
export function lastRxAt(): number {
  return lastRxTime;
}

/**
 * 到目前为止最后一条日志的编号（含攒批中那些）。
 *
 * 编号是全局自增的，不随环形缓冲淘汰而回退，所以两个读数相减就是这期间新增了多少条 ——
 * 暂停期间界面用它告诉用户「数据还在收，只是没往上刷」。
 */
export function latestEntryId(): number {
  return nextId - 1;
}

/** 导出用：按时间顺序取全部条目。调用前先 flushPendingEntries()。 */
export function allEntries(): LogEntry[] {
  return ring.toArray();
}

/**
 * 把缓冲里的全部条目渲染成一份可保存的文本，返回文本与行数。
 *
 * 时间戳带日期，与录制文件同一种写法：导出的日志常常跨夜，只有时分秒的话
 * 拿到手连是哪天的都说不清。
 */
export function logText(view: LogView, messages: Messages): { text: string; lines: number } {
  flushPendingEntries(); // 否则最近 60ms 内收到的帧会漏出导出文件
  const entries = allEntries();
  const text = entries
    .map(
      (entry) =>
        `${formatDateTime(entry.time)} ${directionTag(entry.kind)} ${entryBody(entry, view, messages)}`,
    )
    .join('\n');
  return { text, lines: entries.length };
}

/* ---------------- 渲染选择器 ---------------- */

export interface RowSegment {
  text: string;
  hit: boolean;
}

export interface LogRow {
  id: number;
  kind: LogKind;
  timestamp: string;
  segments: RowSegment[];
}

/** 过滤命中数。`partial` 说明扫描被渲染上限截断了，真实命中只会更多。 */
export interface FilterMatches {
  count: number;
  partial: boolean;
}

function sameMatches(a: FilterMatches | null, b: FilterMatches | null): boolean {
  if (a === null || b === null) return a === b;
  return a.count === b.count && a.partial === b.partial;
}

export interface LogSelection {
  rows: LogRow[];
  /** 已扫描范围内命中过滤词的行数；没有过滤词时为 null。 */
  matches: FilterMatches | null;
  /** 正则写错了的话是那句错误，界面据此把输入框标红。子串模式恒为 null。 */
  filterError: string | null;
  /**
   * 因为 limit 而没扫到的、更早的条目数。
   *
   * 界面用它在滚到顶时说明「上面还有，只是没渲染」—— 环形缓冲里存着 capacity 条，
   * 渲染的只有 limit 条，这个差额此前对用户完全不可见，看起来就像数据丢了。
   */
  hiddenEarlier: number;
}

export interface RowQuery {
  version: number;
  /**
   * 只渲染 id 不大于这个数的条目；null 表示不设上界。
   *
   * 「暂停刷新」就靠它：光冻住 version 是不够的 —— 用户在暂停期间改一下过滤词，
   * 缓存键跟着变，重扫一遍就把暂停之后到的行也带出来了，冻住的画面会突然往下跳。
   */
  upTo: number | null;
  language: Language;
  view: LogView;
  filter: string;
  /** 过滤词按子串还是按正则解释。 */
  filterKind: MatcherKind;
  onlyMatch: boolean;
  showTx: boolean;
  timestampMode: TimestampMode;
  limit: number;
}

const EMPTY_SELECTION: LogSelection = {
  rows: [],
  matches: null,
  hiddenEarlier: 0,
  filterError: null,
};

let cacheKey = '';
let cacheSelection: LogSelection = EMPTY_SELECTION;

/**
 * 计算要渲染的行 —— 缺陷 D7 的核心修复。
 *
 * 原型在每次渲染里对最多 2000 条记录逐条重算 hexStr/asciiStr 再过滤，最后只用最后 600 条；
 * 每次按键、每 500ms 心跳都要跑一遍。这里做两件事：
 *  1. 从最新往回扫，凑够 limit 条就停 —— 无过滤时只碰 600 条，不是 2000 条；
 *  2. 结果按查询条件记忆化，输入框每敲一个字符只重算一次，重渲染不重算。
 */
export function selectRows(query: RowQuery): LogSelection {
  const key = [
    query.version,
    query.language,
    query.view,
    query.filter,
    query.filterKind,
    query.onlyMatch ? 1 : 0,
    query.showTx ? 1 : 0,
    query.timestampMode,
    query.upTo ?? -1,
    query.limit,
  ].join('|');
  if (key === cacheKey) return cacheSelection;

  const messages = messagesRef;
  const compiled = createMatcher(query.filter, query.filterKind);
  // 正则写到一半几乎必然是非法的（`[` 敲下去那一刻就是）。此时不过滤也不高亮，
  // 而不是把日志清空 —— 一边打字一边看着行数忽然归零只会让人以为数据没了
  const matcher = compiled.ok ? compiled.matcher : null;
  const rows: LogRow[] = [];
  let hits = 0;

  let scanned = ring.size - 1;
  // 暂停期间先把上界之后的条目跳过去。它们仍在缓冲里，只是这一刻不该出现在画面上
  while (scanned >= 0 && query.upTo !== null && ring.at(scanned)!.id > query.upTo) scanned -= 1;

  for (; scanned >= 0 && rows.length < query.limit; scanned -= 1) {
    const entry = ring.at(scanned)!;
    if (entry.kind === 'tx' && !query.showTx) continue;

    const body = entryBody(entry, query.view, messages);
    const spans = matcher?.find(body) ?? [];
    if (matcher && query.onlyMatch && spans.length === 0) continue;
    if (spans.length > 0) hits += 1;

    rows.push({
      id: entry.id,
      kind: entry.kind,
      // 间隔要的是**缓冲里**的前一条，不是过滤后的前一条：隐藏 TX 行
      // 不该让剩下两条之间的间隔凭空变大
      timestamp: formatStamp(query.timestampMode, entry.time, ring.at(scanned - 1)?.time ?? null),
      segments: highlight(body, spans),
    });
  }

  rows.reverse();
  // 循环因 limit 提前停下时 scanned 还指着未检查的那条，剩下的都比已渲染的更早。
  // 它们仍在缓冲里、导出时拿得到，只是没渲染。
  const hiddenEarlier = Math.max(0, scanned + 1);
  const selection: LogSelection = {
    rows,
    // 扫描在凑够 limit 行时就停了，更早的还没看过 —— 那时给出的是个下界，不是总数
    matches: matcher === null ? null : { count: hits, partial: hiddenEarlier > 0 },
    hiddenEarlier,
    filterError: compiled.ok ? null : compiled.error,
  };
  cacheKey = key;
  cacheSelection = selection;
  return selection;
}

/**
 * 选择器需要 Messages 来翻译系统消息，但它不是 React 组件、拿不到 context。
 * 由 App 在语言变化时推进来，配合 query.language 参与缓存键，保证不会读到旧目录。
 */
let messagesRef: Messages = {} as Messages;
export function setSelectorMessages(messages: Messages): void {
  messagesRef = messages;
}

/** 按匹配区间把一行切成若干段。原型只高亮第一处，这里把所有匹配都标出来。 */
function highlight(body: string, spans: readonly Span[]): RowSegment[] {
  if (spans.length === 0) return [{ text: body, hit: false }];

  const segments: RowSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) segments.push({ text: body.slice(cursor, span.start), hit: false });
    segments.push({ text: body.slice(span.start, span.end), hit: true });
    cursor = span.end;
  }
  if (cursor < body.length) segments.push({ text: body.slice(cursor), hit: false });
  return segments;
}

/** 仅供测试：重置模块级状态。 */
export function __resetLogStoreForTests(): void {
  ring.clear();
  pending = [];
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  nextId = 1;
  rxWindow = 0;
  txWindow = 0;
  lastRxTime = 0;
  cacheKey = '';
  cacheSelection = EMPTY_SELECTION;
  textFormatter.reset();
  ring.resize(DEFAULT_LOG_CAPACITY);
  useLogStore.setState({
    version: 0,
    capacity: DEFAULT_LOG_CAPACITY,
    size: 0,
    filterMatches: null,
    rxBytes: 0,
    txBytes: 0,
    rxFrames: 0,
    txFrames: 0,
  });
}
