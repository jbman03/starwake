import { describe, expect, it } from 'vitest';
import { buildErrorReport } from './report';

const env = { version: '0.1.0', userAgent: 'UA/1.0', screen: '1920x1080' };

describe('buildErrorReport', () => {
  it('includes message, stack, version, user agent and screen size', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at here (a.js:1:1)';
    const r = buildErrorReport(err, env);
    expect(r).toContain('Message: boom');
    expect(r).toContain('at here (a.js:1:1)');
    expect(r).toContain('Version: 0.1.0');
    expect(r).toContain('User agent: UA/1.0');
    expect(r).toContain('Screen: 1920x1080');
  });

  it('handles non-Error values', () => {
    expect(buildErrorReport('plain string', env)).toContain('Message: plain string');
    expect(buildErrorReport({ a: 1 }, env)).toContain('Message: {"a":1}');
    expect(buildErrorReport(undefined, env)).toContain('Message: undefined');
    expect(buildErrorReport(undefined, env)).toContain('Stack: (none)');
  });

  it('survives unserializable values', () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(() => buildErrorReport(cyc, env)).not.toThrow();
  });
});
