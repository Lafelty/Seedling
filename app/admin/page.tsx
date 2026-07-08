'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

interface Exercise {
  id: string
  name: string
  description: string
  exercise_type: string
  difficulty: string
  target_reps: number
  is_active: boolean
  created_at: string
}

interface Profile {
  id: string
  email: string
  name: string | null
  total_stars: number
  is_admin: boolean
  created_at: string
}

const DIFFICULTY_STYLES: Record<string, { bg: string; fg: string }> = {
  beginner: { bg: '#E8F5E9', fg: '#2E7D32' },
  intermediate: { bg: '#FFF3E0', fg: '#EF6C00' },
  advanced: { bg: '#FFEBEE', fg: '#C62828' },
}

export default function AdminDashboard() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])

  useEffect(() => {
    checkAdminAndLoadExercises()
  }, [])

  async function checkAdminAndLoadExercises() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push('/login')
      return
    }

    // Check if user is admin
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

    // Load exercises
    const { data: exercisesData } = await supabase
      .from('exercises')
      .select('*')
      .order('created_at', { ascending: false })

    if (exercisesData) {
      setExercises(exercisesData as Exercise[])
    }

    // Load users (requires supabase/stars_migration.sql: total_stars column
    // + admin visibility on all profiles)
    const { data: profilesData, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, name, total_stars, is_admin, created_at')
      .order('created_at', { ascending: false })

    if (profilesError) {
      console.error('Error loading profiles (run stars_migration.sql?):', profilesError)
    } else if (profilesData) {
      setProfiles(profilesData as Profile[])
    }

    setLoading(false)
  }

  async function toggleExerciseStatus(id: string, currentStatus: boolean) {
    const supabase = createClient()
    const { error } = await supabase
      .from('exercises')
      .update({ is_active: !currentStatus })
      .eq('id', id)

    if (!error) {
      setExercises(exercises.map(ex =>
        ex.id === id ? { ...ex, is_active: !currentStatus } : ex
      ))
    }
  }

  async function deleteExercise(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return

    const supabase = createClient()
    const { error } = await supabase
      .from('exercises')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting exercise:', error)
      window.alert(`Could not delete exercise: ${error.message}`)
      return
    }

    setExercises(exercises.filter(ex => ex.id !== id))
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
          <p style={{ color: 'var(--muted)' }}>Loading admin dashboard...</p>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return null
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--background)',
    }}>
      <div style={{
        background: 'linear-gradient(180deg, rgba(74, 107, 90, 0.10), rgba(107, 143, 122, 0.04) 240px, transparent 420px)',
        padding: 'var(--space-6)',
        minHeight: '100vh',
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
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
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
                    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
                  </svg>
                </div>
                <h1 style={{
                  fontSize: 'var(--text-3xl)',
                  fontWeight: 600,
                  fontFamily: 'var(--font-display)',
                  color: 'var(--primary)',
                }}>
                  Admin Dashboard
                </h1>
              </div>
              <p style={{ fontSize: 'var(--text-base)', color: 'var(--muted)' }}>
                Tend the garden — manage exercises, boxes, and patients
              </p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Link href="/" className="pill-btn pill-btn-ghost">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 11l9-8 9 8" />
                  <path d="M5 9v11h14V9" />
                </svg>
                Home
              </Link>
              <Link href="/admin/groups" className="pill-btn pill-btn-outline">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                Manage Boxes
              </Link>
              <Link href="/admin/exercises/new" className="pill-btn pill-btn-primary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New Exercise
              </Link>
            </div>
          </div>

          {/* Stats Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-8)',
          }}>
            <div className="card animate-scaleIn stagger-1" style={{
              background: 'linear-gradient(160deg, rgba(74, 107, 90, 0.14), var(--surface) 70%)',
              borderColor: 'rgba(74, 107, 90, 0.25)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(74, 107, 90, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22v-7" />
                    <path d="M12 15q-6 0-7-8 7 1 7 8Z" />
                    <path d="M12 13q0-6 7-9-1 9-7 9Z" />
                  </svg>
                </div>
                <div>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', fontWeight: 600 }}>
                    Total Exercises
                  </p>
                  <p style={{
                    fontSize: 'var(--text-3xl)',
                    fontWeight: 700,
                    fontFamily: 'var(--font-display)',
                    color: 'var(--primary)',
                    lineHeight: 1.1,
                  }}>
                    {exercises.length}
                  </p>
                </div>
              </div>
            </div>

            <div className="card animate-scaleIn stagger-2" style={{
              background: 'linear-gradient(160deg, rgba(107, 143, 122, 0.16), var(--surface) 70%)',
              borderColor: 'rgba(74, 107, 90, 0.25)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(107, 143, 122, 0.18)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M10 8l6 4-6 4z" fill="var(--primary)" stroke="none" />
                  </svg>
                </div>
                <div>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', fontWeight: 600 }}>
                    Active Exercises
                  </p>
                  <p style={{
                    fontSize: 'var(--text-3xl)',
                    fontWeight: 700,
                    fontFamily: 'var(--font-display)',
                    color: 'var(--primary)',
                    lineHeight: 1.1,
                  }}>
                    {exercises.filter(e => e.is_active).length}
                  </p>
                </div>
              </div>
            </div>

            <div className="card animate-scaleIn stagger-3" style={{
              background: 'linear-gradient(160deg, rgba(201, 184, 138, 0.20), var(--surface) 70%)',
              borderColor: 'rgba(74, 107, 90, 0.25)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(201, 184, 138, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8A7A4E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
                    <circle cx="10" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', fontWeight: 600 }}>
                    Patients
                  </p>
                  <p style={{
                    fontSize: 'var(--text-3xl)',
                    fontWeight: 700,
                    fontFamily: 'var(--font-display)',
                    color: '#8A7A4E',
                    lineHeight: 1.1,
                  }}>
                    {profiles.length}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Exercises Table */}
          <div className="card animate-fadeInUp" style={{
            background: 'linear-gradient(180deg, rgba(107, 143, 122, 0.07), var(--surface) 50%)',
            borderColor: 'rgba(74, 107, 90, 0.20)',
            padding: 0,
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
              padding: 'var(--space-5) var(--space-6)',
            }}>
              <h2 style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 600,
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22v-7" />
                  <path d="M12 15q-6 0-7-8 7 1 7 8Z" />
                  <path d="M12 13q0-6 7-9-1 9-7 9Z" />
                </svg>
                All Exercises
              </h2>
              <span style={{
                fontSize: 'var(--text-xs)',
                fontWeight: 700,
                color: 'var(--primary)',
                background: 'rgba(74, 107, 90, 0.10)',
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-full)',
              }}>
                {exercises.filter(e => e.is_active).length} live
              </span>
            </div>

            {exercises.length === 0 ? (
              <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 'var(--space-12)' }}>
                No exercises yet. Create your first one!
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'rgba(74, 107, 90, 0.06)' }}>
                      {['Name', 'Type', 'Difficulty', 'Target Reps', 'Status', 'Actions'].map((h) => (
                        <th key={h} style={{
                          padding: 'var(--space-3) var(--space-4)',
                          textAlign: 'left',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 700,
                          color: 'var(--primary)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {exercises.map((exercise) => {
                      const diffStyle = DIFFICULTY_STYLES[exercise.difficulty] ?? DIFFICULTY_STYLES.beginner
                      return (
                        <tr key={exercise.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                            <div>
                              <p style={{ fontWeight: 600, color: 'var(--ink)' }}>{exercise.name}</p>
                              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>{exercise.description}</p>
                            </div>
                          </td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                            {exercise.exercise_type}
                          </td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                            <span style={{
                              padding: 'var(--space-1) var(--space-3)',
                              fontSize: 'var(--text-xs)',
                              fontWeight: 600,
                              borderRadius: 'var(--radius-full)',
                              background: diffStyle.bg,
                              color: diffStyle.fg,
                            }}>
                              {exercise.difficulty}
                            </span>
                          </td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                            {exercise.target_reps}
                          </td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                            <button
                              onClick={() => toggleExerciseStatus(exercise.id, exercise.is_active)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 'var(--space-1)',
                                padding: 'var(--space-1) var(--space-3)',
                                fontSize: 'var(--text-xs)',
                                fontWeight: 600,
                                borderRadius: 'var(--radius-full)',
                                border: 'none',
                                cursor: 'pointer',
                                background: exercise.is_active ? '#E8F5E9' : '#EEEEEE',
                                color: exercise.is_active ? '#2E7D32' : '#757575',
                              }}
                            >
                              <span style={{
                                width: '7px',
                                height: '7px',
                                borderRadius: '50%',
                                background: exercise.is_active ? '#2E7D32' : '#9E9E9E',
                                display: 'inline-block',
                              }} />
                              {exercise.is_active ? 'Active' : 'Inactive'}
                            </button>
                          </td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                              <Link
                                href={`/admin/exercises/${exercise.id}/edit`}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 'var(--space-1)',
                                  padding: 'var(--space-1) var(--space-3)',
                                  fontSize: 'var(--text-xs)',
                                  fontWeight: 600,
                                  color: 'var(--primary)',
                                  background: 'rgba(74, 107, 90, 0.10)',
                                  border: '1px solid rgba(74, 107, 90, 0.25)',
                                  borderRadius: 'var(--radius-full)',
                                  textDecoration: 'none',
                                }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                </svg>
                                Edit
                              </Link>
                              <button
                                onClick={() => deleteExercise(exercise.id, exercise.name)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 'var(--space-1)',
                                  padding: 'var(--space-1) var(--space-3)',
                                  fontSize: 'var(--text-xs)',
                                  fontWeight: 600,
                                  color: '#C62828',
                                  background: '#FFEBEE',
                                  border: '1px solid rgba(198, 40, 40, 0.25)',
                                  borderRadius: 'var(--radius-full)',
                                  cursor: 'pointer',
                                }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 6h18" />
                                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                </svg>
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Star Config */}
          <div style={{
            marginTop: 'var(--space-8)',
            display: 'flex',
            justifyContent: 'center',
          }}>
            <Link href="/starconfig" className="pill-btn pill-btn-primary" style={{ padding: 'var(--space-3) var(--space-6)' }}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
              </svg>
              Star Config
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
