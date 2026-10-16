/**
 * Holds back the "update available" prompt until it is safe: on a planet screen or the main
 * menu, never mid-flight and never at the pause/map menus (Restart there would discard progress).
 * `notify()` is the service worker's needRefresh; `flush()` is called when the state may have
 * become safe; `suspend()` is called when flight starts: it withdraws an open prompt and queues
 * it again for the next landing.
 */
export function createUpdateGate(opts: { canShow: () => boolean; show: () => void; hide: () => void }) {
  let pending = false;
  let shown = false;
  const flush = (): void => {
    if (!pending || !opts.canShow()) return;
    pending = false;
    shown = true;
    opts.show();
  };
  return {
    notify(): void {
      pending = true;
      flush();
    },
    flush,
    /** Flight started: withdraw the banner and show it again at the next landing. */
    suspend(): void {
      if (shown) {
        shown = false;
        pending = true;
        opts.hide();
      }
    },
    /** The player chose Later or Restart: do not re-show it. */
    dismissed(): void {
      shown = false;
    },
  };
}
