'use client'

/**
 * Text fields with a spring-animated caret.
 *
 * The native caret is hidden (`caret-color: transparent`) and replaced by an
 * absolutely positioned element whose position is driven by a spring, so the
 * caret glides between characters instead of teleporting. Position is derived
 * by rendering the text before the caret into a hidden mirror element that
 * copies the field's font metrics, then measuring it.
 *
 * `SmoothInput` handles single-line fields, `SmoothTextarea` handles multi-line
 * (mirror wraps at the same width, so the caret tracks both line and column).
 *
 * Known limitation: right-to-left text is not supported — those fields fall
 * back to the native caret.
 */

import { motion, type MotionValue, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
import React, {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'

const CARET_SPRING = { stiffness: 500, damping: 30, mass: 0.5 }
/** Reduced motion keeps one caret element but makes it snap like the native one. */
const CARET_SNAP = { stiffness: 10000, damping: 100, mass: 0.1 }

const CARET_WIDTH = 2

/**
 * Input types whose selection API browsers actually expose. Everything else
 * (`number`, `email`, `date`, `color`, …) returns `null` from `selectionStart`
 * per the HTML spec's "do not apply" table, so the caret is unmeasurable.
 */
const SELECTABLE_TYPES = new Set(['text', 'search', 'tel', 'url', 'password'])

/** Firefox draws password bullets as U+25CF; other engines use U+2022. */
let cachedPasswordChar: string | null = null
function passwordChar(): string {
  // Resolved lazily: `navigator` does not exist during the server render.
  if (cachedPasswordChar === null) {
    cachedPasswordChar = /firefox|fxios/i.test(navigator.userAgent) ? '●' : '•'
  }
  return cachedPasswordChar
}

function isChromium(): boolean {
  return /chrome|chromium|crios/i.test(navigator.userAgent)
}

type CaretGeometry = { x: number; y: number; height: number; color: string }

/**
 * Layout properties describe how the field sits in its parent, so they move to
 * the wrapper the caret is anchored in; paint properties stay on the field.
 * Tailwind's preflight makes everything `box-sizing: border-box`, so moving
 * `width` out and giving the field `width: 100%` preserves the original box.
 */
const WRAPPER_STYLE_KEYS = new Set<string>([
  'display',
  'width',
  'minWidth',
  'maxWidth',
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'justifySelf',
  'order',
  'gridArea',
  'gridColumn',
  'gridRow',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginBlock',
  'marginBlockStart',
  'marginBlockEnd',
  'marginInline',
  'marginInlineStart',
  'marginInlineEnd',
])

function splitStyle(style: CSSProperties | undefined) {
  const wrapper: Record<string, unknown> = {}
  const field: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(style ?? {})) {
    if (WRAPPER_STYLE_KEYS.has(key)) wrapper[key] = value
    else field[key] = value
  }

  return { wrapper: wrapper as CSSProperties, field: field as CSSProperties }
}

function resolveLineHeight(styles: CSSStyleDeclaration): number {
  const lineHeight = parseFloat(styles.lineHeight)
  if (Number.isFinite(lineHeight)) return lineHeight
  // `normal` — approximate the way browsers do for Latin fonts.
  return (parseFloat(styles.fontSize) || 16) * 1.2
}

function copyFontMetrics(target: HTMLElement, styles: CSSStyleDeclaration, fontSize: string) {
  target.style.font = `${styles.fontStyle} ${styles.fontWeight} ${fontSize} ${styles.fontFamily}`
  target.style.letterSpacing = styles.letterSpacing
  target.style.wordSpacing = styles.wordSpacing
  target.style.fontFeatureSettings = styles.fontFeatureSettings
  target.style.fontVariationSettings = styles.fontVariationSettings
  target.style.textTransform = styles.textTransform
  target.style.textIndent = styles.textIndent
  target.style.tabSize = styles.tabSize
}

/**
 * The caret index, or `null` when there is no single caret to draw — a range is
 * selected, or the field type does not support the selection API.
 */
function caretIndexOf(field: HTMLInputElement | HTMLTextAreaElement): number | null {
  let start: number | null
  let end: number | null

  try {
    start = field.selectionStart
    end = field.selectionEnd
  } catch {
    return null
  }

  if (start === null || end === null) return null
  if (start !== end) return null

  return start
}

/**
 * Nudge the field's scroll so the caret sits inside the visible band. The
 * browser already does this for the real selection; this only covers the frames
 * where we measure before it has caught up, and is a no-op otherwise.
 */
function scrollCaretIntoView(
  field: HTMLInputElement | HTMLTextAreaElement,
  caretInner: number,
  paddingLeft: number,
  paddingRight: number,
) {
  const maxScroll = Math.max(0, field.scrollWidth - field.clientWidth)
  const visibleLeft = field.scrollLeft + paddingLeft
  const visibleRight = field.scrollLeft + field.clientWidth - paddingRight

  if (caretInner > visibleRight) {
    field.scrollLeft = Math.min(caretInner - field.clientWidth + paddingRight, maxScroll)
    return
  }

  if (caretInner < visibleLeft) {
    field.scrollLeft = Math.max(0, caretInner - paddingLeft)
  }
}

/**
 * Wires the caret element to a `measure` callback: springs its position, hides
 * it when there is nothing to draw, and re-measures on every event that can
 * move it (typing, selection, scroll, font load, resize).
 */
function useCaretMotion(
  fieldRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  caretRef: React.RefObject<HTMLSpanElement | null>,
  measure: () => CaretGeometry | null,
  enabled: boolean,
) {
  const prefersReducedMotion = useReducedMotion()

  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const height = useMotionValue(0)
  const opacity = useMotionValue(0)

  const springConfig = prefersReducedMotion ? CARET_SNAP : CARET_SPRING
  const springX = useSpring(x, springConfig)
  const springY = useSpring(y, springConfig)

  const measureRef = useRef(measure)
  measureRef.current = measure

  /** `immediate` skips the animation — used when the caret appears or the box moves. */
  const sync = useCallback(
    (immediate = false) => {
      const field = fieldRef.current
      if (!enabled || !field || document.activeElement !== field) {
        opacity.set(0)
        return
      }

      const geometry = measureRef.current()
      if (!geometry) {
        opacity.set(0)
        return
      }

      x.set(geometry.x)
      y.set(geometry.y)
      if (immediate) {
        springX.jump(geometry.x)
        springY.jump(geometry.y)
      }
      height.set(geometry.height)

      const caret = caretRef.current
      if (caret) caret.style.background = geometry.color

      opacity.set(1)
    },
    [caretRef, enabled, fieldRef, height, opacity, springX, springY, x, y],
  )

  const syncRef = useRef(sync)
  syncRef.current = sync

  useEffect(() => {
    const field = fieldRef.current
    const wrapper = wrapperRef.current
    if (!enabled || !field || !wrapper) return

    const syncNow = () => syncRef.current(true)
    const syncAnimated = () => syncRef.current(false)
    // Selection and input land before the browser has updated scroll/layout.
    const syncNextFrame = () => requestAnimationFrame(syncAnimated)
    const hideCaret = () => opacity.set(0)

    const handleDocumentSelectionChange = () => {
      if (document.activeElement !== field) return
      syncNextFrame()
    }

    document.addEventListener('selectionchange', handleDocumentSelectionChange)
    field.addEventListener('focus', syncNow)
    field.addEventListener('blur', hideCaret)
    field.addEventListener('select', syncNextFrame)
    field.addEventListener('keyup', syncNextFrame)
    field.addEventListener('pointerup', syncNextFrame)
    field.addEventListener('scroll', syncNow)

    const resizeObserver = new ResizeObserver(syncNow)
    resizeObserver.observe(wrapper)
    resizeObserver.observe(field)

    // Web fonts change every glyph advance we just measured.
    if (document.fonts) {
      document.fonts.addEventListener('loadingdone', syncNow)
      void document.fonts.ready.then(syncNow)
    }

    // `autoFocus` can land before this effect runs, so there is no focus event.
    syncNow()

    return () => {
      document.removeEventListener('selectionchange', handleDocumentSelectionChange)
      field.removeEventListener('focus', syncNow)
      field.removeEventListener('blur', hideCaret)
      field.removeEventListener('select', syncNextFrame)
      field.removeEventListener('keyup', syncNextFrame)
      field.removeEventListener('pointerup', syncNextFrame)
      field.removeEventListener('scroll', syncNow)
      resizeObserver.disconnect()
      if (document.fonts) document.fonts.removeEventListener('loadingdone', syncNow)
    }
    // `blur` closes over `opacity`, which is stable for the component's life.
  }, [enabled, fieldRef, opacity, wrapperRef])

  return { springX, springY, height, opacity, sync }
}

interface CaretProps {
  caretRef: React.RefObject<HTMLSpanElement | null>
  x: MotionValue<number>
  y: MotionValue<number>
  height: MotionValue<number>
  opacity: MotionValue<number>
}

function Caret({ caretRef, x, y, height, opacity }: CaretProps) {
  return (
    <motion.span
      ref={caretRef}
      aria-hidden
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: CARET_WIDTH,
        borderRadius: CARET_WIDTH / 2,
        pointerEvents: 'none',
        x,
        y,
        height,
        opacity,
      }}
    />
  )
}

