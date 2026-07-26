'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { buildLevelMap, type CompletedSession, type GroupNode, type LevelExercise, type LevelGroup } from '@/lib/levels'
import { difficultySteps, tintOf, type BoxTint } from '@/lib/levels-theme'
import BoxMark from '@/components/BoxMark'
import PoseThumb from '@/components/PoseThumb'

export const dynamic = 'force-dynamic'

/**
 * The box's own mark, ringed by how much of the box is done. Identity in the
 * middle, progress around it — one object instead of a badge plus a number.
 * It sits on the box's own colour, so the track it runs on is white — the
 * tint's own wash would be invisible against the surface behind it.
 */
function MarkRing({ id, pct, cleared, tint, size = 72 }: { id: string; pct: number; cleared: boolean; tint: BoxTint; size?: number }) {
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#FFFFFF" strokeWidth={stroke} />
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
      <BoxMark id={id} cleared={cleared} size={size - stroke * 2 - 10} tone="onTint" />
    </div>
  )
}

/** Effort as filled dots plus a word — never a red/amber/green warning badge. */
function Effort({ difficulty, tint, dim }: { difficulty: string; tint: BoxTint; dim: boolean }) {
  const steps = difficultySteps(difficulty)
  return (
    <span className="pose-effort">
      <span aria-hidden style={{ display: 'inline-flex', gap: '3px' }}>
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            style={{
              width: 6,
              height: 6,
              borderRadius: 'var(--radius-full)',
              // The empty dots sit on white and on the tinted current row, so
              // they carry their own alpha rather than the flat --border grey.
              background: step <= steps ? (dim ? '#8A8A8A' : tint.ink) : 'rgba(45, 45, 45, 0.18)',
            }}
          />
        ))}
      </span>
      <span style={{ textTransform: 'capitalize' }}>{difficulty}</span>
    </span>
  )
}

