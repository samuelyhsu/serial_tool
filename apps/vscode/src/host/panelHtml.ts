/**
 * 把最新偏好重新烙进**隐藏着的**面板的 HTML。
 *
 * 界面只在开机时读 HTML 里烙着的偏好（见 webview/prefStore.ts），而面板被隐藏再显示时，
 * VS Code 按 `webview.html` 的当前值重建界面：隐藏期间设 html 只是记下这个值，不会在
 * 后台载入，重新显示时才拿它建新页面（见 VS Code 源码
 * src/vs/workbench/contrib/webview/browser/overlayWebview.ts 的 setHtml / release / claim）。
 * HTML 若只在建面板时生成一次，切一次标签页，预设、主题、语言等就全退回建面板时的值，
 * 接着再改一次还会把更新的那份覆盖掉。所以偏好一有写入（不管来自哪个面板），
 * 隐藏着的面板都要重新生成；面板刚被隐藏时也要补一次，它可见期间自己改的还没烙进去。
 *
 * 可见的面板一律不动：给正显示着的 webview 设 html 会换掉整个页面、脚本重跑
 * （同一目录下 webviewElement.ts 的 setHtml → pre/index.html 的 content 处理），
 * 用户正在输入的内容、滚动位置都会丢。
 */
export function refreshHiddenPanels<P extends { readonly visible: boolean }>(
  panels: Iterable<P>,
  render: (panel: P) => void,
): void {
  for (const panel of panels) {
    if (!panel.visible) render(panel);
  }
}
