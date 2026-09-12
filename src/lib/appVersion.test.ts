import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from './appVersion';

describe('APP_VERSION', () => {
  /**
   * 真相源是扩展清单：release.yml 校验 tag 与它一致。注入错了源，界面上的版本号
   * 就会和 Release 页、商店里的对不上。
   */
  it('与扩展清单 apps/vscode/package.json 的版本一致', () => {
    // jsdom 环境下的 URL 不是 Node 那个，喂给 readFileSync 会被拒，所以按工作目录拼路径
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), 'apps/vscode/package.json'), 'utf8'),
    ) as { version: string };
    expect(APP_VERSION).toBe(manifest.version);
  });
});
