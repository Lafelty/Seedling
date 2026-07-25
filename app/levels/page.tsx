'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { buildLevelMap, type CompletedSession, type GroupNode, type LevelExercise, type LevelGroup } from '@/lib/levels'

export const dynamic = 'force-dynamic'

function LevelsSkeleton() {
  return (
    // Mirrors the real layout, so nothing jumps when the boxes arrive.
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-8 pb-24">
      <div className="mb-8">
        <div className="skeleton" style={{ width: '180px', height: '32px', marginBottom: 'var(--space-2)' }} />
        <div className="skeleton" style={{ width: '280px', height: '16px', marginBottom: 'var(--space-4)' }} />
        <div className="skeleton" style={{ height: '6px', borderRadius: 'var(--radius-full)' }} />
      </div>
      {/* Inline, not `.lvl-grid`: that rule ships with the loaded page. */}
      <div style={{ display: 'grid', gap: 'var(--space-4)', gridAutoRows: '1fr', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: '208px', borderRadius: 'var(--radius-lg)' }} />
        ))}
      </div>
    </main>
  )
}

/**
 * How a box is doing — never where it sits in a queue. `buildLevelMap` only
 * ever marks a group `cleared` or `unlocked`: boxes are not gated behind each
 * other, and the page must not imply that they are.
 */
function statusOf(node: GroupNode) {
  const cleared = node.status === 'cleared'
  return {
    cleared,
    started: node.clearedCount > 0,
    label: cleared ? 'Complete' : node.clearedCount > 0 ? 'In progress' : 'Not started',
  }
}

/** Stable per-box index, so a box keeps the same mark and the same tint. */
function hashId(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return hash
}

/**
 * One light green per box. Four greens of the same lightness and weight — they
 * tell boxes apart without any of them reading as further along, higher, or
 * next. A cleared box leaves this family for gold instead.
 */
const BOX_TINTS = [
  { wash: 'rgba(124, 199, 134, 0.30)', edge: 'rgba(120, 187, 128, 0.55)', ink: '#2F6B45', bar: '#5FAF6B' }, // leaf
  { wash: 'rgba(150, 214, 184, 0.32)', edge: 'rgba(126, 194, 166, 0.55)', ink: '#2C6A5B', bar: '#54B296' }, // mint
  { wash: 'rgba(186, 222, 140, 0.34)', edge: 'rgba(163, 203, 120, 0.55)', ink: '#4E6B27', bar: '#8CC252' }, // spring
  { wash: 'rgba(146, 208, 205, 0.32)', edge: 'rgba(124, 187, 186, 0.55)', ink: '#2A6465', bar: '#57AFAF' }, // eucalyptus
]

const CLEARED_TINT = { wash: 'rgba(201, 184, 138, 0.28)', edge: 'rgba(201, 184, 138, 0.60)', ink: '#7A6A3E', bar: '#C9B88A' }

function tintOf(id: string, cleared: boolean) {
  return cleared ? CLEARED_TINT : BOX_TINTS[hashId(id) % BOX_TINTS.length]
}

/**
 * A growing thing per box, picked from the box's own id. Form carries most of
 * the identity; the box's own green carries the rest.
 */
