'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { buildLevelMap, type CompletedSession, type GroupNode, type LevelExercise, type LevelGroup } from '@/lib/levels'

export const dynamic = 'force-dynamic'

/** Circular progress ring with a glyph or number in the middle. */
function RingBadge({
  pct,
  cleared,
  locked,
  children,
  size = 52,
}: {
  pct: number
  cleared: boolean
  locked: boolean
  children: React.ReactNode
  size?: number
}) {
  const stroke = 4
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c - (pct / 100) * c
  const track = locked ? 'var(--border)' : 'rgba(74, 107, 90, 0.16)'
  const fill = cleared ? '#C9B88A' : 'var(--primary)'
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {!locked && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={fill}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={off}
            className="lvl-ring"
          />
        )}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: locked ? 'var(--muted)' : cleared ? '#8A7A4E' : 'var(--primary)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function LevelsSkeleton() {
  return (
    <main className="min-h-screen max-w-4xl mx-auto px-4 py-8 pb-24">
      <div className="mb-8">
        <div className="skeleton" style={{ width: '160px', height: '32px', marginBottom: 'var(--space-2)' }} />
        <div className="skeleton" style={{ width: '280px', height: '16px', marginBottom: 'var(--space-4)' }} />
        <div className="skeleton" style={{ height: '92px', borderRadius: 'var(--radius-lg)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 320px))', gap: 'var(--space-5)', justifyContent: 'center' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: '200px', borderRadius: 'var(--radius-lg)' }} />
        ))}
      </div>
    </main>
  )
}

