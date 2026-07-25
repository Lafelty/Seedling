'use client'

/**
 * The gold star badge: a struck coin that catches light, and blooms when a
 * star lands.
 *
 * At rest it behaves like a physical object. The pointer tips it in 3D on a
 * spring, and the specular highlight stays where the light is rather than
 * following the cursor — so the coin turns under a fixed lamp instead of
 * dragging a glow around with it. A pale-gold gleam crosses the border every
 * few seconds. That is the whole idle vocabulary: quiet, no bounce.
 *
 * The award is the one moment that spends motion. When the count rises, the
 * number rolls up behind a clip, a single ring of light expands out of the
 * badge and dissolves, and the coin brightens. It reads as something growing,
 * which is the app's metaphor, rather than as a prize going off.
 *
 * Layers inside the coin, back to front: specular highlight, contents behind a
 * travelling mask, then the 1px border gleam. Gradient, bevel and shadow live
 * in `.star-badge`.
 *
 * Everything animated is `transform` or `opacity`. The coin's transform is one
 * composed string driven by springs, so tilt, hover and press never fight over
 * the same property. The idle gleam parks while the badge is off screen.
 *
 * Reduced motion drops the tilt, the gleam and the ring; the count crossfades
 * instead of rolling, and the bevel and hover shadow stay.
 */

import {
  AnimatePresence,
  motion,
  useInView,
  useMotionTemplate,
  useReducedMotion,
  useSpring,
  type TargetAndTransition,
  type Transition,
} from 'framer-motion'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { vibrate } from '@/lib/rewardFx'

/**
 * One gleam per ~4s. A gleam is decorative and the badge is permanent page
 * furniture, so it stays rare enough to notice and ignore; `linear` because
 * constant travel is what a reflection does.
 */
const SWEEP = { duration: 1.05, repeat: Infinity, ease: 'linear', repeatDelay: 3.2 } as const

/** Heavy enough to feel like metal, damped enough never to wobble. */
const TILT_SPRING = { stiffness: 260, damping: 26, mass: 0.6 }
const PRESS_SPRING = { stiffness: 420, damping: 32, mass: 0.5 }

/** ease-out-expo. The ring leaves fast and settles slowly, like light spreading. */
const BLOOM: Transition = { duration: 0.78, ease: [0.16, 1, 0.3, 1] }
const ROLL: Transition = { duration: 0.42, ease: [0.16, 1, 0.3, 1] }

/** Degrees of tilt at the badge's edge. Past ~10 the text starts to smear. */
const MAX_TILT = 8

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

