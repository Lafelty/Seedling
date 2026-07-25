import { describe, expect, it } from 'vitest';

import {
  clampNumeric,
  parseNumericDraft,
  sanitizeNumericDraft,
  type NumericConstraints,
} from '../numericInput';

const INTEGER: NumericConstraints = { format: 'integer' };
const DECIMAL: NumericConstraints = { format: 'decimal' };
const SIGNED_DECIMAL: NumericConstraints = { format: 'decimal', allowNegative: true };

describe('sanitizeNumericDraft', () => {
  it('keeps digits and drops everything else', () => {
    expect(sanitizeNumericDraft('a1b2c3', INTEGER)).toBe('123');
    expect(sanitizeNumericDraft('12 kg', INTEGER)).toBe('12');
    expect(sanitizeNumericDraft('1e5', INTEGER)).toBe('15');
  });

  it('rejects the decimal point on integer fields', () => {
    expect(sanitizeNumericDraft('12.5', INTEGER)).toBe('125');
  });

  it('allows one decimal point on decimal fields', () => {
    expect(sanitizeNumericDraft('12.5', DECIMAL)).toBe('12.5');
    expect(sanitizeNumericDraft('1.2.3', DECIMAL)).toBe('1.23');
  });

  // The point of the sanitizer is that it must not fight the user mid-word:
  // these drafts are not numbers yet, but they are on the way to being one.
  it('preserves half-finished drafts', () => {
    expect(sanitizeNumericDraft('', DECIMAL)).toBe('');
    expect(sanitizeNumericDraft('1.', DECIMAL)).toBe('1.');
    expect(sanitizeNumericDraft('-', SIGNED_DECIMAL)).toBe('-');
    expect(sanitizeNumericDraft('-0.', SIGNED_DECIMAL)).toBe('-0.');
  });

  it('only accepts a sign in the leading position, and only when allowed', () => {
    expect(sanitizeNumericDraft('-5', SIGNED_DECIMAL)).toBe('-5');
    expect(sanitizeNumericDraft('5-3', SIGNED_DECIMAL)).toBe('53');
    expect(sanitizeNumericDraft('-5', INTEGER)).toBe('5');
  });

  it('strips a pasted value down to its digits', () => {
    expect(sanitizeNumericDraft('  168 cm  ', DECIMAL)).toBe('168');
    expect(sanitizeNumericDraft('1,250', INTEGER)).toBe('1250');
  });
});

describe('parseNumericDraft', () => {
  it('parses complete numbers', () => {
    expect(parseNumericDraft('0')).toBe(0);
    expect(parseNumericDraft('165')).toBe(165);
    expect(parseNumericDraft('12.5')).toBe(12.5);
    expect(parseNumericDraft('-4')).toBe(-4);
  });

  it('returns null for drafts that hold no value yet', () => {
    expect(parseNumericDraft('')).toBeNull();
    expect(parseNumericDraft('-')).toBeNull();
    expect(parseNumericDraft('.')).toBeNull();
    expect(parseNumericDraft('-.')).toBeNull();
  });

  it('reads trailing-point drafts as their integer part', () => {
    expect(parseNumericDraft('1.')).toBe(1);
  });
});

describe('clampNumeric', () => {
  it('rounds integer fields', () => {
    expect(clampNumeric(12.4, INTEGER)).toBe(12);
    expect(clampNumeric(12.6, INTEGER)).toBe(13);
  });

  it('leaves decimal fields unrounded', () => {
    expect(clampNumeric(12.6, DECIMAL)).toBe(12.6);
  });

  it('pulls values inside the range', () => {
    expect(clampNumeric(0, { min: 1 })).toBe(1);
    expect(clampNumeric(500, { min: 0, max: 100 })).toBe(100);
    expect(clampNumeric(50, { min: 0, max: 100 })).toBe(50);
  });

  it('clamps after rounding, so the result is always inside the range', () => {
    // Rounding first could push a value past the bound it was just inside of.
    expect(clampNumeric(0.6, { min: 0, max: 0, format: 'integer' })).toBe(0);
    expect(clampNumeric(99.7, { min: 0, max: 100, format: 'integer' })).toBe(100);
  });

  it('applies only the bounds that are given', () => {
    expect(clampNumeric(-40, { max: 100 })).toBe(-40);
    expect(clampNumeric(9000, { min: 1 })).toBe(9000);
  });
});