/** Status wording is the same in the grid and in the expanded panel. */
function statusOf(node: GroupNode, isCurrent: boolean) {
  const locked = node.status === 'locked'
  const cleared = node.status === 'cleared'
  return {
    locked,
    cleared,
    label: locked ? 'Locked' : cleared ? 'Complete' : isCurrent ? 'Current' : 'Open',
  }
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
  // The first box that isn't finished is where the patient is "up to".
  const currentId = visibleBoxes.find((n) => n.status !== 'cleared')?.group.id ?? null

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
          .lvl-card:hover { box-shadow: 0 12px 28px rgba(74, 107, 90, 0.16); }
          .lvl-card:hover .lvl-cta svg { transform: translateX(3px); }
        }
        .lvl-card:focus-visible { box-shadow: 0 0 0 3px rgba(74, 107, 90, 0.45); }
        .lvl-cta svg { transition: transform var(--dur-fast) var(--ease-out); }
        .lvl-pose + .lvl-pose { border-top: 1px solid var(--border); }
        @media (prefers-reduced-motion: reduce) {
          .lvl-card, .lvl-cta svg { transition: none; }
        }
      `}</style>

      <main
        className="min-h-screen max-w-4xl mx-auto px-4 py-8 pb-24"
        style={{ background: 'linear-gradient(180deg, rgba(74, 107, 90, 0.08), transparent 340px)' }}
      >
        {/* Header */}
        <div className="mb-8 animate-fadeIn">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l9-8 9 8" />
              <path d="M5 9v11h5v-6h4v6h5V9" />
            </svg>
            <h1 style={{ color: 'var(--primary)' }}>Your path</h1>
          </div>
          <p style={{ color: 'var(--muted)' }}>
            Work through each box of poses at your own pace
          </p>

          {/* Overall progress */}
          {visibleBoxes.length > 0 && (
            <div
              className="card"
              style={{
                marginTop: 'var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                background: 'linear-gradient(160deg, rgba(74, 107, 90, 0.10), var(--surface) 70%)',
                borderColor: 'rgba(74, 107, 90, 0.22)',
              }}
            >
              <RingBadge pct={overallPct} cleared={overallPct === 100} locked={false} size={56}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{overallPct}%</span>
              </RingBadge>
              <div>
                <p style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 'var(--text-base)' }}>
                  {clearedBoxes} of {visibleBoxes.length} boxes complete
                </p>
                <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
                  {overallPct === 100 ? 'Every box cleared — beautiful work.' : 'Keep going, one pose at a time.'}
                </p>
              </div>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 320px))', gap: 'var(--space-5)', justifyContent: 'center' }}>
            {visibleBoxes.map((node, index) => {
              const locked = node.status === 'locked'
              const cleared = node.status === 'cleared'
              const isCurrent = node.group.id === currentId
              const pct = node.total > 0 ? Math.round((node.clearedCount / node.total) * 100) : 0
              const cta = cleared ? 'Review' : node.clearedCount > 0 ? 'Continue' : 'Start'
              const statusLabel = locked ? 'Locked' : cleared ? 'Complete' : isCurrent ? 'Current' : 'Open'

              const isOpen = active?.group.id === node.group.id

              return (
                <motion.div
                  key={node.group.id}
                  layoutId={`box-${node.group.id}`}
                  className="lvl-card card animate-fadeIn"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  aria-label={`${node.group.name}, box ${index + 1}, ${pct}% complete, ${statusLabel.toLowerCase()}`}
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
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-4)',
                    background: cleared
                      ? 'linear-gradient(160deg, rgba(201, 184, 138, 0.22), var(--surface) 72%)'
                      : locked
                      ? 'var(--surface)'
                      : 'linear-gradient(160deg, rgba(74, 107, 90, 0.13), var(--surface) 72%)',
                    borderColor: cleared
                      ? 'rgba(201, 184, 138, 0.55)'
                      : isCurrent
                      ? 'var(--primary)'
                      : locked
                      ? 'var(--border)'
                      : 'rgba(74, 107, 90, 0.30)',
                    borderWidth: isCurrent ? '2px' : '1px',
                    opacity: locked ? 0.6 : 1,
                    filter: locked ? 'grayscale(0.4)' : 'none',
                    cursor: 'pointer',
                    // The panel takes over the shared layout; leaving the card
                    // visible underneath would show it twice mid-morph.
                    visibility: isOpen ? 'hidden' : 'visible',
                  }}
                >
                  {/* Top: ring + status chip */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                    <motion.div layoutId={`box-ring-${node.group.id}`}>
                      <RingBadge pct={pct} cleared={cleared} locked={locked}>
                        {cleared ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12l5 5L19 7" />
                          </svg>
                        ) : locked ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="5" y="11" width="14" height="9" rx="2" />
                            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                          </svg>
                        ) : (
                          <span style={{ fontSize: 'var(--text-base)', fontWeight: 800 }}>{index + 1}</span>
                        )}
                      </RingBadge>
                    </motion.div>

                    <motion.span
                      layoutId={`box-chip-${node.group.id}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 'var(--space-1)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        padding: 'var(--space-1) var(--space-3)',
                        borderRadius: 'var(--radius-full)',
                        background: cleared
                          ? 'rgba(201, 184, 138, 0.28)'
                          : isCurrent
                          ? 'rgba(74, 107, 90, 0.16)'
                          : 'rgba(0,0,0,0.04)',
                        color: cleared ? '#8A7A4E' : isCurrent ? 'var(--primary)' : 'var(--muted)',
                      }}
                    >
                      {statusLabel}
                    </motion.span>
                  </div>

                  {/* Title + description */}
                  <motion.div layoutId={`box-title-${node.group.id}`} style={{ flex: 1 }}>
                    <span
                      style={{
                        fontSize: 'var(--text-xs)',
                        fontWeight: 700,
                        color: 'var(--muted)',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Box {index + 1}
                    </span>
                    <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--ink)', margin: 'var(--space-1) 0' }}>
                      {node.group.name}
                    </h2>
                    {node.group.description && (
                      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', lineHeight: 1.5 }}>{node.group.description}</p>
                    )}
                  </motion.div>

                  {/* Footer: pose count + CTA */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', fontWeight: 600 }}>
                      {node.clearedCount}/{node.total} poses
                    </span>
                    {locked ? (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>Clear the previous box</span>
                    ) : (
                      <span
                        className="lvl-cta"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 'var(--space-1)',
                          fontSize: 'var(--text-sm)',
                          fontWeight: 700,
                          color: cleared ? '#8A7A4E' : 'var(--primary)',
                        }}
                      >
                        {cta}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14" />
                          <path d="M13 6l6 6-6 6" />
                        </svg>
                      </span>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </main>

      <AnimatePresence>
        {active && (
          <ExpandedBox
            key={active.group.id}
            node={active}
            index={visibleBoxes.findIndex((n) => n.group.id === active.group.id)}
            isCurrent={active.group.id === currentId}
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
  index,
  isCurrent,
  panelRef,
  closeRef,
  onClose,
}: {
  node: GroupNode
  index: number
  isCurrent: boolean
  panelRef: React.RefObject<HTMLDivElement | null>
  closeRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const { locked, cleared, label } = statusOf(node, isCurrent)
  const pct = node.total > 0 ? Math.round((node.clearedCount / node.total) * 100) : 0
  const cta = cleared ? 'Review box' : node.clearedCount > 0 ? 'Continue box' : 'Start box'

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
            // Opaque base under the tint: the card's gradient alone is partly
            // transparent, which is invisible on the page but not over it.
            backgroundColor: 'var(--surface)',
            backgroundImage: cleared
              ? 'linear-gradient(160deg, rgba(201, 184, 138, 0.22), transparent 72%)'
              : locked
              ? 'none'
              : 'linear-gradient(160deg, rgba(74, 107, 90, 0.13), transparent 72%)',
            borderColor: cleared ? 'rgba(201, 184, 138, 0.55)' : isCurrent ? 'var(--primary)' : 'var(--border)',
            boxShadow: '0 24px 60px rgba(38, 48, 42, 0.22)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <motion.div layoutId={`box-ring-${node.group.id}`}>
              <RingBadge pct={pct} cleared={cleared} locked={locked}>
                {cleared ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5L19 7" />
                  </svg>
                ) : locked ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="11" width="14" height="9" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                ) : (
                  <span style={{ fontSize: 'var(--text-base)', fontWeight: 800 }}>{index + 1}</span>
                )}
              </RingBadge>
            </motion.div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <motion.span
                layoutId={`box-chip-${node.group.id}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-full)',
                  background: cleared ? 'rgba(201, 184, 138, 0.28)' : isCurrent ? 'rgba(74, 107, 90, 0.16)' : 'rgba(0,0,0,0.04)',
                  color: cleared ? '#8A7A4E' : isCurrent ? 'var(--primary)' : 'var(--muted)',
                }}
              >
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
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Box {index + 1}
            </span>
            <h2 id={`box-heading-${node.group.id}`} style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--ink)', margin: 'var(--space-1) 0' }}>
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
                        background: poseCleared ? 'rgba(201, 184, 138, 0.45)' : poseLocked ? 'var(--border)' : 'rgba(74, 107, 90, 0.18)',
                        color: poseCleared ? '#8A7A4E' : 'var(--primary)',
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
              {node.clearedCount}/{node.total} poses
            </span>
            {locked ? (
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>Clear the previous box to open this one</span>
            ) : (
              <Link href={`/levels/${node.group.id}`} className="pill-btn pill-btn-primary" style={{ textDecoration: 'none' }}>
                {cta}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="M13 6l6 6-6 6" />
                </svg>
              </Link>
            )}
          </div>
        </motion.div>
      </div>
    </>
  )
}
