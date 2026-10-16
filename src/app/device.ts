export interface WakeLockSentinelLike {
  release(): Promise<void>;
}
export interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * Keeps the screen awake while flying. Released when flight pauses or the page is hidden
 * (the browser drops it then anyway) and re-requested on return. Every failure is ignored.
 */
export class WakeLockManager {
  private flying = false;
  private sentinel: WakeLockSentinelLike | null = null;
  private requesting = false;

  constructor(
    private api: WakeLockApi | undefined,
    private isVisible: () => boolean,
  ) {}

  setFlying(flying: boolean): void {
    this.flying = flying;
    this.sync();
  }

  visibilityChanged(): void {
    this.sync();
  }

  private sync(): void {
    if (!this.api) return;
    if (this.flying && this.isVisible()) void this.acquire();
    else this.release();
  }

  private async acquire(): Promise<void> {
    if (!this.api || this.sentinel || this.requesting) return;
    this.requesting = true;
    try {
      const s = await this.api.request('screen');
      this.requesting = false;
      if (this.flying && this.isVisible()) this.sentinel = s;
      else await s.release().catch(() => {}); // state changed while the request was pending
    } catch {
      this.requesting = false; // unsupported, denied, low battery...
    }
  }

  private release(): void {
    const s = this.sentinel;
    this.sentinel = null;
    if (!s) return;
    try {
      void Promise.resolve(s.release()).catch(() => {});
    } catch {
      // ignore
    }
  }
}

/** Short buzz for landings and jumps, only for touch players who left vibration on. */
export function vibrateIfEnabled(
  nav: { vibrate?: (pattern: number) => unknown },
  enabled: boolean,
  mode: 'touch' | 'keyboard',
): void {
  if (!enabled || mode !== 'touch') return;
  try {
    nav.vibrate?.(30);
  } catch {
    // ignore
  }
}
