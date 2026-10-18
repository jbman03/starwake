import type { UiContext } from './context';
import { button, dialogOpen, el, formatCredits, hotkeyFor } from './dom';
import { mapCornerButton } from './mapButton';

/** Say something in the status line (bad = shown as a problem). */
export type Say = (text: string, bad?: boolean) => void;

export interface ShopItem {
  id: string;
  name: string;
  icon: () => Element;
  /** Small count or tag on the tile, e.g. how many are fitted. */
  badge?: string;
  /** The Info panel body for this item. */
  info: () => Element;
  canBuy: boolean;
  /** Why Buy is disabled, in the words shown to the pilot. */
  reason?: string;
  canSell?: boolean;
}

export interface ShopOpts {
  title: string;
  testId: 'shipyard' | 'outfitter';
  items: () => ShopItem[];
  onBuy(id: string, say: Say): void | Promise<void>;
  /** Absent = no Sell button (the shipyard). */
  onSell?(id: string, say: Say): void;
  onClose(): void;
}

/** Tiles per page: 4x3 on desktop, 3x2 on a phone (short or narrow viewport). */
export function pageSize(width: number, height: number): { cols: number; rows: number } {
  return height < 500 || width < 640 ? { cols: 3, rows: 2 } : { cols: 4, rows: 3 };
}

/**
 * Shared shop screen: a paged grid of tiles (left), an Info panel for the selected tile (right) and
 * Buy / Sell / Prev / Next / Done buttons. Arrow keys move the selection, B and S buy and sell, the
 * page keys turn pages, Esc closes. Buy is disabled with the item's reason when it can't proceed.
 */