const HIDDEN_MIRROR_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
  whiteSpace: 'pre',
  padding: 0,
  border: 0,
  margin: 0,
}

// ---------------------------------------------------------------------------
// Single-line
// ---------------------------------------------------------------------------

export type SmoothInputType = 'text' | 'search' | 'tel' | 'url' | 'password'

export type SmoothInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'> & {
  type?: SmoothInputType
  /** Caret colour. Defaults to the field's own text colour, like a native caret. */
  caretColor?: string
}

export function SmoothInput({
  type = 'text',
  caretColor,
  style,
  onChange,
  ...props
}: SmoothInputProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLSpanElement>(null)
  const caretRef = useRef<HTMLSpanElement>(null)

  const enabled = SELECTABLE_TYPES.has(type)
  const { wrapper, field } = useMemo(() => splitStyle(style), [style])

  const measure = useCallback((): CaretGeometry | null => {
    const input = fieldRef.current
    const mirror = mirrorRef.current
    if (!input || !mirror) return null

    const caretIndex = caretIndexOf(input)
    if (caretIndex === null) return null

    const styles = window.getComputedStyle(input)
    if (styles.direction === 'rtl') return null

    const isPassword = input.type === 'password'

    let fontSize = styles.fontSize
    // Non-Chromium engines render U+2022 larger than the surrounding text, so
    // the mirror has to be scaled up to match the real glyph advance.
    if (isPassword && passwordChar() === '•' && !isChromium()) {
      fontSize = `${parseFloat(fontSize) + 6.25}px`
    }
    copyFontMetrics(mirror, styles, fontSize)

    const text = isPassword ? passwordChar().repeat(input.value.length) : input.value
    const measureWidth = (value: string) => {
      if (value.length === 0) return 0
      mirror.textContent = value
      return mirror.getBoundingClientRect().width
    }

    const prefixWidth = measureWidth(text.slice(0, caretIndex))

    const borderLeft = parseFloat(styles.borderLeftWidth) || 0
    const borderTop = parseFloat(styles.borderTopWidth) || 0
    const paddingLeft = parseFloat(styles.paddingLeft) || 0
    const paddingRight = parseFloat(styles.paddingRight) || 0
    const paddingTop = parseFloat(styles.paddingTop) || 0
    const paddingBottom = parseFloat(styles.paddingBottom) || 0

    // Where the text run starts inside the padding box. Alignment only shifts
    // it while the text still fits; once it overflows, it starts at the edge.
    let textStart = paddingLeft
    const contentWidth = input.clientWidth - paddingLeft - paddingRight
    const fullWidth = measureWidth(text)
    if (fullWidth <= contentWidth) {
      const align = styles.textAlign === 'start' ? 'left' : styles.textAlign === 'end' ? 'right' : styles.textAlign
      if (align === 'center') textStart = paddingLeft + (contentWidth - fullWidth) / 2
      else if (align === 'right') textStart = paddingLeft + (contentWidth - fullWidth)
    }

    const caretInner = textStart + prefixWidth
    scrollCaretIntoView(input, caretInner, paddingLeft, paddingRight)

    const caretVisual = caretInner - input.scrollLeft
    const minVisible = paddingLeft - 1
    const maxVisible = input.clientWidth - paddingRight
    if (caretVisual < minVisible - 0.5 || caretVisual > maxVisible + 1) return null

    const contentHeight = Math.max(0, input.clientHeight - paddingTop - paddingBottom)
    const lineHeight = resolveLineHeight(styles)
    const height = contentHeight > 0 ? Math.min(lineHeight, contentHeight) : lineHeight

    return {
      x: borderLeft + Math.min(caretVisual, maxVisible - CARET_WIDTH),
      y: borderTop + paddingTop + (contentHeight - height) / 2,
      height,
      color: caretColor ?? styles.color,
    }
  }, [caretColor])

  const { springX, springY, height, opacity, sync } = useCaretMotion(
    fieldRef,
    wrapperRef,
    caretRef,
    measure,
    enabled,
  )

  // The caret moves when the value changes from outside (controlled resets) and
  // when the type flips between text and password.
  useEffect(() => {
    sync(false)
  }, [props.value, sync])

  useEffect(() => {
    sync(true)
  }, [type, sync])

  if (!enabled) {
    return <input {...props} type={type} style={style} onChange={onChange} />
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'block', ...wrapper }}>
      <input
        {...props}
        ref={fieldRef}
        type={type}
        style={{ ...field, display: 'block', width: '100%', caretColor: 'transparent' }}
        onChange={(event) => {
          onChange?.(event)
          requestAnimationFrame(() => sync(false))
        }}
      />
      <span ref={mirrorRef} aria-hidden style={HIDDEN_MIRROR_STYLE} />
      <Caret caretRef={caretRef} x={springX} y={springY} height={height} opacity={opacity} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Multi-line
