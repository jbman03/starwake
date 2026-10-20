import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { addNote, hasFlag, setFlag } from './story';
import { newWorld } from './world';

const w0 = newWorld(testData(), 1);

describe('story helpers', () => {
  it('setFlag is idempotent and hasFlag reads it', () => {
    expect(hasFlag(w0, 'a')).toBe(false);
    const w = setFlag(setFlag(w0, 'a'), 'a');
    expect(w.flags).toEqual(['a']);
    expect(hasFlag(w, 'a')).toBe(true);
  });

  it('addNote puts the newest first and dedupes the same text', () => {
    let w = addNote({ ...w0, day: 1 }, 'one');
    w = addNote({ ...w, day: 2 }, 'two');
    w = addNote({ ...w, day: 3 }, 'one');
    expect(w.notes).toEqual([{ day: 2, text: 'two' }, { day: 1, text: 'one' }]);
  });

  it('addNote caps the list at 20, dropping the oldest', () => {
    let w = w0;
    for (let i = 0; i < 25; i++) w = addNote(w, `n${i}`);
    expect(w.notes).toHaveLength(20);
    expect(w.notes[0].text).toBe('n24');
    expect(w.notes[19].text).toBe('n5');
  });
});
