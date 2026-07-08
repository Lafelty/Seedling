'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

interface Group {
  id: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

interface ExerciseRow {
  id: string
  name: string
  difficulty: string
  is_active: boolean
  group_id: string | null
  rank_in_group: number
  unlock_min_score: number
  unlock_max_seconds: number | null
}

const DIFFICULTY_STYLES: Record<string, { bg: string; fg: string }> = {
  beginner: { bg: '#E8F5E9', fg: '#2E7D32' },
  intermediate: { bg: '#FFF3E0', fg: '#EF6C00' },
  advanced: { bg: '#FFEBEE', fg: '#C62828' },
}

const inputStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  fontSize: 'var(--text-sm)',
  color: 'var(--ink)',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--muted)',
  fontWeight: 600,
}

export default function AdminGroupsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [groups, setGroups] = useState<Group[]>([])
  const [exercises, setExercises] = useState<ExerciseRow[]>([])
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    checkAdminAndLoad()
  }, [])

  function flash(text: string) {
    setMessage(text)
    setTimeout(() => setMessage(null), 2500)
  }

  async function checkAdminAndLoad() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      router.push('/')
      return
    }

    setIsAdmin(true)
    await reload()
    setLoading(false)
  }

  async function reload() {
    const supabase = createClient()
    const [groupsRes, exercisesRes] = await Promise.all([
      supabase
        .from('exercise_groups')
        .select('id, name, description, sort_order, is_active')
        .order('sort_order', { ascending: true }),
      supabase
        .from('exercises')
        .select('id, name, difficulty, is_active, group_id, rank_in_group, unlock_min_score, unlock_max_seconds')
        .order('rank_in_group', { ascending: true }),
    ])

    if (groupsRes.error || exercisesRes.error) {
      console.error(
        'Error loading groups (run supabase/levels_migration.sql?):',
        groupsRes.error || exercisesRes.error
      )
      flash('Load failed — has levels_migration.sql been run?')
      return
    }

    setGroups((groupsRes.data ?? []) as Group[])
    setExercises((exercisesRes.data ?? []) as ExerciseRow[])
  }

  async function createGroup() {
    if (!newName.trim()) return
    const supabase = createClient()
    const nextSort = groups.reduce((max, g) => Math.max(max, g.sort_order), 0) + 1
    const { error } = await supabase.from('exercise_groups').insert({
      name: newName.trim(),
      description: newDescription.trim() || null,
      sort_order: nextSort,
    })
    if (error) {
      flash('Failed to create box: ' + error.message)
    } else {
      setNewName('')
      setNewDescription('')
      flash('Box created')
      await reload()
    }
  }

  function updateGroupLocal(id: string, patch: Partial<Group>) {
    setGroups(groups.map(g => (g.id === id ? { ...g, ...patch } : g)))
  }

  async function saveGroup(group: Group) {
    const supabase = createClient()
    const { error } = await supabase
      .from('exercise_groups')
      .update({
        name: group.name,
        description: group.description,
        sort_order: group.sort_order,
        is_active: group.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', group.id)
    if (error) flash('Failed to save box: ' + error.message)
    else {
      flash('Box saved')
      await reload()
    }
  }

  async function deleteGroup(group: Group) {
    if (!confirm(`Delete box "${group.name}"? Its poses become unassigned.`)) return
    const supabase = createClient()
    const { error } = await supabase.from('exercise_groups').delete().eq('id', group.id)
    if (error) flash('Failed to delete box: ' + error.message)
    else {
      flash('Box deleted')
      await reload()
    }
  }

  function updateExerciseLocal(id: string, patch: Partial<ExerciseRow>) {
    setExercises(exercises.map(e => (e.id === id ? { ...e, ...patch } : e)))
  }

  async function saveExercise(ex: ExerciseRow) {
    const supabase = createClient()
    const { error } = await supabase
      .from('exercises')
      .update({
        group_id: ex.group_id,
        rank_in_group: Math.max(1, Math.floor(Number(ex.rank_in_group) || 1)),
        unlock_min_score: Math.min(100, Math.max(0, Math.floor(Number(ex.unlock_min_score) || 0))),
        unlock_max_seconds:
          ex.unlock_max_seconds == null || (ex.unlock_max_seconds as unknown as string) === ''
            ? null
            : Math.max(1, Math.floor(Number(ex.unlock_max_seconds))),
      })
      .eq('id', ex.id)
    if (error) flash('Failed to save pose: ' + error.message)
    else {
      flash('Pose saved')
      await reload()
    }
  }

  function exerciseRow(ex: ExerciseRow, index: number) {
    const diffStyle = DIFFICULTY_STYLES[ex.difficulty] ?? DIFFICULTY_STYLES.beginner
    return (
      <div
        key={ex.id}
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-5)',
          borderTop: '1px solid var(--border)',
          flexWrap: 'wrap',
          background: index % 2 === 1 ? 'rgba(74, 107, 90, 0.03)' : 'transparent',
        }}
      >
        <div style={{ flex: '1 1 180px', minWidth: '160px', alignSelf: 'center' }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 'var(--text-sm)' }}>
            {ex.name}
            {!ex.is_active && (
              <span style={{
                marginLeft: 'var(--space-2)',
                padding: '1px var(--space-2)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                borderRadius: 'var(--radius-full)',
                background: '#EEEEEE',
                color: '#757575',
              }}>
                draft
              </span>
            )}
          </p>
          <span
            style={{
              display: 'inline-block',
              marginTop: '3px',
              padding: '1px var(--space-2)',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              borderRadius: 'var(--radius-full)',
              background: diffStyle.bg,
              color: diffStyle.fg,
            }}
          >
            {ex.difficulty}
          </span>
        </div>

        <label style={fieldLabelStyle}>
          Order
          <input
            type="number"
            min={1}
            value={ex.rank_in_group}
            onChange={(e) => updateExerciseLocal(ex.id, { rank_in_group: Number(e.target.value) })}
            style={{ ...inputStyle, width: '64px', display: 'block', marginTop: '3px' }}
          />
        </label>

        <label style={fieldLabelStyle}>
          Min form %
          <input
            type="number"
            min={0}
            max={100}
            value={ex.unlock_min_score}
            onChange={(e) => updateExerciseLocal(ex.id, { unlock_min_score: Number(e.target.value) })}
            style={{ ...inputStyle, width: '76px', display: 'block', marginTop: '3px' }}
          />
        </label>

        <label style={fieldLabelStyle}>
          Max seconds
          <input
            type="number"
            min={1}
            placeholder="—"
            value={ex.unlock_max_seconds ?? ''}
            onChange={(e) =>
              updateExerciseLocal(ex.id, {
                unlock_max_seconds: e.target.value === '' ? null : Number(e.target.value),
              })
            }
            style={{ ...inputStyle, width: '88px', display: 'block', marginTop: '3px' }}
          />
        </label>

        <label style={fieldLabelStyle}>
          Box
          <select
            value={ex.group_id ?? ''}
            onChange={(e) => updateExerciseLocal(ex.id, { group_id: e.target.value || null })}
            style={{ ...inputStyle, display: 'block', marginTop: '3px', minWidth: '130px' }}
          >
            <option value="">Unassigned</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>

        <button
          onClick={() => saveExercise(ex)}
          style={{
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            color: 'white',
            background: 'var(--primary)',
            border: 'none',
            borderRadius: 'var(--radius-full)',
            cursor: 'pointer',
            marginLeft: 'auto',
            boxShadow: '0 2px 6px rgba(74, 107, 90, 0.25)',
          }}
        >
          Save
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--background)',
      }}>
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p style={{ color: 'var(--muted)' }}>Loading boxes...</p>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return null
  }

  const unassigned = exercises.filter((e) => !e.group_id || !groups.some((g) => g.id === e.group_id))

  return (
    <div className="admin-scope" style={{
      minHeight: '100vh',
      background: 'var(--background)',
    }}>
      <style>{`
        .admin-scope button, .admin-scope a.pill-btn { min-height: 40px; }
        .admin-scope button, .admin-scope a.pill-btn, .admin-scope input, .admin-scope select {
          transition: filter var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
        }
        .admin-scope button:not(:disabled):hover, .admin-scope a.pill-btn:hover { filter: brightness(0.96); }
        .admin-scope button:not(:disabled):active, .admin-scope a.pill-btn:active { transform: translateY(1px); }
        .admin-scope button:focus-visible, .admin-scope a:focus-visible {
          outline: none; box-shadow: 0 0 0 3px rgba(74, 107, 90, 0.45);
        }
        .admin-scope input:focus, .admin-scope select:focus {
          outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(74, 107, 90, 0.18);
        }
        @media (prefers-reduced-motion: reduce) {
          .admin-scope button, .admin-scope a, .admin-scope input, .admin-scope select { transition: none; }
          .admin-scope button:active, .admin-scope a.pill-btn:active { transform: none; }
        }
      `}</style>
      <div style={{
        background: 'linear-gradient(180deg, rgba(74, 107, 90, 0.10), rgba(107, 143, 122, 0.04) 240px, transparent 420px)',
        padding: 'var(--space-6)',
        minHeight: '100vh',
      }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          {/* Header */}
          <div className="animate-fadeIn" style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 'var(--space-4)',
            flexWrap: 'wrap',
            marginBottom: 'var(--space-8)',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                <div style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: 'var(--radius-lg)',
                  background: 'linear-gradient(160deg, var(--primary), #6B8F7A)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(74, 107, 90, 0.25)',
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                </div>
                <h1 style={{
                  fontSize: 'var(--text-3xl)',
                  fontWeight: 600,
                  fontFamily: 'var(--font-display)',
                  color: 'var(--primary)',
                }}>
                  Exercise Boxes
                </h1>
              </div>
              <p style={{ fontSize: 'var(--text-base)', color: 'var(--muted)' }}>
                Group poses into boxes, order them easy to hard, and set unlock requirements
              </p>
            </div>
            <Link href="/admin" className="pill-btn pill-btn-outline">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back to Admin
            </Link>
          </div>

          {message && (
            <div className="animate-scaleIn" style={{
              marginBottom: 'var(--space-4)',
              padding: 'var(--space-3) var(--space-5)',
              borderRadius: 'var(--radius-full)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              background: message.startsWith('Failed') || message.startsWith('Load failed')
                ? '#FFEBEE'
                : '#E8F5E9',
              color: message.startsWith('Failed') || message.startsWith('Load failed')
                ? '#C62828'
                : '#2E7D32',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}>
              {message.startsWith('Failed') || message.startsWith('Load failed') ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5L19 7" />
                </svg>
              )}
              {message}
            </div>
          )}

          {/* Create box */}
          <div className="card animate-fadeInUp" style={{
            background: 'linear-gradient(160deg, rgba(74, 107, 90, 0.12), var(--surface) 65%)',
            borderColor: 'rgba(74, 107, 90, 0.25)',
            marginBottom: 'var(--space-6)',
          }}>
            <h2 style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 600,
              color: 'var(--primary)',
              marginBottom: 'var(--space-4)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Plant a new box
            </h2>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ ...fieldLabelStyle, flex: '0 1 220px' }}>
                Name
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Shoulder strength"
                  style={{ ...inputStyle, display: 'block', width: '100%', marginTop: '3px' }}
                />
              </label>
              <label style={{ ...fieldLabelStyle, flex: '1 1 260px' }}>
                Description (optional)
                <input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="What this box trains"
                  style={{ ...inputStyle, display: 'block', width: '100%', marginTop: '3px' }}
                />
              </label>
              <button
                onClick={createGroup}
                disabled={!newName.trim()}
                className="pill-btn pill-btn-primary"
                style={{
                  cursor: newName.trim() ? 'pointer' : 'default',
                  opacity: newName.trim() ? 1 : 0.5,
                  border: 'none',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add Box
              </button>
            </div>
          </div>

          {/* Boxes */}
          {groups.map((group, index) => {
            const groupExercises = exercises.filter((e) => e.group_id === group.id)
            return (
              <div
                key={group.id}
                className="card animate-fadeInUp"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  marginBottom: 'var(--space-6)',
                  borderColor: group.is_active ? 'rgba(74, 107, 90, 0.25)' : 'var(--border)',
                  opacity: group.is_active ? 1 : 0.75,
                }}
              >
                {/* Box header strip */}
                <div style={{
                  padding: 'var(--space-5) var(--space-5) var(--space-4)',
                  background: 'linear-gradient(180deg, rgba(107, 143, 122, 0.10), transparent)',
                }}>
                  <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <span style={{
                      alignSelf: 'center',
                      padding: 'var(--space-1) var(--space-3)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'white',
                      background: 'linear-gradient(160deg, var(--primary), #6B8F7A)',
                      borderRadius: 'var(--radius-full)',
                      boxShadow: '0 2px 6px rgba(74, 107, 90, 0.25)',
                    }}>
                      Box {index + 1}
                    </span>
                    <label style={{ ...fieldLabelStyle, flex: '0 1 200px' }}>
                      Name
                      <input
                        value={group.name}
                        onChange={(e) => updateGroupLocal(group.id, { name: e.target.value })}
                        style={{ ...inputStyle, display: 'block', width: '100%', marginTop: '3px', fontWeight: 600 }}
                      />
                    </label>
                    <label style={{ ...fieldLabelStyle, flex: '1 1 220px' }}>
                      Description
                      <input
                        value={group.description ?? ''}
                        onChange={(e) => updateGroupLocal(group.id, { description: e.target.value || null })}
                        style={{ ...inputStyle, display: 'block', width: '100%', marginTop: '3px' }}
                      />
                    </label>
                    <label style={fieldLabelStyle}>
                      Order
                      <input
                        type="number"
                        value={group.sort_order}
                        onChange={(e) => updateGroupLocal(group.id, { sort_order: Number(e.target.value) })}
                        style={{ ...inputStyle, width: '64px', display: 'block', marginTop: '3px' }}
                      />
                    </label>
                    <label style={{
                      ...fieldLabelStyle,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-1)',
                      paddingBottom: 'var(--space-2)',
                      cursor: 'pointer',
                    }}>
                      <input
                        type="checkbox"
                        checked={group.is_active}
                        onChange={(e) => updateGroupLocal(group.id, { is_active: e.target.checked })}
                        style={{ accentColor: 'var(--primary)' }}
                      />
                      Visible
                    </label>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'auto' }}>
                      <button
                        onClick={() => saveGroup(group)}
                        style={{
                          padding: 'var(--space-2) var(--space-4)',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 600,
                          color: 'white',
                          background: 'var(--primary)',
                          border: 'none',
                          borderRadius: 'var(--radius-full)',
                          cursor: 'pointer',
                          boxShadow: '0 2px 6px rgba(74, 107, 90, 0.25)',
                        }}
                      >
                        Save Box
                      </button>
                      <button
                        onClick={() => deleteGroup(group)}
                        style={{
                          padding: 'var(--space-2) var(--space-4)',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 600,
                          color: '#C62828',
                          background: '#FFEBEE',
                          border: 'none',
                          borderRadius: 'var(--radius-full)',
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 'var(--space-3)' }}>
                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                      {groupExercises.length} pose{groupExercises.length === 1 ? '' : 's'}
                    </span>
                    {' '}— patients unlock each pose by hitting its “min form %” (and time cap, if set) on the pose before it.
                  </p>
                </div>

                {groupExercises.length > 0 ? (
                  groupExercises.map((ex, i) => exerciseRow(ex, i))
                ) : (
                  <p style={{
                    padding: 'var(--space-4) var(--space-5)',
                    borderTop: '1px solid var(--border)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--muted)',
                  }}>
                    No poses in this box yet — assign some below or from another box.
                  </p>
                )}
              </div>
            )
          })}

          {/* Unassigned */}
          <div className="card animate-fadeInUp" style={{
            padding: 0,
            overflow: 'hidden',
            border: '1px dashed rgba(74, 107, 90, 0.35)',
            background: 'var(--surface)',
          }}>
            <div style={{ padding: 'var(--space-5)' }}>
              <h2 style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 600,
                color: 'var(--ink)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22v-7" />
                  <path d="M12 15q-6 0-7-8 7 1 7 8Z" />
                </svg>
                Unassigned poses
              </h2>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 'var(--space-1)' }}>
                These don't appear on the patient map until you put them in a box.
              </p>
            </div>
            {unassigned.length > 0 ? (
              unassigned.map((ex, i) => exerciseRow(ex, i))
            ) : (
              <p style={{
                padding: 'var(--space-4) var(--space-5)',
                borderTop: '1px solid var(--border)',
                fontSize: 'var(--text-sm)',
                color: 'var(--muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
                  <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
                </svg>
                Every pose is in a box.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
