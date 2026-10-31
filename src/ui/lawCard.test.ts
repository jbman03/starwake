import { describe, expect, it } from 'vitest';
import { lawCardView } from './lawCard';

const base = { npcName: 'Grey Lance', govName: 'Concord', goods: [], fine: 1400, bribe: 2100, credits: 5000, run: false };

describe('law card', () => {
  it('a scan lists the contraband and offers Comply / Bribe / Run', () => {
    const v = lawCardView({ ...base, reason: 'scan', goods: ['3 t of Unlicensed Stims', '1 t of Dimming Relics'], fine: 400, bribe: 600, run: true });
    expect(v.title).toBe('Grey Lance scans your hold');
    expect(v.text).toContain('3 t of Unlicensed Stims and 1 t of Dimming Relics');
    expect(v.choices).toEqual([
      { label: 'Comply (fine 400 cr)', blocked: null },
      { label: 'Bribe 600 cr', blocked: null },
      { label: 'Run', blocked: null },
    ]);
  });
  it('a fine hail warns when Wanted, and blocks what the credits cannot cover', () => {
    const suspect = lawCardView({ ...base, reason: 'fine' });
    expect(suspect.text).toBe('Grey Lance, a Concord patrol, has you on its records. "Pay your fine of 1,400 cr."');
    expect(suspect.choices.map((c) => c.label)).toEqual(['Pay fine 1,400 cr', 'Bribe 2,100 cr', 'Refuse']);
    const wanted = lawCardView({ ...base, reason: 'fine', run: true, credits: 1500 });
    expect(wanted.text).toContain('or we open fire');
    expect(wanted.choices.map((c) => c.blocked)).toEqual([null, 'Not enough credits', null]);
    expect(wanted.choices[2].label).toBe('Run');
  });
});
