import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// POST /api/notify-guardian — called fire-and-forget after a completed
// session. Sends the patient's guardian a summary email via Resend.
//
// Security model: the caller only proves who they are (Supabase JWT) and
// supplies display stats. Whether mail is sent, and to whom, comes from the
// patient's profile row (guardian_notify / guardian_email) read under RLS —
// a tampered client cannot aim email at arbitrary addresses.

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      }
    )

    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('name, email, guardian_email, guardian_notify, total_stars')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (!profile.guardian_notify || !profile.guardian_email) {
      return NextResponse.json({ skipped: true, reason: 'notifications-off' })
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      console.warn('RESEND_API_KEY not set — guardian email skipped')
      return NextResponse.json({ skipped: true, reason: 'no-api-key' })
    }

    // Display-only stats from the client; clamp to sane values.
    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const exerciseName =
      typeof body.exerciseName === 'string' && body.exerciseName.trim()
        ? escapeHtml(body.exerciseName.slice(0, 100))
        : 'Therapy exercise'
    const reps = Math.max(0, Math.floor(Number(body.reps) || 0))
    const targetReps = Math.max(0, Math.floor(Number(body.targetReps) || 0))
    const durationSeconds = Math.max(0, Math.floor(Number(body.durationSeconds) || 0))
    const formScoreRaw = Number(body.formScore)
    const formScore = Number.isFinite(formScoreRaw)
      ? Math.min(100, Math.max(0, Math.round(formScoreRaw)))
      : null

    const patientName = escapeHtml(profile.name || profile.email?.split('@')[0] || 'Your family member')
    const mins = Math.floor(durationSeconds / 60)
    const secs = durationSeconds % 60
    const duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
    const completedAt = new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })

    const statRow = (label: string, value: string) => `
      <tr>
        <td style="padding:8px 16px;color:#5C635D;font-size:14px;">${label}</td>
        <td style="padding:8px 16px;color:#1F2421;font-size:14px;font-weight:600;text-align:right;">${value}</td>
      </tr>`

    const html = `
      <div style="font-family:Georgia,serif;background:#FAF9F7;padding:32px 16px;">
        <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #E5E1D8;border-radius:16px;overflow:hidden;">
          <div style="background:#4A6B5A;padding:24px;text-align:center;">
            <p style="color:#ffffff;font-size:22px;margin:0;font-weight:600;">🌱 Seedling</p>
            <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:8px 0 0;">Session complete!</p>
          </div>
          <div style="padding:24px;">
            <p style="color:#1F2421;font-size:16px;margin:0 0 16px;">
              <strong>${patientName}</strong> just finished a therapy session. 🎉
            </p>
            <table style="width:100%;border-collapse:collapse;background:#F4F7F5;border-radius:12px;overflow:hidden;">
              ${statRow('Exercise', exerciseName)}
              ${statRow('Reps', targetReps > 0 ? `${reps} / ${targetReps}` : `${reps}`)}
              ${statRow('Duration', duration)}
              ${formScore != null ? statRow('Form accuracy', `${formScore}%`) : ''}
              ${profile.total_stars != null ? statRow('Total stars', `⭐ ${profile.total_stars}`) : ''}
              ${statRow('Completed', completedAt)}
            </table>
            <p style="color:#5C635D;font-size:13px;margin:16px 0 0;">
              You're receiving this because ${patientName} added you as their guardian
              in Seedling. They can turn these emails off on their profile page.
            </p>
          </div>
        </div>
      </div>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Set EMAIL_FROM once your domain is verified in Resend, e.g.
        // "Seedling <notify@yourdomain.com>". The resend.dev fallback only
        // delivers to the Resend account owner's own address (testing).
        from: process.env.EMAIL_FROM || 'Seedling <onboarding@resend.dev>',
        to: [profile.guardian_email],
        subject: `${patientName} completed a therapy session 🌱`,
        html,
      }),
    })

    if (!res.ok) {
      const detail = await res.text()
      console.error('Resend error:', res.status, detail)
      return NextResponse.json({ error: 'Send failed' }, { status: 502 })
    }

    return NextResponse.json({ sent: true })
  } catch (err) {
    console.error('notify-guardian error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
