import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { formatDate } from './calendar';

describe('formatDate', () => {
  const cfg = testData().config;
  it('formats day 0 as the start date', () => expect(formatDate(0, cfg)).toBe('1 Mar 3207'));
  it('formats day 13', () => expect(formatDate(13, cfg)).toBe('14 Mar 3207'));
  it('rolls into the next month', () => expect(formatDate(31, cfg)).toBe('1 Apr 3207'));
  // 3208 is a Gregorian leap year, so 1 Mar 3207 + 365 days is 29 Feb 3208.
  it('honours leap years', () => expect(formatDate(365, cfg)).toBe('29 Feb 3208'));
  it('rolls into the next year', () => expect(formatDate(366, cfg)).toBe('1 Mar 3208'));
});
