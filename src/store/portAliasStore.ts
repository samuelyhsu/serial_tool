import { create } from 'zustand';
import { prefKey } from '@/core/prefs/prefKey';
import {
  parsePortAliases,
  PORT_ALIAS_KEY,
  sanitizeAlias,
  type PortAliasMap,
} from '@/core/transport/portAlias';
import { readStoredJson, writeStoredJson } from '@/lib/storage';

/**
 * 端口备注的状态层：只负责「存在哪、什么时候重读」。
 * 取值规则、显示格式、持久化键名见 core/transport/portAlias.ts。
 */

interface PortAliasState {
  aliases: PortAliasMap;
  /** 传入空串即删除备注。 */
  setAlias: (identity: string, alias: string) => void;
}

function loadAliases(): PortAliasMap {
  return parsePortAliases(readStoredJson<unknown>(PORT_ALIAS_KEY, {}));
}

export const usePortAliasStore = create<PortAliasState>()((set) => ({
  aliases: loadAliases(),

  setAlias: (identity, alias) =>
    set((state) => {
      const clean = sanitizeAlias(alias);
      const next = { ...state.aliases };
      if (clean) next[identity] = clean;
      else delete next[identity];
      writeStoredJson(PORT_ALIAS_KEY, next);
      return { aliases: next };
    }),
}));

/**
 * 跨标签页同步。
 *
 * localStorage 是同源全标签页共享的，而备注是整张 map 一次性写入的：
 * 若 A 页改了备注，B 页内存里仍是旧 map，B 页下一次写入就会把整张表覆盖回去，
 * A 页的改动随之丢失。storage 事件只在**其他**标签页写入时触发，
 * 收到即重新载入，让每个标签页的内存副本始终跟得上磁盘。
 *
 * event.key 为 null 表示 localStorage 被整体清空，同样需要重载。
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== prefKey(PORT_ALIAS_KEY)) return;
    usePortAliasStore.setState({ aliases: loadAliases() });
  });
}
