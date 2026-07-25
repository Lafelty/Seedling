/**
 * Numeric text-field helpers.
 *
 * The smooth-caret fields render as `type="text"` because the HTML spec forbids
 * `selectionStart`/`selectionEnd` on `type="number"` (and `email`), which makes
 * caret position unmeasurable there. These helpers replace what the native
 * number input used to give us: digit filtering and min/max enforcement.
 */

export type NumericFormat = 'integer' | 'decimal'

export interface NumericConstraints {
  min?: number
  max?: number
  /** `'integer'` rejects the decimal point outright. Defaults to `'integer'`. */
  format?: NumericFormat
  allowNegative?: boolean
}

/**
 * Drop characters a numeric field can never contain, while still allowing the
 * half-finished shapes a user types through: `''`, `'-'`, `'1.'`, `'-0.'`.
 */
export function sanitizeNumericDraft(raw: string, constraints: NumericConstraints = {}): string {
  const { format = 'integer', allowNegative = false } = constraints

  let out = ''
  let seenDot = false

  for (const char of raw) {
    if (char >= '0' && char <= '9') {
      out += char
      continue
    }
    // A sign is only meaningful in the leading position.
    if (char === '-' && allowNegative && out.length === 0) {
      out += char
      continue
    }
    if (char === '.' && format === 'decimal' && !seenDot) {
      seenDot = true
      out += char
    }
  }

  return out
}

/** Parse a draft to a number, or `null` while it holds no numeric value yet. */
export function parseNumericDraft(draft: string): number | null {
  if (draft === '' || draft === '-' || draft === '.' || draft === '-.') return null
  const parsed = Number(draft)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Round to the field's format and pull the value inside `[min, max]`.
 * Only applied on commit (blur) — clamping mid-keystroke would make values
 * above a single digit unreachable on fields with a non-zero `min`.
 */
export function clampNumeric(value: number, constraints: NumericConstraints = {}): number {
  const { min, max, format = 'integer' } = constraints

  let next = format === 'integer' ? Math.round(value) : value
  if (min !== undefined && next < min) next = min
  if (max !== undefined && next > max) next = max

  return next
}
