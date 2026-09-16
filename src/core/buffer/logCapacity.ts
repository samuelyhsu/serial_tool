import { prefKey } from '../prefs/prefKey';

/**
 * 日志缓冲容量的取值契约。
 *
 * 单独成文件是因为它有**三个**使用方，而它们不能互相 import：
 * 浏览器侧的 logStore（zustand）、VS Code 宿主里的 SessionHost（Node 进程，
 * 不该被拖进 zustand 与 platform），以及两边共用的校验。放在 core 里，
 * 谁都能安全引用，也不会有人偷偷把默认值抄成两份再慢慢发散。
 */

export const DEFAULT_LOG_CAPACITY = 10000;

/**
 * 容量下限。
 *
 * 低于这个数就不像「日志缓冲」而像「窗口」了 —— 一次高速接收几百帧是常事，
 * 缓冲比一屏还小的话，用户还没来得及往上翻，记录就已经被自己顶掉了。
 */
export const LOG_CAPACITY_MIN = 1000;

/**
 * 上限由使用者自己把握，这里只挡**物理上不成立**的值。
 *
 * JS 数组长度的硬上限是 2^32-1，再大一点 `new Array(n)` 直接抛 RangeError，
 * 会把 setCapacity 整个打断。这不是产品意义上的上限，只是别让一次手滑
 * 变成一个异常。真正的代价提示放在界面文案里：容量 × 单帧上限 8192 字节
 * 就是最坏内存占用，20000 条已是 160MB 量级，往上要自己掂量。
 */
export const LOG_CAPACITY_CEILING = 2 ** 32 - 1;

export function isValidLogCapacity(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= LOG_CAPACITY_MIN &&
    value <= LOG_CAPACITY_CEILING
  );
}

/**
 * 持久化键名。
 *
 * 容量单独成键、走 global 作用域：它是资源上限，不该跟着「这个页面想看什么」
 * 的视图偏好走分层作用域。VS Code 宿主也认这一项 —— 它自己持有一份 ring，
 * 要跟着 webview 一起改容量，否则面板重建后回放的条数对不上界面的设定。
 */
export const LOG_CAPACITY_KEY = 'logCapacity';

/** 宿主侧与快照里的完整键名，为什么带前缀见 prefKey。 */
export const LOG_CAPACITY_PREF_KEY = prefKey(LOG_CAPACITY_KEY);

/**
 * 把持久化的原始值解析成容量，非法时为 null。
 *
 * 收的是存下来的 JSON 文本：浏览器从 localStorage 读到的、宿主从 globalState 里拿到的、
 * 快照捎给 webview 的，都是界面当初写下的那个字符串。三处按同一种形状读，
 * 就不会再有哪一处按数字去比 —— 宿主那份缓冲曾因此始终没读到用户的设定。
 */
export function parseLogCapacity(raw: unknown): number | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      // 值被改坏了等同于没设过：由调用方决定回退默认还是维持现状
      return null;
    }
  }
  return isValidLogCapacity(value) ? value : null;
}
