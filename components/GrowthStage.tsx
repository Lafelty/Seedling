'use client'

import { useId } from 'react'

/**
 * The whole road, not just where you are: all four growth stages sit on a
 * box's progress bar at once — seed, sprout, seedling, plant — so a patient
 * sees what they have passed and what is still ahead in one look.
 *
 * A box shows only as many stages as it has poses to reach them: one pose is
 * seed then sprout, two poses adds the seedling, three or more runs the whole
 * way to the plant. Whatever it shows is spread evenly across the bar, so the
 * mark at the right end always means "box finished" — a six-pose box just
 * reaches each stage every two poses instead of every one.
 *
 * Each mark is a little scene rather than a glyph — sky, a mound of soil, and
 * the plant growing out of it — because at this size a filled, coloured shape
 * survives where a thin outline turns to mush.
 */

export const GROWTH_STAGES = ['Seed', 'Sprout', 'Seedling', 'Plant'] as const

export type GrowthStageName = (typeof GROWTH_STAGES)[number]

const LAST = GROWTH_STAGES.length - 1

/**
 * How many steps a box has room for: a one-pose box can only get as far as the
 * sprout, so it draws two marks rather than four with three of them
 * unreachable. Capped at the four stages that exist.
 */
export function growthStepCount(total: number): number {
  return Math.max(1, Math.min(LAST, Math.floor(total)))
}

/**
 * The furthest stage reached. Integer maths on purpose: `cleared / total *
 * steps` lands just under a whole number for cases like 2 of 6 and would round
 * the patient back down a stage.
 */
export function growthStageIndex(clearedCount: number, total: number): number {
  if (!(total > 0) || !(clearedCount > 0)) return 0
  const steps = growthStepCount(total)
  return Math.max(0, Math.min(steps, Math.floor((Math.floor(clearedCount) * steps) / total)))
}

export function growthStageName(clearedCount: number, total: number): GrowthStageName {
  return GROWTH_STAGES[growthStageIndex(clearedCount, total)]
}

/** The widest a mark gets. Also the cell width, which sets the end insets. */
export const GROWTH_MARK_CELL = 34

// One mound of soil under all four, so the stages read as one thing growing in
// place. Everything is drawn in a 32×32 box that fills the whole disc, and the
// disc clips it — which is what lets the soil run right to the edges.
const SOIL_TOP = 'M0 24.6C5 23 10.4 22.8 16 23.6 21.4 24.4 27 24 32 22.8'
const SOIL = `${SOIL_TOP}L32 32 0 32Z`

/** Where the stems meet the ground — the point the leaves sway around. */
const ROOT = { transformBox: 'view-box', transformOrigin: '16px 24px' } as const

export default function GrowthStages({
  clearedCount,
  total,
  className,
}: {
  clearedCount: number
  total: number
  className?: string
}) {
  if (!(total > 0)) return null

  const last = growthStepCount(total)
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
        // as positioning each at its share of the track, without the maths.
        justifyContent: 'space-between',
        pointerEvents: 'none',
      }}
    >
      {GROWTH_STAGES.slice(0, last + 1).map((_, stage) => (
        <span key={stage} style={{ width: GROWTH_MARK_CELL, display: 'grid', placeItems: 'center' }}>
          <GrowthMark
            stage={stage}
            last={last}
            state={
              stage === reached
                ? 'current'
                : stage < reached
                ? 'past'
                : // The one immediately ahead is what clearing a pose buys, so
                  // it gets its own class to wake up on hover.
                stage === reached + 1
                ? 'next'
                : 'ahead'
            }
          />
        </span>
      ))}
    </span>
  )
}

function GrowthMark({
  stage,
  last,
  state,
}: {
  stage: number
  last: number
  state: 'past' | 'current' | 'next' | 'ahead'
}) {
  // Gradients live in the document, so two marks sharing an id would share a
  // fill. `useId` keeps each scene's own — stripped to letters and digits,
  // since React wraps the id in punctuation (`«r0»`) that `url(#…)` chokes on.
  const uid = `gs${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const ahead = state === 'ahead' || state === 'next'
  const current = state === 'current'
  // "Grown" is the end of this box's own road, not stage three: a one-pose box
  // finishes at the sprout.
  const grown = current && stage === last
  const size = current ? GROWTH_MARK_CELL : 28

  return (
    <span
      // The halo on the live mark breathes, so the eye lands on where the
      // patient actually is before it reads anything. These classes carry the
      // box-shadow and the drained look of a stage still ahead; only the
      // resting marks set a shadow inline.
      className={
        grown
          ? 'lvl-mark-done'
          : current
          ? 'lvl-mark-now'
          : state === 'next'
          ? 'lvl-mark-ahead lvl-mark-next'
          : ahead
          ? 'lvl-mark-ahead'
          : undefined
      }
      style={{
        width: size,
        height: size,
        display: 'block',
        borderRadius: 'var(--radius-full)',
        // The disc is the window the scene is cut to — the soil runs edge to
        // edge behind this border rather than floating inside it.
        overflow: 'hidden',
        background: 'var(--surface)',
        border: `2px solid ${ahead ? 'var(--border)' : 'var(--box-edge, rgba(74, 107, 90, 0.45))'}`,
        // What is still ahead keeps its shape but drains of colour — a preview,
        // not something the patient has to act on. The draining lives in
        // `.lvl-mark-ahead` rather than here, so hovering the card can undo it.
        boxShadow: current ? undefined : '0 1px 3px rgba(38, 48, 42, 0.12)',
        transition: 'width var(--dur-fast) var(--ease-out), height var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out)',
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 32 32" fill="none">
        <defs>
          {/* Leaves take the box's own green at the base and lift to a young,
              sunlit green at the tip. */}
          <linearGradient id={`${uid}-leaf`} x1="0" y1="1" x2="0.4" y2="0">
            <stop offset="0" stopColor="var(--box-bar, #4A6B5A)" />
            <stop offset="1" stopColor="#A9DC85" />
          </linearGradient>
          <linearGradient id={`${uid}-soil`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8A6A4E" />
            <stop offset="1" stopColor="#5E442F" />
          </linearGradient>
          <linearGradient id={`${uid}-seed`} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#F0D8AE" />
            <stop offset="1" stopColor="#C39A62" />
          </linearGradient>
          <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#BFE9C6" stopOpacity="0.55" />
            <stop offset="1" stopColor="#BFE9C6" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect width="32" height="32" fill={`url(#${uid}-sky)`} />

        {/* Drawn before the soil, so the buried half of each seed really is
            buried rather than sitting on top of the ground. */}
        {stage === 0 && <Seed uid={uid} x={16} y={22.6} rx={6} ry={4.6} rotate={-16} />}

        <path d={SOIL} fill={`url(#${uid}-soil)`} />
        <path d={SOIL_TOP} stroke="#A5825F" strokeWidth="1.5" strokeLinecap="round" fill="none" />

        {stage === 1 && <Sprout uid={uid} />}
        {stage === 2 && <Seedling uid={uid} sway={current} />}
        {stage === 3 && <Plant uid={uid} sway={current} />}
      </svg>
    </span>
  )
}

