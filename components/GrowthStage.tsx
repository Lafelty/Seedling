'use client'

/**
 * How grown a box is, as a seed becoming a plant — the same four steps a real
 * bean takes. It rides the middle of a box's progress bar so a patient reads
 * "how far along am I" from a picture before they read the numbers.
 *
 * The stage is the count of cleared poses, not a share of the box: one pose
 * done is always a sprout, whether the box holds three poses or six.
 */

export const GROWTH_STAGES = ['Seed', 'Sprout', 'Seedling', 'Plant'] as const

export type GrowthStageName = (typeof GROWTH_STAGES)[number]

/** 0 → seed, 1 → sprout, 2 → seedling, 3 or more → plant. */
export function growthStageIndex(clearedCount: number): number {
  if (!Number.isFinite(clearedCount)) return 0
  return Math.max(0, Math.min(GROWTH_STAGES.length - 1, Math.floor(clearedCount)))
}

export function growthStageName(clearedCount: number): GrowthStageName {
  return GROWTH_STAGES[growthStageIndex(clearedCount)]
}

// All four share one ground line at y=20.5, so they read as one thing growing
// in place rather than four unrelated glyphs swapping around. Height off that
// line is what separates the stages — at 20px the silhouette is all a patient
// can really see, so each step has to be visibly taller than the last.
const STAGE_ART = [
  // Seed — a bean lying on the soil, nothing growing yet.
  <g key="seed">
    <path d="M5 20.5h14" />
    <ellipse cx="12" cy="15.8" rx="4.6" ry="3.6" transform="rotate(-20 12 15.8)" />
  </g>,
  // Sprout — the bean splits and a shoot hooks up out of it.
  <g key="sprout">
    <path d="M5 20.5h14" />
    <ellipse cx="9.6" cy="16.4" rx="3.8" ry="3" transform="rotate(-20 9.6 16.4)" />
    <path d="M12.8 14.8c2.6-.9 4-2.8 4-5.6" />
  </g>,
  // Seedling — a short stem with its first pair of leaves.
  <g key="seedling">
    <path d="M5 20.5h14" />
    <path d="M12 20.5v-5" />
    <path d="M12 15.6c-2.9 0-4.4-1.5-4.4-4.4 2.9 0 4.4 1.5 4.4 4.4Z" />
    <path d="M12 14.4c2.9 0 4.4-1.5 4.4-4.4-2.9 0-4.4 1.5-4.4 4.4Z" />
  </g>,
  // Plant — full height, broader leaves, and a third leaf low on the stem.
  <g key="plant">
    <path d="M5 20.5h14" />
    <path d="M12 20.5V4.2" />
    <path d="M12 11.4c-3.8 0-5.8-2-5.8-5.8 3.8 0 5.8 2 5.8 5.8Z" />
    <path d="M12 9.4c3.8 0 5.8-2 5.8-5.8-3.8 0-5.8 2-5.8 5.8Z" />
    <path d="M12 16.8c-2.6 0-4-1.4-4-4 2.6 0 4 1.4 4 4Z" />
  </g>,
]

export default function GrowthStage({
  clearedCount,
  size = 30,
  className,
}: {
  clearedCount: number
  size?: number
  className?: string
}) {
  const stage = growthStageIndex(clearedCount)
  const glyph = Math.round(size * 0.67)
  const full = stage === GROWTH_STAGES.length - 1

  return (
    // Decorative: the bar it sits on already carries the stage in its label.
    <span
      aria-hidden
      className={className}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 'var(--radius-full)',
        // Opaque, so the bar's fill running underneath never muddies the
        // drawing — and ringed in the box's own green so it reads as part of
        // the bar rather than something dropped on top of it.
        background: 'var(--surface)',
        border: `2px solid var(--box-edge, rgba(74, 107, 90, 0.45))`,
        // A fully grown box earns the solid colour; the earlier stages stay
        // quiet outlines so an untouched card doesn't shout.
        color: full ? 'var(--box-bar, var(--primary))' : 'var(--box-ink, var(--primary))',
        boxShadow: '0 1px 3px rgba(38, 48, 42, 0.14)',
      }}
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={full ? 2.2 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {STAGE_ART[stage]}
      </svg>
    </span>
  )
}
