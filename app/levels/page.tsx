'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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

export default function LevelsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [map, setMap] = useState<GroupNode[]>([])

  useEffect(() => {
    loadMap()
  }, [])

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
      // Groups table missing until levels_migration.sql runs — fall back to
      // the classic single-exercise session so patients are never blocked.
      console.error(
        'Error loading level map (run supabase/levels_migration.sql?):',
        groupsRes.error || exercisesRes.error
      )
      router.push('/session')
      return
    }

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
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p style={{ color: 'var(--muted)' }}>Loading your path...</p>
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
    <>
      <style>{`
        .lvl-card {
          transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
          outline: none;
        }
        .lvl-link:hover .lvl-card { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(74, 107, 90, 0.16); }
        .lvl-link:focus-visible .lvl-card { box-shadow: 0 0 0 3px rgba(74, 107, 90, 0.45); }
        .lvl-link:active .lvl-card { transform: translateY(-1px); }
        .lvl-cta svg { transition: transform var(--dur-fast) var(--ease-out); }
        .lvl-link:hover .lvl-cta svg { transform: translateX(3px); }
        @media (prefers-reduced-motion: reduce) {
          .lvl-card, .lvl-cta svg { transition: none; }
          .lvl-link:hover .lvl-card { transform: none; }
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

              const card = (
                <div
                  className="lvl-card card animate-scaleIn"
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
                    cursor: locked ? 'default' : 'pointer',
                  }}
                >
                  {/* Top: ring + status chip */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
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

                    <span
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
                    </span>
                  </div>

                  {/* Title + description */}
                  <div style={{ flex: 1 }}>
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
                  </div>

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
                </div>
              )

              return locked ? (
                <div key={node.group.id} aria-label={`${node.group.name} — locked`}>{card}</div>
              ) : (
                <Link
                  key={node.group.id}
                  href={`/levels/${node.group.id}`}
                  className="lvl-link"
                  aria-label={`${node.group.name}, box ${index + 1}, ${pct}% complete, ${statusLabel.toLowerCase()}`}
                  style={{ textDecoration: 'none', borderRadius: 'var(--radius-lg)' }}
                >
                  {card}
                </Link>
              )
            })}
          </div>
        )}
      </main>

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
      </nav>
    </>
  )
}