function Seed({
  uid,
  x,
  y,
  rx,
  ry,
  rotate,
}: {
  uid: string
  x: number
  y: number
  rx: number
  ry: number
  rotate: number
}) {
  return (
    <g transform={`rotate(${rotate} ${x} ${y})`}>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={`url(#${uid}-seed)`} />
      {/* The pale crease down a bean, and the shine off its shoulder. */}
      <path
        d={`M${x - rx * 0.55} ${y - ry * 0.15}q${rx * 0.55} ${ry * 0.75} ${rx * 1.1} 0`}
        stroke="#9C7443"
        strokeWidth="0.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />
      <ellipse cx={x - rx * 0.28} cy={y - ry * 0.42} rx={rx * 0.38} ry={ry * 0.26} fill="#FFF6E4" opacity="0.65" />
    </g>
  )
}

/** The bean lifted out of the ground on a hooked shoot, as a real one comes up. */
function Sprout({ uid }: { uid: string }) {
  return (
    <g>
      <path
        d="M13.8 25.2C13 20.4 14.6 17.4 17.6 16.2"
        stroke={`url(#${uid}-leaf)`}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <Seed uid={uid} x={20.4} y={15.2} rx={4.6} ry={3.6} rotate={24} />
    </g>
  )
}

/** First true pair of leaves on a short stem. */
function Seedling({ uid, sway }: { uid: string; sway: boolean }) {
  return (
    <g>
      <path d="M16 25.4V16" stroke={`url(#${uid}-leaf)`} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <g className={sway ? 'lvl-sway' : undefined} style={ROOT}>
        <Leaf uid={uid} x={16} y={17.2} length={8.4} width={3.5} angle={-28} />
        <Leaf uid={uid} x={16} y={17.2} length={8.4} width={3.5} angle={-152} />
      </g>
    </g>
  )
}

/** Full height, two pairs of leaves, and a tip still opening at the top. */
function Plant({ uid, sway }: { uid: string; sway: boolean }) {
  return (
    <g>
      <path
        d="M16 25.4C16 18 16 11 16 6.6"
        stroke={`url(#${uid}-leaf)`}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <g className={sway ? 'lvl-sway' : undefined} style={ROOT}>
        <Leaf uid={uid} x={16} y={19.6} length={8.2} width={3.4} angle={-24} />
        <Leaf uid={uid} x={16} y={19.6} length={8.2} width={3.4} angle={-156} />
        <Leaf uid={uid} x={16} y={13.4} length={9.4} width={3.9} angle={-32} />
        <Leaf uid={uid} x={16} y={13.4} length={9.4} width={3.9} angle={-148} />
        <Leaf uid={uid} x={16} y={7.6} length={5} width={2.2} angle={-90} />
      </g>
    </g>
  )
}

/**
 * A leaf growing out of the stem at (x, y): pointed at both the stem end and
 * the tip, `length` along `angle`, `width` to either side. A real silhouette
 * rather than an oval is most of what makes these read as leaves at 28px.
 */
function Leaf({
  uid,
  x,
  y,
  length,
  width,
  angle,
}: {
  uid: string
  x: number
  y: number
  length: number
  width: number
  angle: number
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <path
        d={`M0 0C${length * 0.28} ${-width} ${length * 0.72} ${-width} ${length} 0C${length * 0.72} ${width} ${length * 0.28} ${width} 0 0Z`}
        fill={`url(#${uid}-leaf)`}
      />
      {/* Midrib — the one bit of detail that survives the shrink. */}
      <path
        d={`M${length * 0.12} 0H${length * 0.8}`}
        stroke="#F2FBEA"
        strokeWidth="0.7"
        strokeLinecap="round"
        opacity="0.45"
      />
    </g>
  )
}
