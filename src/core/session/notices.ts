/**
 * 会话通知：core 层不认识任何语言，只发出带 code + 参数的结构化事件，
 * 由 UI 层的 i18n 决定怎么措辞。原型把中英文字符串硬编码在业务逻辑里
 * （`this.sys(en ? "Port opened " : "串口已打开 ")`，全文散落 20 多处），
 * 加一种语言就要改遍所有分支。
 */
export type SessionNotice =
  | { code: 'port-opened'; config: string }
  | { code: 'port-closed' }
  | {
      code: 'open-failed';
      message: string;
      /** 传输层报的是 in-use。界面据此提示用户去找占着它的程序，而不是怀疑设备或参数。 */
      inUse?: true;
    }
  | { code: 'connection-lost' }
  | { code: 'reconnect-scheduled'; attempt: number; max: number; delayMs: number }
  | { code: 'reconnect-succeeded'; attempt: number }
  | { code: 'reconnect-gave-up'; attempts: number }
  | { code: 'read-error'; message: string }
  | { code: 'write-error'; message: string }
  | { code: 'write-dropped-backpressure'; pendingBytes: number }
  | { code: 'not-open' }
  /** 该端口已被本工具的另一个页面占用。多页面各连一口时才会出现。 */
  | { code: 'port-busy' }
  /**
   * 录制到文件的三种回执。
   *
   * 走通知而不是界面自己拼字符串：录制活在会话那一侧（VS Code 里就是扩展宿主进程），
   * 而翻译只发生在渲染时 —— 宿主手里没有文案目录，能交出来的只有结构化事件。
   */
  | { code: 'record-started'; target: string }
  | { code: 'record-stopped'; target: string; lines: number }
  | { code: 'record-error'; message: string }
  /** DTR / RTS / Break 写失败。读失败不报 —— 轮询每秒一次，报了就是刷屏。 */
  | { code: 'signal-error'; message: string };

export type SessionNoticeCode = SessionNotice['code'];

/** send() 没能写出时报的那几种通知。 */
export type SendFailure = Extract<
  SessionNotice,
  { code: 'not-open' | 'write-dropped-backpressure' | 'write-error' }
>;
