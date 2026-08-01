'use client';

// The progress screen, in the garden's language.
//
// One period control at the top drives everything below it — four stat cards and
// both charts. Two independent toggles on one page would leave the patient
// working out which number was answering which question; one control means the
// whole page always answers the same one.
//
// All of the period maths lives in lib/dashboard-stats.ts. This file fetches a
// year of sessions once, holds the selected period, and draws.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  bucketByDay,
  fetchWindowStart,
  formatDelta,
  periodStats,
  resolvePeriod,
  setPeriodMode,
  shiftPeriod,
  type Delta,
  type Period,
  type SessionRow,
} from '@/lib/dashboard-stats';
import GaugeWheel from '@/components/GaugeWheel';
import SessionSplitBar from '@/components/SessionSplitBar';
import Sprig from '@/components/Sprig';

export const dynamic = 'force-dynamic';

const SESSION_COLUMNS =
  'id, started_at, completed_at, duration_seconds, completed_reps, target_reps, form_quality_score';

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [period, setPeriod] = useState<Period>(() => ({ mode: 'week', anchor: new Date() }));

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    if (typeof window === 'undefined') return;

    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login');
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single();

    setUserName(profile?.name || 'there');

    // One query covers every period the stepper can reach, so switching weeks or
    // months afterwards is a slice of an array rather than a round trip.
    const { data: sessions, error: fetchError } = await supabase
      .from('therapy_sessions')
      .select(SESSION_COLUMNS)
      .eq('user_id', user.id)
      .gte('started_at', fetchWindowStart().toISOString())
      .order('started_at', { ascending: true });

    if (fetchError) {
      setError('We could not load your sessions.');
      setLoading(false);
      return;
    }

    // form_quality_score is a numeric column, which arrives as a string often
    // enough that averaging it raw would concatenate rather than add.
    setRows(
      (sessions ?? []).map((row: any) => ({
        ...row,
        completed_reps: Number(row.completed_reps ?? 0),
        target_reps: Number(row.target_reps ?? 0),
        form_quality_score: row.form_quality_score === null ? null : Number(row.form_quality_score),
      }))
    );
    setLoading(false);
  }

  const resolved = useMemo(() => resolvePeriod(period), [period]);
  const stats = useMemo(() => periodStats(rows, resolved), [rows, resolved]);
  const days = useMemo(
    () => bucketByDay(rows, resolved.start, resolved.end, resolved.mode),
    [rows, resolved]
  );

  const unit = resolved.unit;
  const empty = stats.totalSessions === 0;

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="dash-page">
      <style>{`
        .dash-page {
          min-height: 100vh;
          padding: var(--space-6) var(--space-6) var(--space-16);
          /* A green horizon behind the header that thins out down the page, so
             the screen starts in the garden and settles into reading surface. */
          background:
            radial-gradient(120% 60% at 50% -10%, rgba(124, 199, 134, 0.22), rgba(124, 199, 134, 0) 70%),
            var(--bg);
        }
        .dash-wrap { max-width: 1120px; margin: 0 auto; }

        .dash-head {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          justify-content: space-between;
          gap: var(--space-4);
          margin-bottom: var(--space-6);
        }
        .dash-greeting {
          font-family: var(--font-display);
          font-size: var(--text-3xl);
          font-weight: 600;
          color: var(--ink);
          margin: 0 0 var(--space-1);
          letter-spacing: -0.02em;
        }
        .dash-sub { margin: 0; font-size: var(--text-base); color: var(--muted); }

        /* ── Period control ── */
        .dash-controls {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--space-3);
          margin-bottom: var(--space-8);
        }
        .dash-seg {
          display: inline-flex;
          padding: 3px;
          gap: 2px;
          background: rgba(124, 199, 134, 0.16);
          border-radius: var(--radius-full);
        }
        .dash-seg button {
          border: none;
          cursor: pointer;
          background: transparent;
          color: #3E6B4F;
          font-family: var(--font-body);
          font-size: var(--text-sm);
          font-weight: 600;
          padding: var(--space-2) var(--space-4);
          min-height: 36px;
          border-radius: var(--radius-full);
          transition: background var(--dur-fast) var(--ease-out),
                      color var(--dur-fast) var(--ease-out),
                      box-shadow var(--dur-fast) var(--ease-out);
        }
        .dash-seg button[data-on='true'] {
          background: var(--surface);
          color: #2F6B45;
          box-shadow: 0 1px 3px rgba(47, 107, 69, 0.18);
        }

        .dash-step {
          display: inline-flex;
          align-items: center;
          gap: var(--space-1);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-full);
          padding: 3px;
        }
        .dash-step span {
          min-width: 8.5rem;
          text-align: center;
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--ink);
        }
        .dash-step button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border: none;
          border-radius: var(--radius-full);
          background: transparent;
          color: #3E6B4F;
          cursor: pointer;
          transition: background var(--dur-fast) var(--ease-out);
        }
        .dash-step button:disabled { color: #C3C9C4; cursor: default; }

        @media (hover: hover) and (pointer: fine) {
          .dash-seg button:hover:not([data-on='true']) { color: #2F6B45; background: rgba(255,255,255,0.6); }
          .dash-step button:hover:not(:disabled) { background: rgba(124, 199, 134, 0.18); }
        }
        .dash-seg button:active, .dash-step button:not(:disabled):active { transform: scale(0.96); }

        /* ── Cards ── */
        .dash-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
          gap: var(--space-4);
          /* Room above the row for the sprigs, which stand clear of the cards. */
          padding-top: 26px;
          margin-bottom: var(--space-8);
        }
        .dash-card {
          position: relative;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          padding: var(--space-6);
          box-shadow: 0 1px 2px rgba(45, 45, 45, 0.04),
                      0 12px 28px -18px rgba(47, 107, 69, 0.35);
        }
        /* The shared entrance keyframes start at opacity 0 but set no fill mode,
           so a staggered card would paint fully opaque for its delay and then
           blink out. Holding the first frame is what makes the stagger read. */
        .animate-fadeInUp { animation-fill-mode: backwards; }
        .dash-card-title {
          margin: 0 0 var(--space-2);
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--muted);
          letter-spacing: 0.01em;
        }
        .dash-value {
          margin: 0;
          font-family: var(--font-display);
          font-size: var(--text-3xl);
          font-weight: 700;
          color: var(--ink);
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
        }
        .dash-delta { margin: var(--space-2) 0 0; font-size: var(--text-sm); }
        .dash-gauge { display: flex; justify-content: center; padding: var(--space-1) 0; }

        /* The one place the garden shows up as an object rather than a colour.
           Its stem runs past the bottom of the icon so it plants into the card. */
        .dash-sprig {
          position: absolute;
          top: -34px;
          left: var(--space-6);
          transform-origin: 50% 100%;
          animation: dashSway 3.6s var(--ease-out) infinite;
          filter: drop-shadow(0 2px 3px rgba(28, 40, 32, 0.28));
          pointer-events: none;
        }
        @keyframes dashSway {
          0%, 100% { transform: rotate(-8deg); }
          50%      { transform: rotate(6deg) translateY(-1px); }
        }

        /* ── Charts ── */
        .dash-charts {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
          gap: var(--space-6);
        }
        .dash-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          padding: var(--space-6);
          box-shadow: 0 1px 2px rgba(45, 45, 45, 0.04),
                      0 12px 28px -18px rgba(47, 107, 69, 0.35);
        }
        .dash-panel h2 {
          margin: 0 0 var(--space-1);
          font-size: var(--text-lg);
          font-weight: 600;
          color: var(--ink);
        }
        .dash-panel p.dash-panel-sub {
          margin: 0 0 var(--space-4);
          font-size: var(--text-sm);
          color: var(--muted);
        }
        .dash-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-2);
          height: 250px;
          text-align: center;
          color: var(--muted);
          font-size: var(--text-sm);
        }

        .dash-tip {
          background: var(--surface);
          border: 1px solid rgba(124, 199, 134, 0.45);
          border-radius: var(--radius-md);
          padding: var(--space-2) var(--space-3);
          box-shadow: 0 6px 18px -8px rgba(47, 107, 69, 0.45);
          font-size: var(--text-sm);
        }
        .dash-tip strong { display: block; color: var(--ink); font-weight: 600; }
        .dash-tip span { color: var(--muted); }

        @media (prefers-reduced-motion: reduce) {
          .dash-sprig { animation: none; }
        }

        @media (max-width: 560px) {
          .dash-page { padding: var(--space-4) var(--space-4) var(--space-12); }
          .dash-step span { min-width: 7rem; }
        }
      `}</style>

      <div className="dash-wrap">
        <header className="dash-head">
          <div>
            <h1 className="dash-greeting">Welcome back, {userName}</h1>
            <p className="dash-sub">Track your therapy progress and stay consistent</p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Link href="/levels" className="pill-btn pill-btn-outline">
              Practise
            </Link>
            <button
              className="pill-btn pill-btn-ghost"
              onClick={async () => {
                const supabase = createClient();
                await supabase.auth.signOut();
                router.push('/login');
                router.refresh();
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        {error ? (
          <div className="dash-panel" style={{ textAlign: 'center' }}>
            <p style={{ margin: '0 auto var(--space-4)', color: 'var(--muted)' }}>{error}</p>
            <button className="pill-btn pill-btn-primary" onClick={loadDashboardData}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="dash-controls">
              <div className="dash-seg" role="group" aria-label="Period length">
                {(['week', 'month'] as const).map((mode) => (
                  <button
                    key={mode}
                    data-on={period.mode === mode}
                    aria-pressed={period.mode === mode}
                    onClick={() => setPeriod((p) => setPeriodMode(p, mode))}
                  >
                    {mode === 'week' ? 'Week' : 'Month'}
                  </button>
                ))}
              </div>

              <div className="dash-step">
                <button
                  onClick={() => setPeriod((p) => shiftPeriod(p, -1))}
                  disabled={!resolved.canGoBack}
                  aria-label={`Previous ${unit}`}
                >
                  <Chevron dir="left" />
                </button>
                <span aria-live="polite">{resolved.label}</span>
                <button
                  onClick={() => setPeriod((p) => shiftPeriod(p, 1))}
                  disabled={!resolved.canGoForward}
                  aria-label={`Next ${unit}`}
                >
                  <Chevron dir="right" />
                </button>
              </div>
            </div>

            <div className="dash-cards">
              <Card
                title={`Sessions ${resolved.mode === 'week' ? 'This Week' : 'This Month'}`}
                sprig
                className="animate-fadeInUp stagger-1"
              >
                <p className="dash-value">{stats.finished}</p>
                <SessionSplitBar finished={stats.finished} unfinished={stats.unfinished} />
              </Card>

              <Card title="Form Quality" className="animate-fadeInUp stagger-2">
                <div className="dash-gauge">
                  <GaugeWheel
                    value={stats.avgForm}
                    size={150}
                    subLabel="avg form"
                    ariaLabel={`Average form quality ${stats.avgForm} percent`}
                  />
                </div>
                <DeltaLine delta={formatDelta(stats.avgForm, stats.prevAvgForm, unit)} />
              </Card>

              <Card title="Total Reps" className="animate-fadeInUp stagger-3">
                <p className="dash-value">{stats.totalReps.toLocaleString()}</p>
                <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
                  across {stats.totalSessions} {stats.totalSessions === 1 ? 'session' : 'sessions'}
                </p>
                <DeltaLine delta={formatDelta(stats.totalReps, stats.prevTotalReps, unit)} />
              </Card>

              <Card
                title={resolved.mode === 'week' ? 'Weekly Improvement' : 'Monthly Improvement'}
                sprig
                className="animate-fadeInUp stagger-4"
              >
                <div className="dash-gauge">
                  <GaugeWheel
                    value={stats.improvement}
                    signed
                    size={150}
                    subLabel={`vs last ${unit}`}
                    ariaLabel={`Form quality changed ${stats.improvement} percent versus last ${unit}`}
                  />
                </div>
                <p
                  className="dash-delta"
                  style={{
                    color: !stats.improvementComparable
                      ? 'var(--muted)'
                      : stats.improvement >= 0
                        ? '#2F6B45'
                        : '#9E4A22',
                  }}
                >
                  {!stats.improvementComparable
                    ? `No ${unit} before this to compare`
                    : stats.improvement >= 0
                      ? '↑ Growing'
                      : '↓ Needs a little water'}
                </p>
              </Card>
            </div>

            <div className="dash-charts">
              <section className="dash-panel animate-fadeInUp stagger-5">
                <h2>Form Quality Trend</h2>
                <p className="dash-panel-sub">Average score on the days you practised</p>
                {empty ? (
                  <Empty text="Complete a session and your line starts here" />
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={days} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="dashFormFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#5FAF6B" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#5FAF6B" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="dashFormLine" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#8FD08C" />
                          <stop offset="100%" stopColor="#2F6B45" />
                        </linearGradient>
                      </defs>
                      {/* Horizontal rules only: vertical grid lines on a daily
                          axis add a stripe per day and no information. */}
                      <CartesianGrid
                        vertical={false}
                        stroke="rgba(124, 199, 134, 0.30)"
                        strokeDasharray="2 6"
                      />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={14}
                        tick={{ fontSize: 12, fill: '#6B6B6B' }}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 50, 100]}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 12, fill: '#6B6B6B' }}
                      />
                      <Tooltip
                        content={<ChartTip suffix="%" name="Form" emptyText="Rest day" />}
                        cursor={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="formQuality"
                        // A rest day is a gap in the data, not a zero score —
                        // joining across it keeps the trend readable.
                        connectNulls
                        stroke="url(#dashFormLine)"
                        strokeWidth={3}
                        fill="url(#dashFormFill)"
                        dot={false}
                        activeDot={{ r: 5, fill: '#2F6B45', stroke: '#FFFFFF', strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </section>

              <section className="dash-panel animate-fadeInUp stagger-6">
                <h2>Sessions Per Day</h2>
                <p className="dash-panel-sub">Finished sessions, with anything left unfinished on top</p>
                {empty ? (
                  <Empty text="Your first session plants the first stem" />
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={days} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap="28%">
                      <defs>
                        <linearGradient id="dashBarFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7CC786" />
                          <stop offset="100%" stopColor="#2F6B45" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        vertical={false}
                        stroke="rgba(124, 199, 134, 0.30)"
                        strokeDasharray="2 6"
                      />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={{ stroke: 'rgba(201, 184, 138, 0.7)' }}
                        minTickGap={14}
                        tick={{ fontSize: 12, fill: '#6B6B6B' }}
                      />
                      <YAxis
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 12, fill: '#6B6B6B' }}
                      />
                      <Tooltip content={<ChartTip name="Sessions" />} cursor={{ fill: 'rgba(124, 199, 134, 0.12)' }} />
                      {/* Both segments carry the same top radius. Where they
                          stack, the upper one's square base covers the lower
                          one's rounding, so whichever ends up on top is the
                          only rounding that shows. */}
                      <Bar dataKey="finished" stackId="s" fill="url(#dashBarFill)" radius={[6, 6, 0, 0]} />
                      <Bar
                        dataKey="unfinished"
                        stackId="s"
                        fill="rgba(124, 199, 134, 0.35)"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Card({
  title,
  sprig = false,
  className,
  children,
}: {
  title: string;
  sprig?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`dash-card ${className ?? ''}`}>
      {sprig && <Sprig size={48} className="dash-sprig" />}
      <p className="dash-card-title">{title}</p>
      {children}
    </div>
  );
}

function DeltaLine({ delta }: { delta: Delta | null }) {
  if (!delta) return null;
  const color =
    delta.direction === 'up' ? '#2F6B45' : delta.direction === 'down' ? '#9E4A22' : 'var(--muted)';
  return (
    <p className="dash-delta" style={{ color }}>
      {delta.text}
    </p>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="dash-empty">
      <Sprig size={40} />
      <p style={{ margin: 0 }}>{text}</p>
    </div>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
    </svg>
  );
}

/** Recharts passes these in; typing them loosely keeps the chart config readable. */
function ChartTip({ active, payload, label, name, suffix = '', emptyText }: any) {
  if (!active || !payload?.length) return null;

  // A day the patient rested has no score at all, which is not the same as a
  // score of zero — reporting "Form: 0%" for a rest day would read as a
  // catastrophic session rather than as no session.
  const missing = payload.every((entry: any) => entry.value === null || entry.value === undefined);
  if (missing && emptyText) {
    return (
      <div className="dash-tip">
        <strong>{label}</strong>
        <span>{emptyText}</span>
      </div>
    );
  }

  // A stacked bar hands back one entry per series; the day's answer is the sum.
  const total = payload.reduce((sum: number, entry: any) => sum + (entry.value ?? 0), 0);

  return (
    <div className="dash-tip">
      <strong>{label}</strong>
      <span>
        {name}: {total}
        {suffix}
      </span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: 'var(--space-6)' }}>
      <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
        <div className="skeleton" style={{ height: 36, width: 280, marginBottom: 'var(--space-2)' }} />
        <div className="skeleton" style={{ height: 18, width: 320, marginBottom: 'var(--space-8)' }} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-8)',
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 190, borderRadius: 'var(--radius-xl)' }} />
          ))}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
            gap: 'var(--space-6)',
          }}
        >
          {[0, 1].map((i) => (
            <div key={i} className="skeleton" style={{ height: 340, borderRadius: 'var(--radius-xl)' }} />
          ))}
        </div>
        <span className="sr-only">Loading your progress</span>
      </div>
    </div>
  );
}
