import type { TransportError } from './errors';

export type Parity = 'none' | 'even' | 'odd';
export type FlowControl = 'none' | 'hardware';
export type TransportState = 'closed' | 'opening' | 'open' | 'closing';
/** local = 本地主动关闭；remote = 对端/设备消失；error = 因错误终止 */
export type CloseReason = 'local' | 'remote' | 'error';

/**
 * 端口信息的最小公共形状。
 *
 * core 只依赖这个结构，两侧各自填自己能拿到的字段：
 *  - 浏览器（Web Serial）只给 VID/PID —— 序列号至今拿不到（WICG/serial#175）；
 *  - 桌面（Node + serialport）还能给出序列号与设备路径，因此设备身份可以做得更稳。
 *
 * `SerialPortInfo` 在结构上是它的子类型，所以既有调用方一行都不用改。
 */
export interface PortInfoLike {
  usbVendorId?: number | undefined;
  usbProductId?: number | undefined;
  bluetoothServiceClassId?: number | string | undefined;
  /** 桌面端才有：设备序列号，跨会话稳定，是最可靠的设备身份。 */
  serialNumber?: string | undefined;
  /** 桌面端才有：`COM3` / `/dev/ttyUSB0`。 */
  path?: string | undefined;
}

export interface ConnectionOptions {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: Parity;
  flowControl: FlowControl;
  bufferSize?: number;
}

/**
 * 输出信号线。字段名照搬 Web Serial 的 `SerialOutputSignals`，
 * 桌面端在自己那一层映射成 serialport 的 dtr / rts / brk。
 *
 * 只传要改的那几个：一次 setSignals 把没提到的线也一起写一遍，
 * 在带自动下载电路的开发板上就是一次意料之外的复位。
 */
export interface OutputSignals {
  dataTerminalReady?: boolean;
  requestToSend?: boolean;
  break?: boolean;
}

/** 输入信号线，与 Web Serial 的 `SerialInputSignals` 同形。 */
export interface InputSignals {
  clearToSend: boolean;
  dataCarrierDetect: boolean;
  dataSetReady: boolean;
  ringIndicator: boolean;
}

export interface TransportEvents {
  onData: (chunk: Uint8Array) => void;
  onError: (error: TransportError) => void;
  onClose: (reason: CloseReason) => void;
}

export interface Transport {
  readonly state: TransportState;
  /** 已进入写队列但尚未真正写出的字节数，背压的观测点（缺陷 D10）。 */
  readonly pendingBytes: number;
  open(options: ConnectionOptions): Promise<void>;
  close(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  /**
   * 改输出信号线。端口没打开时抛 invalid-state。
   *
   * 这是「手动把板子拉进 bootloader」「复位 STM32」「用 Break 唤醒总线设备」
   * 唯一的入口 —— 打开端口本身会不会拉 DTR 由驱动决定，用户控制不了。
   */
  setSignals(signals: OutputSignals): Promise<void>;
  /** 读输入信号线。没有事件可订阅，只能轮询。 */
  getSignals(): Promise<InputSignals>;
  /** 返回取消订阅函数。 */
  subscribe(handlers: Partial<TransportEvents>): () => void;
}
