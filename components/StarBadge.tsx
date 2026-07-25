'use client'

/**
 * The gold star badge and its motion.
 *
 * Layers, back to front:
 *   1. a specular highlight that trails the pointer on a spring (fine pointers
 *      only) — the thing that makes the gold read as metal rather than paint
 *   2. the contents, behind a diagonal mask that dissolves them as the gleam
 *      crosses
 *   3. a 1px gleam travelling the pill's border
 *
 * The highlight is pale gold, not white: white over the gold gradient reads as
 * silver. Gradient, border and shadow still live in `.star-badge`.
 *
 * The idle gleam only runs while the badge is on screen, and every animated
 * property is `transform` or `opacity`. Transforms are written as full strings
 * rather than Motion's `scale`/`x` shorthands, which run on the main thread.
 *
 * Reduced motion keeps the badge and its hover shadow but drops all movement.
 */

import {
  motion,
  useInView,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  type TargetAndTransition,
  type Transition,
  type Variants,
} from 'framer-motion'
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'

/**
 * One gleam per ~4s. A gleam is decorative and the badge is permanent page
 * furniture, so it stays rare enough to notice and ignore; `linear` because
 * constant travel is what a reflection does.
 */
const SWEEP = { duration: 1.05, repeat: Infinity, ease: 'linear', repeatDelay: 3.2 } as const

/** Press feedback, in Apple's spring terms. Short, barely any bounce. */
const PRESS_SPRING = { type: 'spring', duration: 0.3, bounce: 0.2 } as const

/** The award pop: one-shot, strong ease-out, under 300ms of real movement. */
const POP: Transition = { duration: 0.42, times: [0, 0.35, 1], ease: [0.23, 1, 0.32, 1] }

const SHINE = 'rgba(255, 248, 219, 0.95)'

/**
 * `--mask-x` travels 100% → -100%; the fallback keeps the first paint sane.
 * The trough is translucent rather than `transparent`: the star count is data
 * the user is reading, so the gleam may dim it but never erase it.
 */
const SHINE_MASK =
  'linear-gradient(-75deg, white calc(var(--mask-x, 100%) + 20%), rgba(255, 255, 255, 0.38) calc(var(--mask-x, 100%) + 30%), white calc(var(--mask-x, 100%) + 100%))'

/** Paints the border-box, then punches out the content-box — leaves the 1px ring. */
const RING_MASK = 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)'

const MASK_START = { '--mask-x': '100%' } as unknown as TargetAndTransition
const MASK_END = { '--mask-x': '-100%' } as unknown as TargetAndTransition

const ROOT_VARIANTS: Variants = {
  hover: { transform: 'scale(1.03)' },
  tap: { transform: 'scale(0.97)' },
}

/** Only the highlight reacts to hover; the ring keeps its own idle loop. */
const SPECULAR_VARIANTS: Variants = {
  hover: { opacity: 1 },
}

const CONTENT_STYLE: CSSProperties = {
  // The badge's flex row moves in here: the mask needs one element wrapping
  // every child.
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'inherit',
  position: 'relative',
  zIndex: 1,
  WebkitMaskImage: SHINE_MASK,
  maskImage: SHINE_MASK,
}

const SPECULAR_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: 'inherit',
  pointerEvents: 'none',
  zIndex: 0,
}

const RING_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: 'inherit',
  padding: 1,
  pointerEvents: 'none',
  overflow: 'hidden',
  zIndex: 2,
  WebkitMask: RING_MASK,
  WebkitMaskComposite: 'xor',
  mask: RING_MASK,
  maskComposite: 'exclude',
}

/**
 * Twice the badge's width so the band can travel by transform. Moving a
 * gradient with `background-position` repaints every frame; moving the layer
 * itself does not.
 */
const GLEAM_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: '-50%',
  width: '200%',
  background: `linear-gradient(-75deg, transparent 30%, ${SHINE} 50%, transparent 70%)`,
}

const STAR_PATH = 'M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z'

interface StarBadgeProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  /** `span` when the badge sits inside a link or other inline content. */
  as?: 'div' | 'span'
  title?: string
  /**
   * Star count. Passing it (instead of `children`) renders the star and the
   * number, and pops the badge when the count goes up.
   */
  value?: number
  starSize?: number
}

