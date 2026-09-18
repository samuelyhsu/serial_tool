import type { Messages } from './types';

export const en: Messages = {
  app: 'Serial Tool',

  port: 'Port',
  baud: 'Baud',
  baudTip:
    'Pick a common rate or type any value; whether the device accepts it is up to the driver',
  baudOptions: 'Common baud rates',
  dataBits: 'Data',
  parity: 'Parity',
  stopBits: 'Stop',
  flow: 'Flow',
  none: 'None',
  autoReconnect: 'Auto-reconnect',
  selectPort: 'Choose port…',
  selectPortTip: 'Opens the browser port chooser. You can label the port afterwards.',
  changePortTip: 'Click to choose a different port',
  portUnplugged: 'unplugged',
  portBusy: 'in use elsewhere',
  aliasLabel: 'Label',
  aliasPlaceholder: 'Name this port',
  aliasTip:
    'The browser does not expose real port names (COM3 and the like), only USB vendor/product IDs. ' +
    'Label the device yourself here; it survives reloads. Note: the browser exposes no serial ' +
    'number, so ports without USB info (or identical models) are told apart by enumeration order — ' +
    'labels may swap if that order changes.',
  openPort: 'Open port',
  closePort: 'Close port',
  disconnected: 'Disconnected',
  opened: 'open',
  opening: 'opening…',
  reconnecting: 'reconnecting…',
  switchLanguage: 'Switch language / 切换语言',
  resizePanes: 'Drag to resize the panes (arrow keys nudge, Home / End jump to the limits)',
  switchTheme: 'Switch dark / light theme',
  payloadLabel: 'Payload',

  receive: 'Receive',
  timestamp: 'Timestamp',
  autoScroll: 'Auto-scroll',
  showTx: 'Show TX',
  filterPlaceholder: 'Filter / highlight…',
  onlyMatch: 'Matches only',

  framing: 'Framing',
  frameModeRaw: 'Raw chunks',
  frameModeIdle: 'Idle timeout',
  frameModeLine: 'On newline',
  idleFrame: 'Idle',
  idleFrameUnit: 'ms',
  framingHint: {
    raw: 'No framing: one row per driver delivery',
    idle: 'Silence longer than the set time ends a frame',
    line: 'A newline ends a frame',
  },
  saveLog: 'Save log',
  clear: 'Clear',
  confirmClear: 'Confirm clear?',
  noData: 'No data',
  noDataHint: 'Choose a port to grant access, then open it to start receiving',
  jumpToBottom: '↓ Back to bottom',
  scrollPaused: 'Auto-scroll paused',
  logCapacity: 'Buffer',
  logCapacityUnit: 'entries',
  logCapacityHint: (min) =>
    `Entries kept in the log buffer (at least ${min}, no upper limit). Each entry is up to 8 KB, ` +
    `so a larger buffer costs more memory; shrinking drops the oldest immediately. ` +
    `Applied on blur or Enter`,
  hiddenEarlier: (count) =>
    `${count} earlier entries are not shown here — they are still buffered; use Save to export the full log`,

  singleSend: 'Single send',
  eol: 'EOL',
  send: 'Send',
  singlePlaceholder: 'Type payload, Ctrl+Enter to send',
  period: 'Every',
  loop: 'Loop',
  stop: 'Stop',
  bytes: 'bytes',
  checksum: 'Checksum',
  checksumAppendTip: 'Computed live from the payload and appended automatically when sending',

  multiSend: 'Multi send',
  import: 'Import',
  importHint: 'Replace every group with the contents of the file',
  append: 'Append',
  appendHint: 'Add the groups in the file after the existing ones',
  export: 'Export',
  searchPresets: 'Search presets',
  presetMenu: 'Groups and files',
  noMatch: 'No preset matches',
  moveHint: 'Alt+Up/Down reorders, Alt+Shift+Up/Down moves across groups',
  tabFull: 'The adjacent group has no empty row left',
  colSequence: 'Seq',
  colFormat: 'Fmt',
  colData: 'Payload',
  colSend: 'Send',
  colPeriod: 'Every ms',
  colLoop: 'Loop',
  dataPlaceholder: 'Payload',
  sequenceLoop: 'Sequence loop',
  gap: 'Gap',
  gapMode: 'Step delay',
  gapModeUniform: 'Uniform',
  gapModeEach: 'Per row',
  gapModeEachHint: 'Each step waits the period set on that row',
  repeat: 'Repeat count',
  repeatHint: 'Stop after this many passes; 0 loops forever',
  startSequence: 'Start sequence',
  stopSequence: 'Stop sequence',
  stopAll: 'Stop all',
  renamePreset: 'Rename send button',
  presetTabs: 'Preset groups',
  presetTabTitle: (index) => `Group ${index}`,
  newTab: 'New group',
  renameTab: 'Rename group',
  tabHint: 'Double-click or press F2 to rename, Delete to remove',
  deleteTab: (title) => `Delete group "${title}"`,
  confirmDeleteTab: 'Confirm delete?',
  toggleHexMode: 'Toggle TXT / HEX mode',
  formatToggleLabel: (current, next) => `Data format: ${current}, click to switch to ${next}`,

  frames: 'fr',
  uptime: 'Uptime',
  noTimer: 'No periodic task',
  queued: (bytes) => `${bytes} B queued`,

  unsupportedTitle: 'This browser has no Web Serial',
  unsupportedBody:
    'Use Chrome, Edge or another Chromium-based browser, and open this page over HTTPS or localhost.',
  unsupportedLink: 'See browser compatibility on MDN',

  crashTitle: 'Something went wrong',
  crashBody: 'An unexpected error occurred. Reloading recovers the UI; the port is unaffected.',
  reload: 'Reload page',

  presetCount: (total, inSequence) => `${total} items · ${inSequence} in sequence`,
  sequenceHint: (count) =>
    count > 0 ? `${count} selected, sent in order` : 'tick the rows to include',
  runningTasks: (count) => `${count} periodic task(s) running`,

  notice: (notice) => {
    switch (notice.code) {
      case 'port-opened':
        return `Port opened ${notice.config}`;
      case 'port-closed':
        return 'Port closed';
      case 'open-failed':
        return notice.inUse
          ? `Open failed: ${notice.message} (the port may be in use by another program or another VS Code window)`
          : `Open failed: ${notice.message}`;
      case 'connection-lost':
        return 'Connection lost';
      case 'reconnect-scheduled':
        return `Reconnecting… (${notice.attempt}/${notice.max}), retry in ${notice.delayMs} ms`;
      case 'reconnect-succeeded':
        return `Reconnected on attempt ${notice.attempt}`;
      case 'reconnect-gave-up':
        return `Reconnect failed after ${notice.attempts} attempts`;
      case 'read-error':
        return `Read error: ${notice.message}`;
      case 'write-error':
        return `Write error: ${notice.message}`;
      case 'write-dropped-backpressure':
        return `Sending too fast — frame dropped (${notice.pendingBytes} bytes queued). Lower the rate or raise the baud rate`;
      case 'not-open':
        return 'Port is closed — send ignored';
      case 'port-busy':
        return 'This port is already open in another page of this tool. Close it there first.';
    }
  },

  hexError: (error) =>
    error.kind === 'invalid-char'
      ? `Invalid hex: character ${error.index + 1} ("${error.char}") is not a hex digit`
      : `Invalid hex: "${error.token}" has an odd number of digits`,

  escapeError: (error) =>
    error.kind === 'unknown-escape'
      ? `Escape error: "\\${error.char}" at character ${error.index + 1} is not a known escape`
      : error.kind === 'bad-hex-escape'
        ? `Escape error: \\x at character ${error.index + 1} needs two hex digits`
        : 'Escape error: the trailing backslash has nothing after it; write \\\\ to send a backslash',
  importedPresets: (count) => `Imported ${count} presets`,
  appendedPresets: (count) => `Appended ${count} presets`,
  importFailed: (reason) => `Import failed: ${reason}`,
  exportedLog: (lines) => `Log exported, ${lines} lines`,
  exportedPresets: 'Presets exported',
  clearedLog: 'Log and counters cleared',
  capacityChanged: (capacity) => `Log buffer capacity set to ${capacity} entries`,
  capacityDropped: (capacity, dropped) =>
    `Log buffer capacity set to ${capacity} entries, dropped the ${dropped} oldest`,
  stoppedAll: 'All periodic sends stopped',
  openPortFirst: 'Open the port first',
  closePortFirst: 'Close the port before changing this',
  portAuthorized: 'Port authorized — you can open it now',
  portPickerDismissed:
    'No port selected: the chooser was dismissed. If the dialog was empty, the browser found ' +
    'no serial ports — check chrome://device-log and confirm the COM ports are healthy in Device Manager.',
  portPickerBlocked:
    'The browser denied serial access. Check chrome://settings/content/serialPorts for this site, ' +
    'and any enterprise policy (DefaultSerialGuardSetting in chrome://policy).',
  portRequestFailed: (reason) => `Port request failed: ${reason}`,
  taskLagging: (name) => `"${name}" is still sending the previous frame — this tick was skipped`,

  presetNames: {
    queryVersion: 'Query version',
    readStatus: 'Read status',
    readTempHumidity: 'Read T/RH',
    readVoltage: 'Read voltage',
    heartbeat: 'Heartbeat',
    relayOn: 'Relay 1 ON',
    relayOff: 'Relay 1 OFF',
    outputEnable: 'Output enable',
    saveConfig: 'Save config',
    softReset: 'Soft reset',
  },
};
