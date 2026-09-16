import { describe, expect, it } from 'vitest';
import {
  LOG_CAPACITY_CEILING,
  LOG_CAPACITY_MIN,
  LOG_CAPACITY_PREF_KEY,
  parseLogCapacity,
} from './logCapacity';

describe('parseLogCapacity', () => {
  it('收下界面写下的 JSON 文本', () => {
    expect(parseLogCapacity('50000')).toBe(50000);
    expect(parseLogCapacity(JSON.stringify(LOG_CAPACITY_MIN))).toBe(LOG_CAPACITY_MIN);
    expect(parseLogCapacity(JSON.stringify(LOG_CAPACITY_CEILING))).toBe(LOG_CAPACITY_CEILING);
  });

  it('不合法的容量一律当作没设过', () => {
    for (const bad of [LOG_CAPACITY_MIN - 1, 1.5, LOG_CAPACITY_CEILING + 1, 'many', null]) {
      expect(parseLogCapacity(JSON.stringify(bad))).toBeNull();
    }
  });

  it('存量值被改坏、或根本没存过时也是 null', () => {
    expect(parseLogCapacity('{')).toBeNull();
    expect(parseLogCapacity(undefined)).toBeNull();
    expect(parseLogCapacity(null)).toBeNull();
  });
});

/** 写死字面量：这是存量用户那里已经存着的键名，改了它，已有的容量设定就读不回来了。 */
describe('LOG_CAPACITY_PREF_KEY', () => {
  it('就是带前缀的那个键名', () => {
    expect(LOG_CAPACITY_PREF_KEY).toBe('wst.logCapacity');
  });
});
