import { describe, expect, it, vi } from 'vitest';
import { WakeLockManager, vibrateIfEnabled, type WakeLockApi } from './device';

function stub() {
  const releases: Array<ReturnType<typeof vi.fn>> = [];
  const request = vi.fn(async () => {
    const release = vi.fn(async () => {});
    releases.push(release);
    return { release };
  });
  const api: WakeLockApi = { request };
  return { api, request, releases };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('WakeLockManager', () => {
  it('requests when flight starts and the page is visible, releases when flight stops', async () => {
    const { api, request, releases } = stub();
    const m = new WakeLockManager(api, () => true);
    m.setFlying(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    m.setFlying(false);
    await flush();
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });

  it('does not double-request while held', async () => {
    const { api, request } = stub();
    const m = new WakeLockManager(api, () => true);
    m.setFlying(true);
    m.setFlying(true);
    await flush();
    m.visibilityChanged();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('releases when hidden and re-requests when visible again while flying', async () => {
    const { api, request, releases } = stub();
    let visible = true;
    const m = new WakeLockManager(api, () => visible);
    m.setFlying(true);
    await flush();
    visible = false;
    m.visibilityChanged();
    await flush();
    expect(releases[0]).toHaveBeenCalledTimes(1);
    visible = true;
    m.visibilityChanged();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not request on visible when not flying', async () => {
    const { api, request } = stub();
    const m = new WakeLockManager(api, () => true);
    m.visibilityChanged();
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it('ignores unsupported browsers and request/release failures', async () => {
    const none = new WakeLockManager(undefined, () => true);
    expect(() => none.setFlying(true)).not.toThrow();
    const bad: WakeLockApi = {
      request: async () => {
        throw new Error('NotAllowedError');
      },
    };
    const m = new WakeLockManager(bad, () => true);
    m.setFlying(true);
    await flush();
    m.setFlying(false);
    const badRelease: WakeLockApi = { request: async () => ({ release: () => Promise.reject(new Error('x')) }) };
    const m2 = new WakeLockManager(badRelease, () => true);
    m2.setFlying(true);
    await flush();
    m2.setFlying(false);
    await flush();
  });

  it('releases a lock that resolves after flight already stopped', async () => {
    const { api, releases } = stub();
    const m = new WakeLockManager(api, () => true);
    m.setFlying(true);
    m.setFlying(false); // before the request promise resolves
    await flush();
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });
});

describe('vibrateIfEnabled', () => {
  it('vibrates 30ms only when enabled and in touch mode', () => {
    const vibrate = vi.fn();
    vibrateIfEnabled({ vibrate }, true, 'touch');
    expect(vibrate).toHaveBeenCalledWith(30);
    vibrate.mockClear();
    vibrateIfEnabled({ vibrate }, false, 'touch');
    vibrateIfEnabled({ vibrate }, true, 'keyboard');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('tolerates missing vibrate support', () => {
    expect(() => vibrateIfEnabled({}, true, 'touch')).not.toThrow();
  });
});
