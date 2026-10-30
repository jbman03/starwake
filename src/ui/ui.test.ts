// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../input/bindings';
import { button, confirmDialog, dialogOpen, formatCredits, hotkeyFor, keyLabel, promptDialog, setUiClickSound } from './dom';
import { SaveError } from '../save/pilot';
import { cleanPilotName, saveErrorText } from './mainMenu';
import { fuelText } from '../sim/fuel';

describe('ui helpers', () => {
  it('keyLabel shortens key codes', () => {
    expect(keyLabel('KeyL')).toBe('L');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('Digit7')).toBe('7');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('F5')).toBe('F5');
  });

  it('hotkeyFor uses the first bound slot', () => {
    expect(hotkeyFor(DEFAULT_BINDINGS, 'leave')).toBe('L');
    expect(hotkeyFor({ ...DEFAULT_BINDINGS, refuel: [null, 'KeyQ'] }, 'refuel')).toBe('Q');
    expect(hotkeyFor({ ...DEFAULT_BINDINGS, refuel: [null, null] }, 'refuel')).toBeUndefined();
  });

  it('cleanPilotName trims, caps at 24 and defaults to Pilot', () => {
    expect(cleanPilotName('  Ava  ')).toBe('Ava');
    expect(cleanPilotName('   ')).toBe('Pilot');
    expect(cleanPilotName('x'.repeat(30))).toHaveLength(24);
  });

  it('saveErrorText explains unknown content clearly', () => {
    expect(saveErrorText(new SaveError('unknownContent'), 'imported')).toBe(
      "This pilot couldn't be imported: it uses a ship, system or planet this version of Starwake doesn't have.",
    );
    expect(saveErrorText(new SaveError('invalid'), 'imported')).toContain('damaged');
  });

  it('fuelText and formatCredits', () => {
    expect(fuelText(3)).toBe('Fuel: 3 jumps');
    expect(fuelText(1)).toBe('Fuel: 1 jump');
    expect(formatCredits(10000)).toBe('10,000 cr');
  });

});

describe('dialogs', () => {
  it('confirmDialog resolves with the choice and Escape cancels without reaching window listeners', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    let leaked = 0;
    const listener = () => leaked++;
    window.addEventListener('keydown', listener);

    const p = confirmDialog(root, { title: 'Sure?', confirm: 'Yes' });
    expect(dialogOpen()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', cancelable: true }));
    expect(await p).toBe(false);
    expect(dialogOpen()).toBe(false);
    expect(leaked).toBe(0);
    expect(root.querySelector('[role=dialog]')).toBeNull();

    const p2 = confirmDialog(root, { title: 'Sure?', confirm: 'Yes' });
    const yes = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Yes'))!;
    yes.click();
    expect(await p2).toBe(true);
    window.removeEventListener('keydown', listener);
  });

  it('promptDialog rejects empty input and returns trimmed text', async () => {
    const root = document.createElement('div');
    const p = promptDialog(root, { title: 'Name', label: 'Pilot name', value: '', maxLength: 24, confirm: 'Create' });
    const input = root.querySelector('input')!;
    const create = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Create'))!;
    create.click();
    expect(root.querySelector('.sw-error')?.textContent).toBe('Please enter a name.');
    input.value = '  Ava ';
    create.click();
    expect(await p).toBe('Ava');
  });

  it('promptDialog shows a Random button that refills the name when given a generator', async () => {
    const root = document.createElement('div');
    const names = ['Mara Voss', 'Dax Calloway'];
    let i = 0;
    const p = promptDialog(root, {
      title: 'New Pilot',
      label: 'Pilot name',
      value: 'Ava Reyes',
      maxLength: 24,
      confirm: 'Create',
      randomize: () => names[i++],
    });
    const input = root.querySelector('input')!;
    const random = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Random'))!;
    expect(random).toBeTruthy();
    random.click();
    expect(input.value).toBe('Mara Voss');
    random.click();
    expect(input.value).toBe('Dax Calloway');
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Create'))!.click();
    expect(await p).toBe('Dax Calloway');
  });

  it('promptDialog has no Random button without a generator', () => {
    const root = document.createElement('div');
    void promptDialog(root, { title: 'Rename', label: 'Pilot name', value: 'Ava', maxLength: 24, confirm: 'Save' });
    expect([...root.querySelectorAll('button')].some((b) => b.textContent?.includes('Random'))).toBe(false);
  });
});

describe('button click sound', () => {
  it('plays the UI click through the hook once it is set, and not after it is cleared', () => {
    let clicks = 0;
    let ran = 0;
    const b = button('Go', () => ran++);
    b.click();
    expect(clicks).toBe(0);
    setUiClickSound(() => clicks++);
    b.click();
    expect(clicks).toBe(1);
    expect(ran).toBe(2);
    setUiClickSound(null);
    b.click();
    expect(clicks).toBe(1);
  });

  it('a failing sound never stops the button working', () => {
    let ran = 0;
    setUiClickSound(() => {
      throw new Error('no audio');
    });
    const b = button('Go', () => ran++);
    b.click();
    expect(ran).toBe(1);
    setUiClickSound(null);
  });
});

