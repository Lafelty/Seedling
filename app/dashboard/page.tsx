'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

export const dynamic = 'force-dynamic'

interface SessionStats {
  id: string
  started_at: string
  duration_seconds: number
  completed_reps: number
  form_quality_score: number
}

interface WeeklyStats {
  sessionsThisWeek: number
  sessionsLastWeek: number
  avgFormThisWeek: number
  avgFormLastWeek: number
  totalRepsThisWeek: number
  improvement: number
}

export default function DashboardPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState<string>('')
  const [recentSessions, setRecentSessions] = useState<SessionStats[]>([])
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats | null>(null)
  const [chartData, setChartData] = useState<any[]>([])

  useEffect(() => {
    loadDashboardData()
  }, [])

  async function loadDashboardData() {
    if (typeof window === 'undefined') return;

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push('/login')
      return
    }

    // Load user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single()

    if (profile) {
      setUserName(profile.name || 'User')
    }

    // Load recent sessions (last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: sessions } = await supabase
      .from('therapy_sessions')
      .select('id, started_at, duration_seconds, completed_reps, form_quality_score')
      .eq('user_id', user.id)
      .gte('started_at', thirtyDaysAgo.toISOString())
      .order('started_at', { ascending: true })

    if (sessions) {
      setRecentSessions(sessions as SessionStats[])
      calculateWeeklyStats(sessions as SessionStats[])
      prepareChartData(sessions as SessionStats[])
    }

    setLoading(false)
  }

  function calculateWeeklyStats(sessions: SessionStats[]) {
    const now = new Date()
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    const thisWeek = sessions.filter(s => new Date(s.started_at) >= oneWeekAgo)
    const lastWeek = sessions.filter(s => {
      const date = new Date(s.started_at)
      return date >= twoWeeksAgo && date < oneWeekAgo
    })

    const avgFormThisWeek = thisWeek.length > 0
      ? thisWeek.reduce((sum, s) => sum + (s.form_quality_score || 0), 0) / thisWeek.length
      : 0

    const avgFormLastWeek = lastWeek.length > 0
      ? lastWeek.reduce((sum, s) => sum + (s.form_quality_score || 0), 0) / lastWeek.length
      : 0

    const improvement = avgFormLastWeek > 0
      ? ((avgFormThisWeek - avgFormLastWeek) / avgFormLastWeek) * 100
      : 0

    setWeeklyStats({
      sessionsThisWeek: thisWeek.length,
      sessionsLastWeek: lastWeek.length,
      avgFormThisWeek: Math.round(avgFormThisWeek),
      avgFormLastWeek: Math.round(avgFormLastWeek),
      totalRepsThisWeek: thisWeek.reduce((sum, s) => sum + s.completed_reps, 0),
      improvement: Math.round(improvement),
    })
  }

  function prepareChartData(sessions: SessionStats[]) {
    // Group by day
    const grouped: { [key: string]: SessionStats[] } = {}

    sessions.forEach(session => {
      const date = new Date(session.started_at).toLocaleDateString()
      if (!grouped[date]) {
        grouped[date] = []
      }
      grouped[date].push(session)
    })

    const data = Object.entries(grouped).map(([date, daySessions]) => ({
      date,
      formQuality: Math.round(
        daySessions.reduce((sum, s) => sum + (s.form_quality_score || 0), 0) / daySessions.length
      ),
      sessions: daySessions.length,
      reps: daySessions.reduce((sum, s) => sum + s.completed_reps, 0),
    }))

    setChartData(data.slice(-14)) // Last 14 days
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
        <p style={{ color: 'var(--muted)' }}>Loading your progress...</p>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--background)',
      padding: 'var(--space-6)',
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 'var(--space-8)' }}>
          <h1 style={{
            fontSize: 'var(--text-3xl)',
            fontWeight: 600,
            fontFamily: 'var(--font-display)',
            color: 'var(--ink)',
            marginBottom: 'var(--space-2)',
          }}>
            Welcome back, {userName}
          </h1>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--muted)' }}>
            Track your therapy progress and stay consistent
          </p>
        </div>

        {/* Weekly Stats Cards */}
        {weeklyStats && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-8)',
          }}>
            <StatCard
              title="Sessions This Week"
              value={weeklyStats.sessionsThisWeek}
              comparison={weeklyStats.sessionsLastWeek}
              unit="sessions"
            />
            <StatCard
              title="Form Quality"
              value={weeklyStats.avgFormThisWeek}
              comparison={weeklyStats.avgFormLastWeek}
              unit="%"
              isPercentage
            />
            <StatCard
              title="Total Reps"
              value={weeklyStats.totalRepsThisWeek}
              comparison={null}
              unit="reps"
            />
            <StatCard
              title="Weekly Improvement"
              value={weeklyStats.improvement}
              comparison={null}
              unit="%"
              isImprovement
            />
          </div>
        )}

        {/* Charts */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))',
          gap: 'var(--space-6)',
          marginBottom: 'var(--space-8)',
        }}>
          {/* Form Quality Trend */}
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
              Form Quality Trend
            </h2>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E1D7" />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#5C635D' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#5C635D' }} />
                  <Tooltip contentStyle={{ background: '#FBF9F5', border: '1px solid #E7E1D7', borderRadius: '8px' }} />
                  <Line type="monotone" dataKey="formQuality" stroke="#C4612F" strokeWidth={3} dot={{ fill: '#C4612F', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 'var(--space-8)' }}>
                Complete some sessions to see your progress
              </p>
            )}
          </div>

          {/* Sessions per Day */}
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
              Sessions Per Day
            </h2>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E1D7" />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#5C635D' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#5C635D' }} />
                  <Tooltip contentStyle={{ background: '#FBF9F5', border: '1px solid #E7E1D7', borderRadius: '8px' }} />
                  <Bar dataKey="sessions" fill="#4A6B5A" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 'var(--space-8)' }}>
                Complete some sessions to see your activity
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-4)',
          justifyContent: 'center',
        }}>
          <button
            onClick={async () => {
              const supabase = createClient()
              await supabase.auth.signOut()
              router.push('/login')
              router.refresh()
            }}
            style={{
              padding: 'var(--space-4) var(--space-8)',
              fontSize: 'var(--text-lg)',
              fontWeight: 600,
              color: 'var(--ink)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-full)',
              cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  comparison,
  unit,
  isPercentage = false,
  isImprovement = false,
}: {
  title: string
  value: number
  comparison: number | null
  unit: string
  isPercentage?: boolean
  isImprovement?: boolean
}) {
  const change = comparison !== null ? value - comparison : null
  const changePercent = comparison && comparison > 0 ? ((value - comparison) / comparison) * 100 : 0

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius-xl)',
      padding: 'var(--space-6)',
      border: '1px solid var(--border)',
    }}>
      <p style={{
        fontSize: 'var(--text-sm)',
        fontWeight: 500,
        color: 'var(--muted)',
        marginBottom: 'var(--space-2)',
      }}>
        {title}
      </p>
      <p style={{
        fontSize: 'var(--text-3xl)',
        fontWeight: 700,
        color: 'var(--ink)',
        fontFamily: 'var(--font-display)',
      }}>
        {value}{unit}
      </p>
      {change !== null && (
        <p style={{
          fontSize: 'var(--text-sm)',
          color: change >= 0 ? '#16A34A' : '#DC2626',
          marginTop: 'var(--space-2)',
        }}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(Math.round(changePercent))}% vs last week
        </p>
      )}
      {isImprovement && (
        <p style={{
          fontSize: 'var(--text-sm)',
          color: value >= 0 ? '#16A34A' : '#DC2626',
          marginTop: 'var(--space-2)',
        }}>
          {value >= 0 ? '↑ Improving' : '↓ Needs work'}
        </p>
      )}
    </div>
  )
}
