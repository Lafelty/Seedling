'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { buildLevelMap, type CompletedSession, type GroupNode, type LevelExercise, type LevelGroup } from '@/lib/levels'
import { difficultySteps, tintOf, type BoxTint } from '@/lib/levels-theme'
import BoxMark from '@/components/BoxMark'

export const dynamic = 'force-dynamic'

/**
 * The box's own mark, ringed by how much of the box is done. Identity in the
 * middle, progress around it — one object instead of a badge plus a number.
 */
function MarkRing({ id, pct, cleared, tint, size = 76 }: { id: string; pct: number; cleared: boolean; tint: BoxTint; size?: number }) {
  const stroke = 5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden
        style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tint.wash} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tint.ink}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          style={{ transition: 'stroke-dashoffset var(--dur-grow) var(--ease-out)' }}
        />
      </svg>
      <BoxMark id={id} cleared={cleared} size={size - stroke * 2 - 10} />
    </div>
  )
}

/** Effort as filled dots plus a word — never a red/amber/green warning badge. */
function Effort({ difficulty, tint, dim }: { difficulty: string; tint: BoxTint; dim: boolean }) {
  const steps = difficultySteps(difficulty)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
      <span aria-hidden style={{ display: 'inline-flex', gap: '3px' }}>
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            style={{
              width: 5,
              height: 5,
              borderRadius: 'var(--radius-full)',
              background: step <= steps ? (dim ? 'var(--muted)' : tint.ink) : 'var(--border)',
            }}
          />
        ))}
      </span>
      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--muted)', textTransform: 'capitalize' }}>
        {difficulty}
      </span>
    </span>
  )
}

function PosePathSkeleton() {
  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-8 pb-24">
      <div className="skeleton" style={{ width: '90px', height: '16px', marginBottom: 'var(--space-4)' }} />
      <div className="skeleton" style={{ height: '148px', borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-6)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton" style={{ height: '116px', borderRadius: 'var(--radius-lg)' }} />
        ))}
      </div>
    </main>
  )
}

