'use client'

import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { SmoothInput } from '@/components/SmoothInput'
import { StarBadge, StarGlyph } from '@/components/StarBadge'
import { signAvatars } from '@/lib/avatar'
import { bmi, formatPhone } from '@/lib/profileFields'
import { createClient } from '@/lib/supabase/client'
import type { ProfileDetail as Profile } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

const PROFILE_COLUMNS =
  'id, email, name, total_stars, is_admin, created_at, updated_at, phone, avatar_path, height_cm, weight_kg, guardian_email, guardian_notify'

function patientName(profile: Profile) {
  return profile.name?.trim() || profile.email.split('@')[0]
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="patient-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function PatientDetails({ profile, photo, detailsId }: { profile: Profile; photo: string | null; detailsId: string }) {
  const name = patientName(profile)
  const patientBmi = bmi(profile.height_cm, profile.weight_kg)

  return (
    <section id={detailsId} className="patient-details" aria-label={`${name}'s profile details`}>
      <div className="patient-details-avatar">
        <ProfileAvatar url={photo} size={80} alt={`${name}'s profile picture`} />
      </div>

      <dl className="patient-facts">
        <Fact label="Phone" value={formatPhone(profile.phone)} />
        <Fact label="Height" value={profile.height_cm != null ? `${profile.height_cm} cm` : 'Not provided'} />
        <Fact label="Weight" value={profile.weight_kg != null ? `${profile.weight_kg} kg` : 'Not provided'} />
        <Fact label="BMI" value={patientBmi != null ? patientBmi.toFixed(1) : 'Not available'} />
        <Fact label="Guardian email" value={profile.guardian_email || 'Not provided'} />
        <Fact label="Guardian updates" value={profile.guardian_notify ? 'Enabled' : 'Disabled'} />
        <Fact label="Joined" value={new Date(profile.created_at).toLocaleDateString()} />
        <Fact label="Last updated" value={new Date(profile.updated_at).toLocaleDateString()} />
      </dl>

      <div className="patient-details-actions">
        <Link href={`/admin/users/${profile.id}`} className="pill-btn pill-btn-outline">
          <StarGlyph size={15} />
          Edit stars
        </Link>
      </div>
    </section>
  )
}