function PosePathSkeleton() {
  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-8 pb-24">
      <div className="skeleton" style={{ width: '90px', height: '16px', marginBottom: 'var(--space-4)' }} />
      <div className="skeleton" style={{ height: '140px', borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-6)' }} />
      {/* One block, because the poses now arrive as one list, not as cards. */}
      <div className="skeleton" style={{ height: '340px', borderRadius: 'var(--radius-lg)' }} />
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
        .select('id, name, description, difficulty, group_id, rank_in_group, unlock_min_score, unlock_max_seconds, demo_images')
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
      {/* The colour spans the viewport while the poses stay a column, so the
          tint must not be pinned to the column's width. */}
      <div
        style={{
          // The page wears the box's own colour, so opening a box from the map
          // lands somewhere that plainly belongs to it.
          ['--box-wash' as string]: tint.wash,
          ['--box-soft' as string]: tint.soft,
          ['--box-edge' as string]: tint.edge,
          ['--box-ink' as string]: tint.ink,
          ['--box-bar' as string]: tint.bar,
          // The colour holds the whole page instead of fading out at 360px —
          // a tint that dies where the content starts leaves the content
          // looking stranded on a different screen than the one it opened on.
          background: `linear-gradient(180deg, ${tint.wash}, ${tint.soft} 420px, ${tint.soft})`,
        }}
      >
      <main className="min-h-screen max-w-2xl mx-auto px-4 py-8 pb-24">
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

          /* ─── The box's own slab ───
             A whole surface of the box's colour, but the colour itself stays
             light. Filling it with the ink made a dark green wall at the top
             of a screen that is meant to feel like daylight in a garden; the
             commitment is in holding one flat tint rather than fading out of
             it, not in how dark it is. */
          .pose-hero {
            margin-top: var(--space-3);
            margin-bottom: var(--space-6);
            display: flex;
            align-items: center;
            gap: var(--space-4);
            background-color: var(--surface);
            background-image: linear-gradient(var(--box-wash), var(--box-wash));
            border: 1px solid var(--box-edge);
            box-shadow: 0 6px 20px var(--box-soft);
          }
          .pose-hero h1 { color: var(--ink); font-size: var(--text-2xl); }
          .pose-hero-sub { color: #5C5C5C; font-size: var(--text-sm); margin-top: 2px; }
          .pose-hero-count { color: var(--box-ink); font-size: var(--text-sm); font-weight: 700; margin-top: var(--space-2); }

          /* ─── The poses, as one list rather than a stack of cards ───
             Cards inside a card gave every pose its own border, gradient and
             shadow; nine of those on one screen is what read as noise. One
             surface, hairline-divided rows, and the order carried by a trail
             that runs through the markers instead of hanging in a gutter. */
          .pose-list {
            list-style: none;
            margin: 0;
            padding: 0;
            overflow: hidden;
            border: 1px solid var(--box-edge);
            /* Header and list are the only two surfaces on the page now, so
               the list can sit flat rather than competing for depth. */
            box-shadow: 0 1px 2px rgba(38, 48, 42, 0.05);
          }

          .pose-item {
            position: relative;
            /* Metadata reads at 5.6:1 on the tinted row and 6.7:1 on white —
               --muted (#6B6B6B) drops to 4.4:1 over the wash and fails AA. */
            --pose-meta: #5C5C5C;
          }
          /* Colour runs down the list in step with the work: done rows hold a
             quiet tint, the pose being worked on holds the full wash, and what
             hasn't been reached yet is plain. The tinted run is the progress,
             which is why it stops where it does. */
          .pose-item[data-state='cleared'] { background: var(--box-soft); }
          .pose-item[data-state='current'] {
            background: linear-gradient(160deg, var(--box-wash), var(--surface) 78%);
          }

          /* The trail: one line through the markers, because inside a box the
             poses do come in order — earlier ones open the next. It runs the
             row's full height and stops half-way at the two ends. */
          .pose-item::before {
            content: '';
            position: absolute;
            left: 33px;
            top: 0;
            bottom: 0;
            width: 2px;
            background: var(--pose-rail, var(--border));
          }
          .pose-item:first-child::before { top: 50%; }
          .pose-item:last-child::before { bottom: 50%; }

          /* Divider inset past the trail, so the two line systems never cross. */
          .pose-item + .pose-item::after {
            content: '';
            position: absolute;
            left: 64px;
            right: 0;
            top: 0;
            height: 1px;
            background: var(--border);
          }

          .pose-row {
            position: relative;
            width: 100%;
            display: grid;
            grid-template-columns: 36px auto minmax(0, 1fr) auto;
            align-items: center;
            gap: var(--space-3);
            padding: var(--space-4);
            background: transparent;
            border: 0;
            text-align: left;
            font: inherit;
            color: inherit;
            text-decoration: none;
          }
          a.pose-row { cursor: pointer; }
          /* Inset, or the ring is clipped by the list's own overflow. */
          a.pose-row:focus-visible { outline-offset: -3px; border-radius: var(--radius-md); }

          /* The trail marker. Sits above the line it hangs on. */
          .pose-disc {
            position: relative;
            z-index: 1;
            width: 36px;
            height: 36px;
            border-radius: var(--radius-full);
            display: grid;
            place-items: center;
            font-size: var(--text-sm);
            font-weight: 700;
            font-variant-numeric: tabular-nums;
          }

          /* The pose's own demo pictures, sized here rather than in the
             component so the row can shrink them on a narrow phone. */
          .pose-thumb { width: 88px; height: 88px; }

          .pose-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }

          /* Pose names are UI labels, so they take the body face. Left alone
             they inherit DM Serif Display from the global h1–h6 rule. */
          .pose-name {
            font-family: var(--font-body);
            font-size: var(--text-base);
            font-weight: 600;
            line-height: 1.35;
            letter-spacing: 0;
            color: var(--ink);
            overflow-wrap: anywhere;
          }

          .pose-desc {
            font-size: var(--text-sm);
            line-height: 1.5;
            color: var(--pose-meta);
            max-width: none;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }
          /* The pose being worked on is the one worth reading in full. */
          .pose-item[data-state='current'] .pose-desc { -webkit-line-clamp: 3; }

          .pose-meta {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: var(--space-1) var(--space-3);
            margin-top: var(--space-1);
            font-size: var(--text-xs);
            font-weight: 600;
            color: var(--pose-meta);
          }
          .pose-effort { display: inline-flex; align-items: center; gap: var(--space-2); }
          .pose-status { font-weight: 700; color: var(--box-ink); }
          .pose-item[data-state='locked'] .pose-status { color: var(--pose-meta); }
          /* The same gold as a finished box's ink, deep enough to hold 4.5:1
             on the current row's wash — 12px bold is normal text to WCAG. */
          .pose-best { display: inline-flex; align-items: center; gap: var(--space-1); color: #6B5C33; font-weight: 700; }

          /* One chip on one row — the pose the patient is up to. It rides the
             meta line rather than the title, so a long pose name keeps the
             full column width instead of wrapping around it. */
          .pose-next {
            flex-shrink: 0;
            font-weight: 700;
            letter-spacing: 0.03em;
            padding: 2px var(--space-2);
            border-radius: var(--radius-full);
            background: var(--box-ink);
            color: #FFFFFF;
          }

          /* One filled action on the page: the pose to do next. Every other
             open pose is a quiet row with a chevron. */
          .pose-go {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-1);
            flex-shrink: 0;
            color: var(--box-ink);
          }
          .pose-go[data-fill='true'] {
            position: relative;
            min-height: 40px;
            padding-inline: var(--space-4);
            border-radius: var(--radius-full);
            /* Every tint's ink passes 4.5:1 against white label text. The sweep
               rides on top of the ink as a moving highlight — one paint, so the
               pill needs no overflow clipping and the sprig can sit outside it. */
            background-color: var(--box-ink);
            background-image: linear-gradient(100deg, transparent 26%, rgba(255, 255, 255, 0.34) 40%, transparent 54%);
            background-size: 260% 100%;
            background-repeat: no-repeat;
            color: #FFFFFF;
            font-size: var(--text-sm);
            font-weight: 700;
            box-shadow: 0 2px 10px var(--box-edge), 0 0 0 3px var(--box-wash);
            animation: pose-sheen 4.2s var(--ease-out) infinite;
          }
          /* Long rest between passes: the sweep is meant to catch the eye once,
             not to shimmer continuously next to text a patient is reading. */
          @keyframes pose-sheen {
            0% { background-position: 200% 0; }
            40%, 100% { background-position: -110% 0; }
          }

          /* A leaf growing off the top of the action — the one place on the
             page where the garden shows up as an object rather than a colour. */
          .pose-sprig {
            position: absolute;
            /* Centred on the pill and standing clear of it: the leaf grows out
               of the middle of the action rather than off one corner.
               Centring by margin, not translate, so the sway keyframes own the
               transform outright. */
            top: -20px;
            left: 50%;
            margin-left: -14px;
            width: 28px;
            height: 28px;
            pointer-events: none;
            transform-origin: 50% 100%;
            animation: pose-sway 3.4s var(--ease-out) infinite;
            filter: drop-shadow(0 1px 2px rgba(28, 40, 32, 0.35));
          }
          @keyframes pose-sway {
            0%, 100% { transform: rotate(-8deg); }
            50% { transform: rotate(6deg) translateY(-1px); }
          }
          /* The sprig has its own sway; only the chevron slides. */
          .pose-go svg:not(.pose-sprig) { transition: transform var(--dur-fast) var(--ease-out); }

          @media (hover: hover) and (pointer: fine) {
            .pose-back:hover { background: var(--box-wash); }
            .pose-back:hover svg { transform: translateX(-2px); }
            .pose-item[data-open='true']:hover { background: var(--box-wash); }
            .pose-row:hover .pose-go svg:not(.pose-sprig) { transform: translateX(3px); }
            .pose-row:hover .pose-go[data-fill='true'] { filter: brightness(1.1); }
          }
          a.pose-row:active { background: var(--box-wash); }

          /* A picture, a name and a filled action can't share one line on a
             phone: the pose name ends up two words wide. The action drops
             below the text and keeps its full label. The bare chevron stays in
             its column — it costs 18px and reads as a stray glyph on a line of
             its own. */
          @media (max-width: 560px) {
            .pose-item[data-state='current'] .pose-row { grid-template-columns: 36px auto minmax(0, 1fr); }
            .pose-item[data-state='current'] .pose-go {
              grid-column: 3;
              justify-self: start;
              margin-top: var(--space-2);
            }
            .pose-item[data-state='current'] .pose-desc { -webkit-line-clamp: 2; }
          }

          @media (max-width: 400px) {
            .pose-thumb { width: 72px; height: 72px; }
            .pose-row { gap: var(--space-2); padding: var(--space-3); }
          }

          @media (prefers-reduced-motion: reduce) {
            .pose-go svg, .pose-back svg { transition: none; }
            .pose-go[data-fill='true'] { animation: none; }
            .pose-sprig { animation: none; }
          }
        `}</style>

        <Link href="/levels" className="pose-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          All boxes
        </Link>

        {/* Header: what this box is, and how far in the patient is. It wears
            the box's colour outright rather than a wash of it — one committed
            surface at the top, so the green isn't only a fade and a stripe. */}
        <header className="pose-hero card animate-fadeIn">
          <MarkRing id={node.group.id} pct={pct} cleared={boxCleared} tint={tint} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>{node.group.name}</h1>
            {node.group.description && <p className="pose-hero-sub">{node.group.description}</p>}
            <p className="pose-hero-count">
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
          <ol className="pose-list card animate-fadeIn" style={{ padding: 0 }}>
            {node.exercises.map((exNode, index) => {
              const { exercise, status, bestScore } = exNode
              const locked = status === 'locked'
              const cleared = status === 'cleared'
              const isCurrent = exercise.id === currentId
              const state = cleared ? 'cleared' : locked ? 'locked' : isCurrent ? 'current' : 'ready'
              const prev = index > 0 ? node.exercises[index - 1].exercise : null
              // Status reads three ways — marker shape, word, colour — so none
              // of it rests on colour alone.
              const action = cleared ? 'Practice again' : isCurrent ? 'Start pose' : 'Start'

              const body = (
                <>
                  <span
                    className="pose-disc"
                    aria-hidden
                    style={{
                      background: cleared ? tint.bar : locked ? 'var(--bg)' : 'var(--surface)',
                      border: `2px solid ${cleared ? tint.bar : locked ? 'var(--border)' : tint.edge}`,
                      boxShadow: isCurrent ? `0 0 0 4px ${tint.wash}` : 'none',
                      color: cleared ? '#FFFFFF' : locked ? '#5C5C5C' : tint.ink,
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

                  {/* The pose as the therapist shot it, ahead of its name —
                      a picture of the movement lands before words do. */}
                  <PoseThumb
                    images={Array.isArray(exercise.demo_images) ? exercise.demo_images : []}
                    locked={locked}
                    tint={tint}
                    delayMs={index * 220}
                  />

                  <div className="pose-body">
                    <h2 className="pose-name">{exercise.name}</h2>

                    {/* Locked poses say what opens them; that replaces the
                        description, which they can't act on yet. */}
                    {locked && prev ? (
                      <p className="pose-desc">
                        Opens when you reach {exercise.unlock_min_score}% form on {prev.name}
                        {exercise.unlock_max_seconds != null && ` within ${exercise.unlock_max_seconds} seconds`}.
                      </p>
                    ) : (
                      exercise.description && <p className="pose-desc">{exercise.description}</p>
                    )}

                    <span className="pose-meta">
                      {isCurrent && <span className="pose-next">Up next</span>}
                      <Effort difficulty={exercise.difficulty} tint={tint} dim={locked} />
                      {(cleared || locked) && (
                        <span className="pose-status">{cleared ? 'Cleared' : 'Locked'}</span>
                      )}
                      {bestScore != null && (
                        <span className="pose-best">
                          <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                            <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
                          </svg>
                          Best form {Math.round(bestScore)}%
                        </span>
                      )}
                    </span>
                  </div>

                  {!locked && (
                    <span className="pose-go" data-fill={isCurrent}>
                      {isCurrent && (
                        <svg className="pose-sprig" viewBox="0 0 24 24" fill="none" aria-hidden>
                          {/* The leaves are outlined: their top halves sit on the
                              row's pale green, where an unlined light green leaf
                              disappears. */}
                          <path d="M12 22V12.5" stroke="#2A5F3C" strokeWidth="2.6" strokeLinecap="round" />
                          <path d="M12 14c-4.4 0-6.6-2.2-6.6-6.6C9.8 7.4 12 9.6 12 14Z" fill="#8FD08C" stroke="#2A5F3C" strokeWidth="1.1" strokeLinejoin="round" />
                          <path d="M12 14c4.4 0 6.6-2.2 6.6-6.6C14.2 7.4 12 9.6 12 14Z" fill="#C2EBAA" stroke="#2A5F3C" strokeWidth="1.1" strokeLinejoin="round" />
                        </svg>
                      )}
                      {isCurrent && action}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        {isCurrent ? (
                          <>
                            <path d="M5 12h14" />
                            <path d="M13 6l6 6-6 6" />
                          </>
                        ) : (
                          <path d="M9 6l6 6-6 6" />
                        )}
                      </svg>
                    </span>
                  )}
                </>
              )

              return (
                <li
                  key={exercise.id}
                  className="pose-item"
                  data-state={state}
                  data-open={!locked}
                  style={{ ['--pose-rail' as string]: cleared ? tint.bar : 'var(--border)' }}
                >
                  {locked ? (
                    <div className="pose-row">{body}</div>
                  ) : (
                    <Link
                      href={`/session?exercise=${exercise.id}`}
                      className="pose-row"
                      aria-label={`${action}: ${exercise.name}`}
                    >
                      {body}
                    </Link>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </main>
      </div>

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
