'use client'

/**
 * Numeric field built on {@link SmoothInput}.
 *
 * Renders as `type="text"` because `type="number"` does not expose
 * `selectionStart`, which the smooth caret needs. `inputMode` keeps the numeric
 * keypad on mobile, and the digit filtering plus min/max clamping that the
 * native number input used to provide happen in JS instead.
 */

import React, { useEffect, useRef, useState } from 'react'

import {
  clampNumeric,
  parseNumericDraft,
  sanitizeNumericDraft,
  type NumericConstraints,
} from '@/lib/numericInput'

import { SmoothInput, type SmoothInputProps } from './SmoothInput'

export type NumberFieldProps = Omit<
  SmoothInputProps,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode' | 'min' | 'max' | 'step'
> & {
  value: number | null | undefined
  onValueChange: (value: number | null) => void
  min?: number
  max?: number
  /** Allow a decimal point. Defaults to integers only. */
  decimal?: boolean
  allowNegative?: boolean
  /** Let an empty field commit `null` instead of `emptyValue`. */
  nullable?: boolean
  /** Value committed for an empty field when `nullable` is false. Defaults to `min ?? 0`. */
  emptyValue?: number
}

function toDraft(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

export function NumberField({
  value,
  onValueChange,
  min,
  max,
  decimal = false,
  allowNegative = false,
  nullable = false,
  emptyValue,
  onBlur,
  ...props
}: NumberFieldProps) {
  const constraints: NumericConstraints = {
    min,
    max,
    format: decimal ? 'decimal' : 'integer',
    allowNegative,
  }

  /**
   * The field is driven by a draft string rather than the number itself, so
   * transient states the number cannot represent (`''`, `'-'`, `'1.'`) survive
   * long enough to finish typing.
   */
  const [draft, setDraft] = useState(() => toDraft(value))
  const draftRef = useRef(draft)
  draftRef.current = draft

  const fallback = (): number | null => (nullable ? null : (emptyValue ?? min ?? 0))

  // Adopt changes that came from outside (form reset, server load, a sibling
  // edit) without clobbering an in-progress draft that already means `value`.
  useEffect(() => {
    if (parseNumericDraft(draftRef.current) === (value ?? null)) return
    setDraft(toDraft(value))
  }, [value])

  return (
    <SmoothInput
      {...props}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      autoComplete="off"
      value={draft}
      onChange={(event) => {
        const next = sanitizeNumericDraft(event.target.value, constraints)
        setDraft(next)

        const parsed = parseNumericDraft(next)
        // Deliberately unclamped while typing: clamping here would make any
        // value longer than one digit unreachable on a field with a `min`.
        onValueChange(parsed === null ? fallback() : parsed)
      }}
      onBlur={(event) => {
        const parsed = parseNumericDraft(draft)
        const committed = parsed === null ? fallback() : clampNumeric(parsed, constraints)
        setDraft(toDraft(committed))
        onValueChange(committed)
        onBlur?.(event)
      }}
    />
  )
}
