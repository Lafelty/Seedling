'use client'

/**
 * The whole road, not just where you are: all four growth stages sit on a
 * box's progress bar at once — seed, sprout, seedling, plant — so a patient
 * sees what they have passed and what is still ahead in one look.
 *
 * The stages are spread evenly across the bar whatever the box holds, so the
 * plant always means "box finished". A three-pose box reaches a stage per
 * pose; a six-pose box reaches one every two poses.
 */

export const GROWTH_STAGES = ['Seed', 'Sprout', 'Seedling', 'Plant'] as const

export type GrowthStageName = (typeof GROWTH_STAGES)[number]

const LAST = GROWTH_STAGES.length - 1

/**
 * The furthest stage reached. Integer maths on purpose: `cleared / total * 3`
 * lands just under a whole number for cases like 2 of 6 and would round the
 * patient back down a stage.
 */
export function growthStageIndex(clearedCount: number, total: number): number {
  if (!(total > 0) || !(clearedCount > 0)) return 0
  return Math.max(0, Math.min(LAST, Math.floor((Math.floor(clearedCount) * LAST) / total)))
}

export function growthStageName(clearedCount: number, total: number): GrowthStageName {
  return GROWTH_STAGES[growthStageIndex(clearedCount, total)]
}

// All four share one ground line at y=20.5, so they read as one thing growing
// in place rather than four unrelated glyphs swapping around. Height off that
// line is what separates the stages — at this size the silhouette is all a
// patient can really see, so each step has to be visibly taller than the last.
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

/** The widest a mark gets. Also the cell width, which sets the end insets. */
export const GROWTH_MARK_CELL = 30

function GrowthMark({ stage, state }: { stage: number; state: 'past' | 'current' | 'ahead' }) {
  const ahead = state === 'ahead'
  const current = state === 'current'
  // The finished box is the one moment a mark fills in solid — every earlier
  // stage stays an outline so an untouched card never shouts.
  const crowned = current && stage === LAST
  const size = current ? GROWTH_MARK_CELL : 26
  const glyph = Math.round(size * 0.67)

  return (
    <span
      style={{
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 'var(--radius-full)',
        // Opaque, so the bar's fill running underneath never muddies the
        // drawing.
        background: crowned ? 'var(--box-bar, var(--primary))' : 'var(--surface)',
        border: `2px solid ${
          ahead ? 'var(--border)' : crowned ? 'var(--box-bar, var(--primary))' : 'var(--box-edge, rgba(74, 107, 90, 0.45))'
        }`,
        color: crowned ? 'var(--surface)' : ahead ? 'var(--muted)' : 'var(--box-ink, var(--primary))',
        // What is still ahead stays legible but recedes — it is a preview, not
        // a thing the patient has to act on.
        opacity: ahead ? 0.42 : 1,
        // The stage they are on now carries a halo, so it reads first.
        boxShadow: current
          ? '0 0 0 3px var(--box-wash, rgba(74, 107, 90, 0.12)), 0 1px 3px rgba(38, 48, 42, 0.14)'
          : '0 1px 3px rgba(38, 48, 42, 0.12)',
        transition: 'width var(--dur-fast) var(--ease-out), height var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out)',
      }}
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={crowned ? 2.2 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {STAGE_ART[stage]}
      </svg>
    </span>
  )
}

/**
 * The four marks, laid over a progress bar. The parent must be
 * `position: relative` and inset by half a cell on each side (see
 * `GROWTH_MARK_CELL`) so the first and last mark sit fully inside the card.
 */
export default function GrowthStages({
  clearedCount,
  total,
  className,
}: {
  clearedCount: number
  total: number
  className?: string
}) {
  const reached = growthStageIndex(clearedCount, total)

  return (
    // Decorative: the bar underneath already carries the stage in its label.
    <span
      aria-hidden
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        // Equal-width cells plus `space-between` puts the outer two marks half
        // a cell in from each end and spaces the rest evenly — the same result
        // as positioning each at 0/33/67/100% of the track, without the maths.
        justifyContent: 'space-between',
        pointerEvents: 'none',
      }}
    >
      {GROWTH_STAGES.map((_, stage) => (
        <span key={stage} style={{ width: GROWTH_MARK_CELL, display: 'grid', placeItems: 'center' }}>
          <GrowthMark stage={stage} state={stage === reached ? 'current' : stage < reached ? 'past' : 'ahead'} />
        </span>
      ))}
    </span>
  )
}
