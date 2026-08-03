import { describe, expect, it } from 'vitest';
import {
  bmi,
  capPhoneInput,
  formatPhone,
  HEIGHT_CM,
  isValidPhone,
  normalizePhone,
  optionsWithStored,
  PHONE_MAX_CHARS,
  PHONE_MAX_DIGITS,
  phoneDigitCount,
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

describe('phoneDigitCount', () => {
  it('counts digits, not the way they are spaced', () => {
    expect(phoneDigitCount('081-234-5678')).toBe(10);
    expect(phoneDigitCount('+66 81 234 5678')).toBe(11);
    expect(phoneDigitCount('')).toBe(0);
  });
});

describe('capPhoneInput', () => {
  it('leaves a normal number exactly as typed', () => {
    expect(capPhoneInput('081-234-5678')).toBe('081-234-5678');
    expect(capPhoneInput('(081) 234 5678')).toBe('(081) 234 5678');
  });

  it('keeps a leading country plus', () => {
    expect(capPhoneInput('+66 81 234 5678')).toBe('+66 81 234 5678');
  });

  it('drops letters as they are typed', () => {
    expect(capPhoneInput('081call5678')).toBe('0815678');
  });

  it('drops a plus that is not leading, the way normalizePhone does', () => {
    expect(capPhoneInput('081+2345678')).toBe('0812345678');
  });

  it('refuses the sixteenth digit', () => {
    expect(capPhoneInput('12345678901234567890')).toBe('123456789012345');
    expect(phoneDigitCount(capPhoneInput('12345678901234567890'))).toBe(PHONE_MAX_DIGITS);
  });

  it('counts the plus against the length but not against the digits', () => {
    const capped = capPhoneInput('+123456789012345678');
    expect(phoneDigitCount(capped)).toBe(PHONE_MAX_DIGITS);
    expect(capped.startsWith('+')).toBe(true);
  });

  it('stops a wall of separators from filling the field', () => {
    expect(capPhoneInput('-'.repeat(200)).length).toBeLessThanOrEqual(PHONE_MAX_CHARS);
  });

  it('leaves anything it returns short enough for the field', () => {
    expect(capPhoneInput('+66 (081) 234-5678 9012 3456').length).toBeLessThanOrEqual(
      PHONE_MAX_CHARS
    );
  });

  it('accepts an emptied field', () => {
    expect(capPhoneInput('')).toBe('');
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
