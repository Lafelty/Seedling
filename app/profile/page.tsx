'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--space-3)',
  fontSize: 'var(--text-base)',
  color: 'var(--ink)',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  color: 'var(--ink)',
  marginBottom: 'var(--space-1)',
}

function ProfileSkeleton() {
  return (
    <main className="min-h-screen max-w-xl mx-auto px-4 py-8 pb-16">
      <div className="mb-8">
        <div className="skeleton" style={{ width: '120px', height: '14px', marginBottom: 'var(--space-3)' }} />
        <div className="skeleton" style={{ width: '180px', height: '32px', marginBottom: 'var(--space-2)' }} />
        <div className="skeleton" style={{ width: '220px', height: '16px' }} />
      </div>
      <div className="skeleton" style={{ height: '210px', borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-6)' }} />
      <div className="skeleton" style={{ height: '200px', borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-6)' }} />
      <div className="skeleton" style={{ height: '56px', borderRadius: 'var(--radius-full)' }} />
    </main>
  )
}

export default function ProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [guardianEmail, setGuardianEmail] = useState('')
  const [guardianNotify, setGuardianNotify] = useState(false)

  useEffect(() => {
    loadProfile()
  }, [])

  async function loadProfile() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('email, name, height_cm, weight_kg, guardian_email, guardian_notify')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('Error loading profile:', error)
      setMessage('Failed to load profile. Check your connection and refresh.')
      setLoading(false)
      return
    }

    if (profile) {
      setEmail(profile.email ?? '')
      setName(profile.name ?? '')
      setHeightCm(profile.height_cm != null ? String(profile.height_cm) : '')
      setWeightKg(profile.weight_kg != null ? String(profile.weight_kg) : '')
      setGuardianEmail(profile.guardian_email ?? '')
      setGuardianNotify(!!profile.guardian_notify)
    }
    setLoading(false)
  }

  async function saveProfile() {
    setSaving(true)
    setMessage(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const height = heightCm.trim() === '' ? null : Number(heightCm)
    const weight = weightKg.trim() === '' ? null : Number(weightKg)
    const guardian = guardianEmail.trim() || null

    if (height != null && (Number.isNaN(height) || height < 50 || height > 250)) {
      setMessage('Height should be between 50 and 250 cm.')
      setSaving(false)
      return
    }
    if (weight != null && (Number.isNaN(weight) || weight < 20 || weight > 300)) {
      setMessage('Weight should be between 20 and 300 kg.')
      setSaving(false)
      return
    }
    if (guardianNotify && !guardian) {
      setMessage('Add a guardian email or turn notifications off.')
      setSaving(false)
      return
    }
    if (guardian && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardian)) {
      setMessage('Guardian email looks invalid.')
      setSaving(false)
      return
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        name: name.trim() || null,
        height_cm: height,
        weight_kg: weight,
        guardian_email: guardian,
        guardian_notify: guardianNotify,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (error) {
      console.error('Error saving profile:', error)
      setMessage('Failed to save. Please try again.')
    } else {
      setMessage('Profile saved!')
    }
    setSaving(false)
  }

  if (loading) {
    return <ProfileSkeleton />
  }

  return (
    <main
      className="min-h-screen max-w-xl mx-auto px-4 py-8 pb-16"
      style={{ background: 'linear-gradient(180deg, rgba(74, 107, 90, 0.07), transparent 320px)' }}
    >
      {/* Header */}
      <div className="mb-8 animate-fadeIn">
        <Link
          href="/"
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
          Back to Garden
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <h1 style={{ color: 'var(--primary)' }}>My Profile</h1>
        </div>
        <p style={{ color: 'var(--muted)' }}>{email}</p>
      </div>

      {/* About you */}
      <div className="card mb-6 animate-fadeInUp" style={{
        background: 'linear-gradient(180deg, rgba(107, 143, 122, 0.08), var(--surface) 55%)',
        borderColor: 'rgba(74, 107, 90, 0.20)',
      }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--primary)', marginBottom: 'var(--space-4)' }}>
          About you
        </h2>

        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={labelStyle} htmlFor="profile-name">Name</label>
          <input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div>
            <label style={labelStyle} htmlFor="profile-height">Height (cm)</label>
            <input
              id="profile-height"
              type="number"
              inputMode="decimal"
              min={50}
              max={250}
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="e.g. 165"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="profile-weight">Weight (kg)</label>
            <input
              id="profile-weight"
              type="number"
              inputMode="decimal"
              min={20}
              max={300}
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="e.g. 60"
              style={inputStyle}
            />
          </div>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 'var(--space-2)' }}>
          Helps your therapist tailor exercises to you.
        </p>
      </div>

      {/* Guardian */}
      <div className="card mb-6 animate-fadeInUp" style={{
        background: 'linear-gradient(180deg, rgba(201, 184, 138, 0.12), var(--surface) 55%)',
        borderColor: 'rgba(74, 107, 90, 0.20)',
      }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--primary)', marginBottom: 'var(--space-2)' }}>
          Guardian updates
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginBottom: 'var(--space-4)' }}>
          A family member or caregiver gets a short email each time you complete a session.
        </p>

        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={labelStyle} htmlFor="guardian-email">Guardian email</label>
          <input
            id="guardian-email"
            type="email"
            value={guardianEmail}
            onChange={(e) => setGuardianEmail(e.target.value)}
            placeholder="family@example.com"
            style={inputStyle}
          />
        </div>

        {/* Toggle */}
        <button
          onClick={() => setGuardianNotify(!guardianNotify)}
          role="switch"
          aria-checked={guardianNotify}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            width: '100%',
            padding: 'var(--space-3)',
            background: guardianNotify ? 'rgba(74, 107, 90, 0.10)' : 'var(--surface)',
            border: `1px solid ${guardianNotify ? 'rgba(74, 107, 90, 0.35)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-lg)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span
            style={{
              width: '44px',
              height: '26px',
              borderRadius: 'var(--radius-full)',
              background: guardianNotify ? 'var(--primary)' : 'var(--border)',
              position: 'relative',
              flexShrink: 0,
              transition: 'background 200ms ease',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: '3px',
                left: guardianNotify ? '21px' : '3px',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: 'white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                transition: 'left 200ms ease',
              }}
            />
          </span>
          <span>
            <span style={{ display: 'block', fontWeight: 600, color: 'var(--ink)', fontSize: 'var(--text-sm)' }}>
              Email my guardian after each session
            </span>
            <span style={{ display: 'block', color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '2px' }}>
              {guardianNotify ? 'On — they get a summary with your results' : 'Off — no emails are sent'}
            </span>
          </span>
        </button>
      </div>

      {message && (
        <p
          className="animate-scaleIn"
          style={{
            marginBottom: 'var(--space-4)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: message === 'Profile saved!' ? '#2E7D32' : '#C62828',
          }}
        >
          {message}
        </p>
      )}

      <button
        onClick={saveProfile}
        disabled={saving}
        className="btn btn-primary w-full"
        style={{ opacity: saving ? 0.7 : 1, cursor: saving ? 'wait' : 'pointer' }}
      >
        {saving ? 'Saving...' : 'Save Profile'}
      </button>
    </main>
  )
}
