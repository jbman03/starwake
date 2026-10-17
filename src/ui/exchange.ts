import { formatDate } from '../sim/calendar';
import { cargoFree, maxBuy } from '../sim/cargo';
import { displayLevel, localNews, priceOf } from '../sim/economy';
import type { UiContext } from './context';
import { button, el, formatCredits, hotkeyFor } from './dom';
import { guideCard } from './guideHint';

/** Press-and-hold time (ms) on Buy/Sell before it moves 1 t instead of 10. */
export const LONG_PRESS_MS = 450;
const STEP = 10;

/** Why a Buy or Sell moved nothing, in the words shown to the pilot. */
export const EXCHANGE_REASON = {
  holdFull: 'Hold full',
  noCredits: 'Not enough credits',
  noneHeld: 'You have none to sell',
  notTraded: 'Not traded here',
} as const;

const LEVEL_TEXT = { low: 'Low', med: 'Med', high: 'High' } as const;

const tons = (n: number) => `${n} t`;

/**
 * EV-style commodity exchange: a panel of Commodity · In hold · Level · Price rows for the port's
 * market. Click or Up/Down selects a row; Buy 10 / Sell 10 (B / S) move 10 t, 1 t with Shift or a
 * long press; Buy max and Sell all fill or empty the line. Esc or Done runs `onClose`.
 */
