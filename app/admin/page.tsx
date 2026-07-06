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

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--background)',
      }}>
        <p style={{ color: 'var(--muted)' }}>Loading admin dashboard...</p>
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
      padding: 'var(--space-6)',
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-8)',
        }}>
          <div>
            <h1 style={{
              fontSize: 'var(--text-3xl)',
              fontWeight: 600,
              fontFamily: 'var(--font-display)',
              color: 'var(--ink)',
              marginBottom: 'var(--space-2)',
            }}>
              Admin Dashboard
            </h1>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--muted)' }}>
              Manage therapy exercises and poses
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <Link
              href="/"
              style={{
                padding: 'var(--space-3) var(--space-5)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--ink)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-full)',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Back to Home
            </Link>
            <Link
              href="/admin/exercises/new"
              style={{
                padding: 'var(--space-3) var(--space-5)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'white',
                background: 'var(--primary)',
                border: 'none',
                borderRadius: 'var(--radius-full)',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              + Create New Exercise
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
          <div style={{
            background: 'var(--surface)',
            borderRadius: 'var(--radius-xl)',
            padding: 'var(--space-6)',
            border: '1px solid var(--border)',
          }}>
            <p style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--muted)',
              marginBottom: 'var(--space-2)',
            }}>
              Total Exercises
            </p>
            <p style={{
              fontSize: 'var(--text-3xl)',
              fontWeight: 700,
              color: 'var(--ink)',
            }}>
              {exercises.length}
            </p>
          </div>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 'var(--radius-xl)',
            padding: 'var(--space-6)',
            border: '1px solid var(--border)',
          }}>
            <p style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--muted)',
              marginBottom: 'var(--space-2)',
            }}>
              Active Exercises
            </p>
            <p style={{
              fontSize: 'var(--text-3xl)',
              fontWeight: 700,
              color: 'var(--primary)',
            }}>
              {exercises.filter(e => e.is_active).length}
            </p>
          </div>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 'var(--radius-xl)',
            padding: 'var(--space-6)',
            border: '1px solid var(--border)',
          }}>
            <p style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--muted)',
              marginBottom: 'var(--space-2)',
            }}>
              Patients
            </p>
            <p style={{
              fontSize: 'var(--text-3xl)',
              fontWeight: 700,
              color: 'var(--ink)',
            }}>
              {profiles.length}
            </p>
          </div>
        </div>

        {/* Exercises Table */}
        <div style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-6)',
          border: '1px solid var(--border)',
        }}>
          <h2 style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 600,
            color: 'var(--ink)',
            marginBottom: 'var(--space-4)',
          }}>
            All Exercises
          </h2>

          {exercises.length === 0 ? (
            <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 'var(--space-8)' }}>
              No exercises yet. Create your first one!
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: 'var(--space-3)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--muted)' }}>
                      Name
                    </th>
                    <th style={{ padding: 'var(--space-3)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--muted)' }}>
                      Type
                    </th>
                    <th style={{ padding: 'var(--space-3)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--muted)' }}>
                      Difficulty
                    </th>
                    <th style={{ padding: 'var(--space-3)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--muted)' }}>
                      Target Reps
                    </th>
                    <th style={{ padding: 'var(--space-3)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--muted)' }}>
                      Status
                    </th>
                    <th style={{ padding: 'var(--space-3)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--muted)' }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {exercises.map((exercise) => (
                    <tr key={exercise.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <div>
                          <p style={{ fontWeight: 600, color: 'var(--ink)' }}>{exercise.name}</p>
                          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>{exercise.description}</p>
                        </div>
                      </td>
                      <td style={{ padding: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                        {exercise.exercise_type}
                      </td>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <span style={{
                          padding: 'var(--space-1) var(--space-3)',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 600,
                          borderRadius: 'var(--radius-full)',
                          background: exercise.difficulty === 'beginner' ? '#E8F5E9' : exercise.difficulty === 'intermediate' ? '#FFF3E0' : '#FFEBEE',
                          color: exercise.difficulty === 'beginner' ? '#2E7D32' : exercise.difficulty === 'intermediate' ? '#EF6C00' : '#C62828',
                        }}>
                          {exercise.difficulty}
                        </span>
                      </td>
                      <td style={{ padding: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                        {exercise.target_reps}
                      </td>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <button
                          onClick={() => toggleExerciseStatus(exercise.id, exercise.is_active)}
                          style={{
                            padding: 'var(--space-1) var(--space-3)',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 600,
                            borderRadius: 'var(--radius-full)',
                            border: 'none',
                            cursor: 'pointer',
                            background: exercise.is_active ? '#E8F5E9' : '#E0E0E0',
                            color: exercise.is_active ? '#2E7D32' : '#757575',
                          }}
                        >
                          {exercise.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <Link
                          href={`/admin/exercises/${exercise.id}/edit`}
                          style={{
                            fontSize: 'var(--text-sm)',
                            color: 'var(--primary)',
                            textDecoration: 'none',
                            fontWeight: 600,
                          }}
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
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
          <Link
            href="/starconfig"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-3) var(--space-6)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: 'white',
              background: 'var(--primary)',
              border: 'none',
              borderRadius: 'var(--radius-full)',
              textDecoration: 'none',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
            </svg>
            Star Config
          </Link>
        </div>
      </div>
    </div>
  )
}
