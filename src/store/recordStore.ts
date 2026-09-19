import { create } from 'zustand';
import type { RecordingStatus } from '@/core/log/recorder';
import { platform } from './platform';
import { useUiStore } from './uiStore';

/**
 * 录制状态的镜子。
 *
 * 真相源是运行环境持有的录制器（浏览器里就在页面内，VS Code 里在扩展宿主进程），
 * 与周期任务同一个套路：界面只读 `status`，不另存一份「是否在录」的布尔标志 ——
 * 那样迟早会出现「按钮显示在录、文件其实早停了」。
 */
const recorder = platform().recorder;

interface RecordState {
  status: RecordingStatus;
  /** 这个环境能不能落盘。不能时按钮禁用，而不是点了没反应。 */
  supported: boolean;
  /**
   * 开始 / 停止。
   *
   * **必须由按钮的 click 直接调用**：浏览器只在用户手势里才肯弹文件选择器，
   * 中间隔一个 await 就会被拒。
   */
  toggle: () => Promise<void>;
}

export const useRecordStore = create<RecordState>()((set) => {
  recorder.subscribe((status) => set({ status }));

  return {
    status: recorder.status(),
    supported: recorder.supported,

    toggle: async () => {
      if (recorder.status().active) {
        await recorder.stop();
        return;
      }
      // 文件里的格式取点下这一刻的接收区视图，之后界面再切也不影响已开的文件
      await recorder.start(useUiStore.getState().view);
    },
  };
});
