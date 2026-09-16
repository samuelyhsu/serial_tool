import { prefKey } from '../prefs/prefKey';
import type { PortDescriptor } from './portDescriptor';

/**
 * 用户给端口起的备注名 —— 与运行环境无关的那部分。
 *
 * 浏览器不提供真实端口名（COM3 之类），`SerialPortInfo` 只有 VID/PID，
 * 见 WICG/serial#175 —— 该诉求至今未解决。所以「知道这个口接的是哪台设备」
 * 只能由用户自己标注，我们负责把它记住。
 *
 * 与 zustand 那层（store/portAliasStore.ts）分开放，是因为使用方不止界面：
 * VS Code 活动栏里的端口列表跑在扩展宿主（Node 进程，碰不得 zustand），
 * 显示的却是用户在面板里起的同一个名字。两边算出来的名字必须逐字一致，
 * 所以取值规则、显示格式、键名都只在这里写一遍。
 */

/** 备注表：端口 identity → 用户起的名字。 */
export type PortAliasMap = Readonly<Record<string, string>>;

/**
 * 持久化键名。
 *
 * 备注按 PortDescriptor.identity 存储，而不是按会话内的 key：key 是运行时计数器
 * （浏览器）或设备路径（桌面端），刷新页面、换个 USB 口就对不上了。
 */
export const PORT_ALIAS_KEY = 'portAliases';

/** 宿主侧比对用的完整键名，为什么带前缀见 prefKey。 */
export const PORT_ALIAS_PREF_KEY = prefKey(PORT_ALIAS_KEY);

/** 太长会把下拉框和侧边栏撑爆，也没人真的需要那么长的备注。 */
export const MAX_ALIAS_LENGTH = 24;

export function sanitizeAlias(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_ALIAS_LENGTH);
}

/**
 * 把持久化的原始值解析成备注表。
 *
 * 两侧拿到的形状不同：浏览器读 localStorage 时已经 JSON.parse 过一次，拿到的是对象；
 * 宿主从 globalState 里拿到的则是 webview 存进去的那个 JSON 字符串。两种都收。
 * 逐项校验、不认识的丢掉 —— 存量数据、被手改过的值都不该让端口列表起不来。
 */
export function parsePortAliases(raw: unknown): PortAliasMap {
  let source = raw;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      // 值被改坏了只影响备注显示，回退到「没有备注」即可
      return {};
    }
  }
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return {};

  const result: Record<string, string> = {};
  for (const [identity, alias] of Object.entries(source)) {
    if (typeof alias !== 'string') continue;
    const clean = sanitizeAlias(alias);
    if (clean) result[identity] = clean;
  }
  return result;
}

/** 显示用的完整名称：有备注就放在最前面，同时保留原始标签以便与设备管理器核对。 */
export function portDisplayLabel(port: PortDescriptor, aliases: PortAliasMap): string {
  const alias = aliases[port.identity];
  return alias ? `${alias} · ${port.label}` : port.label;
}

/** 读取某个端口当前的备注，没有则为空串。 */
export function aliasOf(port: PortDescriptor | undefined, aliases: PortAliasMap): string {
  return port ? (aliases[port.identity] ?? '') : '';
}
