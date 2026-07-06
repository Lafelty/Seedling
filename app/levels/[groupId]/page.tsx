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

  return (
    <main
      className="min-h-screen max-w-2xl mx-auto px-4 py-8 pb-16"
      style={{ background: 'linear-gradient(180deg, rgba(74, 107, 90, 0.07), transparent 360px)' }}
    >
      {/* Header */}
      <div className="mb-8 animate-fadeIn">
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
            marginBottom: 'var(--space-3)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          All boxes
        </Link>
        <h1 style={{ color: 'var(--primary)', marginBottom: 'var(--space-1)' }}>{node.group.name}</h1>
        {node.group.description && <p style={{ color: 'var(--muted)' }}>{node.group.description}</p>}
        <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-2)' }}>
          {node.clearedCount}/{node.total} poses cleared
        </p>
      </div>

      {/* Pose path */}
      <div style={{ position: 'relative', paddingLeft: '28px' }}>
        {/* Trail line */}
        <div
          style={{
            position: 'absolute',
            left: '13px',
            top: '24px',
            bottom: '24px',
            width: '2px',
            background: 'linear-gradient(180deg, var(--primary), rgba(74, 107, 90, 0.15))',
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {node.exercises.map((exNode, index) => {
            const { exercise, status, bestScore } = exNode
            const locked = status === 'locked'
            const cleared = status === 'cleared'
            const diffStyle = DIFFICULTY_STYLES[exercise.difficulty] ?? DIFFICULTY_STYLES.beginner
            const prev = index > 0 ? node.exercises[index - 1].exercise : null

            return (
              <div key={exercise.id} style={{ position: 'relative' }} className="animate-fadeInUp">
                {/* Trail node */}
                <div
                  style={{
                    position: 'absolute',
                    left: '-28px',
                    top: '20px',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: cleared ? 'var(--primary)' : locked ? 'var(--border)' : 'var(--surface)',
                    border: locked ? 'none' : '2px solid var(--primary)',
                    color: cleared ? 'white' : locked ? 'var(--muted)' : 'var(--primary)',
                    zIndex: 1,
                  }}
                >
                  {cleared ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5L19 7" />
                    </svg>
                  ) : locked ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                  ) : (
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{index + 1}</span>
                  )}
                </div>

                <div
                  className="card"
                  style={{
                    marginLeft: 'var(--space-3)',
                    background: cleared
                      ? 'linear-gradient(160deg, rgba(201, 184, 138, 0.16), var(--surface) 70%)'
                      : locked
                      ? 'var(--surface)'
                      : 'linear-gradient(160deg, rgba(74, 107, 90, 0.12), var(--surface) 70%)',
                    borderColor: locked ? 'var(--border)' : 'rgba(74, 107, 90, 0.30)',
                    opacity: locked ? 0.65 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '160px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-1)' }}>
                        <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--ink)' }}>
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
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginBottom: 'var(--space-1)' }}>
                          {exercise.description}
                        </p>
                      )}
                      {bestScore != null && (
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--primary)', fontWeight: 600 }}>
                          Best form: {Math.round(bestScore)}%
                        </p>
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
                        className="pill-btn pill-btn-primary"
                        style={{ flexShrink: 0 }}
                      >
                        {cleared ? 'Practice again' : 'Start'}
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
