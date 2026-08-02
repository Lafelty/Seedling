'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { SmoothInput } from '@/components/SmoothInput'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { SavedOverlay } from '@/components/SavedOverlay'
import {
  AVATAR_BUCKET,
  avatarObjectPath,
  rejectAvatar,
  removeAvatar,
  signAvatar,
} from '@/lib/avatar'
import {
  HEIGHT_CM,
  isValidPhone,
  normalizePhone,
  optionsWithStored,
  rangeOptions,
  WEIGHT_KG,
} from '@/lib/profileFields'

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

/** Native select, sized to match the text fields it sits beside. */
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  // Native selects ignore the shared padding on some mobile browsers unless the
  // height is stated, which would leave the two fields visibly different.
  minHeight: '48px',
  appearance: 'none',
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%234A6B5A' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right var(--space-3) center',
  paddingRight: 'var(--space-8)',
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
      <div className="skeleton" style={{ height: '56px', borderRadius: 'var(--radius-full)', marginBottom: 'var(--space-6)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
        <div className="skeleton" style={{ width: '76px', height: '76px', borderRadius: '50%', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div className="skeleton" style={{ width: '180px', height: '32px', marginBottom: 'var(--space-2)' }} />
          <div className="skeleton" style={{ width: '220px', height: '16px' }} />
        </div>
      </div>
      <div className="skeleton" style={{ height: '270px', borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-6)' }} />
      <div className="skeleton" style={{ height: '200px', borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-6)' }} />
      <div className="skeleton" style={{ height: '56px', borderRadius: 'var(--radius-full)' }} />
    </main>
  )
}

export default function ProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  /** Problems only — a successful save is announced by the overlay instead. */
  const [message, setMessage] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  /** Empty string means "not set" — the column is nullable. */
  const [heightCm, setHeightCm] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [heightOptions, setHeightOptions] = useState<number[]>(() =>
    rangeOptions(HEIGHT_CM.min, HEIGHT_CM.max)
  )
  const [weightOptions, setWeightOptions] = useState<number[]>(() =>
    rangeOptions(WEIGHT_KG.min, WEIGHT_KG.max)
  )

  /** The object path the row currently holds, so a replaced photo can be cleaned up. */
  const [committedAvatar, setCommittedAvatar] = useState<string | null>(null)
  const [avatarPath, setAvatarPath] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  // Read-only: the guardian card is locked (see below), but showing what is
  // already stored is still worth doing.
  const [guardianEmail, setGuardianEmail] = useState('')
  const [guardianNotify, setGuardianNotify] = useState(false)

  useEffect(() => {
    loadProfile()
  }, [])

  // The preview is an object URL over the picked file; the browser holds the
  // blob until it is revoked.
  useEffect(() => {
    return () => {
      if (avatarUrl?.startsWith('blob:')) URL.revokeObjectURL(avatarUrl)
    }
  }, [avatarUrl])

  async function loadProfile() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('email, name, phone, avatar_path, height_cm, weight_kg, guardian_email, guardian_notify')
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
      setPhone(profile.phone ?? '')
      setHeightCm(profile.height_cm != null ? String(profile.height_cm) : '')
      setWeightKg(profile.weight_kg != null ? String(profile.weight_kg) : '')
      // Whatever is already stored stays selectable even when it predates the
      // dropdown — otherwise saving anything would quietly rewrite it.
      setHeightOptions(optionsWithStored(HEIGHT_CM.min, HEIGHT_CM.max, profile.height_cm))
      setWeightOptions(optionsWithStored(WEIGHT_KG.min, WEIGHT_KG.max, profile.weight_kg))
      setGuardianEmail(profile.guardian_email ?? '')
      setGuardianNotify(!!profile.guardian_notify)

      setCommittedAvatar(profile.avatar_path)
      setAvatarPath(profile.avatar_path)
      setAvatarUrl(await signAvatar(supabase, profile.avatar_path))
    }
    setLoading(false)
  }

  /**
   * Uploads straight away and holds the new path in state; Save Profile is what
   * points the row at it. Same shape as the exercise editor's demo pictures.
   */
  async function pickAvatar(file: File) {
    const problem = rejectAvatar(file)
    if (problem) {
      setMessage(problem)
      return
    }

    setUploading(true)
    setMessage(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    // The leading folder must be the user's own id — that is what the storage
    // policy checks.
    const path = avatarObjectPath(user.id, file)
    const { error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { contentType: file.type })

    if (error) {
      console.error('Error uploading avatar:', error)
      setMessage('Picture upload failed. Please try again.')
      setUploading(false)
      return
    }

    setAvatarPath(path)
    // Preview from the local file rather than a fresh signed URL: it is already
    // in memory, and it renders instantly.
    setAvatarUrl((previous) => {
      if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous)
      return URL.createObjectURL(file)
    })
    setUploading(false)
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

    if (!isValidPhone(phone)) {
      setMessage('That phone number does not look right — 8 to 15 digits.')
      setSaving(false)
      return
    }

    // Height and weight come from dropdowns now, so there is nothing left to
    // range-check: every option is already a value the column accepts.
    const { error } = await supabase
      .from('profiles')
      .update({
        name: name.trim() || null,
        phone: normalizePhone(phone) || null,
        height_cm: heightCm === '' ? null : Number(heightCm),
        weight_kg: weightKg === '' ? null : Number(weightKg),
        avatar_path: avatarPath,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (error) {
      console.error('Error saving profile:', error)
      setMessage('Failed to save. Please try again.')
      setSaving(false)
      return
    }

    // Only once the row points at the new object is the old one safe to drop.
    if (committedAvatar && committedAvatar !== avatarPath) {
      await removeAvatar(supabase, committedAvatar)
    }
    setCommittedAvatar(avatarPath)
    setSaved(true)
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
      {/* Back to the garden. /profile sits outside the (dashboard) route group,
          so there is no bottom nav here — this is the only way out, and it is
          sized to say so. */}
      <Link
        href="/"
        className="btn btn-back w-full animate-fadeIn"
        style={{ marginBottom: 'var(--space-6)' }}
      >
        <svg className="btn-back-chevron" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to Garden
        {/* The same canopy the bottom nav uses for Garden — the button carries
            the mark of where it lands. */}
        <svg className="btn-back-garden" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z" />
          <path d="M12 19v3" />
        </svg>
      </Link>

      {/* Header: photo, then who this is */}
      <div
        className="mb-8 animate-fadeIn"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}
      >
        <ProfileAvatar
          url={avatarUrl}
          size={76}
          editable
          uploading={uploading}
          onPick={pickAvatar}
          alt={name ? `${name}'s profile picture` : 'Your profile picture'}
        />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ color: 'var(--primary)', marginBottom: '2px' }}>My Profile</h1>
          <p style={{ color: 'var(--muted)', overflowWrap: 'anywhere' }}>{email}</p>
        </div>
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
          <SmoothInput
            id="profile-name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={labelStyle} htmlFor="profile-phone">Phone number</label>
          <SmoothInput
            id="profile-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="081-234-5678"
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div>
            <label style={labelStyle} htmlFor="profile-height">Height (cm)</label>
            <select
              id="profile-height"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              style={selectStyle}
            >
              <option value="">Not set</option>
              {heightOptions.map((cm) => (
                <option key={cm} value={cm}>{cm}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="profile-weight">Weight (kg)</label>
            <select
              id="profile-weight"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              style={selectStyle}
            >
              <option value="">Not set</option>
              {weightOptions.map((kg) => (
                <option key={kg} value={kg}>{kg}</option>
              ))}
            </select>
          </div>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 'var(--space-2)' }}>
          Helps your therapist tailor exercises to you.
        </p>
      </div>

      {/* Guardian — locked. /api/notify-guardian needs RESEND_API_KEY, which is
          not configured, so the route returns { skipped: 'no-api-key' } every
          time. A card that promises email nobody receives is worse than one that
          says it is not ready yet. Stored values are left untouched, so nothing
          is lost when the key is set. */}
      <div className="card mb-6 animate-fadeInUp" style={{
        position: 'relative',
        background: 'linear-gradient(180deg, rgba(201, 184, 138, 0.12), var(--surface) 55%)',
        borderColor: 'rgba(74, 107, 90, 0.20)',
      }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--primary)', marginBottom: 'var(--space-2)' }}>
          Guardian updates
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginBottom: 'var(--space-4)' }}>
          A family member or caregiver gets a short email each time you complete a session.
        </p>

        {/* A disabled fieldset turns off every control inside it natively, and
            keeps them announced as disabled rather than hidden. The grey sheet
            below is what says so on screen; this is what says so to a keyboard
            and a screen reader. */}
        <fieldset
          disabled
          style={{ border: 'none', padding: 0, margin: 0, minInlineSize: 0 }}
        >
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label style={labelStyle} htmlFor="guardian-email">Guardian email</label>
            <SmoothInput
              id="guardian-email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              readOnly
              value={guardianEmail}
              placeholder="family@example.com"
              style={{ ...inputStyle, cursor: 'not-allowed' }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              width: '100%',
              padding: 'var(--space-3)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
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
                }}
              />
            </span>
            <span>
              <span style={{ display: 'block', fontWeight: 600, color: 'var(--ink)', fontSize: 'var(--text-sm)' }}>
                Email my guardian after each session
              </span>
              <span style={{ display: 'block', color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '2px' }}>
                Off — no emails are sent
              </span>
            </span>
          </div>
        </fieldset>

        {/* The grey sheet over the whole card. Decorative — the disabled
            fieldset underneath is what actually stops anyone reaching the
            fields; this is only how it looks. `inset: -1px` covers the card's
            own border, so the sheet ends where the card does rather than
            leaving a bright rim around it. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: '-1px',
            display: 'grid',
            placeItems: 'center',
            gap: 'var(--space-2)',
            alignContent: 'center',
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(96, 100, 96, 0.55)',
            backdropFilter: 'grayscale(1)',
            WebkitBackdropFilter: 'grayscale(1)',
          }}
        >
          <svg
            width="46"
            height="46"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35))' }}
          >
            <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
            <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
          </svg>
          <span
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 700,
              color: 'white',
              textShadow: '0 1px 4px rgba(0, 0, 0, 0.4)',
            }}
          >
            Not available yet
          </span>
        </div>
      </div>

      {message && (
        <p
          className="animate-scaleIn"
          style={{
            marginBottom: 'var(--space-4)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: '#C62828',
          }}
        >
          {message}
        </p>
      )}

      <button
        onClick={saveProfile}
        disabled={saving || uploading}
        className="btn btn-primary w-full"
        style={{ opacity: saving || uploading ? 0.7 : 1, cursor: saving ? 'wait' : 'pointer' }}
      >
        {saving ? 'Saving...' : uploading ? 'Uploading picture...' : 'Save Profile'}
      </button>

      {saved && <SavedOverlay onDone={() => setSaved(false)} />}
    </main>
  )
}
