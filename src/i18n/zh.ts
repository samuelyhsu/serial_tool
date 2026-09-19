import type { Messages } from './types';

export const zh: Messages = {
  app: '串口助手',

  port: '端口',
  baud: '波特率',
  baudTip: '可从常用档位中选择，也可直接输入任意值；设备是否支持由驱动决定',
  baudOptions: '常用波特率',
  dataBits: '数据位',
  parity: '校验',
  stopBits: '停止位',
  flow: '流控',
  none: '无',
  autoReconnect: '自动重连',
  signals: '控制信号线',
  outputLineTip:
    '点一下翻转这条输出线。显示的是本工具最后一次设置的值 —— 这两条线读不回来，' +
    '端口刚打开时它们由驱动决定（多数是两条都拉起，ESP32 一开口就复位正是因为这个）。' +
    '本工具不会在打开时替你下发一遍',
  breakTip: '发一个 250ms 的 Break 脉冲：打断 U-Boot、唤醒总线上的从机用它',
  inputLineTip: '对端拉起来的输入线，每秒读一次。VS Code 里读不到 RI，那盏灯恒灭',
  selectPort: '选择端口…',
  selectPortTip: '打开浏览器的端口选择器。选中后可以给它起个备注名，方便下次辨认。',
  changePortTip: '点击可重新选择端口',
  portUnplugged: '已拔出',
  portBusy: '已被其他页面占用',
  aliasLabel: '备注',
  aliasPlaceholder: '给这个端口起个名字',
  aliasTip:
    '浏览器不提供真实端口名（COM3 之类），只给 USB 厂商/产品 ID。' +
    '在这里自己标注设备，刷新后仍然保留。注意：浏览器不暴露序列号，' +
    '无 USB 信息或同型号的多个端口只能按枚举顺序区分，若顺序变化备注可能对调。',
  openPort: '打开串口',
  closePort: '关闭串口',
  disconnected: '未连接',
  opened: '已打开',
  opening: '打开中…',
  reconnecting: '重连中…',
  switchLanguage: '切换语言 / Switch language',
  resizePanes: '拖动调整左右分栏宽度（方向键微调，Home / End 到两端）',
  switchTheme: '切换深色 / 浅色主题',
  payloadLabel: '发送内容',

  receive: '接收区',
  timestamp: '时间',
  timestampNone: '不显示',
  timestampTime: '时间',
  timestampDateTime: '日期 + 时间',
  timestampDelta: '间隔',
  timestampHint: {
    none: '每行前面不显示时间那一列',
    time: '时:分:秒.毫秒',
    datetime: '年-月-日 时:分:秒.毫秒。跨夜抓的日志要它',
    delta: '与上一条的间隔。注意它算的是缓冲里物理上的上一条，隐藏 TX 行不会让间隔变大',
  },
  autoScroll: '自动滚屏',
  showTx: '显示发送',
  filterPlaceholder: '过滤 / 高亮关键字…',
  onlyMatch: '仅匹配',

  framing: '分帧',
  frameModeRaw: '原样显示',
  frameModeIdle: '空闲超时',
  frameModeLine: '按换行',
  idleFrame: '空闲时长',
  idleFrameUnit: 'ms',
  framingHint: {
    raw: '不做分帧：驱动每交付一次就是一行',
    idle: '静默超过设定时长即成一帧',
    line: '遇到换行符即成一帧',
  },
  saveLog: '保存日志',
  record: '录制',
  recordTip:
    '把收发数据边收边写进文件，不受缓冲条数限制 —— 挂一夜等偶发问题用它。' +
    '格式按点下时的 TXT / HEX 定死，只记收发帧，不记系统消息',
  stopRecord: '停止录制',
  recording: (lines) => `录制中 · ${lines} 行`,
  recordUnsupported: '当前环境不支持写入文件',
  clear: '清空',
  confirmClear: '确认清空？',
  noData: '无数据',
  noDataHint: '点「选择端口」授权设备，再打开串口开始接收',
  jumpToBottom: '↓ 回到底部',
  pause: '暂停',
  resume: '继续',
  pauseTip:
    '定住画面看一眼，数据照收照存，只是不往上刷。往上滚也会自动暂停、滚回底部自动恢复；' +
    '手动按下的这个要再按一次才恢复',
  pausedBacklog: (count) => (count > 0 ? `已暂停 · 期间新到 ${count} 条` : '已暂停'),
  logCapacity: '缓冲',
  logCapacityUnit: '条',
  logCapacityHint: (min) =>
    `日志缓冲保留的记录条数（不少于 ${min}，上不封顶）。每条最大 8 KB，条数越大越吃内存；` +
    `改小会立即丢弃超出的旧记录。离开输入框或按回车后生效`,
  hiddenEarlier: (count) =>
    `更早的 ${count} 条未在此显示 —— 它们仍在缓冲里，点「保存」可导出完整日志`,

  singleSend: '单条发送',
  send: '发送',
  singlePlaceholder: '输入要发送的内容，Ctrl+Enter 发送',
  period: '周期',
  loop: '循环',
  stop: '停止',
  bytes: '字节',
  checksum: '校验和',
  checksumAppendTip: '按当前载荷实时计算，发送时自动追加在数据末尾',
  byteCountTip: '真正写到串口上的字节数：转义已解析、校验和已计入',
  copyPayload: '复制',
  copyPayloadTip: '复制最终会发出去的报文：TXT 写成规范化的转义，HEX 含校验和',
  copied: '报文已复制到剪贴板',
  copyFailed: '复制失败：剪贴板不可用',

  multiSend: '多条发送',
  import: '导入',
  importHint: '用文件里的内容替换全部分组',
  append: '追加',
  appendHint: '把文件里的分组接在现有分组之后',
  export: '导出',
  searchPresets: '搜索预设',
  presetMenu: '分组与文件',
  noMatch: '没有匹配的预设',
  moveHint: 'Alt+↑↓ 调整顺序，Alt+Shift+↑↓ 挪到相邻分组',
  tabFull: '相邻分组没有空行了',
  colSequence: '序列',
  colFormat: '格式',
  colData: '数据',
  colSend: '发送',
  colPeriod: '周期 ms',
  colLoop: '循环',
  dataPlaceholder: '数据',
  sequenceLoop: '顺序循环',
  gap: '间隔',
  gapMode: '步间隔',
  gapModeUniform: '统一',
  gapModeEach: '每条',
  gapModeEachHint: '每一步按该条预设自己的周期等待',
  repeat: '重复遍数',
  repeatHint: '整条队列跑几遍后自动停，0 表示一直循环',
  startSequence: '启动顺序循环',
  stopSequence: '停止顺序循环',
  stopAll: '全部停止',
  renamePreset: '重命名发送按钮',
  presetTabs: '预设分组',
  presetTabTitle: (index) => `分组 ${index}`,
  newTab: '新建分组',
  renameTab: '重命名分组',
  tabHint: '双击或按 F2 重命名，按 Delete 删除',
  deleteTab: (title) => `删除分组「${title}」`,
  confirmDeleteTab: '确认删除？',
  toggleHexMode: '切换 TXT / HEX 模式',
  formatToggleLabel: (current, next) => `数据格式：${current}，点击切换为 ${next}`,

  frames: '帧',
  uptime: '运行',
  noTimer: '无周期任务',
  queued: (bytes) => `积压 ${bytes} B`,

  unsupportedTitle: '此浏览器不支持 Web Serial',
  unsupportedBody:
    '请改用 Chrome、Edge 或其他 Chromium 内核浏览器，并通过 HTTPS 或 localhost 访问本页面。',
  unsupportedLink: '查看 MDN 上的浏览器兼容性说明',

  crashTitle: '界面出错了',
  crashBody: '发生了未预期的错误。刷新页面即可恢复，串口不会受影响。',
  reload: '刷新页面',

  presetCount: (total, inSequence) => `${total} 条 · ${inSequence} 条在序列中`,
  sequenceHint: (count) => (count > 0 ? `按序依次发送 ${count} 条` : '先勾选要参与循环的指令'),
  runningTasks: (count) => `${count} 个周期任务运行中`,

  notice: (notice) => {
    switch (notice.code) {
      case 'port-opened':
        return `串口已打开 ${notice.config}`;
      case 'port-closed':
        return '串口已关闭';
      case 'open-failed':
        return notice.inUse
          ? `打开失败：${notice.message}（端口可能正被其他程序或另一个 VS Code 窗口占用）`
          : `打开失败：${notice.message}`;
      case 'connection-lost':
        return '连接意外断开';
      case 'reconnect-scheduled':
        return `正在重连… (${notice.attempt}/${notice.max})，${notice.delayMs} ms 后重试`;
      case 'reconnect-succeeded':
        return `重连成功（第 ${notice.attempt} 次尝试）`;
      case 'reconnect-gave-up':
        return `重连失败，已尝试 ${notice.attempts} 次`;
      case 'read-error':
        return `读取错误：${notice.message}`;
      case 'write-error':
        return `写入错误：${notice.message}`;
      case 'write-dropped-backpressure':
        return `发送过快，本次已丢弃（队列积压 ${notice.pendingBytes} 字节）。请降低发送频率或提高波特率`;
      case 'not-open':
        return '串口未打开，发送已忽略';
      case 'port-busy':
        return '该端口已被本工具的另一个页面打开，请先在那个页面关闭它';
      case 'record-started':
        return `开始录制到 ${notice.target}`;
      case 'record-stopped':
        return `录制结束，共 ${notice.lines} 行写入 ${notice.target}`;
      case 'record-error':
        return `录制写入失败：${notice.message}`;
      case 'signal-error':
        return `信号线设置失败：${notice.message}`;
    }
  },

  hexError: (error) =>
    error.kind === 'invalid-char'
      ? `HEX 格式错误：第 ${error.index + 1} 个字符 “${error.char}” 不是十六进制数字`
      : `HEX 格式错误：“${error.token}” 的位数是奇数，无法拼成完整字节`,

  escapeError: (error) =>
    error.kind === 'unknown-escape'
      ? `转义错误：第 ${error.index + 1} 个字符起的 “\\${error.char}” 不是已知的转义`
      : error.kind === 'bad-hex-escape'
        ? `转义错误：第 ${error.index + 1} 个字符起的 \\x 后面要跟两位十六进制数字`
        : '转义错误：末尾的反斜杠后面缺字符；要发反斜杠本身请写 \\\\',
  importedPresets: (count) => `已导入 ${count} 条预设`,
  appendedPresets: (count) => `已追加 ${count} 条预设`,
  importFailed: (reason) => `导入失败：${reason}`,
  exportedLog: (lines) => `日志已导出，共 ${lines} 行`,
  exportedPresets: '发送预设已导出',
  clearedLog: '日志与统计已清空',
  capacityChanged: (capacity) => `日志缓冲容量已改为 ${capacity} 条`,
  capacityDropped: (capacity, dropped) =>
    `日志缓冲容量已改为 ${capacity} 条，丢弃了最旧的 ${dropped} 条记录`,
  stoppedAll: '已停止全部周期发送',
  openPortFirst: '请先打开串口',
  closePortFirst: '请先关闭串口再修改此项',
  portAuthorized: '端口已授权，现在可以打开',
  portPickerDismissed:
    '未选择端口：选择器已关闭。如果弹窗里是空的，说明浏览器没有枚举到任何串口 —— ' +
    '可在 chrome://device-log 查看枚举记录，并确认设备管理器里的 COM 口工作正常。',
  portPickerBlocked:
    '浏览器拒绝了串口访问。请检查 chrome://settings/content/serialPorts 中本站是否被禁止，' +
    '或是否有企业策略（chrome://policy 的 DefaultSerialGuardSetting）限制。',
  portRequestFailed: (reason) => `选择端口失败：${reason}`,
  taskLagging: (name) => `「${name}」上一帧尚未发完，本次已跳过`,

  presetNames: {
    queryVersion: '查询版本',
    readStatus: '读取状态',
    readTempHumidity: '读温湿度',
    readVoltage: '读取电压',
    heartbeat: '心跳包',
    relayOn: '继电器1 开',
    relayOff: '继电器1 关',
    outputEnable: '使能输出',
    saveConfig: '保存参数',
    softReset: '软复位',
  },
};
