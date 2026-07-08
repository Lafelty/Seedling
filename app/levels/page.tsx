'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { buildLevelMap, type CompletedSession, type GroupNode, type LevelExercise, type LevelGroup } from '@/lib/levels'

export const dynamic = 'force-dynamic'

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

  return (
    <>
      <main
        className="min-h-screen max-w-4xl mx-auto px-4 py-8 pb-24"
        style={{ background: 'linear-gradient(180deg, rgba(74, 107, 90, 0.07), transparent 360px)' }}
      >
        {/* Header */}
        <div className="mb-8 animate-fadeIn">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l9-8 9 8" />
              <path d="M5 9v11h5v-6h4v6h5V9" />
            </svg>
            <h1 style={{ color: 'var(--primary)' }}>Choose your path</h1>
          </div>
          <p style={{ color: 'var(--muted)' }}>
            Clear every pose in a box to unlock the next one
          </p>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 300px))', gap: 'var(--space-4)', justifyContent: 'center' }}>
            {visibleBoxes.map((node, index) => {
              const locked = node.status === 'locked'
              const cleared = node.status === 'cleared'
              const pct = node.total > 0 ? Math.round((node.clearedCount / node.total) * 100) : 0

              const card = (
                <div
                  className="card animate-scaleIn"
                  style={{
                    animationDelay: `${index * 60}ms`,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)',
                    background: cleared
                      ? 'linear-gradient(160deg, rgba(201, 184, 138, 0.20), var(--surface) 70%)'
                      : locked
                      ? 'var(--surface)'
                      : 'linear-gradient(160deg, rgba(74, 107, 90, 0.14), var(--surface) 70%)',
                    borderColor: locked ? 'var(--border)' : 'rgba(74, 107, 90, 0.35)',
                    opacity: locked ? 0.6 : 1,
                    filter: locked ? 'grayscale(0.4)' : 'none',
                    cursor: locked ? 'default' : 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                    <span
                      style={{
                        fontSize: 'var(--text-xs)',
                        fontWeight: 700,
                        color: locked ? 'var(--muted)' : 'var(--primary)',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Box {index + 1}
                    </span>
                    {locked ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="11" width="14" height="9" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                    ) : cleared ? (
                      <span className="star-badge" style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)' }}>
                        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
                        </svg>
                        <span>Complete</span>
                      </span>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M10 8l6 4-6 4z" fill="var(--primary)" stroke="none" />
                      </svg>
                    )}
                  </div>

                  <div>
                    <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--ink)', marginBottom: 'var(--space-1)' }}>
                      {node.group.name}
                    </h2>
                    {node.group.description && (
                      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>{node.group.description}</p>
                    )}
                  </div>

                  <div style={{ marginTop: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', fontWeight: 600 }}>
                        {node.clearedCount}/{node.total} poses
                      </span>
                      <span style={{ fontSize: 'var(--text-xs)', color: locked ? 'var(--muted)' : 'var(--primary)', fontWeight: 700 }}>
                        {pct}%
                      </span>
                    </div>
                    <div style={{ height: '6px', borderRadius: 'var(--radius-full)', background: 'var(--border)', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          borderRadius: 'var(--radius-full)',
                          background: cleared
                            ? 'linear-gradient(90deg, #C9B88A, #B8A56F)'
                            : 'linear-gradient(90deg, var(--primary), #6B8F7A)',
                        }}
                      />
                    </div>
                    {locked && (
                      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 'var(--space-2)' }}>
                        Clear the previous box to unlock
                      </p>
                    )}
                  </div>
                </div>
              )

              return locked ? (
                <div key={node.group.id}>{card}</div>
              ) : (
                <Link key={node.group.id} href={`/levels/${node.group.id}`} style={{ textDecoration: 'none' }}>
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
