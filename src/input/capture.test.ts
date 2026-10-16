import { describe, expect, it } from 'vitest';
import { applyCapture, applyClear, applySwap } from './capture';
import { resetBindings } from './bindings';

describe('capture logic', () => {
  it('binds a free key', () => {
    const r = applyCapture(resetBindings(), 'thrust', 0, 'KeyW');
    expect(r.kind === 'ok' && r.bindings.thrust).toEqual(['KeyW', null]);
  });
  it('reports a same-group conflict, but not a cross-group one', () => {
    expect(applyCapture(resetBindings(), 'land', 0, 'KeyJ')).toEqual({ kind: 'conflict', other: 'jump' });
    expect(applyCapture(resetBindings(), 'thrust', 0, 'KeyL')).toEqual({ kind: 'conflict', other: 'land' });
    expect(applyCapture(resetBindings(), 'refuel', 0, 'KeyJ').kind).toBe('ok');
  });
  it('is a no-op when the action already has the key', () => {
    expect(applyCapture(resetBindings(), 'thrust', 1, 'ArrowUp').kind).toBe('noop');
  });
  it('swap exchanges keys', () => {
    const r = applySwap(resetBindings(), 'land', 0, 'KeyJ');
    expect(r.kind === 'ok' && [r.bindings.land[0], r.bindings.jump[0]]).toEqual(['KeyJ', 'KeyL']);
  });
  it('rejects losing Escape on pause/back, allows clearing others', () => {
    expect(applyClear(resetBindings(), 'pause', 0).kind).toBe('error');
    expect(applyCapture(resetBindings(), 'back', 0, 'KeyQ').kind).toBe('error');
    expect(applyClear(resetBindings(), 'leave', 1).kind).toBe('ok');
    expect(applyClear(resetBindings(), 'thrust', 1).kind).toBe('noop');
  });
});
