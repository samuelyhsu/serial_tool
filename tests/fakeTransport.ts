import { TransportError } from '@/core/transport/errors';
import type {
  CloseReason,
  ConnectionOptions,
  InputSignals,
  OutputSignals,
  Transport,
  TransportEvents,
  TransportState,
} from '@/core/transport/types';

/**
 * 测试替身：实现与 WebSerialTransport 完全相同的 Transport 接口。
 *
 * 它让「打开 → 收帧 → 掉线 → 退避重连 → 恢复」这条最容易出错、又最难在真机上复现的
 * 链路可以在 CI 里跑成确定性测试。注意它只存在于 tests/ 下，不会被打进产物。
 */
export class FakeTransport implements Transport {
  state: TransportState = 'closed';
  pendingBytes = 0;

  readonly written: Uint8Array[] = [];
  readonly openCalls: ConnectionOptions[] = [];
  /** 设为非 null 时，下一次 open() 会以该错误失败（用于测试重连的失败分支）。 */
  failNextOpen: Error | null = null;

  /** 每次 setSignals 的原始入参，按顺序。测试据此确认「只动被提到的那几条线」。 */
  readonly signalWrites: OutputSignals[] = [];
  /** 累积后的输出线状态。 */
  outputs: OutputSignals = {};
  /** getSignals 返回什么，由测试摆布。 */
  inputs: InputSignals = {
    clearToSend: false,
    dataCarrierDetect: false,
    dataSetReady: false,
    ringIndicator: false,
  };
  /** 设为非 null 时，信号线读写一律以该错误失败。 */
  failSignals: TransportError | null = null;

  readonly #handlers = new Set<Partial<TransportEvents>>();
  #openGate: Promise<void> | null = null;
  /** 配合 blockOpen()：调用后 open() 才继续。 */
  releaseOpen: () => void = () => undefined;

  /** 让下一次 open() 挂起，模拟驱动打开端口需要时间。 */
  blockOpen(): void {
    this.#openGate = new Promise<void>((resolve) => {
      this.releaseOpen = resolve;
    });
  }

  async open(options: ConnectionOptions): Promise<void> {
    if (this.#openGate) {
      const gate = this.#openGate;
      this.#openGate = null;
      await gate;
    }
    if (this.failNextOpen) {
      const error = this.failNextOpen;
      this.failNextOpen = null;
      this.state = 'closed';
      return Promise.reject(error);
    }
    this.openCalls.push(options);
    this.state = 'open';
    return Promise.resolve();
  }

  close(): Promise<void> {
    if (this.state === 'closed') return Promise.resolve();
    this.state = 'closed';
    this.#emit((h) => h.onClose?.('local'));
    return Promise.resolve();
  }

  write(data: Uint8Array): Promise<void> {
    if (this.state !== 'open') {
      return Promise.reject(new TransportError('invalid-state', 'Port is not open'));
    }
    this.written.push(data);
    return Promise.resolve();
  }

  setSignals(signals: OutputSignals): Promise<void> {
    if (this.state !== 'open') {
      return Promise.reject(new TransportError('invalid-state', 'Port is not open'));
    }
    if (this.failSignals) return Promise.reject(this.failSignals);
    this.signalWrites.push(signals);
    // 只合并调用方提到的那几条线，与真实传输层一致
    this.outputs = { ...this.outputs, ...signals };
    return Promise.resolve();
  }

  getSignals(): Promise<InputSignals> {
    if (this.state !== 'open') {
      return Promise.reject(new TransportError('invalid-state', 'Port is not open'));
    }
    if (this.failSignals) return Promise.reject(this.failSignals);
    return Promise.resolve(this.inputs);
  }

  subscribe(handlers: Partial<TransportEvents>): () => void {
    this.#handlers.add(handlers);
    return () => this.#handlers.delete(handlers);
  }

  /* ---------- 测试驱动接口 ---------- */

  /** 模拟设备发来一段数据。 */
  emitData(bytes: Uint8Array | number[]): void {
    const chunk = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    this.#emit((h) => h.onData?.(chunk));
  }

  emitError(error: TransportError): void {
    this.#emit((h) => h.onError?.(error));
  }

  /** 模拟设备被拔出：非本地原因的关闭。 */
  emitUnplug(reason: CloseReason = 'remote'): void {
    this.state = 'closed';
    this.#emit((h) => h.onClose?.(reason));
  }

  /** 拒绝写入（模拟背压）。 */
  rejectWritesWith(error: TransportError): void {
    this.write = () => Promise.reject(error);
  }

  #emit(fn: (handlers: Partial<TransportEvents>) => void): void {
    for (const handlers of [...this.#handlers]) fn(handlers);
  }
}

export const TEST_OPTIONS: ConnectionOptions = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
};