// ---------------------------------------------------------------------------

export type SmoothTextareaProps = ComponentPropsWithoutRef<'textarea'> & {
  /** Caret colour. Defaults to the field's own text colour, like a native caret. */
  caretColor?: string
}

export function SmoothTextarea({
  caretColor,
  style,
  onChange,
  ...props
}: SmoothTextareaProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<HTMLSpanElement>(null)

  const { wrapper, field } = useMemo(() => splitStyle(style), [style])

  const measure = useCallback((): CaretGeometry | null => {
    const textarea = fieldRef.current
    const mirror = mirrorRef.current
    if (!textarea || !mirror) return null

    const caretIndex = caretIndexOf(textarea)
    if (caretIndex === null) return null

    const styles = window.getComputedStyle(textarea)
    if (styles.direction === 'rtl') return null

    const paddingLeft = parseFloat(styles.paddingLeft) || 0
    const paddingRight = parseFloat(styles.paddingRight) || 0
    const paddingTop = parseFloat(styles.paddingTop) || 0
    const paddingBottom = parseFloat(styles.paddingBottom) || 0
    const borderLeft = parseFloat(styles.borderLeftWidth) || 0
    const borderTop = parseFloat(styles.borderTopWidth) || 0

    copyFontMetrics(mirror, styles, styles.fontSize)
    const lineHeight = resolveLineHeight(styles)
    mirror.style.lineHeight = `${lineHeight}px`
    mirror.style.textAlign = styles.textAlign
    // Wrap at exactly the same width as the real text run, or the mirror's line
    // breaks land in different places than the ones on screen.
    mirror.style.width = `${Math.max(0, textarea.clientWidth - paddingLeft - paddingRight)}px`
    mirror.style.whiteSpace = textarea.wrap === 'off' ? 'pre' : 'pre-wrap'
    mirror.style.overflowWrap = styles.overflowWrap
    mirror.style.wordBreak = styles.wordBreak

    // Text before the caret, then a marker holding the remainder. Keeping the
    // remainder in the mirror preserves the real wrap points; the '.' fallback
    // gives the marker a box when the caret sits at the very end.
    const value = textarea.value
    mirror.textContent = value.slice(0, caretIndex)
    const marker = document.createElement('span')
    marker.textContent = value.slice(caretIndex) || '.'
    mirror.appendChild(marker)

    // The marker's first fragment starts exactly where the caret belongs. Client
    // rects rather than offsetLeft/offsetTop: those round to whole pixels, and a
    // marker whose text wraps would report the height of *all* its rows.
    const firstFragment = marker.getClientRects()[0]
    if (!firstFragment) return null
    const mirrorOrigin = mirror.getBoundingClientRect()

    // An inline box sits half-leading below the top of its line box, and the
    // caret is drawn against the line box, not the glyphs.
    const halfLeading = (lineHeight - firstFragment.height) / 2

    const caretInnerX = paddingLeft + (firstFragment.left - mirrorOrigin.left)
    const caretInnerY = paddingTop + (firstFragment.top - mirrorOrigin.top) - halfLeading

    const caretVisualX = caretInnerX - textarea.scrollLeft
    const caretVisualY = caretInnerY - textarea.scrollTop

    const maxVisibleX = textarea.clientWidth - paddingRight
    const maxVisibleY = textarea.clientHeight - paddingBottom
    if (caretVisualX < paddingLeft - 1.5 || caretVisualX > maxVisibleX + 1) return null
    if (caretVisualY + lineHeight < paddingTop - 1 || caretVisualY > maxVisibleY) return null

    return {
      x: borderLeft + Math.min(caretVisualX, maxVisibleX - CARET_WIDTH),
      y: borderTop + caretVisualY,
      height: lineHeight,
      color: caretColor ?? styles.color,
    }
  }, [caretColor])

  const { springX, springY, height, opacity, sync } = useCaretMotion(
    fieldRef,
    wrapperRef,
    caretRef,
    measure,
    true,
  )

  useEffect(() => {
    sync(false)
  }, [props.value, sync])

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'block', ...wrapper }}>
      <textarea
        {...props}
        ref={fieldRef}
        style={{ ...field, display: 'block', width: '100%', caretColor: 'transparent' }}
        onChange={(event) => {
          onChange?.(event)
          requestAnimationFrame(() => sync(false))
        }}
      />
      <div ref={mirrorRef} aria-hidden style={HIDDEN_MIRROR_STYLE} />
      <Caret caretRef={caretRef} x={springX} y={springY} height={height} opacity={opacity} />
    </div>
  )
}