export function StarBadge({
  children,
  className = '',
  style,
  as = 'div',
  title,
  value,
  starSize = 20,
}: StarBadgeProps) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  // Offscreen badges keep their gleam parked: an animation nobody can see is
  // pure main-thread cost.
  const inView = useInView(ref)
  const animated = !reduced && inView

  // Motion's `whileHover` fires on touch taps, which leaves a badge stuck in
  // its hover state after the finger lifts.
  const finePointer = useFinePointer()

  const pointerX = useSpring(0, SPECULAR_SPRING)
  const pointerY = useSpring(0, SPECULAR_SPRING)
  const specular = useMotionTemplate`radial-gradient(52px circle at ${pointerX}px ${pointerY}px, rgba(255, 255, 255, 0.55), transparent 72%)`

  const celebration = useAwardCount(value)

  function trackPointer(event: PointerEvent<HTMLElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    pointerX.set(event.clientX - box.left)
    pointerY.set(event.clientY - box.top)
  }

  // Both tags take the same props; the cast keeps JSX off a union component type.
  const Root = (as === 'span' ? motion.span : motion.div) as typeof motion.div

  const content =
    value != null ? (
      <>
        <svg width={starSize} height={starSize} viewBox="0 0 20 20" fill="currentColor">
          <path d={STAR_PATH} />
        </svg>
        {/* Tabular figures: the badge must not resize as the count ticks over. */}
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </>
    ) : (
      children
    )

  return (
    <Root
      ref={ref}
      title={title}
      className={`star-badge ${className}`.trim()}
      // The resting transform must be spelled out. Motion derives the origin of
      // a string transform by zeroing its numbers, so without this the badge
      // settles at `scale(0)` the first time a hover/tap variant resolves.
      style={{ position: 'relative', overflow: 'hidden', transform: 'scale(1)', ...style }}
      variants={ROOT_VARIANTS}
      whileHover={finePointer ? 'hover' : undefined}
      whileTap="tap"
      transition={PRESS_SPRING}
      onPointerMove={finePointer && !reduced ? trackPointer : undefined}
    >
      {finePointer && !reduced && (
        <motion.span
          aria-hidden
          style={{ ...SPECULAR_STYLE, backgroundImage: specular }}
          variants={SPECULAR_VARIANTS}
          initial={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
        />
      )}

      <motion.span
        style={CONTENT_STYLE}
        initial={MASK_START}
        animate={animated ? MASK_END : MASK_START}
        transition={animated ? SWEEP : { duration: 0 }}
      >
        {/* Remounting replays the pop; awards are rare, so a restart is fine. */}
        <motion.span
          key={celebration}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'inherit' }}
          animate={celebration && !reduced ? { transform: ['scale(1)', 'scale(1.22)', 'scale(1)'] } : undefined}
          transition={POP}
        >
          {content}
        </motion.span>
      </motion.span>

      <span aria-hidden style={RING_STYLE}>
        <motion.span
          style={GLEAM_STYLE}
          initial={{ transform: 'translateX(50%)', opacity: 0 }}
          animate={
            animated
              ? { transform: ['translateX(50%)', 'translateX(-50%)'], opacity: [0, 1, 0] }
              : { opacity: 0 }
          }
          transition={animated ? SWEEP : { duration: 0 }}
        />
      </span>
    </Root>
  )
}

const SPECULAR_SPRING = { stiffness: 220, damping: 26, mass: 0.4 }

/** Hover effects belong to devices that can actually hover. */
function useFinePointer(): boolean {
  const [fine, setFine] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)')
    setFine(query.matches)
    const onChange = (event: MediaQueryListEvent) => setFine(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return fine
}

/**
 * Counts how many times the star count has gone *up* while mounted. Only
 * increases celebrate — a correction downward is not an award, and the first
 * value is just the badge rendering.
 */
function useAwardCount(value: number | undefined): number {
  const previous = useRef(value)
  const [awards, setAwards] = useState(0)

  useEffect(() => {
    if (value == null) return
    if (previous.current != null && value > previous.current) setAwards((count) => count + 1)
    previous.current = value
  }, [value])

  return awards
}
