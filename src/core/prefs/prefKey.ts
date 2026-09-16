/**
 * 偏好键名的统一前缀。
 *
 * 它本来只是 localStorage 的命名空间（同源下这张表与站点上别的脚本共用），
 * 但键名会**原样穿过 RPC 存进 VS Code 宿主的 globalState**：webview 写什么键，
 * 宿主就存什么键。宿主要认出其中某一项（比如端口备注）就得算出同一个键名，
 * 而它不该 import 只属于浏览器的 lib/storage。所以前缀的唯一定义放在 core。
 */
const PREFIX = 'wst.';

/** 带前缀的完整键名。storage 事件回调与宿主侧的偏好比对都要用它。 */
export function prefKey(name: string): string {
  return PREFIX + name;
}
