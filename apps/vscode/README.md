# Serial Tool · 串口助手

A serial port monitor for embedded development, right inside VS Code: talk to UART / COM ports
through USB-serial adapters, dev boards and RS-232 / RS-485 converters.
**One panel = one session = one port** — open two panels to watch two boards side by side.

中文说明见[下方](#中文说明)。

![A serial panel: port settings and control lines on top, log in the middle, send pane and presets on the right, readouts and log settings along the bottom](media/screenshot.png)

## Getting started

Click 🔌 in the Activity Bar, then **click a port to connect**. The list refreshes as you plug
and unplug devices.

Connected ports turn green; clicking one switches to its panel instead of opening another.
To open the same port in another panel, use the `+` at the end of its row. Other entry points:
`🔌 Serial` in the status bar, the `+` in a serial panel's title bar, and **New Serial Panel** /
**Serial Panels…** in the Command Palette.

Split the editor to watch two boards at once — each panel keeps its own session, log and presets:

![COM1 and COM2 side by side in a split editor, each panel with its own log and send pane](media/screenshot1.png)

## Features

- **The connection lives in the extension host**: hiding the panel or switching back to your code
  doesn't drop the port, and periodic sends keep running
- HEX and text views, timestamps, auto-scroll, filter & highlight, log export
- A status bar along the bottom: byte and frame counts with separate RX / TX throughput, uptime,
  write-queue backlog, plus the timestamp, framing and log-buffer settings
- Receive framing by idle timeout, by line or raw; UTF-8 text is decoded correctly across chunks
- Single send, periodic send, command presets in tabbed groups (3 by default; add, rename and delete your own) with a sequence loop, JSON import / export
- 17 checksums appended automatically in HEX mode: CRC-8 / CRC-16 / CRC-32 (incl. CRC-16/MODBUS),
  SUM8, SUM16, XOR8
- 51 common baud rates from 50 to 4,000,000, or type any value; data bits, parity, stop bits,
  RTS/CTS flow control
- Auto-reconnect with exponential backoff after the device is unplugged
- Ports are labeled the way Device Manager shows them, plus the chip name: `COM3 · CH340`
- A port held by another panel is flagged up front, instead of failing with
  `Failed to open serial port`
- Devices are recognized by USB serial number: baud rate and alias follow the device to any USB port
- **AI chat tools**: in agent mode, or referenced as `#serialPorts` / `#serialOutput` / `#serialSend`,
  the assistant can list ports, read what a panel has captured and send data to a port that is
  already open. It cannot open or close ports, and each send asks for confirmation. Serial data the
  assistant reads is passed to the chat's language model
- English and Chinese UI, following VS Code's display language
- No telemetry and no network requests — works fully offline
- Prebuilt native binaries for Windows (x64, arm64, ia32), macOS (Intel and Apple Silicon)
  and Linux (x64, arm, arm64)

## ⚠️ The bytes you send have physical effects

- Wrong data or a wrong baud rate can brick firmware; a frame can trigger relays, motors or cylinders
- **Periodic send keeps sending** after you switch tabs or hide the panel — by design
- On ESP32, Arduino boards with an auto-reset circuit and the like, **just opening the port**
  resets the board via DTR/RTS
- Sends from the AI chat tools are real writes. Check the port and bytes in the confirmation, and
  think twice before letting it send without asking

Only use it on devices you are authorized to operate. Provided "as is", without warranty of any kind.

## Known limitations

In remote development (SSH / WSL / containers), the ports you see are those of **the machine the
extension host runs on**.

## Also available as a web app

The same core and UI as a plain web page: <https://serial.uplume.com/> — open it in Chrome or Edge,
nothing to install.

---

## 中文说明

VS Code 里的串口调试助手，给单片机与嵌入式开发用：USB 转串口、开发板、RS-232 / RS-485
转换器都能直接连。**一个面板 = 一条会话 = 一个端口**——想同时盯两块板子，就开两个面板
各连一个口，互不干扰。

### 上手

点左侧活动栏的 🔌，端口列表里**点一个就直接连上**。插拔设备列表会自己刷新。

已连接的口标成绿色，点它是切到对应面板而不是再开一个；同一个口想再开一个面板，
用行尾的 `+`。其余入口：状态栏的 `🔌 串口`、串口面板标题栏的 `+`、命令面板的
「新建串口面板」/「串口面板…」。

### 能做什么

- **串口连接活在扩展宿主进程里**：面板被隐藏、切去看代码都不会断，周期发送照跑
- HEX / 文本双视图，时间戳、自动滚动、过滤高亮、日志导出
- 底部状态栏：收发字节数与帧数、**收发各自的实时速率**、运行时长、写队列积压，
  以及时间列、分帧、日志缓冲容量这几项设置
- 按空闲超时 / 换行 / 原始分块分帧，UTF-8 跨块解码，被切开的汉字不乱码
- 单条发送、周期发送，指令预设按分组标签页管理（默认 3 组，可新建、改名、删除）与顺序循环，预设可 JSON 导入导出
- HEX 模式自动追加 17 种校验和：CRC-8 / CRC-16 / CRC-32（含 CRC-16/MODBUS）、SUM8、SUM16、XOR8
- 波特率 50 ~ 4000000 共 51 档常用值，也可直接输入任意值；数据位、校验位、停止位、RTS/CTS 流控
- 拔掉设备后按指数退避自动重连
- 端口名与设备管理器一致，并附芯片名：`COM3 · CH340`
- 端口被别的面板占着时直接拦下并说明原因，而不是一句 `Failed to open serial port`
- 设备身份带 USB 序列号，换个 USB 口插也认得出来，波特率和备注跟着设备走
- **AI 聊天工具**：在 agent 模式下，或用 `#serialPorts` / `#serialOutput` / `#serialSend` 引用，助手可以
  列出串口、读取面板已捕获的收发数据、向已打开的串口发送数据。它不能打开或关闭端口，每次发送都会
  请你确认。助手读到的串口数据会交给聊天所用的模型
- 中英双语界面，跟随 VS Code 显示语言
- 不收集遥测、不发任何网络请求，离线可用

### ⚠️ 发出去的字节有物理后果

- 内容或波特率写错可能刷坏固件；报文可能触发继电器、电机、气缸等机械动作
- **周期发送会一直发下去**，包括你切走标签页、隐藏面板之后——这是设计如此
- 在 ESP32、带自动下载电路的 Arduino 等板子上，**仅仅「打开端口」这个动作**
  就会通过 DTR/RTS 触发复位
- AI 聊天工具的发送是真实写入。允许之前看清确认框里的端口和字节，慎用免确认

请只在你有权操作的设备上使用。本工具按「现状」提供，不作任何担保。

### 已知限制

远程开发（SSH / WSL / 容器）时，打开的是**扩展宿主所在那台机器**的串口。

### 另有网页版

同一套核心与界面的纯网页版：<https://serial.uplume.com/>，用 Chrome 或 Edge 打开即用，
不需要安装任何东西。

## License · 许可证

[MIT](LICENSE)