function BoxMark({ id, cleared }: { id: string; cleared: boolean }) {
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
  const hash = hashId(id)
  const tint = tintOf(id, cleared)

  return (
    <span
      aria-hidden
      style={{
        width: 48,
        height: 48,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 'var(--radius-full)',
        background: tint.wash,
        color: tint.ink,
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {marks[hash % marks.length]}
      </svg>
    </span>
  )
}

export default function LevelsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [map, setMap] = useState<GroupNode[]>([])
  /** The box whose panel is open. The grid card morphs into it and back. */
  const [active, setActive] = useState<GroupNode | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // Where focus came from, so closing puts it back on the card the patient opened.
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    loadMap()
  }, [])

  // While a panel is open it owns the screen: escape closes it, the page behind
  // it stays put, and focus starts on the close button.
  useEffect(() => {
    if (!active) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActive(null)
    }
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setActive(null)
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      openerRef.current?.focus()
    }
  }, [active])

  async function loadMap() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const [groupsRes, exercisesRes, sessionsRes] = await Promise.all([
      supabase
        .from('exercise_groups')
        .select('id, name, description, sort_order')
        .eq('is_active', true),
      supabase
        .from('exercises')
        .select('id, name, difficulty, group_id, rank_in_group, unlock_min_score, unlock_max_seconds')
        .eq('is_active', true),
      supabase
        .from('therapy_sessions')
        .select('exercise_id, form_quality_score, duration_seconds')
        .eq('user_id', user.id)
        .not('completed_at', 'is', null),
    ])

    if (groupsRes.error || exercisesRes.error) {
      console.error('Error loading level map:', groupsRes.error || exercisesRes.error)
      setLoadError(true)
      setLoading(false)
      return
    }
    setLoadError(false)

    setMap(
      buildLevelMap(
        (groupsRes.data ?? []) as LevelGroup[],
        (exercisesRes.data ?? []) as LevelExercise[],
        (sessionsRes.data ?? []) as CompletedSession[]
      )
    )
    setLoading(false)
  }

  if (loading) {
    return <LevelsSkeleton />
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card text-center" style={{ maxWidth: '420px' }}>
          <p style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: 'var(--space-2)' }}>
            Couldn&apos;t load your path
          </p>
          <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
            Check your connection and try again.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => { setLoading(true); loadMap() }}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const visibleBoxes = map.filter((node) => node.total > 0)
  const clearedBoxes = visibleBoxes.filter((n) => n.status === 'cleared').length
  const overallPct = visibleBoxes.length > 0 ? Math.round((clearedBoxes / visibleBoxes.length) * 100) : 0

  return (
    // `reducedMotion="user"` makes every layout morph below honour the OS
    // setting: the panel then appears and leaves without travelling.
    <MotionConfig reducedMotion="user">
      <style>{`
        .lvl-card {
          transition: box-shadow var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
          outline: none;
        }
        @media (hover: hover) and (pointer: fine) {
          .lvl-card:hover { box-shadow: 0 12px 28px var(--box-edge, rgba(74, 107, 90, 0.16)); }
          .lvl-card:hover .lvl-cta svg { transform: translateX(3px); }
        }
        .lvl-card:focus-visible { box-shadow: 0 0 0 3px var(--box-edge, rgba(74, 107, 90, 0.45)); }
        .lvl-cta svg { transition: transform var(--dur-fast) var(--ease-out); }
        .lvl-pose + .lvl-pose { border-top: 1px solid var(--border); }

        /* Overall progress, carried by a rail instead of its own card. */
        .lvl-rail {
          margin-top: var(--space-4);
          height: 8px;
          border-radius: var(--radius-full);
          background: rgba(124, 199, 134, 0.22);
          overflow: hidden;
        }
        .lvl-rail-fill {
          display: block;
          height: 100%;
          border-radius: var(--radius-full);
          background: linear-gradient(90deg, #8CC252, #54B296 55%, var(--primary));
          transition: width var(--dur-grow) var(--ease-out);
        }

        /* Boxes sit side by side as equals — no queue, no numbering, nothing
           to suggest one has to come before another. Same size, too:
           \`grid-auto-rows: 1fr\` gives every row the tallest row's height, and
           the card fills it, so no box is bigger than any other. */
        .lvl-grid {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: var(--space-4);
          grid-template-columns: 1fr;
          grid-auto-rows: 1fr;
        }
        @media (min-width: 620px) {
          .lvl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        .lvl-grid > li { display: flex; min-width: 0; }

        /* Two lines of description on every card, reserved whether or not the
           box has one, so equal-height rows never have to stretch to cover a
           difference in text. */
        .lvl-clamp {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          min-height: calc(2 * 1.5 * var(--text-sm));
        }

        .lvl-chip {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
          font-size: var(--text-xs);
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: var(--space-1) var(--space-3);
          border-radius: var(--radius-full);
          background: var(--box-wash, rgba(74, 107, 90, 0.12));
          color: var(--box-ink, var(--primary));
        }
        /* An untouched box has nothing to announce — the chip stays a label in
           the box's own green, not a badge, so three "not started" cards don't
           shout at once. */
        .lvl-chip[data-started='false'] { background: transparent; padding-inline: 0; }

        .lvl-bar {
          display: block;
          height: 8px;
          border-radius: var(--radius-full);
          background: var(--box-wash, rgba(74, 107, 90, 0.12));
          overflow: hidden;
        }
        .lvl-bar > span {
          display: block;
          height: 100%;
          border-radius: var(--radius-full);
          background: var(--box-bar, var(--primary));
          transition: width var(--dur-grow) var(--ease-out);
        }

        @media (prefers-reduced-motion: reduce) {
          .lvl-card, .lvl-cta svg, .lvl-rail-fill, .lvl-bar > span { transition: none; }
        }
      `}</style>

      {/* The wash spans the viewport; the path itself stays a column, so the
          tint must not be pinned to the column's width. */}
      <div style={{ background: 'linear-gradient(180deg, rgba(140, 194, 82, 0.16), rgba(84, 178, 150, 0.10) 180px, transparent 380px)' }}>
      <main className="min-h-screen max-w-2xl mx-auto px-4 py-8 pb-24">
        {/* Header. Progress rides in the sentence and the rail rather than its
            own slab, and says nothing about which box to pick. */}
        <div className="mb-8 animate-fadeIn">
          <h1 style={{ color: 'var(--primary)' }}>Your boxes</h1>
          <p style={{ color: 'var(--muted)', marginTop: 'var(--space-1)' }}>
            {visibleBoxes.length === 0
              ? 'Work through each box of poses at your own pace'
              : overallPct === 100
              ? 'Every box complete — beautiful work.'
              : `Open any box you like. ${clearedBoxes} of ${visibleBoxes.length} finished so far.`}
          </p>

          {visibleBoxes.length > 0 && (
            <div className="lvl-rail" role="img" aria-label={`${overallPct}% of your path complete`}>
              <span className="lvl-rail-fill" style={{ width: `${overallPct}%` }} />
            </div>
          )}
        </div>

        {visibleBoxes.length === 0 ? (
          <div className="card text-center" style={{ padding: 'var(--space-12) var(--space-6)' }}>
            <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-4)' }}>
              No exercise boxes are set up yet. Your therapist is preparing your program.
            </p>
            <Link href="/session" className="pill-btn pill-btn-primary">
              Start a classic session
            </Link>
          </div>
        ) : (
          <ul className="lvl-grid">
            {visibleBoxes.map((node, index) => {
              const { cleared, started, label } = statusOf(node)
              const pct = node.total > 0 ? Math.round((node.clearedCount / node.total) * 100) : 0
              const cta = cleared ? 'Review' : started ? 'Continue' : 'Start'
              const isOpen = active?.group.id === node.group.id
              const tint = tintOf(node.group.id, cleared)

              return (
                <li key={node.group.id}>
                  <motion.div
                    layoutId={`box-${node.group.id}`}
                    className="lvl-card card animate-fadeIn"
                    data-cleared={cleared}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    aria-label={`${node.group.name}, ${node.clearedCount} of ${node.total} poses done, ${label.toLowerCase()}`}
                    onClick={(event) => {
                      openerRef.current = event.currentTarget
                      setActive(node)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      openerRef.current = event.currentTarget
                      setActive(node)
                    }}
                    style={{
                      animationDelay: `${index * 60}ms`,
                      // Same box, same size, every time: the row is already
                      // equal-height, and the card takes all of it.
                      height: '100%',
                      width: '100%',
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-3)',
                      // Each box gets its own green; a finished one warms to
                      // gold. Different colour, equal weight — none is "next".
                      ['--box-wash' as string]: tint.wash,
                      ['--box-edge' as string]: tint.edge,
                      ['--box-ink' as string]: tint.ink,
                      ['--box-bar' as string]: tint.bar,
                      background: `linear-gradient(160deg, ${tint.wash}, var(--surface) 72%)`,
                      borderColor: tint.edge,
                      cursor: 'pointer',
                      // The panel takes over the shared layout; leaving the card
                      // visible underneath would show it twice mid-morph.
                      visibility: isOpen ? 'hidden' : 'visible',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                      <motion.div layoutId={`box-mark-${node.group.id}`}>
                        <BoxMark id={node.group.id} cleared={cleared} />
                      </motion.div>

                      <motion.span
                        layoutId={`box-chip-${node.group.id}`}
                        className="lvl-chip"
                        data-cleared={cleared}
                        data-started={started}
                      >
                        {label}
                      </motion.span>
                    </div>

                    <motion.div layoutId={`box-title-${node.group.id}`} style={{ flex: 1, minWidth: 0 }}>
                      <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--ink)' }}>
                        {node.group.name}
                      </h2>
                      {/* Rendered even when empty: the reserved two lines keep
                          a box without a description the same size as one with. */}
                      <p className="lvl-clamp" style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', lineHeight: 1.5, marginTop: 'var(--space-1)' }}>
                        {node.group.description}
                      </p>
                    </motion.div>

                    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                      <span className="lvl-bar" role="img" aria-label={`${pct}% of this box done`}>
                        <span style={{ width: `${pct}%` }} />
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', fontWeight: 600 }}>
                          {node.clearedCount} of {node.total} poses
                        </span>
                        <span
                          className="lvl-cta"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 'var(--space-1)',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 700,
                            color: tint.ink,
                          }}
                        >
                          {cta}
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14" />
                            <path d="M13 6l6 6-6 6" />
                          </svg>
                        </span>
                      </div>
                    </div>
                  </motion.div>
                </li>
              )
            })}
          </ul>
        )}
      </main>
      </div>

      <AnimatePresence>
        {active && (
          <ExpandedBox
            key={active.group.id}
            node={active}
            panelRef={panelRef}
            closeRef={closeRef}
            onClose={() => setActive(null)}
          />
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <Link href="/" className="nav-item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z" />
            <path d="M12 19v3" />
          </svg>
          <span>Garden</span>
        </Link>
        <Link href="/progress" className="nav-item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3v18h18" />
            <path d="M7 16l4-8 4 4 4-12" />
          </svg>
          <span>Progress</span>
        </Link>
        <Link href="/profile" className="nav-item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span>Profile</span>
        </Link>
      </nav>
    </MotionConfig>
  )
}

