import { describe, expect, it } from 'vitest';
import {
  aliasOf,
  MAX_ALIAS_LENGTH,
  parsePortAliases,
  PORT_ALIAS_PREF_KEY,
  portDisplayLabel,
  sanitizeAlias,
} from './portAlias';
import type { PortDescriptor } from './portDescriptor';

function makePort(overrides: Partial<PortDescriptor> = {}): PortDescriptor {
  return {
    key: 'port-1',
    ordinal: 1,
    identity: 'usb:1A86:7523',
    label: '#1 CH340 (1A86:7523)',
    chip: 'CH340',
    vendor: 'WCH 沁恒',
    connected: true,
    ...overrides,
  };
}

describe('sanitizeAlias', () => {
  it('首尾空白被裁掉，连续空白折叠', () => {
    expect(sanitizeAlias('  电机   控制器  ')).toBe('电机 控制器');
  });

  it('超长备注被截断，避免撑爆下拉框与侧边栏', () => {
    expect(sanitizeAlias('A'.repeat(100))).toHaveLength(MAX_ALIAS_LENGTH);
  });

  it('只有空白的备注等于没有备注', () => {
    expect(sanitizeAlias('   ')).toBe('');
  });
});

describe('parsePortAliases', () => {
  it('收下已经解析过的对象 —— 浏览器侧读 localStorage 拿到的就是这个形状', () => {
    expect(parsePortAliases({ 'usb:1A86:7523': '调试板' })).toEqual({
      'usb:1A86:7523': '调试板',
    });
  });

  it('收下 JSON 字符串 —— 宿主侧从 globalState 拿到的就是这个形状', () => {
    expect(parsePortAliases('{"usb:1A86:7523":"调试板"}')).toEqual({
      'usb:1A86:7523': '调试板',
    });
  });

  it('存量值被改坏、或根本不是备注表时退回空表', () => {
    expect(parsePortAliases('{ 不是 JSON')).toEqual({});
    expect(parsePortAliases(undefined)).toEqual({});
    expect(parsePortAliases(null)).toEqual({});
    expect(parsePortAliases(42)).toEqual({});
    expect(parsePortAliases(['a'])).toEqual({});
  });

  it('逐项校验：不是字符串、或裁完是空的那几项丢掉，其余照收', () => {
    expect(parsePortAliases({ a: 1, b: '  ', c: '好的' })).toEqual({ c: '好的' });
  });

  it('存量值里的超长备注读回来时一样被截断', () => {
    const parsed = parsePortAliases({ a: 'A'.repeat(100) });
    expect(parsed['a']).toHaveLength(MAX_ALIAS_LENGTH);
  });
});

/** 写死字面量：这是存量用户那里已经存着的键名，改了它，已有的备注就读不回来了。 */
describe('PORT_ALIAS_PREF_KEY', () => {
  it('就是带前缀的那个键名', () => {
    expect(PORT_ALIAS_PREF_KEY).toBe('wst.portAliases');
  });
});

describe('portDisplayLabel', () => {
  it('没有备注时显示原始标签', () => {
    expect(portDisplayLabel(makePort(), {})).toBe('#1 CH340 (1A86:7523)');
  });

  it('有备注时把备注放在最前面，同时保留原始信息以便与设备管理器核对', () => {
    expect(portDisplayLabel(makePort(), { 'usb:1A86:7523': '电机控制器' })).toBe(
      '电机控制器 · #1 CH340 (1A86:7523)',
    );
  });

  it('同型号的两个适配器靠 identity 里的出现序号各记各的备注', () => {
    const aliases = { 'usb:1A86:7523#0': '甲板', 'usb:1A86:7523#1': '乙板' };
    const first = makePort({ identity: 'usb:1A86:7523#0', label: '#1 CH340 (1A86:7523)' });
    const second = makePort({
      key: 'port-2',
      ordinal: 2,
      identity: 'usb:1A86:7523#1',
      label: '#2 CH340 (1A86:7523)',
    });

    expect(portDisplayLabel(first, aliases)).toBe('甲板 · #1 CH340 (1A86:7523)');
    expect(portDisplayLabel(second, aliases)).toBe('乙板 · #2 CH340 (1A86:7523)');
  });

  it('不同型号互不影响', () => {
    const aliases = { 'usb:1A86:7523': '甲' };
    const other = makePort({ identity: 'usb:0403:6001', label: '#2 FTDI (0403:6001)' });
    expect(portDisplayLabel(other, aliases)).toBe('#2 FTDI (0403:6001)');
  });
});

describe('aliasOf', () => {
  it('没有选中端口时返回空串', () => {
    expect(aliasOf(undefined, { x: 'y' })).toBe('');
  });

  it('返回选中端口的备注', () => {
    expect(aliasOf(makePort(), { 'usb:1A86:7523': '调试板' })).toBe('调试板');
    expect(aliasOf(makePort(), {})).toBe('');
  });
});
