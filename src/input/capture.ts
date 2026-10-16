import type { ActionId } from './actions';
import { findConflict, rebind, swapBinding, type Bindings } from './bindings';

export type CaptureResult =
  | { kind: 'noop' }
  | { kind: 'ok'; bindings: Bindings }
  | { kind: 'conflict'; other: ActionId }
  | { kind: 'error'; message: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Outcome of binding a freshly captured `code` to an action slot. */
export function applyCapture(b: Bindings, action: ActionId, slot: 0 | 1, code: string): CaptureResult {
  if (b[action].includes(code)) return { kind: 'noop' };
  const other = findConflict(b, action, code);
  if (other) return { kind: 'conflict', other };
  try {
    return { kind: 'ok', bindings: rebind(b, action, slot, code) };
  } catch (e) {
    return { kind: 'error', message: errorText(e) };
  }
}

/** Confirm a swap with the conflicting action; may fail on the Escape invariant. */
export function applySwap(b: Bindings, action: ActionId, slot: 0 | 1, code: string): CaptureResult {
  try {
    return { kind: 'ok', bindings: swapBinding(b, action, slot, code) };
  } catch (e) {
    return { kind: 'error', message: errorText(e) };
  }
}

export function applyClear(b: Bindings, action: ActionId, slot: 0 | 1): CaptureResult {
  if (b[action][slot] === null) return { kind: 'noop' };
  try {
    return { kind: 'ok', bindings: rebind(b, action, slot, null) };
  } catch (e) {
    return { kind: 'error', message: errorText(e) };
  }
}
