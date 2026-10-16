// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testFlags, testHookActive } from './testHook';

afterEach(() => vi.unstubAllEnvs());

describe('test hook gating', () => {
  it('is active in dev builds', () => {
    vi.stubEnv('DEV', true);
    expect(testHookActive()).toBe(true);
    expect(testFlags('?crash=1').crash).toBe(true);
  });

  it('is never active in production, even when the URL mentions test', () => {
    vi.stubEnv('DEV', false);
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('https://example.test/starwake/?test&crash=1&baddata=1');
    expect(testHookActive()).toBe(false);
    expect(testFlags('?test&crash=1&baddata=1')).toEqual({ crash: false });
  });
});
