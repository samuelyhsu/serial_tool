import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickText } from './hostText';

/** package.nls.json 是英文那一份（zh-cn 另有一份），扩展清单里的命令名、视图名都来自它。 */
function nls(): Record<string, string> {
  // jsdom 环境里 import.meta.url 不是 file: 协议，只能从 vitest 的 root（仓库根）算
  const raw = readFileSync(resolve(process.cwd(), 'apps/vscode/package.nls.json'), 'utf8');
  return JSON.parse(raw) as Record<string, string>;
}

describe('宿主文案', () => {
  it('按 VS Code 的显示语言在中英之间选', () => {
    expect(pickText('zh-cn').appName).toBe('串口助手');
    expect(pickText('zh-tw').appName).toBe('串口助手');
    expect(pickText('en').appName).toBe('Serial Tool');
    // 没有对应译文的语言退到英文，而不是中文：VS Code 自己也是这么退的
    expect(pickText('ja').appName).toBe('Serial Tool');
  });

  it('两份文案同构，没有把中文原样抄进英文表', () => {
    const zh = pickText('zh-cn');
    const en = pickText('en');

    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const [key, value] of Object.entries(zh)) {
      // 漏译最典型的形态就是两边留着同一个中文串
      if (typeof value === 'string') expect(en[key as keyof typeof en]).not.toBe(value);
    }
  });

  it('带参数的文案两边都真的把参数用上了', () => {
    for (const language of ['zh-cn', 'en']) {
      const t = pickText(language);
      expect(t.bindingFailed('EPERM')).toContain('EPERM');
      expect(t.portNotFound('COM7')).toContain('COM7');
      expect(t.heldByPanel('COM3')).toContain('COM3');
    }
  });

  /**
   * 标签页、状态栏与命令面板并排显示，同一个东西两种叫法比留着中文更让人困惑。
   * 这条断言把两处措辞钉在一起，改了一边忘了另一边就会红。
   */
  it('英文措辞与 package.nls.json 对齐', () => {
    const en = pickText('en');
    const manifest = nls();

    expect(en.appName).toBe(manifest['view.container']);
    expect(en.statusNewPanel).toBe(manifest['cmd.newPanel']);
    expect(manifest['view.empty']).toContain(en.noPortsFound);
  });
});