/** Lives outside the coin's clip, so it can leave the pill's edge. */
const BLOOM_STYLE: CSSProperties = {
  position: 'absolute',
  inset: -2,
  borderRadius: 'var(--radius-full)',
  border: '1px solid rgba(201, 184, 138, 0.85)',
  boxShadow: '0 0 18px rgba(201, 184, 138, 0.55)',
  pointerEvents: 'none',
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
   * number, rolls the number when it changes, and blooms when it goes up.
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

  // Motion's pointer states fire on touch taps too, which leaves a badge stuck
  // lit after the finger lifts. Tilt and highlight are for pointers that hover.
  const finePointer = useFinePointer()
  const tilt = !reduced && finePointer

  const rotateX = useSpring(0, TILT_SPRING)
  const rotateY = useSpring(0, TILT_SPRING)
  const scale = useSpring(1, PRESS_SPRING)
  // One composed transform: tilt, hover and press can never overwrite each
  // other, and there is no implicit resting value for Motion to guess at.
  const transform = useMotionTemplate`perspective(420px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`

  // The lamp is fixed in the badge's own space. Tilting toward the pointer
  // slides the reflection the other way, which is what a real surface does.
  const lightX = useSpring(50, TILT_SPRING)
  const lightY = useSpring(30, TILT_SPRING)
  const specular = useMotionTemplate`radial-gradient(58px circle at ${lightX}% ${lightY}%, rgba(255, 255, 255, 0.6), transparent 70%)`
  const specularOpacity = useSpring(0, PRESS_SPRING)

  const awards = useAwardCount(value)
  const [blooming, setBlooming] = useState(false)

  useEffect(() => {
    if (awards > 0 && !reduced) setBlooming(true)
  }, [awards, reduced])

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!tilt) return
      const box = event.currentTarget.getBoundingClientRect()
      // -0.5 … 0.5 from the centre of the badge.
      const dx = (event.clientX - box.left) / box.width - 0.5
      const dy = (event.clientY - box.top) / box.height - 0.5
      rotateY.set(dx * MAX_TILT * 2)
      rotateX.set(-dy * MAX_TILT * 2)
      lightX.set(50 - dx * 60)
      lightY.set(50 - dy * 60)
    },
    [tilt, rotateX, rotateY, lightX, lightY]
  )

  const settle = useCallback(() => {
    rotateX.set(0)
    rotateY.set(0)
    scale.set(1)
    specularOpacity.set(0)
  }, [rotateX, rotateY, scale, specularOpacity])

  const Root = (as === 'span' ? motion.span : motion.div) as typeof motion.div
  const Wrapper = as === 'span' ? 'span' : 'div'

  const content =
    value != null ? (
      <>
        <svg width={starSize} height={starSize} viewBox="0 0 20 20" fill="currentColor">
          <path d={STAR_PATH} />
        </svg>
        <RollingCount value={value} reduced={!!reduced} />
      </>
    ) : (
      children
    )

  return (
    // Neutral wrapper: the bloom has to escape the coin's own clip.
    <Wrapper style={{ position: 'relative', display: 'inline-flex' }}>
      {/* Unmounts the moment it finishes: a spent ring is invisible but still
          a layer the compositor has to carry. */}
      {blooming && (
        <motion.span
          key={awards}
          aria-hidden
          style={BLOOM_STYLE}
          initial={{ opacity: 0.95, transform: 'scale(0.94)' }}
          animate={{ opacity: 0, transform: 'scale(1.45)' }}
          transition={BLOOM}
          onAnimationComplete={() => setBlooming(false)}
        />
      )}

      <Root
        ref={ref}
        title={title}
        aria-label={value != null ? `${value} stars` : undefined}
        className={`star-badge ${className}`.trim()}
        style={{ position: 'relative', overflow: 'hidden', transform, ...style }}
        onPointerMove={onPointerMove}
        onPointerEnter={() => {
          if (!tilt) return
          scale.set(1.03)
          specularOpacity.set(1)
        }}
        onPointerLeave={settle}
        onPointerDown={() => scale.set(0.97)}
        onPointerUp={() => scale.set(tilt ? 1.03 : 1)}
        onPointerCancel={settle}
      >
        {tilt && (
          <motion.span
            aria-hidden
            style={{ ...SPECULAR_STYLE, backgroundImage: specular, opacity: specularOpacity }}
          />
        )}

        <motion.span
          style={CONTENT_STYLE}
          initial={MASK_START}
          animate={animated ? MASK_END : MASK_START}
          transition={animated ? SWEEP : { duration: 0 }}
        >
          {content}
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
    </Wrapper>
  )
}

/**
 * The count, rolling up behind a clip when it changes. Grid stacking keeps the
 * outgoing and incoming numbers in the same cell, so nothing reflows mid-roll.
 */
function RollingCount({ value, reduced }: { value: number; reduced: boolean }) {
  return (
    <span
      style={{
        display: 'grid',
        overflow: 'hidden',
        // Tabular figures: the badge must not resize as the count ticks over.
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={value}
          style={{ gridArea: '1 / 1' }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: '100%' }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: '0%' }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: '-100%' }}
          transition={ROLL}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

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
 * increases bloom — a correction downward is not an award, and the first value
 * is just the badge rendering.
 */
function useAwardCount(value: number | undefined): number {
  const previous = useRef(value)
  const [awards, setAwards] = useState(0)

  useEffect(() => {
    if (value == null) return
    if (previous.current != null && value > previous.current) {
      setAwards((count) => count + 1)
      // Phones get the award in the hand as well as the eye.
      vibrate(12)
    }
    previous.current = value
  }, [value])

  return awards
}
