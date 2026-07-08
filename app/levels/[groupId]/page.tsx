'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { buildLevelMap, type CompletedSession, type GroupNode, type LevelExercise, type LevelGroup } from '@/lib/levels'

export const dynamic = 'force-dynamic'

const DIFFICULTY_STYLES: Record<string, { bg: string; fg: string }> = {
  beginner: { bg: '#E8F5E9', fg: '#2E7D32' },
  intermediate: { bg: '#FFF3E0', fg: '#EF6C00' },
  advanced: { bg: '#FFEBEE', fg: '#C62828' },
}

/** Circular progress ring with a glyph or number in the middle. */
function RingBadge({ pct, cleared, size = 56 }: { pct: number; cleared: boolean; size?: number }) {
  const stroke = 4
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c - (pct / 100) * c
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(74, 107, 90, 0.16)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={cleared ? '#C9B88A' : 'var(--primary)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--text-sm)',
          fontWeight: 700,
          color: cleared ? '#8A7A4E' : 'var(--primary)',
        }}
      >
        {pct}%
      </div>
    </div>
  )
}

export default function LevelGroupPage() {
  const router = useRouter()
  const params = useParams<{ groupId: string }>()
  const [loading, setLoading] = useState(true)
  const [node, setNode] = useState<GroupNode | null>(null)

  useEffect(() => {
    loadGroup()
  }, [])

  async function loadGroup() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    // Build the whole map so box lock state stays consistent with /levels —
    // deep-linking a locked box bounces back to the map.
    const [groupsRes, exercisesRes, sessionsRes] = await Promise.all([
      supabase
        .from('exercise_groups')
        .select('id, name, description, sort_order')
        .eq('is_active', true),
      supabase
        .from('exercises')
        .select('id, name, description, difficulty, group_id, rank_in_group, unlock_min_score, unlock_max_seconds')
        .eq('is_active', true),
      supabase
        .from('therapy_sessions')
        .select('exercise_id, form_quality_score, duration_seconds')
        .eq('user_id', user.id)
        .not('completed_at', 'is', null),
    ])

    if (groupsRes.error || exercisesRes.error) {
      console.error(
        'Error loading box (run supabase/levels_migration.sql?):',
        groupsRes.error || exercisesRes.error
      )
      router.push('/levels')
      return
    }

    const map = buildLevelMap(
      (groupsRes.data ?? []) as LevelGroup[],
      (exercisesRes.data ?? []) as LevelExercise[],
      (sessionsRes.data ?? []) as CompletedSession[]
    )

    const found = map.find((n) => n.group.id === params.groupId)
    if (!found || found.status === 'locked') {
      router.replace('/levels')
      return
    }

    setNode(found)
    setLoading(false)
  }

  if (loading || !node) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p style={{ color: 'var(--muted)' }}>Loading poses...</p>
        </div>
      </div>
    )
  }

  const pct = node.total > 0 ? Math.round((node.clearedCount / node.total) * 100) : 0
  const boxCleared = node.status === 'cleared'
  // The pose the patient is "up to" — first one that's open but not yet cleared.
  const currentId = node.exercises.find((e) => e.status === 'unlocked')?.exercise.id ?? null
  const nextUp = node.exercises.find((e) => e.exercise.id === currentId)?.exercise ?? null

  return (
    <main
      className="min-h-screen max-w-2xl mx-auto px-4 py-8 pb-16"
      style={{ background: 'linear-gradient(180deg, rgba(74, 107, 90, 0.08), transparent 340px)' }}
    >
      <style>{`
        .pose-start { transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out); }
        .pose-start:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(74, 107, 90, 0.22); }
        .pose-start:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(74, 107, 90, 0.45); }
        .pose-card { transition: border-color var(--dur-fast) var(--ease-out); }
        @media (prefers-reduced-motion: reduce) {
          .pose-start { transition: none; }
          .pose-start:hover { transform: none; }
        }
      `}</style>

      {/* Header */}
      <div className="mb-6 animate-fadeIn">
        <Link
          href="/levels"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--primary)',
            textDecoration: 'none',
            marginBottom: 'var(--space-4)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          All boxes
        </Link>

        {/* Hero card */}
        <div
          className="card animate-scaleIn"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
            background: boxCleared
              ? 'linear-gradient(160deg, rgba(201, 184, 138, 0.22), var(--surface) 72%)'
              : 'linear-gradient(160deg, rgba(74, 107, 90, 0.12), var(--surface) 72%)',
            borderColor: boxCleared ? 'rgba(201, 184, 138, 0.55)' : 'rgba(74, 107, 90, 0.28)',
          }}
        >
          <RingBadge pct={pct} cleared={boxCleared} size={64} />
          <div style={{ flex: 1 }}>
            <h1 style={{ color: 'var(--primary)', fontSize: 'var(--text-2xl)', marginBottom: '2px' }}>{node.group.name}</h1>
            {node.group.description && (
              <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>{node.group.description}</p>
            )}
            <p style={{ color: 'var(--ink)', fontSize: 'var(--text-sm)', fontWeight: 600, marginTop: 'var(--space-1)' }}>
              {boxCleared
                ? 'Box complete — every pose cleared.'
                : nextUp
                ? `Next up: ${nextUp.name}`
                : `${node.clearedCount}/${node.total} poses cleared`}
            </p>
          </div>
        </div>
      </div>

      {/* Pose path */}
      <div style={{ position: 'relative', paddingLeft: '34px' }}>
        {/* Trail line */}
        <div
          style={{
            position: 'absolute',
            left: '15px',
            top: '28px',
            bottom: '28px',
            width: '3px',
            borderRadius: 'var(--radius-full)',
            background: 'linear-gradient(180deg, var(--primary), rgba(74, 107, 90, 0.12))',
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {node.exercises.map((exNode, index) => {
            const { exercise, status, bestScore } = exNode
            const locked = status === 'locked'
            const cleared = status === 'cleared'
            const isCurrent = exercise.id === currentId
            const diffStyle = DIFFICULTY_STYLES[exercise.difficulty] ?? DIFFICULTY_STYLES.beginner
            const prev = index > 0 ? node.exercises[index - 1].exercise : null

            return (
              <div key={exercise.id} style={{ position: 'relative' }} className="animate-fadeInUp">
                {/* Trail node */}
                <div
                  style={{
                    position: 'absolute',
                    left: '-34px',
                    top: '18px',
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: cleared ? '#C9B88A' : locked ? 'var(--border)' : 'var(--surface)',
                    border: locked ? 'none' : `2px solid ${cleared ? '#C9B88A' : 'var(--primary)'}`,
                    boxShadow: isCurrent ? '0 0 0 4px rgba(74, 107, 90, 0.18)' : 'none',
                    color: cleared ? 'white' : locked ? 'var(--muted)' : 'var(--primary)',
                    zIndex: 1,
                  }}
                >
                  {cleared ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5L19 7" />
                    </svg>
                  ) : locked ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                  ) : (
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 800 }}>{index + 1}</span>
                  )}
                </div>

                <div
                  className="pose-card card"
                  style={{
                    marginLeft: 'var(--space-3)',
                    background: cleared
                      ? 'linear-gradient(160deg, rgba(201, 184, 138, 0.18), var(--surface) 72%)'
                      : locked
                      ? 'var(--surface)'
                      : 'linear-gradient(160deg, rgba(74, 107, 90, 0.11), var(--surface) 72%)',
                    borderColor: isCurrent
                      ? 'var(--primary)'
                      : cleared
                      ? 'rgba(201, 184, 138, 0.5)'
                      : locked
                      ? 'var(--border)'
                      : 'rgba(74, 107, 90, 0.28)',
                    borderWidth: isCurrent ? '2px' : '1px',
                    opacity: locked ? 0.65 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '160px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-1)' }}>
                        {isCurrent && (
                          <span
                            style={{
                              fontSize: '0.65rem',
                              fontWeight: 800,
                              letterSpacing: '0.06em',
                              textTransform: 'uppercase',
                              color: 'var(--primary)',
                              background: 'rgba(74, 107, 90, 0.14)',
                              padding: '2px var(--space-2)',
                              borderRadius: 'var(--radius-full)',
                            }}
                          >
                            Current
                          </span>
                        )}
                        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--ink)' }}>
                          {exercise.name}
                        </h2>
                        <span
                          style={{
                            padding: '2px var(--space-2)',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 600,
                            borderRadius: 'var(--radius-full)',
                            background: diffStyle.bg,
                            color: diffStyle.fg,
                          }}
                        >
                          {exercise.difficulty}
                        </span>
                      </div>
                      {exercise.description && (
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginBottom: 'var(--space-2)', lineHeight: 1.5 }}>
                          {exercise.description}
                        </p>
                      )}
                      {bestScore != null && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 'var(--space-1)',
                            fontSize: 'var(--text-xs)',
                            color: '#8A7A4E',
                            fontWeight: 700,
                            background: 'rgba(201, 184, 138, 0.22)',
                            padding: '2px var(--space-2)',
                            borderRadius: 'var(--radius-full)',
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
                          </svg>
                          Best form {Math.round(bestScore)}%
                        </span>
                      )}
                      {locked && prev && (
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 'var(--space-1)' }}>
                          Reach {exercise.unlock_min_score}% form on “{prev.name}”
                          {exercise.unlock_max_seconds != null && ` within ${exercise.unlock_max_seconds}s`}
                          {' '}to unlock
                        </p>
                      )}
                    </div>

                    {!locked && (
                      <button
                        onClick={() => router.push(`/session?exercise=${exercise.id}`)}
                        className="pose-start pill-btn pill-btn-primary"
                        style={{ flexShrink: 0, minHeight: '44px' }}
                      >
                        {cleared ? 'Practice again' : 'Start'}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14" />
                          <path d="M13 6l6 6-6 6" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
