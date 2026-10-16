import { describe, expect, it } from 'vitest';
import { createUpdateGate } from './updateGate';

function setup(canShow = true) {
  const state = { canShow, shown: 0 };
  const gate = createUpdateGate({ canShow: () => state.canShow, show: () => void state.shown++ });
  return { state, gate };
}

describe('createUpdateGate', () => {
  it('shows at once when not flying', () => {
    const { gate, state } = setup(true);
    gate.notify();
    expect(state.shown).toBe(1);
  });

  it('queues mid-flight and shows at the next opportunity', () => {
    const { gate, state } = setup(false);
    gate.notify();
    expect(state.shown).toBe(0);
    gate.flush();
    expect(state.shown).toBe(0); // still flying
    state.canShow = true;
    gate.flush();
    expect(state.shown).toBe(1);
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
});