export function showShop(ctx: UiContext, opts: ShopOpts): void {
  const { controller } = ctx;
  const bindings = controller.settings.bindings;
  let selected = '';
  let page = 0;
  let message = '';
  let messageBad = false;
  let items: ShopItem[] = [];

  const close = () => {
    ctx.unmount();
    opts.onClose();
  };

  const say: Say = (text, bad = false) => {
    message = text;
    messageBad = bad;
  };

  const stats = el('div', { class: 'sw-ex-stats', attrs: { 'data-testid': `${opts.testId}-stats` } });
  const grid = el('div', { class: 'sw-shop-grid', attrs: { role: 'listbox', 'aria-label': opts.title } });
  const pager = el('div', { class: 'sw-shop-pager' });
  const info = el('div', { class: 'sw-shop-info', attrs: { 'data-testid': `${opts.testId}-info` } });
  const status = el('p', { class: 'sw-ex-message', attrs: { 'data-testid': `${opts.testId}-status`, 'aria-live': 'polite' } });

  const buyBtn = button('Buy', () => void buy(), { class: 'sw-btn-primary', hotkey: hotkeyFor(bindings, 'shopBuy') });
  const sellBtn = opts.onSell ? button('Sell', () => sell(), { hotkey: hotkeyFor(bindings, 'shopSell') }) : null;
  const prevBtn = button('Prev', () => turn(-1), { hotkey: hotkeyFor(bindings, 'shopPrevPage') });
  const nextBtn = button('Next', () => turn(1), { hotkey: hotkeyFor(bindings, 'shopNextPage') });
  const doneBtn = button('Done', close, { hotkey: hotkeyFor(bindings, 'back') });

  const size = () => {
    const { cols, rows } = pageSize(window.innerWidth, window.innerHeight);
    return { cols, per: cols * rows };
  };
  const current = () => items.find((i) => i.id === selected);

  async function buy(): Promise<void> {
    const it = current();
    if (!it || !it.canBuy) return;
    say('');
    await opts.onBuy(it.id, say);
    render();
  }
  function sell(): void {
    const it = current();
    if (!it || !it.canSell || !opts.onSell) return;
    say('');
    opts.onSell(it.id, say);
    render();
  }
  function select(id: string): void {
    if (id !== selected) say('');
    selected = id;
    const i = items.findIndex((x) => x.id === id);
    if (i >= 0) page = Math.floor(i / size().per);
    render();
  }
  /** Move the selection by `delta` tiles, staying inside the list. */
  function move(delta: number): void {
    if (items.length === 0) return;
    const i = Math.max(0, items.findIndex((x) => x.id === selected));
    select(items[Math.min(items.length - 1, Math.max(0, i + delta))].id);
  }
  /** Turn the page and select its first tile. */
  function turn(dir: -1 | 1): void {
    const pages = Math.max(1, Math.ceil(items.length / size().per));
    const to = Math.min(pages - 1, Math.max(0, page + dir));
    if (to === page) return;
    select(items[to * size().per].id);
  }

  function render(): void {
    items = opts.items();
    if (!items.some((i) => i.id === selected)) selected = items[0]?.id ?? '';
    const { cols, per } = size();
    const pages = Math.max(1, Math.ceil(items.length / per));
    const sel = items.findIndex((i) => i.id === selected);
    page = Math.min(pages - 1, sel >= 0 ? Math.floor(sel / per) : Math.min(page, pages - 1));

    stats.replaceChildren(el('span', { text: `Credits: ${formatCredits(controller.world.credits)}` }));
    grid.style.setProperty('--sw-shop-cols', String(cols));
    grid.replaceChildren(
      ...items.slice(page * per, page * per + per).map((it) =>
        el(
          'div',
          {
            class: it.id === selected ? 'sw-shop-tile sw-shop-selected' : 'sw-shop-tile',
            attrs: { role: 'option', 'aria-selected': String(it.id === selected), 'data-item': it.id },
            onClick: () => select(it.id),
          },
          [
            el('div', { class: 'sw-shop-icon' }, [it.icon()]),
            el('div', { class: 'sw-shop-name', text: it.name }),
            it.badge ? el('span', { class: 'sw-shop-badge', text: it.badge }) : null,
          ],
        ),
      ),
    );
    pager.replaceChildren(
      prevBtn,
      el('span', { class: 'sw-shop-page', text: `Page ${page + 1}/${pages}` }),
      nextBtn,
    );
    prevBtn.disabled = page <= 0;
    nextBtn.disabled = page >= pages - 1;

    const it = items[sel];
    if (!it) {
      info.replaceChildren(el('p', { class: 'sw-empty', text: 'Nothing for sale here.' }));
    } else {
      info.replaceChildren(it.info());
      if (!it.canBuy && it.reason) info.append(el('p', { class: 'sw-shop-reason', text: it.reason }));
    }
    buyBtn.disabled = !it || !it.canBuy;
    if (sellBtn) sellBtn.disabled = !it || !it.canSell;
    const line = message || (it && !it.canBuy ? (it.reason ?? '') : '');
    status.textContent = line;
    status.classList.toggle('sw-ex-bad', message ? messageBad : !!line);
    grid.querySelector('.sw-shop-selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  const actions = [buyBtn, ...(sellBtn ? [sellBtn] : []), doneBtn];
  const screen = el('div', { class: 'sw-screen sw-planet-screen sw-shop-screen', attrs: { 'data-testid': opts.testId } }, [
    el('div', { class: 'sw-panel sw-shop' }, [
      mapCornerButton(ctx, () => showShop(ctx, opts)),
      el('h1', { class: 'sw-title', text: opts.title }),
      stats,
      el('div', { class: 'sw-shop-body' }, [
        el('div', { class: 'sw-shop-left' }, [grid, pager]),
        el('div', { class: 'sw-shop-right' }, [info]),
      ]),
      status,
      el('div', { class: 'sw-ex-actions' }, actions),
    ]),
  ]);

  // Arrows belong to the flight group, which the UI poll doesn't read: handle them here.
  const onKey = (e: KeyboardEvent) => {
    if (dialogOpen()) return; // keys belong to the dialog
    const { cols } = size();
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.code];
    if (delta === undefined) return;
    e.preventDefault();
    move(delta);
  };
  const onResize = () => render();
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);

  ctx.mount(screen, {
    groups: ['shop', 'menus'],
    onPress: (pressed) => {
      if (pressed.has('back')) close();
      else if (pressed.has('shopBuy')) void buy();
      else if (pressed.has('shopSell')) sell();
      else if (pressed.has('shopPrevPage')) turn(-1);
      else if (pressed.has('shopNextPage')) turn(1);
    },
    cleanup: () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    },
  });
  render();
}

/** Standard Info panel body: name, description, label/value rows, then plain notes. */
export function infoBlock(name: string, description: string, rows: [string, string][], notes: string[] = []): Element {
  return el('div', { class: 'sw-shop-infobody' }, [
    el('h2', { class: 'sw-mc-title', text: name }),
    el('p', { class: 'sw-mc-desc', text: description }),
    el('dl', { class: 'sw-map-rows sw-mc-rows' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
    ...notes.map((n) => el('p', { class: 'sw-shop-note', text: n })),
  ]);
}
