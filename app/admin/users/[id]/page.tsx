'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getTreeStage } from '@/lib/progress'
import type { ProfileSummary as Profile } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

export default function AdminUserPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stars, setStars] = useState(0)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    checkAdminAndLoadUser()
  }, [])

  async function checkAdminAndLoadUser() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push('/login')
      return
    }

    const { data: me } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!me?.is_admin) {
      router.push('/')
      return
    }

    const { data: userProfile, error } = await supabase
      .from('profiles')
      .select('id, email, name, total_stars, is_admin, created_at')
      .eq('id', params.id)
      .single()

    if (error || !userProfile) {
      console.error('Error loading user profile:', error)
      router.push('/admin')
      return
    }

    setProfile(userProfile as Profile)
    setStars(userProfile.total_stars ?? 0)
    setLoading(false)
  }

  async function saveStars() {
    if (!profile) return
    setSaving(true)
    setMessage(null)

    const cleanStars = Math.max(0, Math.floor(Number(stars) || 0))
    const supabase = createClient()
    // Direct total_stars writes are revoked from clients; admins set the
    // absolute value through this SECURITY DEFINER RPC (checks is_admin()).
    const { data, error } = await supabase
      .rpc('admin_set_stars', { p_user_id: profile.id, p_stars: cleanStars })

    if (error) {
      console.error('Error updating stars:', error)
      setMessage('Failed to save stars. Please try again.')
    } else {
      const saved = typeof data === 'number' ? data : cleanStars
      setStars(saved)
      setProfile({ ...profile, total_stars: saved })
      setMessage('Stars saved!')
    }

    setSaving(false)
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
        <p style={{ color: 'var(--muted)' }}>Loading user profile...</p>
      </div>
    )
  }

  if (!profile) {
    return null
  }

  const treeStage = getTreeStage(Math.max(0, Math.floor(Number(stars) || 0)))

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--background)',
      padding: 'var(--space-6)',
    }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
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
              {profile.name || profile.email.split('@')[0]}
            </h1>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--muted)' }}>
              {profile.email}
            </p>
          </div>
          <Link
            href="/starconfig"
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
            Back to Star Config
          </Link>
        </div>

        {/* Star Editor */}
        <div style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-6)',
          border: '1px solid var(--border)',
          marginBottom: 'var(--space-6)',
        }}>
          <h2 style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 600,
            color: 'var(--ink)',
            marginBottom: 'var(--space-4)',
          }}>
            Total Stars
          </h2>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <span className="star-badge">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
              </svg>
              <span>{profile.total_stars}</span>
            </span>

            <input
              type="number"
              min={0}
              step={1}
              value={stars}
              onChange={(e) => setStars(Number(e.target.value))}
              style={{
                width: '120px',
                padding: 'var(--space-3)',
                fontSize: 'var(--text-base)',
                fontWeight: 600,
                color: 'var(--ink)',
                background: 'var(--background)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
              }}
            />

            <button
              onClick={saveStars}
              disabled={saving}
              style={{
                padding: 'var(--space-3) var(--space-5)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'white',
                background: 'var(--primary)',
                border: 'none',
                borderRadius: 'var(--radius-full)',
                cursor: saving ? 'wait' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save Stars'}
            </button>
          </div>

          <p style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--muted)',
            marginTop: 'var(--space-3)',
          }}>
            Tree stage at this count: <strong style={{ color: 'var(--ink)' }}>{treeStage}</strong>.
            The patient sees the new value next time their home page loads.
          </p>

          {message && (
            <p style={{
              marginTop: 'var(--space-3)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: message === 'Stars saved!' ? '#2E7D32' : '#C62828',
            }}>
              {message}
            </p>
          )}
        </div>

        {/* User Info */}
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
            Account
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginBottom: 'var(--space-2)' }}>
            Role: <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{profile.is_admin ? 'Admin' : 'Patient'}</span>
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
            Joined: <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{new Date(profile.created_at).toLocaleDateString()}</span>
          </p>
        </div>
      </div>
    </div>
  )
}
