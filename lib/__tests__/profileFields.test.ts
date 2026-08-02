import { describe, expect, it } from 'vitest';
import {
  bmi,
  formatPhone,
  HEIGHT_CM,
  isValidPhone,
  normalizePhone,
  optionsWithStored,
  rangeOptions,
  WEIGHT_KG,
} from '../profileFields';

describe('rangeOptions', () => {
  it('covers both ends of the range', () => {
    expect(rangeOptions(120, 123)).toEqual([120, 121, 122, 123]);
  });

  it('returns a single option when min equals max', () => {
    expect(rangeOptions(70, 70)).toEqual([70]);
  });

  it('returns nothing for an inverted range', () => {
    expect(rangeOptions(10, 5)).toEqual([]);
  });

  it('spans the configured height and weight dropdowns', () => {
    expect(rangeOptions(HEIGHT_CM.min, HEIGHT_CM.max)).toHaveLength(81);
    expect(rangeOptions(WEIGHT_KG.min, WEIGHT_KG.max)).toHaveLength(126);
  });
});

describe('optionsWithStored', () => {
  it('leaves the range alone when the stored value is already in it', () => {
    expect(optionsWithStored(120, 125, 122)).toEqual([120, 121, 122, 123, 124, 125]);
  });

  it('keeps a legacy decimal selectable, in order', () => {
    expect(optionsWithStored(120, 123, 121.5)).toEqual([120, 121, 121.5, 122, 123]);
  });

  it('keeps a value below the range', () => {
    expect(optionsWithStored(120, 122, 95)).toEqual([95, 120, 121, 122]);
  });

  it('keeps a value above the range', () => {
    expect(optionsWithStored(120, 122, 210)).toEqual([120, 121, 122, 210]);
  });

  it('handles a profile with nothing stored yet', () => {
    expect(optionsWithStored(120, 122, null)).toEqual([120, 121, 122]);
    expect(optionsWithStored(120, 122, undefined)).toEqual([120, 121, 122]);
  });

  it('ignores a non-finite stored value', () => {
    expect(optionsWithStored(120, 122, Number.NaN)).toEqual([120, 121, 122]);
  });
});

describe('normalizePhone', () => {
  it('strips the separators people type', () => {
    expect(normalizePhone('081-234-5678')).toBe('0812345678');
    expect(normalizePhone('(081) 234 5678')).toBe('0812345678');
  });

  it('keeps a leading country plus', () => {
    expect(normalizePhone('+66 81 234 5678')).toBe('+66812345678');
  });

  it('drops a plus that is not leading', () => {
    expect(normalizePhone('081+2345678')).toBe('0812345678');
  });

  it('returns empty for a blank field', () => {
    expect(normalizePhone('   ')).toBe('');
  });
});

describe('isValidPhone', () => {
  it('accepts an empty field as "not given"', () => {
    expect(isValidPhone('')).toBe(true);
    expect(isValidPhone('  ')).toBe(true);
  });

  it('accepts Thai local and international forms', () => {
    expect(isValidPhone('081-234-5678')).toBe(true);
    expect(isValidPhone('+66 81 234 5678')).toBe(true);
  });

  it('rejects anything too short to dial', () => {
    expect(isValidPhone('12')).toBe(false);
    expect(isValidPhone('1234567')).toBe(false);
  });

  it('rejects more than the 15 digits E.164 allows', () => {
    expect(isValidPhone('1234567890123456')).toBe(false);
  });

  it('rejects letters rather than quietly storing a blank', () => {
    expect(isValidPhone('call-me')).toBe(false);
    expect(isValidPhone('081call5678')).toBe(false);
  });

  it('accepts the separators people actually type', () => {
    expect(isValidPhone('(081) 234.5678')).toBe(true);
  });
});

describe('formatPhone', () => {
  it('shows a dash when nothing is stored', () => {
    expect(formatPhone(null)).toBe('—');
    expect(formatPhone('')).toBe('—');
  });

  it('shows the normalized number', () => {
    expect(formatPhone('081-234-5678')).toBe('0812345678');
  });
});

describe('bmi', () => {
  it('computes to one decimal place', () => {
    expect(bmi(165, 60)).toBe(22);
    expect(bmi(170, 75)).toBe(26);
    expect(bmi(180, 60)).toBe(18.5);
  });

  it('returns null when either measurement is missing', () => {
    expect(bmi(165, null)).toBeNull();
    expect(bmi(null, 60)).toBeNull();
    expect(bmi(null, null)).toBeNull();
  });

  it('returns null for nonsense measurements', () => {
    expect(bmi(0, 60)).toBeNull();
    expect(bmi(165, 0)).toBeNull();
  });
});