export default function LevelGroupPage() {
  const router = useRouter()
  const params = useParams<{ groupId: string }>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [node, setNode] = useState<GroupNode | null>(null)

  const loadGroup = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    // Build the whole map so pose unlock state stays consistent with /levels.
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

    // A failed request is not the same as a box that isn't there: offer a
    // retry here rather than silently bouncing the patient back to the map.
    if (groupsRes.error || exercisesRes.error) {
      console.error('Error loading box:', groupsRes.error || exercisesRes.error)
      setLoadError(true)
      setLoading(false)
      return
    }
    setLoadError(false)

    const map = buildLevelMap(
      (groupsRes.data ?? []) as LevelGroup[],
      (exercisesRes.data ?? []) as LevelExercise[],
      (sessionsRes.data ?? []) as CompletedSession[]
    )

    const found = map.find((n) => n.group.id === params.groupId)
    if (!found) {
      router.replace('/levels')
      return
    }

    setNode(found)
    setLoading(false)
  }, [params.groupId, router])

  useEffect(() => {
    loadGroup()
  }, [loadGroup])

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card text-center" style={{ maxWidth: '420px' }}>
          <p style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: 'var(--space-2)' }}>
            Couldn&apos;t load this box
          </p>
          <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
            Check your connection and try again.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => { setLoading(true); loadGroup() }}>
              Try again
            </button>
            <Link href="/levels" className="pill-btn pill-btn-outline">
              All boxes
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (loading || !node) {
    return <PosePathSkeleton />
  }

  const pct = node.total > 0 ? Math.round((node.clearedCount / node.total) * 100) : 0
  const boxCleared = node.status === 'cleared'
  const tint = tintOf(node.group.id, boxCleared)
  // The pose the patient is up to — first one open but not yet cleared.
  const current = node.exercises.find((e) => e.status === 'unlocked') ?? null
  const currentId = current?.exercise.id ?? null

  return (
    <>
      <main
        className="min-h-screen max-w-2xl mx-auto px-4 py-8 pb-24"
        style={{
          // The page wears the box's own colour, so opening a box from the map
          // lands somewhere that plainly belongs to it.
          ['--box-wash' as string]: tint.wash,
          ['--box-edge' as string]: tint.edge,
          ['--box-ink' as string]: tint.ink,
          ['--box-bar' as string]: tint.bar,
          background: `linear-gradient(180deg, ${tint.wash}, transparent 360px)`,
        }}
      >
        <style>{`
          .pose-back {
            display: inline-flex;
            align-items: center;
            gap: var(--space-1);
            min-height: 48px;
            margin-left: calc(-1 * var(--space-2));
            padding-inline: var(--space-2);
            border-radius: var(--radius-full);
            font-size: var(--text-sm);
            font-weight: 600;
            color: var(--box-ink);
            text-decoration: none;
            transition: background var(--dur-fast) var(--ease-out);
          }
          .pose-back svg { transition: transform var(--dur-fast) var(--ease-out); }

          /* Dark enough for white label text (>=4.5:1) at every tint. */
          .pose-start {
            min-height: 48px;
            background: var(--box-ink);
            color: #FFFFFF;
            transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), filter var(--dur-fast) var(--ease-out);
          }
          .pose-start-quiet {
            min-height: 48px;
            background: var(--surface);
            color: var(--box-ink);
            border-color: var(--box-edge);
          }

          @media (hover: hover) and (pointer: fine) {
            .pose-back:hover { background: var(--box-wash); }
            .pose-back:hover svg { transform: translateX(-2px); }
            .pose-start:hover { transform: translateY(-1px); filter: brightness(1.12); box-shadow: 0 8px 20px var(--box-edge); }
            .pose-start-quiet:hover { background: var(--box-wash); }
            .pose-row[data-locked='false']:hover { border-color: var(--box-bar); }
          }

          .pose-row { transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out); }

          /* The trail: one line down the poses, because inside a box they do
             come in order — earlier poses open the next one. */
          .pose-trail { position: relative; padding-left: 46px; }
          .pose-trail::before {
            content: '';
            position: absolute;
            left: 17px;
            top: 24px;
            bottom: 24px;
            width: 2px;
            border-radius: var(--radius-full);
            background: linear-gradient(180deg, var(--box-bar), var(--box-wash));
          }

          @media (prefers-reduced-motion: reduce) {
            .pose-start:hover { transform: none; }
          }
        `}</style>

        <Link href="/levels" className="pose-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          All boxes
        </Link>

        {/* Header: what this box is, and how far in the patient is. */}
        <header
          className="card animate-fadeIn"
          style={{
            marginTop: 'var(--space-3)',
            marginBottom: 'var(--space-6)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
            background: `linear-gradient(160deg, ${tint.wash}, var(--surface) 72%)`,
            borderColor: tint.edge,
          }}
        >
          <MarkRing id={node.group.id} pct={pct} cleared={boxCleared} tint={tint} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ color: 'var(--ink)', fontSize: 'var(--text-2xl)' }}>{node.group.name}</h1>
            {node.group.description && (
              <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', marginTop: '2px' }}>
                {node.group.description}
              </p>
            )}
            <p style={{ color: tint.ink, fontSize: 'var(--text-sm)', fontWeight: 700, marginTop: 'var(--space-2)' }}>
              {node.total === 0
                ? 'No poses yet'
                : boxCleared
                ? `All ${node.total} poses cleared`
                : `${node.clearedCount} of ${node.total} poses cleared`}
            </p>
          </div>
        </header>

        {node.total === 0 ? (
          <div className="card text-center" style={{ padding: 'var(--space-12) var(--space-6)' }}>
            <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-4)' }}>
              This box has no poses in it yet. Your therapist is still filling it.
            </p>
            <Link href="/levels" className="pill-btn pill-btn-primary" style={{ minHeight: 48 }}>
              Pick another box
            </Link>
          </div>
        ) : (
          <ol className="pose-trail" style={{ listStyle: 'none', margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {node.exercises.map((exNode, index) => {
              const { exercise, status, bestScore } = exNode
              const locked = status === 'locked'
              const cleared = status === 'cleared'
              const isCurrent = exercise.id === currentId
              const prev = index > 0 ? node.exercises[index - 1].exercise : null
              // Status reads three ways — mark, word, colour — so none of it
              // rests on colour alone.
              const statusLabel = cleared ? 'Cleared' : locked ? 'Locked' : isCurrent ? 'Up next' : 'Ready'

              return (
                <li key={exercise.id} style={{ position: 'relative' }} className="animate-fadeInUp" >
                  {/* Trail marker */}
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      left: '-46px',
                      top: '22px',
                      width: '36px',
                      height: '36px',
                      borderRadius: 'var(--radius-full)',
                      display: 'grid',
                      placeItems: 'center',
                      background: cleared ? tint.ink : locked ? 'var(--bg)' : 'var(--surface)',
                      border: `2px solid ${cleared ? tint.ink : locked ? 'var(--border)' : tint.edge}`,
                      boxShadow: isCurrent ? `0 0 0 4px ${tint.wash}` : 'none',
                      color: cleared ? '#FFFFFF' : locked ? 'var(--muted)' : tint.ink,
                      fontSize: 'var(--text-sm)',
                      fontWeight: 800,
                    }}
                  >
                    {cleared ? (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5L19 7" />
                      </svg>
                    ) : locked ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="11" width="14" height="9" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                    ) : (
                      index + 1
                    )}
                  </span>

                  <div
                    className="pose-row card"
                    data-locked={locked}
                    style={{
                      animationDelay: `${Math.min(index, 6) * 50}ms`,
                      padding: 'var(--space-4)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-3)',
                      // Locked poses stay legible: quieter surface, full-strength
                      // text. Dimming the whole card takes the words with it.
                      background: cleared
                        ? `linear-gradient(160deg, ${tint.wash}, var(--surface) 72%)`
                        : locked
                        ? 'var(--bg)'
                        : 'var(--surface)',
                      borderColor: isCurrent ? tint.bar : locked ? 'var(--border)' : tint.edge,
                      borderWidth: isCurrent ? '2px' : '1px',
                      boxShadow: isCurrent ? `0 8px 24px ${tint.wash}` : '0 1px 3px rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                      <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--ink)', minWidth: 0 }}>
                        {exercise.name}
                      </h2>
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 'var(--text-xs)',
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          color: locked ? 'var(--muted)' : tint.ink,
                        }}
                      >
                        {statusLabel}
                      </span>
                    </div>

                    {exercise.description && (
                      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', lineHeight: 1.5 }}>
                        {exercise.description}
                      </p>
                    )}

                    {locked && prev && (
                      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', lineHeight: 1.5 }}>
                        Opens when you reach {exercise.unlock_min_score}% form on {prev.name}
                        {exercise.unlock_max_seconds != null && ` within ${exercise.unlock_max_seconds} seconds`}.
                      </p>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <Effort difficulty={exercise.difficulty} tint={tint} dim={locked} />
                        {bestScore != null && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-xs)', fontWeight: 700, color: '#7A6A3E' }}>
                            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                              <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
                            </svg>
                            Best form {Math.round(bestScore)}%
                          </span>
                        )}
                      </span>

                      {!locked && (
                        <button
                          onClick={() => router.push(`/session?exercise=${exercise.id}`)}
                          className={`pill-btn ${cleared ? 'pose-start-quiet' : 'pose-start'}`}
                          style={{ flexShrink: 0 }}
                        >
                          {cleared ? 'Practice again' : 'Start pose'}
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M5 12h14" />
                            <path d="M13 6l6 6-6 6" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </main>

      {/* Same shell as every other page in the app. */}
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
    </>
  )
}
