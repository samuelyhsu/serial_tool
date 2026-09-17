import * as vscode from 'vscode';

/**
 * 宿主侧面向用户的文案。
 *
 * 这些字符串属于 VS Code 的界面外壳 —— 标签页标题、状态栏、QuickPick、端口视图 ——
 * 与 package.nls.json 里的命令名、视图容器名并列，所以跟 **VS Code 的显示语言**走，
 * 而不是 webview 工具栏上那个语言开关。理由有两条：一是面板刚创建、webview 还没
 * 加载时就得有标题，那时只有 env.language 可用；二是标签页与命令面板、侧边栏并排
 * 显示，跟着 webview 走反而会和它们对不上。webview 内部的文案另有一套（src/i18n）。
 *
 * 没有用 vscode.l10n：那套要额外的 bundle 生成步骤与打包配置，而这里统共二十几条，
 * 一张同构的中英对照表更直接，也和 src/i18n 的写法保持一致。
 */
export interface HostText {
  /** 面板未选端口时的标签页标题，与 package.nls 的 view.container 同名 */
  readonly appName: string;
  readonly statusIdle: string;
  readonly statusNewPanel: string;
  readonly statusHint: string;
  readonly noPort: string;
  readonly openWebVersion: string;
  readonly bindingFailed: (reason: string) => string;
  readonly panelPickTitle: string;
  readonly portPickTitle: string;
  readonly noPortsFound: string;
  readonly noPortsFoundOnRemote: (remote: string) => string;
  readonly portBusy: string;
  readonly noActivePanel: string;
  readonly pickPortFirst: string;
  readonly portNotFound: (portKey: string) => string;
  readonly open: string;
  readonly deviceId: string;
  readonly chip: string;
  readonly vendor: string;
  readonly heldByPanel: (label: string) => string;
  readonly remoteHost: (remote: string) => string;
  readonly stateOpen: string;
  readonly stateOpening: string;
  readonly stateReconnecting: string;
  readonly stateClosed: string;
}

const zh: HostText = {
  appName: '串口助手',
  statusIdle: '串口',
  statusNewPanel: '新建串口面板',
  statusHint: '_点击可切换面板或新建_',
  noPort: '（未选端口）',
  openWebVersion: '打开浏览器版',
  bindingFailed: (reason) =>
    `串口原生模块加载失败：${reason}。当前平台可能缺少 @serialport/bindings-cpp 的预编译产物。`,
  panelPickTitle: '串口面板',
  portPickTitle: '选择串口',
  noPortsFound: '没有找到任何串口设备。',
  noPortsFoundOnRemote: (remote) =>
    `远端（${remote}）上没有找到任何串口设备。要用插在本机上的设备，请把本扩展安装到本地。`,
  portBusy: '已被其他面板占用',
  noActivePanel: '没有处于活动状态的串口面板。',
  pickPortFirst: '请先在面板里选择一个串口。',
  portNotFound: (portKey) => `没有找到端口 ${portKey}`,
  open: '打开',
  deviceId: '设备标识',
  chip: '芯片',
  vendor: '厂商',
  heldByPanel: (label) => `正被面板「${label}」使用`,
  remoteHost: (remote) => `远端：${remote}`,
  stateOpen: '已连接',
  stateOpening: '连接中',
  stateReconnecting: '重连中',
  stateClosed: '未连接',
};

/**
 * 与 zh 同构由 HostText 保证。措辞刻意抄 package.nls.json —— 同一个东西在标签页和
 * 命令面板里两种叫法，比留着中文更让人困惑。
 */
const en: HostText = {
  appName: 'Serial Tool',
  statusIdle: 'Serial',
  statusNewPanel: 'New Serial Panel',
  statusHint: '_Click to switch panels or open a new one_',
  noPort: '(no port)',
  openWebVersion: 'Open the web version',
  bindingFailed: (reason) =>
    `Failed to load the native serial module: ${reason}. This platform may be missing a prebuilt @serialport/bindings-cpp binary.`,
  panelPickTitle: 'Serial Panels',
  portPickTitle: 'Select Port',
  noPortsFound: 'No serial devices found.',
  noPortsFoundOnRemote: (remote) =>
    `No serial devices found on the remote (${remote}). To use devices attached to this computer, install this extension locally.`,
  portBusy: 'In use by another panel',
  noActivePanel: 'No active serial panel.',
  pickPortFirst: 'Select a port in the panel first.',
  portNotFound: (portKey) => `Port ${portKey} not found`,
  open: 'Open',
  deviceId: 'Device ID',
  chip: 'Chip',
  vendor: 'Vendor',
  heldByPanel: (label) => `In use by panel "${label}"`,
  remoteHost: (remote) => `Remote: ${remote}`,
  stateOpen: 'Connected',
  stateOpening: 'Connecting',
  stateReconnecting: 'Reconnecting',
  stateClosed: 'Disconnected',
};

/** 语言标签 → 文案。与 vscode 解耦，好让两半分支都能被测到。 */
export function pickText(language: string): HostText {
  return language.startsWith('zh') ? zh : en;
}

/**
 * 每次调用都重读 env.language，而不是在模块顶层求值一次。
 *
 * 顶层求值会把语言钉死在模块被加载的那一刻。VS Code 改显示语言要重载窗口，
 * 单看运行时没差别，但那样一来两份文案里写漏的那一份就只有对应语言的用户才看得见。
 */
export function hostText(): HostText {
  return pickText(vscode.env.language);
}
