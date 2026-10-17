import { describe, expect, it } from 'vitest';
import { clearProgress, loadProgress, saveProgress, type Progress } from './progress';

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  } as Storage;
}
const fail = (): never => {
  throw new Error('blocked');
};
const throwing = { getItem: fail, setItem: fail, removeItem: fail } as unknown as Storage;

const p: Progress = {
  step: 7,
  done: false,
  target: { good: 'food', system: 'tessaly', port: 'vanterre' },
  startCredits: 10000,
  startPos: { x: 1, y: 2 },
  buyPort: 'halcyon',
};

describe('progress', () => {
  it('round-trips per pilot under starwake.guide.<id>', () => {
    const s = memory();
    expect(saveProgress('a', p, s)).toBe(true);
    expect(s.getItem('starwake.guide.a')).not.toBeNull();
    expect(loadProgress('a', s)).toEqual(p);
    expect(loadProgress('b', s)).toBeNull();
  });
  it('accepts older progress saved before buyPort existed', () => {
    const s = memory();
    const { buyPort: _, ...old } = p;
    s.setItem('starwake.guide.a', JSON.stringify(old));
    const got = loadProgress('a', s);
    expect(got).toEqual(old);
    expect(got?.buyPort).toBeUndefined();
  });
  it('clears', () => {
    const s = memory();
    saveProgress('a', p, s);
    clearProgress('a', s);
    expect(loadProgress('a', s)).toBeNull();
  });
  it('rejects malformed data', () => {
    const s = memory();
    const bads = [
      'not json',
      '{}',
      '{"step":99,"done":false}',
      JSON.stringify({ ...p, step: 0 }),
      JSON.stringify({ ...p, target: { good: 'x' } }),
    ];
    for (const bad of bads) {
      s.setItem('starwake.guide.a', bad);
      expect(loadProgress('a', s)).toBeNull();
    }
  });
  it('survives storage failures', () => {
    expect(saveProgress('a', p, throwing)).toBe(false);
    expect(loadProgress('a', throwing)).toBeNull();
    expect(() => clearProgress('a', throwing)).not.toThrow();
    expect(saveProgress('a', p, undefined)).toBe(false);
  });
});
