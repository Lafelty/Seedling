'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SmoothInput } from '@/components/SmoothInput'
import { AvatarCropper } from '@/components/AvatarCropper'
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
  capPhoneInput,
  HEIGHT_CM,
  isValidPhone,
  normalizePhone,
  optionsWithStored,
  PHONE_MAX_CHARS,
  PHONE_MAX_DIGITS,
  phoneDigitCount,
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
    <main className="profile-page min-h-screen max-w-xl mx-auto px-4 py-8 pb-24">
      <div className="skeleton" style={{ height: '56px', borderRadius: 'var(--radius-full)', marginBottom: 'var(--space-6)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
        <div className="skeleton" style={{ width: '76px', height: '76px', borderRadius: '50%', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
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
  const [loadError, setLoadError] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
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
  /** The picked file, held while the patient frames it. Null when no cropper is up. */
  const [photoToFrame, setPhotoToFrame] = useState<File | null>(null)

  // Keep existing guardian preferences read-only until sending is available.
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
    setLoading(true)
    setLoadError(false)
    setMessage(null)
    try {
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

      if (error || !profile) {
        setLoadError(true)
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
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  /**
   * A picked file is checked here and framed before it goes anywhere — the
   * upload happens on the way *out* of the cropper, not on the way in, so a
   * patient who changes their mind has cost the bucket nothing.
   */
  function frameAvatar(file: File) {
    const problem = rejectAvatar(file)
    if (problem) {
      setMessage(problem)
      return
    }
    setMessage(null)
    setPhotoToFrame(file)
  }

  /**
   * Uploads straight away and holds the new path in state; Save Profile is what
   * points the row at it. Same shape as the exercise editor's demo pictures.
   */
  async function uploadAvatar(file: File) {
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

  if (loadError) return (
    <main className="min-h-screen max-w-xl mx-auto px-4 py-8">
      <header className="patient-heading"><h1>Profile</h1></header>
      <p role="alert">Your profile couldn’t be loaded. Retry before making changes.</p>
      <button className="btn btn-primary mt-4" onClick={() => void loadProfile()}>Retry loading</button>
    </main>
  )

  return (
    <main
      className="profile-page min-h-screen max-w-xl mx-auto px-4 py-8 pb-24"
      style={{ background: 'linear-gradient(180deg, rgba(74, 107, 90, 0.07), transparent 320px)' }}
    >
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
          onPick={frameAvatar}
          alt={name ? `${name}'s profile picture` : 'Your profile picture'}
        />
        <div style={{ minWidth: 0 }}>
          <h1 className="patient-title" style={{ color: 'var(--primary)', marginBottom: '2px' }}>Profile</h1>
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
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            // Capped as it is typed rather than only judged on save: letters
            // never appear, and the 16th digit never lands.
            onChange={(e) => setPhone(capPhoneInput(e.target.value))}
            maxLength={PHONE_MAX_CHARS}
            aria-describedby="profile-phone-hint"
            placeholder="081-234-5678"
            style={inputStyle}
          />
          <p
            id="profile-phone-hint"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              color: 'var(--muted)',
              marginTop: 'var(--space-1)',
            }}
          >
            <span>8 to {PHONE_MAX_DIGITS} digits.</span>
            {/* Only once they are close to the ceiling — a counter on an empty
                field is noise. */}
            {phoneDigitCount(phone) >= PHONE_MAX_DIGITS - 2 && (
              <span style={{ fontWeight: 600 }}>
                {phoneDigitCount(phone)}/{PHONE_MAX_DIGITS}
              </span>
            )}
          </p>
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

      <section className="guardian-status" aria-labelledby="guardian-heading">
        <h2 id="guardian-heading">Guardian updates</h2>
        <p className="prep-note">Automatic guardian emails aren’t available yet. Your saved preferences haven’t been changed.</p>
        {guardianEmail && <details className="tracking-help">
          <summary>Saved preferences</summary>
          <p className="profile-email">{guardianEmail}</p>
          <p>Notifications: {guardianNotify ? 'requested, but not being sent' : 'off'}</p>
        </details>}
      </section>

      {message && (
        <p
          role="alert"
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

      <section className="account-actions" aria-label="Account">
        <button className="pill-btn pill-btn-outline" disabled={signingOut || saving || uploading} onClick={async () => {
          setSigningOut(true)
          try {
            const { error } = await createClient().auth.signOut()
            if (error) throw error
            router.replace('/login')
            router.refresh()
          } catch {
            setMessage('Sign out didn’t finish. Please try again.')
            setSigningOut(false)
          }
        }}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </section>

      {photoToFrame && (
        <AvatarCropper
          file={photoToFrame}
          onCancel={() => setPhotoToFrame(null)}
          onConfirm={(cropped) => {
            setPhotoToFrame(null)
            void uploadAvatar(cropped)
          }}
        />
      )}

      {saved && <SavedOverlay onDone={() => setSaved(false)} />}
    </main>
  )
}
