import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { testRaw } from '../data/testData';

const guide = readFileSync(new URL('../../public/editor-guide.html', import.meta.url), 'utf8');

describe('the Editor guide', () => {
  it('every section in its contents exists', () => {
    const links = [...guide.matchAll(/<a href="#([a-z-]+)">/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThanOrEqual(10);
    for (const id of links) expect(guide).toContain(`id="${id}"`);
  });

  it('names only game records that exist when it says to copy one', () => {
    const raw = testRaw() as unknown as Record<string, unknown>;
    const ids = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.id === 'string') ids.add(o.id);
        Object.values(o).forEach(walk);
      }
    };
    walk(raw);
    const copied = [...guide.matchAll(/copy <code>([a-z0-9-]+)<\/code>/gi)].map((m) => m[1]);
    const choose = [...guide.matchAll(/choose <code>([a-z0-9-]+)<\/code>/g)].map((m) => m[1]);
    expect(copied.length).toBeGreaterThan(4);
    for (const id of [...copied, ...choose]) expect(ids, id).toContain(id);
  });
});
