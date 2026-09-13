import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 扩展清单里决定「在商店里搜不搜得到」的那几项。
 *
 * 它们写错了不会让任何功能出错，只会让扩展悄悄变难找；更糟的是商店的硬性约束
 * （关键词上限、合法分类）要到打 tag 之后的发布步骤才会被拒 —— 而那一步失败会
 * 连带跳过网页部署。所以把这些约束写成断言，提前到 CI 里红。
 */

interface Manifest {
  categories: string[];
  keywords: string[];
}

function read(relativePath: string): string {
  // jsdom 环境里 import.meta.url 不是 file: 协议，只能从 vitest 的 root（仓库根）算
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

const raw = read('apps/vscode/package.json');
const manifest = JSON.parse(raw) as Manifest;
const nlsEn = JSON.parse(read('apps/vscode/package.nls.json')) as Record<string, string>;
const nlsZh = JSON.parse(read('apps/vscode/package.nls.zh-cn.json')) as Record<string, string>;

/** 取值来自 https://code.visualstudio.com/api/references/extension-manifest 的 categories 一节。 */
const CATEGORIES = [
  'Programming Languages',
  'Snippets',
  'Linters',
  'Themes',
  'Debuggers',
  'Formatters',
  'Keymaps',
  'SCM Providers',
  'Other',
  'Extension Packs',
  'Language Packs',
  'Data Science',
  'Machine Learning',
  'Visualization',
  'Notebooks',
  'Education',
  'Testing',
];

describe('扩展清单的商店元数据', () => {
  it('关键词不超过商店上限 30 个，也没有只差大小写的重复', () => {
    expect(manifest.keywords.length).toBeLessThanOrEqual(30);
    const folded = new Set(manifest.keywords.map((keyword) => keyword.toLowerCase()));
    expect(folded.size).toBe(manifest.keywords.length);
  });

  /**
   * 中文检索词只能靠关键词命中：商店检索用的是默认（英文）那份名称与简介，
   * zh-cn 的译文只在中文界面里显示。
   *
   * 2026-09 实测 Marketplace 上搜「串口助手」「串口调试」结果为 0，「串口」只有 1 个 ——
   * 这几个词几乎没有竞争，是新扩展最容易排到前面的入口。删掉它们等于放弃这批用户。
   */
  it('中文检索词在关键词里', () => {
    expect(manifest.keywords).toEqual(expect.arrayContaining(['串口', '串口助手', '串口调试']));
  });

  it('分类只用商店认得的取值', () => {
    for (const category of manifest.categories) expect(CATEGORIES).toContain(category);
  });

  /** 占位符缺译文时，商店页和扩展列表里显示的就是字面上的 `%displayName%`。 */
  it('清单里每个 %占位符% 在中英两份文案里都有译文', () => {
    const keys = [...raw.matchAll(/"%([^"%]+)%"/g)].map((match) => match[1]!);
    expect(keys).toEqual(expect.arrayContaining(['displayName', 'description']));
    for (const key of keys) {
      expect(nlsEn[key], `package.nls.json 缺少 ${key}`).toBeTruthy();
      expect(nlsZh[key], `package.nls.zh-cn.json 缺少 ${key}`).toBeTruthy();
    }
    expect(Object.keys(nlsZh).sort()).toEqual(Object.keys(nlsEn).sort());
  });

  /**
   * 在商店里搜到的名字，装上之后要在活动栏、标签页上认得出来：
   * 英文环境两处都有「Serial Tool」，中文环境两处都有「串口助手」。
   */
  it('商店名称包含界面上的名称', () => {
    expect(nlsEn.displayName).toContain(nlsEn['view.container']);
    expect(nlsZh.displayName).toContain(nlsZh['view.container']);
  });
});