export default function PatientsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [avatarUrls, setAvatarUrls] = useState<Map<string, string>>(() => new Map())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const loadPatients = useCallback(async () => {
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      router.replace('/login')
      return
    }

    const { data: adminProfile, error: adminError } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (adminError) {
      setError('We could not confirm your access. Please try again.')
      setLoading(false)
      return
    }

    if (!adminProfile?.is_admin) {
      router.replace('/')
      return
    }

    setIsAdmin(true)

    const { data, error: profilesError } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('is_admin', false)
      .order('created_at', { ascending: false })

    if (profilesError) {
      setError('We could not load the patient directory. Please try again.')
      setLoading(false)
      return
    }

    const patients = (data ?? []) as Profile[]
    setProfiles(patients)
    setLoading(false)

    const signed = await signAvatars(supabase, patients.map((profile) => profile.avatar_path))
    setAvatarUrls(signed)
  }, [router])

  useEffect(() => {
    void loadPatients()
  }, [loadPatients])

  const visibleProfiles = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase()
    if (!normalized) return profiles

    return profiles.filter((profile) => {
      const searchable = [patientName(profile), profile.email, profile.phone ?? '', formatPhone(profile.phone)]
        .join(' ')
        .toLocaleLowerCase()
      return searchable.includes(normalized)
    })
  }, [deferredQuery, profiles])

  if (!loading && !isAdmin && !error) return null

  const resultLabel = query.trim()
    ? `${visibleProfiles.length} of ${profiles.length} patients`
    : `${profiles.length} ${profiles.length === 1 ? 'patient' : 'patients'}`

  return (
    <div className="patients-page">
      <style>{PATIENTS_CSS}</style>

      <main className="patients-shell">
        <header className="patients-header">
          <div className="patients-heading">
            <Link href="/admin" className="patients-back" aria-label="Back to admin dashboard">
              <ArrowLeftIcon />
            </Link>
            <div>
              <h1>Patients</h1>
              <p>Review profiles, progress, and star totals in one place.</p>
            </div>
          </div>
          {!loading && !error ? <span className="patients-count" aria-live="polite">{resultLabel}</span> : null}
        </header>

        <section className="patients-directory" aria-labelledby="patient-directory-title" aria-busy={loading}>
          <div className="patients-toolbar">
            <div>
              <h2 id="patient-directory-title">Patient directory</h2>
              <p>Select details for health and guardian information.</p>
            </div>

            {!loading && !error && profiles.length > 0 ? (
              <div className="patients-search">
                <SearchIcon />
                <SmoothInput
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="patients-search-input"
                  aria-label="Search patients"
                  placeholder="Search name, email, or phone"
                />
                {query ? (
                  <button type="button" className="patients-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                    <CloseIcon />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {loading ? (
            <PatientDirectorySkeleton />
          ) : error ? (
            <DirectoryState
              icon={<AlertIcon />}
              title="Patient directory unavailable"
              body={error}
              action={<button type="button" className="pill-btn pill-btn-primary" onClick={() => void loadPatients()}>Try again</button>}
            />
          ) : profiles.length === 0 ? (
            <DirectoryState icon={<PeopleIcon />} title="No patients yet" body="Patient accounts will appear here after they sign up." />
          ) : visibleProfiles.length === 0 ? (
            <DirectoryState
              icon={<SearchIcon />}
              title="No matching patients"
              body={`No patient matches “${query.trim()}”. Try a name, email, or phone number.`}
              action={<button type="button" className="pill-btn pill-btn-outline" onClick={() => setQuery('')}>Clear search</button>}
            />
          ) : (
            <PatientResults
              profiles={visibleProfiles}
              avatarUrls={avatarUrls}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
            />
          )}
        </section>
      </main>
    </div>
  )
}

function PatientResults({
  profiles,
  avatarUrls,
  expandedId,
  setExpandedId,
}: {
  profiles: Profile[]
  avatarUrls: Map<string, string>
  expandedId: string | null
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>
}) {
  return (
    <>
      <div className="patients-table-wrap">
        <table className="patients-table">
          <caption className="sr-only">Patient profiles, star totals, and progress actions</caption>
          <thead>
            <tr>
              <th scope="col">Patient</th>
              <th scope="col">Contact</th>
              <th scope="col">Stars</th>
              <th scope="col">Joined</th>
              <th scope="col"><span className="sr-only">Patient actions</span></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => {
              const name = patientName(profile)
              const expanded = expandedId === profile.id
              const detailsId = `patient-${profile.id}-details`
              const photo = profile.avatar_path ? avatarUrls.get(profile.avatar_path) ?? null : null

              return (
                <React.Fragment key={profile.id}>
                  <tr className="patient-row" data-open={expanded}>
                    <td>
                      <div className="patient-identity">
                        <ProfileAvatar url={photo} size={44} alt="" />
                        <div><strong>{name}</strong><span>{profile.email}</span></div>
                      </div>
                    </td>
                    <td><span className="patient-contact">{formatPhone(profile.phone)}</span></td>
                    <td><StarBadge as="span" value={profile.total_stars} starSize={14} /></td>
                    <td><time dateTime={profile.created_at}>{new Date(profile.created_at).toLocaleDateString()}</time></td>
                    <td>
                      <div className="patient-row-actions">
                        <Link href={`/admin/users/${profile.id}/dashboard`} className="patient-progress-link" aria-label={`View ${name}'s progress`}>
                          <ChartIcon />
                          View progress
                        </Link>
                        <button
                          type="button"
                          className="patient-disclosure"
                          aria-expanded={expanded}
                          aria-controls={detailsId}
                          aria-label={`${expanded ? 'Hide' : 'Show'} ${name}'s details`}
                          onClick={() => setExpandedId(expanded ? null : profile.id)}
                        >
                          <ChevronIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="patient-details-row">
                      <td colSpan={5}><PatientDetails profile={profile} photo={photo} detailsId={detailsId} /></td>
                    </tr>
                  ) : null}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="patients-mobile-list">
        {profiles.map((profile) => {
          const name = patientName(profile)
          const expanded = expandedId === profile.id
          const detailsId = `patient-${profile.id}-mobile-details`
          const photo = profile.avatar_path ? avatarUrls.get(profile.avatar_path) ?? null : null

          return (
            <article className="patient-mobile-card" key={profile.id}>
              <div className="patient-mobile-head">
                <div className="patient-identity">
                  <ProfileAvatar url={photo} size={48} alt="" />
                  <div><h3>{name}</h3><span>{profile.email}</span></div>
                </div>
                <StarBadge as="span" value={profile.total_stars} starSize={14} />
              </div>

              <dl className="patient-mobile-summary">
                <div><dt>Phone</dt><dd>{formatPhone(profile.phone)}</dd></div>
                <div><dt>Joined</dt><dd><time dateTime={profile.created_at}>{new Date(profile.created_at).toLocaleDateString()}</time></dd></div>
              </dl>

              <div className="patient-mobile-actions">
                <Link href={`/admin/users/${profile.id}/dashboard`} className="pill-btn pill-btn-primary"><ChartIcon />View progress</Link>
                <button
                  type="button"
                  className="pill-btn pill-btn-outline patient-mobile-details-button"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  onClick={() => setExpandedId(expanded ? null : profile.id)}
                >
                  {expanded ? 'Hide details' : 'View details'}
                  <ChevronIcon />
                </button>
              </div>

              {expanded ? <PatientDetails profile={profile} photo={photo} detailsId={detailsId} /> : null}
            </article>
          )
        })}
      </div>
    </>
  )
}

function DirectoryState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="patients-state" role="status">
      <div className="patients-state-icon" aria-hidden>{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action ? <div>{action}</div> : null}
    </div>
  )
}

