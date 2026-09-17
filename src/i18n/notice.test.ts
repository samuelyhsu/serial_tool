import { describe, expect, it } from 'vitest';
import { LANGUAGES, messagesFor } from './index';

describe('会话通知的文案', () => {
  it('端口被占导致的打开失败，两种语言都提示去找占用者，并保留底层原因', () => {
    for (const language of LANGUAGES) {
      const t = messagesFor(language);
      const plain = t.notice({ code: 'open-failed', message: 'Opening COM3: Access denied' });
      const inUse = t.notice({
        code: 'open-failed',
        message: 'Opening COM3: Access denied',
        inUse: true,
      });

      expect(inUse).toContain('Opening COM3: Access denied');
      expect(inUse).toContain('VS Code');
      expect(plain).not.toContain('VS Code');
    }
  });
});
