'use client'

import { hashId, tintOf } from '@/lib/levels-theme'

/**
 * A growing thing per box, picked from the box's own id. Form carries most of
 * the identity, the box's own green carries the rest — so a patient recognises
 * the box they tapped on the page it opens into.
 */
export default function BoxMark({
  id,
  cleared,
  size = 48,
  /**
   * `onDark` is for the box's own page, where the mark sits on a slab of the
   * box's colour rather than on a light card — the tint's ink would all but
   * disappear there.
   */
  tone = 'onLight',
}: {
  id: string
  cleared: boolean
  size?: number
  tone?: 'onLight' | 'onDark'
}) {
  const marks = [
    // Leaf on a stem
    <g key="leaf">
      <path d="M12 21c0-5 1-8 3-10" />
      <path d="M15 11c3-1 5-4 5-8-4 0-7 2-8 5-1 3 0 4 3 3Z" />
    </g>,
    // Two-leaf sprout
    <g key="sprout">
      <path d="M12 21v-8" />
      <path d="M12 13c-4 0-6-2-6-6 4 0 6 2 6 6Z" />
      <path d="M12 13c4 0 6-2 6-6-4 0-6 2-6 6Z" />
    </g>,
    // Bud
    <g key="bud">
      <path d="M12 21v-6" />
      <path d="M12 15c-3 0-5-2-5-5s2-7 5-7 5 4 5 7-2 5-5 5Z" />
    </g>,
    // Frond
    <g key="frond">
      <path d="M7 21C7 13 10 7 17 4" />
      <path d="M9 15c2-1 4-1 6 0M10.5 11.5c2-1 4-2 6-2M12.5 8.5c1-1 2.5-2 4-2" />
    </g>,
  ]
  const tint = tintOf(id, cleared)
  const glyph = Math.round(size * 0.5)

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 'var(--radius-full)',
        background: tone === 'onDark' ? 'rgba(255, 255, 255, 0.16)' : tint.wash,
        color: tone === 'onDark' ? '#FFFFFF' : tint.ink,
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {marks[hashId(id) % marks.length]}
      </svg>
    </span>
  )
}
