/**
 * 构建时注入的版本号（vite.config.ts 与 apps/vscode/vite.webview.config.ts 的 define）。
 *
 * 全仓库唯一的版本号在扩展清单 apps/vscode/package.json 里 —— 那是 vsce 与商店强制要读的
 * 必填字段，删不掉；根 package.json 是 private 的 workspace 根、从不发布，所以干脆不写版本，
 * 免得出现两个号。release.yml 校验 tag 与扩展清单一致，网页版也跟着同一个 tag 部署，
 * 于是界面上的版本号与 Release 页、商店里的天然对得上。
 *
 * 声明写在模块里而不是全局 .d.ts：tsconfig.webview.json 只 include 自己那两个目录，
 * 放在 src 下的全局声明它看不见；模块则是顺着 import 被带进去的，两边都能解析。
 */
declare const __APP_VERSION__: string;

export const APP_VERSION = __APP_VERSION__;