export function showExchange(ctx: UiContext, portId: string, onClose: () => void): void {
  const { controller } = ctx;
  const { data } = controller;
  const port = data.planets[portId];
  const goods = Object.keys(port.market ?? {}).filter((id) => data.commodities[id]);
  const bindings = controller.settings.bindings;
  let selected = goods[0] ?? '';
  let shiftHeld = false;

  const close = () => {
    ctx.unmount();
    onClose();
  };

  const stats = el('div', { class: 'sw-ex-stats', attrs: { 'data-testid': 'exchange-stats' } });
  const tbody = el('tbody');
  const news = el('p', { class: 'sw-ex-news', attrs: { 'data-testid': 'exchange-news' } });
  const detail = el('p', { class: 'sw-ex-detail', attrs: { 'data-testid': 'exchange-detail' } });
  const message = el('p', { class: 'sw-ex-message', attrs: { 'data-testid': 'exchange-message', 'aria-live': 'polite' } });

  const say = (text: string, bad = false) => {
    message.textContent = text;
    message.classList.toggle('sw-ex-bad', bad);
  };

  /** One trade of `n` tons (or all that fits); zero-result presses explain why. */
  const trade = (kind: 'buy' | 'sell', n: number | 'all') => {
    if (!selected) return;
    const name = data.commodities[selected].name;
    if (kind === 'buy') {
      const want = n === 'all' ? Math.max(1, maxBuy(controller.world, data, portId, selected)) : n;
      const r = controller.buy(selected, want);
      if (r.tons > 0) say(`Bought ${tons(r.tons)} of ${name} for ${formatCredits(r.cost)}.`);
      else say(EXCHANGE_REASON[r.reason ?? 'holdFull'], true);
    } else {
      const held = controller.world.cargo[selected] ?? 0;
      const want = n === 'all' ? Math.max(1, held) : n;
      const r = controller.sell(selected, want);
      if (r.tons > 0) say(`Sold ${tons(r.tons)} of ${name} for ${formatCredits(r.revenue)}.`);
      else say(EXCHANGE_REASON[r.reason ?? 'noneHeld'], true);
    }
    render();
  };

  const select = (id: string) => {
    if (id !== selected) say(''); // the last reason belonged to the previous row
    selected = id;
    render();
  };
  const move = (delta: number) => {
    if (goods.length === 0) return;
    const i = Math.max(0, goods.indexOf(selected));
    select(goods[Math.min(goods.length - 1, Math.max(0, i + delta))]);
  };

  function render(): void {
    const w = controller.world;
    const shipCargo = data.ships[w.shipId].cargo;
    stats.replaceChildren(
      el('span', { text: formatDate(w.day, data.config) }),
      el('span', { text: `Credits: ${formatCredits(w.credits)}` }),
      el('span', { text: `Cargo: ${cargoFree(w, data)}/${shipCargo} t` }),
    );
    tbody.replaceChildren(
      ...goods.map((id) => {
        const c = data.commodities[id];
        const price = priceOf(w, data, portId, id) ?? 0;
        const level = displayLevel(price, c.basePrice);
        const tr = el('tr', {
          class: id === selected ? 'sw-ex-row sw-ex-selected' : 'sw-ex-row',
          attrs: { 'data-good': id, 'aria-selected': String(id === selected) },
          onClick: () => select(id),
        });
        tr.append(
          el('td', { class: 'sw-ex-name', text: c.name }),
          el('td', { class: 'sw-ex-held', text: tons(w.cargo[id] ?? 0) }),
          el('td', { class: `sw-ex-level sw-ex-level-${level}`, text: LEVEL_TEXT[level] }),
          el('td', { class: 'sw-ex-price', text: formatCredits(price) }),
        );
        return tr;
      }),
    );
    const sel = selected ? data.commodities[selected] : undefined;
    detail.textContent = sel?.origin ? sel.description : '';
    news.textContent = localNews(w, data, portId) ?? '';
  }

  /** Buy/Sell button: click = 10 t (1 t with Shift), long press = 1 t. */
  const tradeButton = (label: string, kind: 'buy' | 'sell', hotkey: string | undefined) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let longFired = false;
    const stop = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const b = button(label, () => {}, { hotkey });
    b.title = 'Shift-click or hold for 1 t';
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.isPrimary === false) return; // primary button or touch only
      longFired = false;
      stop();
      timer = setTimeout(() => {
        timer = undefined;
        longFired = true;
        trade(kind, 1);
      }, LONG_PRESS_MS);
    });
    // The click (if any) follows pointerup in the same task; afterwards a leftover flag must not
    // swallow a later keyboard activation.
    const end = () => {
      stop();
      if (longFired) setTimeout(() => (longFired = false), 0);
    };
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) b.addEventListener(ev, end);
    b.addEventListener('click', (e) => {
      if (longFired) {
        longFired = false; // the long press already moved its ton
        return;
      }
      trade(kind, e.shiftKey ? 1 : STEP);
    });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return { b, stop };
  };
  const buyBtn = tradeButton(`Buy ${STEP}`, 'buy', hotkeyFor(bindings, 'buyGoods'));
  const sellBtn = tradeButton(`Sell ${STEP}`, 'sell', hotkeyFor(bindings, 'sellGoods'));
  const buyMax = button('Buy max', () => trade('buy', 'all'));
  const sellAll = button('Sell all', () => trade('sell', 'all'));
  const done = button('Done', close, { class: 'sw-btn-primary', hotkey: hotkeyFor(bindings, 'back') });

  const hint = guideCard(controller, ctx.root);

  const table = el('table', { class: 'sw-ex-table', attrs: { 'data-testid': 'exchange-table' } }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Commodity' }),
        el('th', { text: 'In hold' }),
        el('th', { text: 'Level' }),
        el('th', { text: 'Price' }),
      ]),
    ]),
    tbody,
  ]);

  const screen = el('div', { class: 'sw-screen sw-planet-screen sw-exchange-screen', attrs: { 'data-testid': 'exchange' } }, [
    el('div', { class: 'sw-panel sw-exchange' }, [
      el('h1', { class: 'sw-title', text: `${port.name} · Commodity Exchange` }),
      stats,
      el('div', { class: 'sw-ex-tablewrap' }, [table]),
      news,
      detail,
      message,
      hint.node,
      el('div', { class: 'sw-ex-actions' }, [buyBtn.b, sellBtn.b, buyMax, sellAll, done]),
    ]),
  ]);

  // Arrows belong to the flight group, which the UI poll doesn't read: handle them here.
  const onKey = (e: KeyboardEvent) => {
    shiftHeld = e.shiftKey;
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      move(e.code === 'ArrowUp' ? -1 : 1);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    shiftHeld = e.shiftKey;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  ctx.mount(screen, {
    groups: ['exchange', 'menus'],
    onPress: (pressed) => {
      if (pressed.has('back')) close();
      else if (pressed.has('buyGoods')) trade('buy', shiftHeld ? 1 : STEP);
      else if (pressed.has('sellGoods')) trade('sell', shiftHeld ? 1 : STEP);
    },
    cleanup: () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      buyBtn.stop();
      sellBtn.stop();
      hint.dispose();
    },
    guide: 'exchange',
  });
  render();
}
