'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { StarBadge } from '@/components/StarBadge'
import { signAvatars } from '@/lib/avatar'
import { bmi, formatPhone } from '@/lib/profileFields'
import type { ProfileDetail as Profile } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

const cellStyle: React.CSSProperties = { padding: 'var(--space-3)' }

const headStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: 'left',
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  color: 'var(--muted)',
}

/** One labelled value in the expanded record. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginBottom: '2px' }}>{label}</p>
      <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', overflowWrap: 'anywhere' }}>
        {value}
      </p>
    </div>
  )
}

export default function StarConfigPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  /** Object path → signed URL, filled in one batch after the rows load. */
  const [avatarUrls, setAvatarUrls] = useState<Map<string, string>>(new Map())
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
      .select(
        'id, email, name, total_stars, is_admin, created_at, updated_at, phone, avatar_path, height_cm, weight_kg, guardian_email, guardian_notify'
      )
      .order('created_at', { ascending: false })

    if (profilesError) {
      console.error('Error loading profiles:', profilesError)
    } else if (profilesData) {
      setProfiles(profilesData as Profile[])
      // The avatars bucket is private, so every photo needs a signature. One
      // batch call for the whole table rather than one request per row.
      setAvatarUrls(await signAvatars(supabase, profilesData.map((p) => p.avatar_path)))
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
              Open a patient to see their profile, or edit their stars
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
                    <th style={{ ...headStyle, width: '56px' }}>
                      <span className="sr-only">Photo</span>
                    </th>
                    <th style={headStyle}>Name</th>
                    <th style={headStyle}>Email</th>
                    <th style={headStyle}>Phone</th>
                    <th style={headStyle}>Stars</th>
                    <th style={headStyle}>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => {
                    const expanded = expandedId === profile.id
                    const photo = profile.avatar_path
                      ? avatarUrls.get(profile.avatar_path) ?? null
                      : null
                    const toggle = () => setExpandedId(expanded ? null : profile.id)
                    const displayName = profile.name || profile.email.split('@')[0]
                    const patientBmi = bmi(profile.height_cm, profile.weight_kg)

                    return (
                      <React.Fragment key={profile.id}>
                        <tr
                          onClick={toggle}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              toggle()
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-expanded={expanded}
                          aria-label={`${displayName} — ${expanded ? 'hide' : 'show'} profile`}
                          style={{
                            borderBottom: expanded ? 'none' : '1px solid var(--border)',
                            cursor: 'pointer',
                            background: expanded ? 'rgba(74, 107, 90, 0.06)' : undefined,
                          }}
                        >
                          <td style={cellStyle}>
                            <ProfileAvatar url={photo} size={36} alt="" />
                          </td>
                          <td style={cellStyle}>
                            <p style={{ fontWeight: 600, color: 'var(--ink)' }}>
                              {displayName}
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
                          <td style={{ ...cellStyle, fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
                            {profile.email}
                          </td>
                          <td style={{ ...cellStyle, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                            {formatPhone(profile.phone)}
                          </td>
                          <td style={cellStyle}>
                            <Link
                              href={`/admin/users/${profile.id}`}
                              title="Edit stars"
                              // The row is a toggle; this cell is a link out of
                              // the page, so it must not also expand the row.
                              onClick={(event) => event.stopPropagation()}
                              style={{ textDecoration: 'none' }}
                            >
                              <StarBadge
                                as="span"
                                value={profile.total_stars}
                                starSize={14}
                                style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-1) var(--space-3)' }}
                              />
                            </Link>
                          </td>
                          <td style={{ ...cellStyle, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                            {new Date(profile.created_at).toLocaleDateString()}
                          </td>
                        </tr>

                        {expanded && (
                          <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(74, 107, 90, 0.06)' }}>
                            <td colSpan={6} style={{ padding: 'var(--space-5) var(--space-3) var(--space-6)' }}>
                              <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                <ProfileAvatar url={photo} size={96} alt={`${displayName}'s profile picture`} />

                                <div
                                  style={{
                                    flex: '1 1 320px',
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                    gap: 'var(--space-4)',
                                  }}
                                >
                                  <Fact label="Name" value={profile.name || '—'} />
                                  <Fact label="Phone" value={formatPhone(profile.phone)} />
                                  <Fact
                                    label="Height"
                                    value={profile.height_cm != null ? `${profile.height_cm} cm` : '—'}
                                  />
                                  <Fact
                                    label="Weight"
                                    value={profile.weight_kg != null ? `${profile.weight_kg} kg` : '—'}
                                  />
                                  <Fact label="BMI" value={patientBmi != null ? patientBmi.toFixed(1) : '—'} />
                                  <Fact label="Guardian email" value={profile.guardian_email || '—'} />
                                  <Fact
                                    label="Guardian emails"
                                    value={profile.guardian_notify ? 'On' : 'Off'}
                                  />
                                  <Fact label="Role" value={profile.is_admin ? 'Admin' : 'Patient'} />
                                  <Fact
                                    label="Joined"
                                    value={new Date(profile.created_at).toLocaleDateString()}
                                  />
                                  <Fact
                                    label="Last updated"
                                    value={new Date(profile.updated_at).toLocaleDateString()}
                                  />
                                </div>
                              </div>

                              <Link
                                href={`/admin/users/${profile.id}`}
                                style={{
                                  display: 'inline-block',
                                  marginTop: 'var(--space-5)',
                                  padding: 'var(--space-3) var(--space-5)',
                                  fontSize: 'var(--text-sm)',
                                  fontWeight: 600,
                                  color: 'white',
                                  background: 'var(--primary)',
                                  borderRadius: 'var(--radius-full)',
                                  textDecoration: 'none',
                                }}
                              >
                                Edit stars
                              </Link>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
