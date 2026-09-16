import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_ALIAS_LENGTH } from '@/core/transport/portAlias';
import { usePortAliasStore } from './portAliasStore';

/** 备注的取值规则与显示格式归 core/transport/portAlias.ts 测，这里只管存取与同步。 */

describe('portAliasStore', () => {
  beforeEach(() => {
    localStorage.clear();
    usePortAliasStore.setState({ aliases: {} });
  });

  it('设置备注后可读回', () => {
    usePortAliasStore.getState().setAlias('usb:1A86:7523', '电机控制器');
    expect(usePortAliasStore.getState().aliases['usb:1A86:7523']).toBe('电机控制器');
  });

  it('备注持久化到 localStorage，刷新后仍在', () => {
    usePortAliasStore.getState().setAlias('usb:1A86:7523', '调试板');
    const stored = localStorage.getItem('wst.portAliases');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual({ 'usb:1A86:7523': '调试板' });
  });

  it('传入空串即删除备注', () => {
    const store = usePortAliasStore.getState();
    store.setAlias('usb:1A86:7523', '调试板');
    store.setAlias('usb:1A86:7523', '   ');
    expect(usePortAliasStore.getState().aliases).toEqual({});
  });

  it('首尾空白被裁掉，连续空白折叠', () => {
    usePortAliasStore.getState().setAlias('x', '  电机   控制器  ');
    expect(usePortAliasStore.getState().aliases['x']).toBe('电机 控制器');
  });

  it('超长备注被截断，避免撑爆下拉框', () => {
    usePortAliasStore.getState().setAlias('x', 'A'.repeat(100));
    expect(usePortAliasStore.getState().aliases['x']).toHaveLength(MAX_ALIAS_LENGTH);
  });

  it('多个端口各自独立', () => {
    const store = usePortAliasStore.getState();
    store.setAlias('usb:1A86:7523', '甲');
    store.setAlias('usb:0403:6001', '乙');
    expect(usePortAliasStore.getState().aliases).toEqual({
      'usb:1A86:7523': '甲',
      'usb:0403:6001': '乙',
    });
  });
});

describe('跨标签页同步', () => {
  beforeEach(() => {
    localStorage.clear();
    usePortAliasStore.setState({ aliases: {} });
  });

  /**
   * localStorage 同源全标签页共享，而备注是整张 map 一次性写入的。
   * 不监听 storage 事件的话，B 页的下一次写入会把 A 页的改动整张覆盖掉。
   */
  it('其他标签页的写入会被同步进来', () => {
    localStorage.setItem(
      'wst.portAliases',
      JSON.stringify({ 'usb:1A86:7523': '来自另一个标签页' }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'wst.portAliases' }));

    expect(usePortAliasStore.getState().aliases).toEqual({ 'usb:1A86:7523': '来自另一个标签页' });
  });

  it('同步后本页写入不会覆盖掉其他标签页的备注', () => {
    // 另一个标签页存了甲设备
    localStorage.setItem('wst.portAliases', JSON.stringify({ 'usb:1A86:7523': '甲' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'wst.portAliases' }));

    // 本页再存乙设备
    usePortAliasStore.getState().setAlias('usb:0403:6001', '乙');

    expect(JSON.parse(localStorage.getItem('wst.portAliases')!)).toEqual({
      'usb:1A86:7523': '甲',
      'usb:0403:6001': '乙',
    });
  });

  it('localStorage 被整体清空时（key 为 null）也重新载入', () => {
    usePortAliasStore.setState({ aliases: { x: 'y' } });
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));

    expect(usePortAliasStore.getState().aliases).toEqual({});
  });

  it('无关的键不触发重载', () => {
    usePortAliasStore.setState({ aliases: { x: 'y' } });
    window.dispatchEvent(new StorageEvent('storage', { key: 'wst.theme' }));

    expect(usePortAliasStore.getState().aliases).toEqual({ x: 'y' });
  });
});
