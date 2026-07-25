'use client'

/**
 * The gold star badge, with a shine that sweeps across it on a loop.
 *
 * Two synchronized layers make the sweep: a diagonal mask that briefly
 * dissolves the badge's contents (star + count) as the band crosses them, and a
 * 1px band travelling around the border. Gold is the badge's identity, so the
 * highlight is pale gold — a white one reads as silver over the gold gradient.
 *
 * Everything except the sweep still comes from `.star-badge` in globals.css,
 * and `children` stay whatever the call site passes, so each site keeps its own
 * star size and padding.
 *
 * Reduced motion drops both layers and renders the plain gold pill.
 */

import { motion, type TargetAndTransition, useReducedMotion } from 'framer-motion'
import type { CSSProperties, ReactNode } from 'react'

/** One gleam per 4s: reads as alive without competing with the page content. */
const SWEEP = { duration: 1, repeat: Infinity, ease: 'linear', repeatDelay: 3 } as const

const PRESS_SPRING = { type: 'spring', stiffness: 500, damping: 30, mass: 0.5 } as const

const SHINE = 'rgba(255, 248, 219, 0.95)'

/** `--mask-x` is driven from 100% to -100%; the fallback keeps SSR markup sane. */
const SHINE_MASK =
  'linear-gradient(-75deg, white calc(var(--mask-x, 100%) + 20%), transparent calc(var(--mask-x, 100%) + 30%), white calc(var(--mask-x, 100%) + 100%))'

const BAND_MASK = 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)'

/** Custom properties are not part of the animation target types, hence the casts. */
const MASK_START = { '--mask-x': '100%' } as unknown as TargetAndTransition
const MASK_END = { '--mask-x': '-100%' } as unknown as TargetAndTransition

const CONTENT_STYLE: CSSProperties = {
  // The badge's own flex row moves in here, since the mask needs a single
  // element wrapping every child.
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'inherit',
  position: 'relative',
  zIndex: 1,
  WebkitMaskImage: SHINE_MASK,
  maskImage: SHINE_MASK,
}

const BAND_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: 'inherit',
  padding: 1,
  pointerEvents: 'none',
  background: `linear-gradient(-75deg, transparent 30%, ${SHINE} 50%, transparent 70%)`,
  backgroundSize: '200% 100%',
  // Punch out the interior so only the 1px border ring paints.
  WebkitMask: BAND_MASK,
  WebkitMaskComposite: 'xor',
  mask: BAND_MASK,
  maskComposite: 'exclude',
}

interface StarBadgeProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  /** `span` when the badge sits inside a link or other inline content. */
  as?: 'div' | 'span'
  title?: string
}

export function StarBadge({ children, className = '', style, as = 'div', title }: StarBadgeProps) {
  const reduced = useReducedMotion()
  // Both tags take the same props; the cast keeps JSX off a union component type.
  const Root = (as === 'span' ? motion.span : motion.div) as typeof motion.div

  return (
    <Root
      title={title}
      className={`star-badge ${className}`.trim()}
      style={{ position: 'relative', overflow: 'hidden', ...style }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.97 }}
      transition={PRESS_SPRING}
    >
      {reduced ? (
        children
      ) : (
        <>
          <motion.span
            style={CONTENT_STYLE}
            initial={MASK_START}
            animate={MASK_END}
            transition={SWEEP}
          >
            {children}
          </motion.span>

          <motion.span
            aria-hidden
            style={BAND_STYLE}
            initial={{ backgroundPosition: '100% 0', opacity: 0 }}
            animate={{ backgroundPosition: ['100% 0', '0% 0'], opacity: [0, 1, 0] }}
            transition={SWEEP}
          />
        </>
      )}
    </Root>
  )
}
