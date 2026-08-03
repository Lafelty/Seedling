// The patient-entered fields on /profile: what the height and weight dropdowns
// offer, and what counts as a phone number.
//
// Height and weight used to be typed. On a phone, typing a number that only ever
// comes from a short list is the slowest possible way to answer, so they became
// selects — and a select needs its options built from somewhere testable.

/** Bounds of the height dropdown, in centimetres. */
export const HEIGHT_CM = { min: 120, max: 200 } as const;

/** Bounds of the weight dropdown, in kilograms. */
export const WEIGHT_KG = { min: 25, max: 150 } as const;

/** Every whole number from `min` to `max`, inclusive. */
export function rangeOptions(min: number, max: number): number[] {
  if (!(max >= min)) return [];
  return Array.from({ length: Math.floor(max - min) + 1 }, (_, i) => min + i);
}

/**
 * The dropdown's options, with whatever is already stored guaranteed to be one
 * of them.
 *
 * `height_cm` and `weight_kg` are `numeric(5,1)`, and were free text before this
 * screen used dropdowns — so a row can legitimately hold `165.5`, or a value
 * outside the common range. Folding the stored value in keeps it selected and
 * unchanged; dropping it would silently rewrite the patient's own answer the
 * next time they saved anything at all.
 */
export function optionsWithStored(
  min: number,
  max: number,
  stored: number | null | undefined
): number[] {
  const options = rangeOptions(min, max);
  if (stored == null || !Number.isFinite(stored)) return options;
  if (options.includes(stored)) return options;
  return [...options, stored].sort((a, b) => a - b);
}

/**
 * The most digits a phone number can hold. E.164 caps at 15, and nothing longer
 * is dialable anywhere on earth.
 */
export const PHONE_MAX_DIGITS = 15;

/** The fewest digits worth storing. Below this it cannot be called back. */
export const PHONE_MIN_DIGITS = 8;

/**
 * The most characters the field will hold at all — the 15 digits, a leading `+`,
 * and room for the separators people space a number out with. A second cap on
 * top of the digit one, so a paste of a thousand dashes cannot sit in the field
 * looking like a valid entry.
 */
export const PHONE_MAX_CHARS = 24;

/**
 * Digits and an optional leading `+`, nothing else. Separators are how people
 * write a number, not part of it — `081-234-5678`, `081 234 5678` and
 * `(081) 234-5678` are all the same number and all store the same way.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/\D/g, '');
}

/** Digits, a leading `+`, and the separators people write numbers with. */
const PHONE_SHAPE = /^\+?[\d\s().-]+$/;

/**
 * Two checks, and no more: the field contains nothing but a number and its
 * separators, and that number is 8 to 15 digits long. Numbering plans differ
 * enough that anything stricter would reject real numbers — E.164 caps at 15
 * digits, and nothing dialable is shorter than 8.
 *
 * An empty field is valid: it means "not given", which is the column's default.
 * A field with characters that survive nothing — `call me` — is *not* empty and
 * must not be treated as such, or answering the question wrongly would silently
 * store a blank instead of saying so.
 */
export function isValidPhone(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  if (!PHONE_SHAPE.test(trimmed)) return false;

  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
}

/** How many digits the field holds, ignoring how they have been spaced out. */
export function phoneDigitCount(raw: string): number {
  return raw.replace(/\D/g, '').length;
}

/**
 * What the phone field is allowed to contain, applied on every keystroke.
 *
 * Validation on save says "that is wrong" after the fact; this stops the wrong
 * thing being typed at all — letters never appear, and the 16th digit simply
 * does not land. The separators the patient has already typed are left exactly
 * where they are, so the caret does not jump around mid-number.
 *
 * A `+` only counts as one when it leads: `+66 81 234 5678` is a country code,
 * `081+2345678` is a typo, and `normalizePhone` already treats them that way.
 */
export function capPhoneInput(raw: string): string {
  const plus = raw.trimStart().startsWith('+') ? '+' : '';
  const rest = raw.replace(/[^\d\s().-]/g, '');

  let digits = 0;
  let kept = '';
  for (const character of rest) {
    const isDigit = character >= '0' && character <= '9';
    if (isDigit) {
      if (digits >= PHONE_MAX_DIGITS) continue;
      digits += 1;
    }
    kept += character;
    if (plus.length + kept.length >= PHONE_MAX_CHARS) break;
  }

  return plus + kept;
}

/** Display form for a stored number. `—` stands in for "not given". */
export function formatPhone(value: string | null | undefined): string {
  const normalized = value ? normalizePhone(value) : '';
  return normalized || '—';
}

/**
 * Body mass index from the two stored measurements, to one decimal place, or
 * null when either is missing — a therapist reading a half-filled profile should
 * see a blank, not a number derived from a guess.
 */
export function bmi(
  heightCm: number | null | undefined,
  weightKg: number | null | undefined
): number | null {
  if (heightCm == null || weightKg == null) return null;
  if (!(heightCm > 0) || !(weightKg > 0)) return null;
  const metres = heightCm / 100;
  return Math.round((weightKg / (metres * metres)) * 10) / 10;
}