function PatientDirectorySkeleton() {
  return (
    <div className="patients-loading" aria-label="Loading patients">
      {[0, 1, 2, 3].map((item) => (
        <div className="patients-loading-row" key={item}>
          <div className="skeleton patients-loading-avatar" />
          <div className="patients-loading-copy"><div className="skeleton" /><div className="skeleton" /></div>
          <div className="skeleton patients-loading-meta" />
        </div>
      ))}
      <span className="sr-only">Loading patient directory</span>
    </div>
  )
}

function ArrowLeftIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
}
function SearchIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
}
function CloseIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
}
function ChevronIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
}
function ChartIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 3v18h18" /><path d="m7 16 4-5 4 3 5-7" /></svg>
}
function AlertIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
}
function PeopleIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
}

const PATIENTS_CSS = `
  .patients-page {
    min-height: 100vh;
    padding: var(--space-6) var(--space-6) var(--space-16);
    background: radial-gradient(90% 42% at 50% -8%, rgba(74, 107, 90, 0.12), transparent 72%), var(--background);
  }
  .patients-shell { max-width: 1180px; margin: 0 auto; }
  .patients-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-6); }
  .patients-heading { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
  .patients-heading h1 { margin: 0 0 var(--space-1); font-size: var(--text-3xl); line-height: 1.15; color: var(--ink); }
  .patients-heading p { margin: 0; color: var(--muted); font-size: var(--text-sm); }
  .patients-back {
    width: 44px; height: 44px; display: grid; place-items: center; flex: 0 0 auto;
    color: var(--ink); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-full);
    transition: background var(--dur-fast) var(--ease-out), transform var(--dur-instant) var(--ease-out);
  }
  .patients-count {
    flex: 0 0 auto; padding: var(--space-2) var(--space-4); color: var(--primary); background: rgba(74, 107, 90, 0.09);
    border-radius: var(--radius-full); font-size: var(--text-sm); font-weight: 700; font-variant-numeric: tabular-nums;
  }
  .patients-directory { overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
  .patients-toolbar {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-6); min-height: 92px;
    padding: var(--space-5) var(--space-6); background: rgba(74, 107, 90, 0.035); border-bottom: 1px solid var(--border);
  }
  .patients-toolbar h2 { margin: 0 0 2px; font-family: var(--font-body); font-size: var(--text-lg); color: var(--ink); letter-spacing: 0; }
  .patients-toolbar p { margin: 0; color: var(--muted); font-size: var(--text-sm); }
  .patients-search { position: relative; width: min(100%, 340px); flex: 0 1 340px; }
  .patients-search > svg { position: absolute; z-index: 1; left: var(--space-4); top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
  .patients-search-input {
    height: 46px; padding: 0 48px 0 44px; color: var(--ink); background: var(--surface); border: 1px solid #D7DCD8;
    border-radius: var(--radius-full); font: 500 var(--text-sm)/1 var(--font-body);
    transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  }
  .patients-search-input::placeholder { color: #6B6B6B; opacity: 1; }
  .patients-search-input::-webkit-search-cancel-button { display: none; }
  .patients-search-input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(74, 107, 90, 0.16); }
  .patients-search-clear {
    position: absolute; z-index: 2; right: 1px; top: 1px; width: 44px; height: 44px; display: grid; place-items: center;
    color: var(--muted); background: transparent; border: 0; border-radius: var(--radius-full); cursor: pointer;
  }
  .patients-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .patients-table th {
    padding: var(--space-3) var(--space-4); color: var(--muted); background: #FCFCFB; border-bottom: 1px solid var(--border);
    font-family: var(--font-body); font-size: var(--text-xs); font-weight: 700; text-align: left; letter-spacing: 0;
  }
  .patients-table th:nth-child(1) { width: 31%; padding-left: var(--space-6); }
  .patients-table th:nth-child(2) { width: 17%; }
  .patients-table th:nth-child(3) { width: 12%; }
  .patients-table th:nth-child(4) { width: 13%; }
  .patients-table th:nth-child(5) { width: 27%; }
  .patients-table td { padding: var(--space-3) var(--space-4); color: var(--ink); font-size: var(--text-sm); vertical-align: middle; }
  .patients-table .patient-row > td { border-bottom: 1px solid var(--border); }
  .patients-table .patient-row > td:first-child { padding-left: var(--space-6); }
  .patient-row { transition: background var(--dur-fast) var(--ease-out); }
  .patient-row[data-open='true'] { background: rgba(74, 107, 90, 0.055); }
  .patient-identity { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
  .patient-identity > div:last-child { min-width: 0; }
  .patient-identity strong, .patient-identity h3 { display: block; margin: 0; color: var(--ink); font: 700 var(--text-sm)/1.35 var(--font-body); overflow-wrap: anywhere; }
  .patient-identity span { display: block; color: var(--muted); font-size: var(--text-xs); line-height: 1.45; overflow-wrap: anywhere; }
  .patient-contact, .patients-table time { color: #4F5752; font-variant-numeric: tabular-nums; }
  .patient-row-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); }
  .patient-progress-link {
    min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-2) var(--space-3);
    color: var(--primary); background: transparent; border-radius: var(--radius-full); font-size: var(--text-sm); font-weight: 700;
    text-decoration: none; white-space: nowrap;
  }
  .patient-disclosure {
    width: 44px; height: 44px; display: grid; place-items: center; flex: 0 0 auto; color: var(--muted); background: transparent;
    border: 1px solid transparent; border-radius: var(--radius-full); cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  }
  .patient-disclosure[aria-expanded='true'] { color: var(--primary); background: rgba(74, 107, 90, 0.1); }
  .patient-disclosure[aria-expanded='true'] svg { transform: rotate(180deg); }
  .patient-disclosure svg, .patient-mobile-details-button svg { transition: transform var(--dur-fast) var(--ease-out); }
  .patient-mobile-details-button[aria-expanded='true'] svg { transform: rotate(180deg); }
  .patient-details-row > td { padding: 0; background: rgba(74, 107, 90, 0.035); border-bottom: 1px solid var(--border); }
  .patient-details {
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: var(--space-6); padding: var(--space-6);
    animation: patientDetailsIn var(--dur-fast) var(--ease-out);
  }
  .patient-facts { display: grid; grid-template-columns: repeat(4, minmax(110px, 1fr)); gap: var(--space-4) var(--space-6); margin: 0; }
  .patient-fact dt { margin: 0 0 2px; color: var(--muted); font-size: var(--text-xs); }
  .patient-fact dd { margin: 0; color: var(--ink); font-size: var(--text-sm); font-weight: 600; overflow-wrap: anywhere; }
  .patient-details-actions { display: flex; flex-direction: column; align-items: stretch; gap: var(--space-2); }
  .patient-details-actions .pill-btn { min-height: 44px; }
  .patients-mobile-list { display: none; }
  .patients-state { min-height: 350px; display: grid; place-content: center; justify-items: center; gap: var(--space-2); padding: var(--space-8); text-align: center; }
  .patients-state-icon { width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: var(--space-2); color: var(--primary); background: rgba(74, 107, 90, 0.1); border-radius: var(--radius-full); }
  .patients-state h3 { margin: 0; font-family: var(--font-body); font-size: var(--text-lg); letter-spacing: 0; }
  .patients-state p { margin: 0 0 var(--space-3); color: var(--muted); font-size: var(--text-sm); }
  .patients-loading { padding: 0 var(--space-6); }
  .patients-loading-row { min-height: 76px; display: flex; align-items: center; gap: var(--space-3); border-bottom: 1px solid var(--border); }
  .patients-loading-avatar { width: 44px; height: 44px; flex: 0 0 auto; border-radius: 50%; }
  .patients-loading-copy { width: min(38%, 240px); display: grid; gap: var(--space-2); }
  .patients-loading-copy .skeleton:first-child { width: 68%; height: 13px; }
  .patients-loading-copy .skeleton:last-child { width: 100%; height: 11px; }
  .patients-loading-meta { width: 100px; height: 30px; margin-left: auto; border-radius: var(--radius-full); }
  @keyframes patientDetailsIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  @media (hover: hover) and (pointer: fine) {
    .patients-back:hover, .patients-search-clear:hover, .patient-disclosure:hover { background: rgba(74, 107, 90, 0.08); color: var(--primary); }
    .patients-back:hover { transform: translateX(-1px); }
    .patient-row:hover { background: rgba(74, 107, 90, 0.025); }
    .patient-progress-link:hover { background: rgba(74, 107, 90, 0.08); }
  }
  @media (max-width: 900px) {
    .patients-table th:nth-child(2), .patients-table td:nth-child(2), .patients-table th:nth-child(4), .patients-table td:nth-child(4) { display: none; }
    .patients-table th:nth-child(1) { width: 43%; }
    .patients-table th:nth-child(3) { width: 17%; }
    .patients-table th:nth-child(5) { width: 40%; }
    .patient-facts { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
  }
  @media (max-width: 720px) {
    .patients-page { padding: var(--space-4) var(--space-4) var(--space-12); }
    .patients-header { align-items: flex-start; }
    .patients-heading h1 { font-size: var(--text-2xl); }
    .patients-count { margin-top: 5px; }
    .patients-directory { border-radius: var(--radius-md); }
    .patients-toolbar { align-items: stretch; flex-direction: column; gap: var(--space-4); padding: var(--space-4); }
    .patients-search { width: 100%; flex-basis: auto; }
    .patients-table-wrap { display: none; }
    .patients-mobile-list { display: grid; }
    .patient-mobile-card { padding: var(--space-4); border-bottom: 1px solid var(--border); content-visibility: auto; contain-intrinsic-size: auto 260px; }
    .patient-mobile-card:last-child { border-bottom: 0; }
    .patient-mobile-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
    .patient-mobile-summary { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); margin: var(--space-4) 0; padding: var(--space-3) 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .patient-mobile-summary dt { color: var(--muted); font-size: var(--text-xs); }
    .patient-mobile-summary dd { margin: 1px 0 0; color: var(--ink); font-size: var(--text-sm); font-weight: 600; }
    .patient-mobile-actions { display: flex; gap: var(--space-2); }
    .patient-mobile-actions .pill-btn { min-height: 44px; flex: 1 1 0; padding-inline: var(--space-3); }
    .patient-mobile-card > .patient-details { grid-template-columns: 1fr; gap: var(--space-5); margin: var(--space-4) calc(-1 * var(--space-4)) calc(-1 * var(--space-4)); padding: var(--space-5) var(--space-4); background: rgba(74, 107, 90, 0.045); border-top: 1px solid var(--border); }
    .patient-mobile-card .patient-details-avatar { display: none; }
    .patient-mobile-card .patient-facts { grid-template-columns: 1fr 1fr; gap: var(--space-4); }
  }
  @media (max-width: 460px) {
    .patients-heading p { max-width: 28ch; }
    .patients-count { display: none; }
    .patient-mobile-head { align-items: center; }
    .patient-mobile-actions { flex-direction: column; }
    .patient-mobile-actions .pill-btn { width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .patient-details { animation: none; }
    .patients-back, .patient-row, .patient-disclosure, .patient-disclosure svg, .patient-mobile-details-button svg { transition: none; }
  }
`
