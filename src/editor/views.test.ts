import { describe, expect, it } from 'vitest';
import { testRaw } from '../data/testData';
import { fieldKind, refOptions } from './form';
import { effectiveSystems, placeSystem, toggleLane } from './mapView';
import { copyOf, newDraft, problems, recordsOf, upsert } from './model';

const raw = testRaw();

describe('form fields', () => {
  it('numbers, text, on/off, fixed choices and references get their own inputs; nested parts stay JSON', () => {
    const p = newDraft();
    expect(fieldKind('ships', 'price', 100, raw, p)).toEqual({ kind: 'number' });
    expect(fieldKind('ships', 'name', 'Hawk', raw, p)).toEqual({ kind: 'text' });
    expect(fieldKind('ships', 'description', 'x', raw, p)).toEqual({ kind: 'longText' });
    expect(fieldKind('ships', 'unique', true, raw, p)).toEqual({ kind: 'bool' });
    expect(fieldKind('ships', 'loadout', { a: 1 }, raw, p)).toEqual({ kind: 'json' });
    const role = fieldKind('ships', 'role', 'courier', raw, p);
    expect(role.kind === 'choice' && role.options).toContain('carrier');
    const sys = fieldKind('planets', 'systemId', 'calder', raw, p);
    expect(sys.kind === 'choice' && sys.options).toContain('calder');
  });

  it('reference lists include the plug-in own records', () => {
    const p = upsert(newDraft(), 'systems', copyOf(raw, newDraft(), 'systems', 'calder')!);
    expect(refOptions(raw, p, 'systems')).toContain('calder-2');
  });
});

describe('map view', () => {
  it('places a plug-in system and draws a lane both ways, copying the base system it links to', () => {
    let p = upsert(newDraft(), 'systems', { ...copyOf(raw, newDraft(), 'systems', 'calder')!, links: [] });
    p = placeSystem(p, 'calder-2', { x: 1234.4, y: -56.6 });
    expect(recordsOf(p, 'systems')[0].mapPos).toEqual({ x: 1234, y: -57 });
    p = toggleLane(raw, p, 'calder-2', 'vesk');
    const mine = (id: string) => recordsOf(p, 'systems').find((r) => r.id === id) as { links: string[] } | undefined;
    expect(mine('calder-2')!.links).toEqual(['vesk']);
    expect(mine('vesk')!.links).toContain('calder-2');
    expect(effectiveSystems(raw, p).find((s) => s.id === 'vesk')!.links).toContain('calder-2');
    p = toggleLane(raw, p, 'calder-2', 'vesk');
    expect(mine('calder-2')!.links).toEqual([]);
    expect(mine('vesk')!.links).not.toContain('calder-2');
  });

  it('a new system linked both ways, with a fresh name, passes the game checks', () => {
    let p = upsert(newDraft(), 'systems', { ...copyOf(raw, newDraft(), 'systems', 'vesk')!, name: 'Vesk Two', links: [], mapPos: { x: 4000, y: 4000 } });
    p = toggleLane(raw, p, 'vesk-2', 'vesk');
    expect(problems(raw, p)).toEqual([]);
  });
});
