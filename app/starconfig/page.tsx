'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { ProfileSummary as Profile } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

export default function StarConfigPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])

  useEffect(() => {
    checkAdminAndLoadUsers()
  }, [])

  async function checkAdminAndLoadUsers() {
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

    const { data: profilesData, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, name, total_stars, is_admin, created_at')
      .order('created_at', { ascending: false })

    if (profilesError) {
      console.error('Error loading profiles:', profilesError)
    } else if (profilesData) {
      setProfiles(profilesData as Profile[])
    }

    setLoading(false)
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
        <p style={{ color: 'var(--muted)' }}>Loading star config...</p>
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
              Star Config
            </h1>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--muted)' }}>
              View patients and edit their stars
            </p>
          </div>
          <Link
            href="/admin"
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
            Back to Admin
          </Link>
        </div>

        {/* Patients Table */}
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
            Patients
          </h2>

          {profiles.length === 0 ? (
            <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 'var(--space-8)' }}>
              No users found.
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
                      Email
                    </th>
                    <th style={{ padding: 'var(--space-3)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--muted)' }}>
                      Stars
                    </th>
                    <th style={{ padding: 'var(--space-3)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--muted)' }}>
                      Joined
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <p style={{ fontWeight: 600, color: 'var(--ink)' }}>
                          {profile.name || profile.email.split('@')[0]}
                          {profile.is_admin && (
                            <span style={{
                              marginLeft: 'var(--space-2)',
                              padding: 'var(--space-1) var(--space-2)',
                              fontSize: 'var(--text-xs)',
                              fontWeight: 600,
                              borderRadius: 'var(--radius-full)',
                              background: '#E3F2FD',
                              color: '#1565C0',
                            }}>
                              admin
                            </span>
                          )}
                        </p>
                      </td>
                      <td style={{ padding: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
                        {profile.email}
                      </td>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <Link
                          href={`/admin/users/${profile.id}`}
                          title="Edit stars"
                          className="star-badge"
                          style={{ textDecoration: 'none', fontSize: 'var(--text-sm)', padding: 'var(--space-1) var(--space-3)' }}
                        >
                          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
                          </svg>
                          <span>{profile.total_stars}</span>
                        </Link>
                      </td>
                      <td style={{ padding: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                        {new Date(profile.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
