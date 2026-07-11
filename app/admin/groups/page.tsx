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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className="chev"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function unlockSummary(ex: ExerciseRow) {
  const parts = [`form ≥ ${ex.unlock_min_score}%`]
  if (ex.unlock_max_seconds != null) parts.push(`≤ ${ex.unlock_max_seconds}s`)
  return parts.join(' · ')
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

  // progressive disclosure state — keep the screen calm, reveal on demand
  const [openBoxes, setOpenBoxes] = useState<Set<string>>(new Set())
  const [settingsFor, setSettingsFor] = useState<Set<string>>(new Set())
  const [editingEx, setEditingEx] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showUnassigned, setShowUnassigned] = useState(false)

  useEffect(() => {
    checkAdminAndLoad()
  }, [])

  function flash(text: string) {
    setMessage(text)
    setTimeout(() => setMessage(null), 2500)
  }

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
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
      console.error('Error loading groups:', groupsRes.error || exercisesRes.error)
      flash('Failed to load groups. Refresh to retry.')
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
      setShowCreate(false)
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
      setEditingEx(null)
      flash('Pose saved')
      await reload()
    }
  }

  // A pose: compact read row that expands into an edit form on demand.
  function exerciseRow(ex: ExerciseRow, index: number) {
    const diffStyle = DIFFICULTY_STYLES[ex.difficulty] ?? DIFFICULTY_STYLES.beginner
    const editing = editingEx === ex.id

    return (
      <div
        key={ex.id}
        style={{
          borderTop: '1px solid var(--border)',
          background: editing ? 'rgba(74, 107, 90, 0.05)' : index % 2 === 1 ? 'rgba(74, 107, 90, 0.02)' : 'transparent',
        }}
      >
        {/* Read row — always visible, click to edit */}
        <button
          type="button"
          onClick={() => setEditingEx(editing ? null : ex.id)}
          aria-expanded={editing}
          className="pose-row"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{
            flexShrink: 0,
            width: '26px',
            height: '26px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            color: 'var(--primary)',
            background: 'rgba(74, 107, 90, 0.10)',
            borderRadius: 'var(--radius-full)',
          }}>
            {ex.rank_in_group}
          </span>

          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <span style={{
              fontWeight: 600,
              color: 'var(--ink)',
              fontSize: 'var(--text-sm)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}>
              {ex.name}
              {!ex.is_active && (
                <span style={{
                  padding: '1px var(--space-2)',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  borderRadius: 'var(--radius-full)',
                  background: '#EEEEEE',
                  color: '#757575',
                }}>
                  draft
                </span>
              )}
            </span>
            <span style={{
              display: 'block',
              marginTop: '2px',
              fontSize: 'var(--text-xs)',
              color: 'var(--muted)',
            }}>
              Unlocks at {unlockSummary(ex)}
            </span>
          </div>

          <span style={{
            padding: '2px var(--space-2)',
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'capitalize',
            borderRadius: 'var(--radius-full)',
            background: diffStyle.bg,
            color: diffStyle.fg,
            flexShrink: 0,
          }}>
            {ex.difficulty}
          </span>

          <span style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            color: 'var(--primary)',
            flexShrink: 0,
          }}>
            {editing ? 'Close' : 'Edit'}
          </span>
          <Chevron open={editing} />
        </button>

        {/* Edit form — only when this pose is open */}
        {editing && (
          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
            padding: '0 var(--space-4) var(--space-4)',
          }}>
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
                placeholder="none"
                value={ex.unlock_max_seconds ?? ''}
                onChange={(e) =>
                  updateExerciseLocal(ex.id, {
                    unlock_max_seconds: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                style={{ ...inputStyle, width: '96px', display: 'block', marginTop: '3px' }}
              />
            </label>

            <label style={fieldLabelStyle}>
              Move to box
              <select
                value={ex.group_id ?? ''}
                onChange={(e) => updateExerciseLocal(ex.id, { group_id: e.target.value || null })}
                style={{ ...inputStyle, display: 'block', marginTop: '3px', minWidth: '150px' }}
              >
                <option value="">Unassigned</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'auto' }}>
              <button
                onClick={() => setEditingEx(null)}
                className="pill-btn pill-btn-ghost"
                style={{ fontSize: 'var(--text-xs)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => saveExercise(ex)}
                className="pill-btn pill-btn-primary"
                style={{ fontSize: 'var(--text-xs)', border: 'none' }}
              >
                Save pose
              </button>
            </div>
          </div>
        )}
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
  const assignedCount = exercises.length - unassigned.length
  const allOpen = groups.length > 0 && groups.every((g) => openBoxes.has(g.id))

  function toggleAll() {
    setOpenBoxes(allOpen ? new Set() : new Set(groups.map((g) => g.id)))
  }

  const statChipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: 'var(--space-1) var(--space-3)',
    borderRadius: 'var(--radius-full)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    fontSize: 'var(--text-xs)',
    color: 'var(--muted)',
    fontWeight: 600,
  }

  return (
    <div className="admin-scope" style={{
      minHeight: '100vh',
      background: 'var(--background)',
    }}>
      <style>{`
        .admin-scope button, .admin-scope a.pill-btn { min-height: 40px; }
        .admin-scope .pose-row { min-height: 0; }
        .admin-scope button, .admin-scope a.pill-btn, .admin-scope input, .admin-scope select, .admin-scope .chev {
          transition: filter var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
        }
        .admin-scope button:not(:disabled):hover, .admin-scope a.pill-btn:hover { filter: brightness(0.96); }
        .admin-scope .box-head:hover, .admin-scope .pose-row:hover { background: rgba(74, 107, 90, 0.06); filter: none; }
        .admin-scope button:not(:disabled):active, .admin-scope a.pill-btn:active { transform: translateY(1px); }
        .admin-scope button:focus-visible, .admin-scope a:focus-visible {
          outline: none; box-shadow: 0 0 0 3px rgba(74, 107, 90, 0.45);
        }
        .admin-scope input:focus, .admin-scope select:focus {
          outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(74, 107, 90, 0.18);
        }
        @media (prefers-reduced-motion: reduce) {
          .admin-scope button, .admin-scope a, .admin-scope input, .admin-scope select, .admin-scope .chev { transition: none; }
          .admin-scope button:active, .admin-scope a.pill-btn:active { transform: none; }
        }
      `}</style>
      <div style={{
        background: 'linear-gradient(180deg, rgba(74, 107, 90, 0.10), rgba(107, 143, 122, 0.04) 200px, transparent 360px)',
        padding: 'var(--space-6)',
        minHeight: '100vh',
      }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          {/* Header */}
          <div className="animate-fadeIn" style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'var(--space-4)',
            flexWrap: 'wrap',
            marginBottom: 'var(--space-4)',
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
                Group poses into boxes and set what unlocks each one. Open a box to edit it.
              </p>
            </div>
            <Link href="/admin" className="pill-btn pill-btn-outline">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back to Admin
            </Link>
          </div>

          {/* Overview + controls */}
          <div className="animate-fadeIn" style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            flexWrap: 'wrap',
            marginBottom: 'var(--space-6)',
          }}>
            <span style={statChipStyle}>
              <strong style={{ color: 'var(--primary)' }}>{groups.length}</strong> boxes
            </span>
            <span style={statChipStyle}>
              <strong style={{ color: 'var(--primary)' }}>{assignedCount}</strong> poses placed
            </span>
            {unassigned.length > 0 && (
              <span style={{ ...statChipStyle, background: '#FFF3E0', borderColor: '#FFCC80', color: '#EF6C00' }}>
                <strong>{unassigned.length}</strong> unassigned
              </span>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'auto' }}>
              {groups.length > 0 && (
                <button onClick={toggleAll} className="pill-btn pill-btn-ghost" style={{ fontSize: 'var(--text-xs)' }}>
                  {allOpen ? 'Collapse all' : 'Expand all'}
                </button>
              )}
              <button
                onClick={() => setShowCreate((s) => !s)}
                className="pill-btn pill-btn-primary"
                style={{ fontSize: 'var(--text-xs)', border: 'none' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New box
              </button>
            </div>
          </div>

          {message && (
            <div className="animate-scaleIn" style={{
              marginBottom: 'var(--space-4)',
              padding: 'var(--space-3) var(--space-4)',
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

          {/* Create box — only when asked for */}
          {showCreate && (
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
                    autoFocus
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
                  onClick={() => { setShowCreate(false); setNewName(''); setNewDescription('') }}
                  className="pill-btn pill-btn-ghost"
                >
                  Cancel
                </button>
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
          )}

          {/* Empty state */}
          {groups.length === 0 && (
            <div className="card animate-fadeInUp" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
              <p style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--ink)', marginBottom: 'var(--space-2)' }}>
                No boxes yet
              </p>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginBottom: 'var(--space-4)' }}>
                Create your first box to start grouping poses for patients.
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="pill-btn pill-btn-primary"
                style={{ border: 'none', margin: '0 auto' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New box
              </button>
            </div>
          )}

          {/* Boxes — accordion */}
          {groups.map((group, index) => {
            const groupExercises = exercises.filter((e) => e.group_id === group.id)
            const open = openBoxes.has(group.id)
            const showSettings = settingsFor.has(group.id)
            return (
              <div
                key={group.id}
                className="card animate-fadeInUp"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  marginBottom: 'var(--space-4)',
                  borderColor: open ? 'rgba(74, 107, 90, 0.35)' : 'var(--border)',
                  opacity: group.is_active ? 1 : 0.72,
                }}
              >
                {/* Collapsed header — the calm summary */}
                <button
                  type="button"
                  className="box-head"
                  onClick={() => toggleSet(setOpenBoxes, group.id)}
                  aria-expanded={open}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-4)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: 'var(--primary)',
                  }}
                >
                  <Chevron open={open} />
                  <span style={{
                    flexShrink: 0,
                    padding: 'var(--space-1) var(--space-3)',
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'white',
                    background: 'linear-gradient(160deg, var(--primary), #6B8F7A)',
                    borderRadius: 'var(--radius-full)',
                  }}>
                    Box {index + 1}
                  </span>
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <span style={{
                      display: 'block',
                      fontWeight: 600,
                      fontSize: 'var(--text-base)',
                      color: 'var(--ink)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {group.name || 'Untitled box'}
                    </span>
                    {group.description && (
                      <span style={{
                        display: 'block',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--muted)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {group.description}
                      </span>
                    )}
                  </div>
                  {!group.is_active && (
                    <span style={{
                      flexShrink: 0,
                      padding: '2px var(--space-2)',
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      borderRadius: 'var(--radius-full)',
                      background: '#EEEEEE',
                      color: '#757575',
                    }}>
                      hidden
                    </span>
                  )}
                  <span style={{
                    flexShrink: 0,
                    padding: '2px var(--space-3)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 700,
                    color: 'var(--primary)',
                    background: 'rgba(74, 107, 90, 0.10)',
                    borderRadius: 'var(--radius-full)',
                  }}>
                    {groupExercises.length} pose{groupExercises.length === 1 ? '' : 's'}
                  </span>
                </button>

                {/* Expanded body */}
                {open && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {/* Toolbar */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      padding: 'var(--space-3) var(--space-4)',
                      background: 'rgba(107, 143, 122, 0.06)',
                    }}>
                      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', flex: '1 1 auto' }}>
                        Patients unlock each pose by hitting its target on the pose before it.
                      </p>
                      <button
                        onClick={() => toggleSet(setSettingsFor, group.id)}
                        className="pill-btn pill-btn-ghost"
                        style={{ fontSize: 'var(--text-xs)' }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                        </svg>
                        {showSettings ? 'Hide settings' : 'Box settings'}
                      </button>
                    </div>

                    {/* Box settings — tucked away */}
                    {showSettings && (
                      <div style={{
                        display: 'flex',
                        gap: 'var(--space-3)',
                        flexWrap: 'wrap',
                        alignItems: 'flex-end',
                        padding: 'var(--space-4)',
                        borderTop: '1px solid var(--border)',
                        background: 'var(--surface)',
                      }}>
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
                          Visible to patients
                        </label>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'auto' }}>
                          <button
                            onClick={() => saveGroup(group)}
                            className="pill-btn pill-btn-primary"
                            style={{ fontSize: 'var(--text-xs)', border: 'none' }}
                          >
                            Save box
                          </button>
                          <button
                            onClick={() => deleteGroup(group)}
                            className="pill-btn"
                            style={{
                              fontSize: 'var(--text-xs)',
                              color: '#C62828',
                              background: '#FFEBEE',
                              border: 'none',
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Poses */}
                    {groupExercises.length > 0 ? (
                      groupExercises.map((ex, i) => exerciseRow(ex, i))
                    ) : (
                      <p style={{
                        padding: 'var(--space-4)',
                        borderTop: '1px solid var(--border)',
                        fontSize: 'var(--text-sm)',
                        color: 'var(--muted)',
                      }}>
                        No poses in this box yet — open an unassigned pose below and move it here.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Unassigned — collapsible, only matters when non-empty */}
          {unassigned.length > 0 && (
            <div className="card animate-fadeInUp" style={{
              padding: 0,
              overflow: 'hidden',
              border: '1px dashed rgba(239, 108, 0, 0.45)',
              background: 'var(--surface)',
              marginTop: 'var(--space-6)',
            }}>
              <button
                type="button"
                className="box-head"
                onClick={() => setShowUnassigned((s) => !s)}
                aria-expanded={showUnassigned}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-4)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <Chevron open={showUnassigned} />
                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 'var(--text-base)', color: 'var(--ink)' }}>
                    Unassigned poses
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                    Not on the patient map until you move them into a box.
                  </span>
                </div>
                <span style={{
                  flexShrink: 0,
                  padding: '2px var(--space-3)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 700,
                  color: '#EF6C00',
                  background: '#FFF3E0',
                  borderRadius: 'var(--radius-full)',
                }}>
                  {unassigned.length}
                </span>
              </button>
              {showUnassigned && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  {unassigned.map((ex, i) => exerciseRow(ex, i))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
