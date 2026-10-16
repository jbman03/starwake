import { describe, expect, it } from 'vitest';
import { createUpdateGate } from './updateGate';

function setup(canShow = true) {
  const state = { canShow, shown: 0, hidden: 0 };
  const gate = createUpdateGate({
    canShow: () => state.canShow,
    show: () => void state.shown++,
    hide: () => void state.hidden++,
  });
  return { state, gate };
}

describe('createUpdateGate', () => {
  it('shows at once when safe (main menu or planet screen)', () => {
    const { gate, state } = setup(true);
    gate.notify();
    expect(state.shown).toBe(1);
  });

  it('queues mid-flight and shows at the next landing', () => {
    const { gate, state } = setup(false);
    gate.notify();
    expect(state.shown).toBe(0);
    gate.flush();
    expect(state.shown).toBe(0);
    state.canShow = true; // landed
    gate.flush();
    expect(state.shown).toBe(1);
  });

  it('is not shown while paused mid-flight (pause and map menus are unsafe)', () => {
    const { gate, state } = setup(false); // canShow stays false at the pause menu
    gate.notify();
    gate.flush(); // flight paused
    gate.flush();
    expect(state.shown).toBe(0);
  });

  it('shows only once, and flush with nothing queued does nothing', () => {
    const { gate, state } = setup(false);
    gate.flush();
    gate.notify();
    gate.notify();
    state.canShow = true;
    gate.flush();
    gate.flush();
    expect(state.shown).toBe(1);
  });

  it('withdraws an open banner on takeoff and re-shows it at the next landing', () => {
    const { gate, state } = setup(true);
    gate.notify();
    expect(state.shown).toBe(1);
    state.canShow = false; // takeoff
    gate.suspend();
    expect(state.hidden).toBe(1);
    gate.flush();
    expect(state.shown).toBe(1);
    state.canShow = true; // next landing
    gate.flush();
    expect(state.shown).toBe(2);
  });

  it('suspend does nothing when no banner is open, and a dismissed banner stays dismissed', () => {
    const { gate, state } = setup(true);
    gate.suspend();
    expect(state.hidden).toBe(0);
    gate.notify();
    gate.dismissed(); // Later
    gate.suspend();
    state.canShow = true;
    gate.flush();
    expect(state.hidden).toBe(0);
    expect(state.shown).toBe(1);
  });
});
