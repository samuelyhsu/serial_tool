import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodePortInfo } from '@/core/transport/nodePortRegistry';
import { PORT_ALIAS_PREF_KEY } from '@/core/transport/portAlias';
import { PortLeases } from './portLeases';
import { PortWatcher } from './portWatcher';
import { PortsTreeProvider } from './portsView';

/**
 * 活动栏端口列表。
 *
 * 这块是「点一下就连上」的入口，它错了用户第一步就走不下去。
 * 靠 tests/vscodeStub.ts 把 VS Code 的门面替掉，才能在单元测试里跑到它。
 */

const PORTS: NodePortInfo[] = [
  { path: 'COM3', vendorId: '1a86', productId: '7523', serialNumber: 'SN1' },
  { path: 'COM4' },
];

let leases: PortLeases;
let watcher: PortWatcher;
let listed = 0;
let prefs: Record<string, unknown>;

function makeProvider(options: { watcherAvailable?: boolean } = {}): PortsTreeProvider {
  return new PortsTreeProvider({
    leases,
    ensureWatcher: () => {
      listed += 1;
      return Promise.resolve(options.watcherAvailable === false ? null : watcher);
    },
    holderLabel: (portKey) => {
      const holder = leases.holderOf(portKey);
      return holder === undefined ? undefined : `面板 ${holder}`;
    },
    readPrefs: () => prefs,
  });
}

function storedAliases(aliases: Record<string, string>): string {
  return JSON.stringify(aliases);
}

beforeEach(() => {
  listed = 0;
  prefs = {};
  leases = new PortLeases();
  watcher = new PortWatcher({ list: () => Promise.resolve(PORTS), intervalMs: 60_000 });
});

afterEach(() => {
  watcher.stop();
});

describe('端口视图', () => {
  it('列出当前枚举到的端口', async () => {
    const provider = makeProvider();

    const children = await provider.getChildren();

    expect(children.map((port) => port.key)).toEqual(['COM3', 'COM4']);
    provider.dispose();
  });

  it('端口下面没有子项', async () => {
    const provider = makeProvider();
    const [first] = await provider.getChildren();

    expect(await provider.getChildren(first)).toEqual([]);
    provider.dispose();
  });

  /**
   * 惰性是有意的：打开这个视图本身就是「我要用串口」的意思，
   * 而没打开它的人不该为加载原生模块、启动轮询付出启动开销。
   */
  it('不展开视图就不去碰原生模块', () => {
    makeProvider();
    expect(listed).toBe(0);
  });

  it('原生模块加载失败时返回空列表，且不会每次展开都重试', async () => {
    const provider = makeProvider({ watcherAvailable: false });

    expect(await provider.getChildren()).toEqual([]);
    expect(await provider.getChildren()).toEqual([]);
    // 失败提示已经弹过一次了，不该每展开一次再弹一遍
    expect(listed).toBe(1);
    provider.dispose();
  });

  it('空闲端口的条目指向「打开」命令', async () => {
    const provider = makeProvider();
    const [port] = await provider.getChildren();
    const item = provider.getTreeItem(port!);

    expect(item.label).toBe('COM3 · CH340 (1A86:7523)');
    expect(item.id).toBe('COM3');
    expect(item.description).toBe('usb:1A86:7523:SN1');
    expect(item.contextValue).toBe('port');
    expect(item.command?.command).toBe('serialTool.openPort');
    expect(item.command?.arguments?.[0]).toBe(port);
    provider.dispose();
  });

  it('已被面板占着的端口标成已连接，右键菜单也能区分', async () => {
    leases.acquire('COM3', 'panel-1');
    const provider = makeProvider();
    const [port] = await provider.getChildren();
    const item = provider.getTreeItem(port!);

    expect(item.description).toBe('已连接');
    expect(item.contextValue).toBe('port.busy');
    provider.dispose();
  });

  it('占用变化会触发刷新 —— 别的面板开了口，这里的标注要跟着变', () => {
    const provider = makeProvider();
    const changed = vi.fn();
    provider.onDidChangeTreeData(changed);

    leases.acquire('COM3', 'panel-1');

    expect(changed).toHaveBeenCalled();
    provider.dispose();
  });

  it('销毁后不再响应占用变化', () => {
    const provider = makeProvider();
    const changed = vi.fn();
    provider.onDidChangeTreeData(changed);
    provider.dispose();

    leases.acquire('COM3', 'panel-1');

    expect(changed).not.toHaveBeenCalled();
  });

  it('手动刷新会重新枚举并通知界面', async () => {
    const provider = makeProvider();
    await provider.getChildren();
    const changed = vi.fn();
    provider.onDidChangeTreeData(changed);

    await provider.reload();

    expect(changed).toHaveBeenCalled();
    provider.dispose();
  });
});

describe('端口备注', () => {
  it('启动时就带上已经存过的备注', async () => {
    prefs[PORT_ALIAS_PREF_KEY] = storedAliases({ 'usb:1A86:7523:SN1': '温控板' });
    const provider = makeProvider();
    const [port] = await provider.getChildren();

    const item = provider.getTreeItem(port!);

    expect(item.label).toBe('温控板 · COM3 · CH340 (1A86:7523)');
    // 原始 COM 号仍在，用户还要拿它去设备管理器核对
    expect(item.tooltip).toHaveProperty('value', expect.stringContaining('温控板 · COM3'));
    provider.dispose();
  });

  it('面板里改完备注，列表立刻跟着变', async () => {
    const provider = makeProvider();
    const [port] = await provider.getChildren();
    const changed = vi.fn();
    provider.onDidChangeTreeData(changed);

    provider.applyPref(PORT_ALIAS_PREF_KEY, storedAliases({ 'usb:1A86:7523:SN1': '温控板' }));

    expect(changed).toHaveBeenCalled();
    expect(provider.getTreeItem(port!).label).toBe('温控板 · COM3 · CH340 (1A86:7523)');
    provider.dispose();
  });

  it('备注被清掉后退回原始标签', async () => {
    prefs[PORT_ALIAS_PREF_KEY] = storedAliases({ 'usb:1A86:7523:SN1': '温控板' });
    const provider = makeProvider();
    const [port] = await provider.getChildren();

    provider.applyPref(PORT_ALIAS_PREF_KEY, storedAliases({}));

    expect(provider.getTreeItem(port!).label).toBe('COM3 · CH340 (1A86:7523)');
    provider.dispose();
  });

  it('没有备注的端口不受影响', async () => {
    prefs[PORT_ALIAS_PREF_KEY] = storedAliases({ 'usb:1A86:7523:SN1': '温控板' });
    const provider = makeProvider();
    const [, second] = await provider.getChildren();

    expect(provider.getTreeItem(second!).label).toBe('COM4');
    provider.dispose();
  });

  it('别的偏好写入不会惊动列表', () => {
    const provider = makeProvider();
    const changed = vi.fn();
    provider.onDidChangeTreeData(changed);

    provider.applyPref('wst.sendPane', '{"payload":"AA55","mode":"hex"}');

    expect(changed).not.toHaveBeenCalled();
    provider.dispose();
  });

  it('存量值被改坏时当作没有备注，列表照常可用', async () => {
    prefs[PORT_ALIAS_PREF_KEY] = '{ 不是 JSON';
    const provider = makeProvider();
    const [port] = await provider.getChildren();

    expect(provider.getTreeItem(port!).label).toBe('COM3 · CH340 (1A86:7523)');
    provider.dispose();
  });
});
