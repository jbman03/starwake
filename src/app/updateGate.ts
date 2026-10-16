/**
 * Holds back the "update available" prompt while the ship is flying. `notify()` is the service
 * worker's needRefresh; `flush()` is called at landings and menus and shows a queued prompt.
 */
export function createUpdateGate(opts: { canShow: () => boolean; show: () => void }) {
  let pending = false;
  const flush = (): void => {
    if (!pending || !opts.canShow()) return;
    pending = false;
    opts.show();
  };
  return {
    notify(): void {
      pending = true;
      flush();
    },
    flush,
  };
}