/**
 * The opened box. It carries the same `layoutId`s as its card, so the card
 * grows into this panel rather than a separate dialog appearing over it, and
 * shows what the card has no room for: the poses inside the box.
 */
function ExpandedBox({
  node,
  panelRef,
  closeRef,
  onClose,
}: {
  node: GroupNode
  panelRef: React.RefObject<HTMLDivElement | null>
  closeRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const { cleared, started, label } = statusOf(node)
  const pct = node.total > 0 ? Math.round((node.clearedCount / node.total) * 100) : 0
  const cta = cleared ? 'Review box' : started ? 'Continue box' : 'Start box'
  const tint = tintOf(node.group.id, cleared)

  return (
    <>
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={{ position: 'fixed', inset: 0, background: 'rgba(38, 48, 42, 0.38)', zIndex: 1000 }}
      />

      <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', padding: 'var(--space-4)', zIndex: 1001 }}>
        <motion.div
          ref={panelRef}
          layoutId={`box-${node.group.id}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`box-heading-${node.group.id}`}
          className="card"
          style={{
            width: 'min(560px, 100%)',
            maxHeight: '85vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
            // The box keeps its own green when it opens.
            ['--box-wash' as string]: tint.wash,
            ['--box-edge' as string]: tint.edge,
            ['--box-ink' as string]: tint.ink,
            ['--box-bar' as string]: tint.bar,
            // Opaque base under the tint: the card's gradient alone is partly
            // transparent, which is invisible on the page but not over it.
            backgroundColor: 'var(--surface)',
            backgroundImage: `linear-gradient(160deg, ${tint.wash}, transparent 72%)`,
            borderColor: tint.edge,
            boxShadow: '0 24px 60px rgba(38, 48, 42, 0.22)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <motion.div layoutId={`box-mark-${node.group.id}`}>
              <BoxMark id={node.group.id} cleared={cleared} />
            </motion.div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <motion.span layoutId={`box-chip-${node.group.id}`} className="lvl-chip" data-cleared={cleared} data-started={started}>
                {label}
              </motion.span>
              <button
                ref={closeRef}
                onClick={onClose}
                aria-label="Close box"
                className="pill-btn"
                // 48px: patients may have limited mobility, so nothing here is
                // allowed to be a small target.
                style={{ width: 48, height: 48, padding: 0, borderRadius: 'var(--radius-full)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>

          <motion.div layoutId={`box-title-${node.group.id}`}>
            <h2 id={`box-heading-${node.group.id}`} style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--ink)' }}>
              {node.group.name}
            </h2>
            {node.group.description && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', lineHeight: 1.5 }}>{node.group.description}</p>
            )}
          </motion.div>

          {/* The poses themselves — what the card never had room to show. */}
          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, delay: 0.1 }}
            style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--border)' }}
          >
            {node.exercises.map((item) => {
              const poseCleared = item.status === 'cleared'
              const poseLocked = item.status === 'locked'
              return (
                <li
                  key={item.exercise.id}
                  className="lvl-pose"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3) 0',
                    opacity: poseLocked ? 0.55 : 1,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 18,
                        height: 18,
                        flexShrink: 0,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: 'var(--radius-full)',
                        background: poseCleared ? tint.bar : poseLocked ? 'var(--border)' : tint.wash,
                        color: tint.ink,
                      }}
                    >
                      {poseCleared && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12l5 5L19 7" />
                        </svg>
                      )}
                    </span>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.exercise.name}
                    </span>
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', fontWeight: 600, flexShrink: 0 }}>
                    {poseLocked
                      ? 'Locked'
                      : item.bestScore != null
                      ? `Best ${item.bestScore}%`
                      : 'Not tried yet'}
                  </span>
                </li>
              )
            })}
          </motion.ul>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', fontWeight: 600 }}>
              {node.clearedCount} of {node.total} poses · {pct}%
            </span>
            <Link href={`/levels/${node.group.id}`} className="pill-btn pill-btn-primary" style={{ textDecoration: 'none' }}>
              {cta}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
        </motion.div>
      </div>
    </>
  )
}
