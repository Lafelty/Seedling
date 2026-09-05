'use client';

import Link from 'next/link';
import ProgressTabs from '@/components/ProgressTabs';
import { useRouter } from 'next/navigation';
import { loadProgressSnapshot } from '@/lib/progressSync';
import { useEffect, useMemo, useState } from 'react';
import { getProgress, setProgressUid, applyServerProgress, type ProgressData } from '@/lib/progress';
import { createClient } from '@/lib/supabase/client';
import { startOfMonth, endOfMonth, eachDayOfInterval, format, isSameDay, isSameMonth, addMonths } from 'date-fns';
import { DayFace, MOOD_BG, computeDayMood, type DayMood } from '@/components/DayFace';
import { StarBadge, StarGlyph } from '@/components/StarBadge';

interface DaySession {
  id: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  completed_reps: number;
  target_reps: number;
  form_quality_score: number | null;
  exercise_name: string;
}

export default function ProgressPage() {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [sessions, setSessions] = useState<DaySession[]>([]);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const [loadError, setLoadError] = useState<string | null>(null);
  const [monthError, setMonthError] = useState<string | null>(null);
  const [monthLoading, setMonthLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!user) { router.replace('/login'); return; }
        if (cancelled) return;
        setProgressUid(user.id);
        setProgress(getProgress());
        const { profile, completedDates } = await loadProgressSnapshot(supabase, user.id);
        if (!cancelled) setProgress(applyServerProgress(profile.total_stars ?? 0, completedDates));
      } catch {
        if (!cancelled) setLoadError('Your latest progress could not be loaded. Any progress shown is the last saved copy.');
      }
    })();
    return () => { cancelled = true; };
  }, [router, refreshKey]);

  // Ignore late responses when the patient changes months quickly.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setMonthLoading(true);
    setMonthError(null);
    setSessions([]);
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error('Sign in to load session history.');
        const { data, error } = await supabase.from('therapy_sessions')
          .select('id, started_at, completed_at, duration_seconds, completed_reps, target_reps, form_quality_score, exercises(name)')
          .eq('user_id', user.id)
          .gte('started_at', startOfMonth(viewMonth).toISOString())
          .lte('started_at', endOfMonth(viewMonth).toISOString())
          .order('started_at', { ascending: true }).abortSignal(controller.signal);
        if (error) throw error;
        if (!cancelled) setSessions((data ?? []).map(row => ({
          id: row.id, started_at: row.started_at, completed_at: row.completed_at,
          duration_seconds: row.duration_seconds, completed_reps: row.completed_reps,
          target_reps: row.target_reps,
          form_quality_score: row.form_quality_score === null ? null : Number(row.form_quality_score),
          exercise_name: row.exercises?.name ?? 'Exercise',
        })));
      } catch {
        if (!cancelled) setMonthError('This month’s sessions could not be loaded. Please retry.');
      } finally {
        if (!cancelled) setMonthLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [viewMonth, refreshKey]);

  function changeMonth(delta: number) {
    const next = addMonths(viewMonth, delta);
    setViewMonth(next);
    setSelectedDay(format(isSameMonth(next, new Date()) ? new Date() : next, 'yyyy-MM-dd'));
    setMonthLoading(true);
  }

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, DaySession[]>();
    for (const s of sessions) {
      const key = format(new Date(s.started_at), 'yyyy-MM-dd');
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [sessions]);

  if (!progress) {
    if (loadError) return <main className="max-w-md mx-auto p-8"><p role="alert">{loadError}</p><button className="btn btn-primary mt-4" onClick={() => setRefreshKey(k => k + 1)}>Retry loading</button></main>;
    return <ProgressSkeleton />;
  }

  const today = new Date();
  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const selectedSessions = sessionsByDay.get(selectedDay) ?? [];
  const selectedDate = new Date(`${selectedDay}T00:00:00`);
  const selectedCompleted = progress.completedDates.includes(selectedDay)
    || selectedSessions.some(s => s.completed_at);

  return (
    <>
    <main
      className="min-h-screen max-w-4xl mx-auto px-4 py-8 pb-24"
      style={{ background: 'linear-gradient(180deg, rgba(74, 107, 90, 0.07), rgba(107, 143, 122, 0.03) 240px, transparent 480px)' }}
    >
      <header className="patient-heading">
        <h1>Progress</h1>
        <p>Your sessions, day by day. Rest days belong here, too.</p>
      </header>
      <ProgressTabs view="journal" />

      {/* Stats Grid */}
      {loadError && <div className="card mb-6"><p role="alert">{loadError}</p><button className="btn mt-3" onClick={() => setRefreshKey(k => k + 1)}>Retry loading</button></div>}
      <dl className="progress-summary">
        <div><dt>Total stars</dt><dd>{progress.totalStars}</dd></div>
        <div><dt>Day streak</dt><dd>{progress.completionStreak}</dd></div>
        <div><dt>Tree stage</dt><dd className="capitalize">{progress.treeStage}</dd></div>
      </dl>

      {/* Calendar */}
      <div
        className="card mb-8"
        style={{
          background: 'linear-gradient(180deg, rgba(107, 143, 122, 0.08), var(--surface) 55%)',
          borderColor: 'rgba(74, 107, 90, 0.20)',
        }}
      >
        <div className="calendar-heading">
          <h2 style={{ color: 'var(--primary)' }}>{format(viewMonth, 'MMMM yyyy')}</h2>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              onClick={() => changeMonth(-1)}
              aria-label="Previous month"
              style={{
                width: '48px', height: '48px', flexShrink: 0, borderRadius: 'var(--radius-full)',
                border: '1px solid rgba(74, 107, 90, 0.35)', background: 'rgba(107, 143, 122, 0.12)',
                color: 'var(--primary)', cursor: 'pointer', fontSize: 'var(--text-base)', fontWeight: 700,
              }}
            >
              ‹
            </button>
            <button
              onClick={() => changeMonth(1)}
              disabled={isSameMonth(viewMonth, today)}
              aria-label="Next month"
              style={{
                width: '48px', height: '48px', flexShrink: 0, borderRadius: 'var(--radius-full)',
                border: '1px solid rgba(74, 107, 90, 0.35)', background: 'rgba(107, 143, 122, 0.12)',
                color: 'var(--primary)', cursor: isSameMonth(viewMonth, today) ? 'default' : 'pointer',
                opacity: isSameMonth(viewMonth, today) ? 0.35 : 1, fontSize: 'var(--text-base)', fontWeight: 700,
              }}
            >
              ›
            </button>
          </div>
        </div>

        <div className="calendar-compact">
          <label htmlFor="journal-day">Choose a day</label>
          <select id="journal-day" value={selectedDay} onChange={event => setSelectedDay(event.target.value)}>
            {daysInMonth.filter(day => day <= today).map(day => {
              const key = format(day, 'yyyy-MM-dd');
              const count = sessionsByDay.get(key)?.length ?? 0;
              return <option key={key} value={key}>{format(day, 'EEE, MMM d')}{count ? ` · ${count} session${count === 1 ? '' : 's'}` : ''}</option>;
            })}
          </select>
          {(monthLoading || monthError) && <div className="mt-4"><p role={monthError ? 'alert' : 'status'}>{monthError ?? 'Loading sessions…'}</p>{monthError && <button className="btn mt-3" onClick={() => setRefreshKey(k => k + 1)}>Retry loading</button>}</div>}
        </div>
        <div className="calendar-weekdays" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <div key={day} style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--primary)', fontWeight: 700 }}>
              {day}
            </div>
          ))}
        </div>

        <div className="calendar-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-2)' }}>
          {Array.from({ length: (daysInMonth[0].getDay() + 6) % 7 }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}

          {monthLoading || monthError ? (
            <div className="col-span-7 py-8 text-center">
              <p role={monthError ? 'alert' : 'status'}>{monthError ?? 'Loading sessions…'}</p>
              {monthError && <button className="btn mt-3" onClick={() => setRefreshKey(k => k + 1)}>Retry loading</button>}
            </div>
          ) : daysInMonth.map((day) => {
            const isToday = isSameDay(day, today);
            const isFuture = day > today && !isToday;
            const dayStr = format(day, 'yyyy-MM-dd');
            const daySessions = sessionsByDay.get(dayStr) ?? [];
            const completedSessions = daySessions.filter(s => s.completed_at);
            const hasCompleted = progress.completedDates.includes(dayStr)
              || completedSessions.length > 0;
            const hasPartial = !hasCompleted && daySessions.length > 0;
            const isSelected = dayStr === selectedDay;

            const formScores = completedSessions
              .map(s => s.form_quality_score)
              .filter((v): v is number => v != null);
            const avgForm = formScores.length > 0
              ? formScores.reduce((a, b) => a + b, 0) / formScores.length
              : null;
            const isGreat = hasCompleted
              && (completedSessions.length >= 2 || (avgForm != null && avgForm >= 80));

            const mood: DayMood = isFuture
              ? 'future'
              : isGreat
              ? 'great'
              : hasCompleted
              ? 'happy'
              : hasPartial
              ? 'partial'
              : 'rest';

            return (
              <div key={day.toISOString()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    fontWeight: isToday ? 700 : 600,
                    color: isToday ? 'var(--primary)' : 'var(--muted)',
                    opacity: isFuture ? 0.5 : 1,
                  }}
                >
                  {format(day, 'd')}
                </span>
                <button
                  onClick={() => !isFuture && setSelectedDay(dayStr)}
                  disabled={isFuture}
                  aria-label={`${format(day, 'MMMM d, yyyy')} — ${hasCompleted ? 'Session complete' : hasPartial ? 'Partial session' : isFuture ? 'Upcoming day' : 'Rest day'}`}
                  aria-pressed={isSelected}
                  title={
                    mood === 'great' ? 'Amazing day — tap to view'
                    : mood === 'happy' ? 'Session complete — tap to view'
                    : mood === 'partial' ? 'Partial session — tap to view'
                    : isFuture ? '' : 'Rest day — tap to view'
                  }
                  style={{
                    width: '100%',
                    maxWidth: '72px',
                    aspectRatio: '1',
                    padding: 0,
                    borderRadius: '50%',
                    background: MOOD_BG[mood],
                    border: 'none',
                    boxShadow: isSelected
                      ? '0 0 0 2px var(--surface), 0 0 0 4px #C9B88A'
                      : 'none',
                    cursor: isFuture ? 'default' : 'pointer',
                    transition: 'transform var(--dur-fast, 150ms) ease, box-shadow var(--dur-fast, 150ms) ease',
                  }}
                >
                  <DayFace mood={mood} />
                </button>
              </div>
            );
          })}
        </div>

        {/* The legend belongs to the visual calendar, not the compact picker. */}
        <div className="calendar-legend" style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', marginTop: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: MOOD_BG.great, display: 'inline-block' }} />
            Amazing day
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: MOOD_BG.happy, display: 'inline-block' }} />
            Session complete
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: MOOD_BG.partial, display: 'inline-block' }} />
            Partial session
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: MOOD_BG.rest, display: 'inline-block' }} />
            Rest day
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid #C9B88A', display: 'inline-block' }} />
            Selected
          </span>
        </div>
      </div>

      {/* Day Detail */}
      <div
        className="card mb-8 animate-fadeIn"
        style={{
          background: 'linear-gradient(180deg, rgba(107, 143, 122, 0.08), var(--surface) 55%)',
          borderColor: 'rgba(74, 107, 90, 0.20)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          <h2 style={{ color: 'var(--primary)' }}>{format(selectedDate, 'EEEE, MMMM d')}</h2>
          {!monthLoading && !monthError && selectedCompleted && (
            <StarBadge as="span" style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-1) var(--space-3)' }}>
              <StarGlyph size={14} />
              <span>Star earned</span>
            </StarBadge>
          )}
        </div>

        {monthLoading || monthError ? (
          <p style={{ color: 'var(--muted)' }}>{monthLoading ? 'Loading session details…' : 'Session details are unavailable until this month loads.'}</p>
        ) : selectedSessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto var(--space-3)', opacity: 0.6 }}>
              <path d="M12 22v-7" />
              <path d="M12 15q-6 0-7-8 7 1 7 8Z" />
              <path d="M12 13q0-6 7-9-1 9-7 9Z" />
            </svg>
            <p style={{ color: 'var(--muted)' }}>
              {selectedCompleted
                ? 'A session was completed this day — details live in your garden history.'
                : 'A resting day — the garden was quiet.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {selectedSessions.map((s) => {
              const mins = Math.floor((s.duration_seconds ?? 0) / 60);
              const secs = (s.duration_seconds ?? 0) % 60;
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-4)',
                    padding: 'var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                    background: s.completed_at
                      ? 'linear-gradient(160deg, rgba(74, 107, 90, 0.08), var(--surface) 70%)'
                      : 'var(--surface)',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: 'var(--radius-full)',
                      background: s.completed_at ? 'var(--primary)' : 'var(--border)',
                      color: s.completed_at ? 'white' : 'var(--muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {s.completed_at ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5L19 7" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 3" />
                      </svg>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                      {s.exercise_name}
                      {!s.completed_at && (
                        <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--muted)' }}>
                          (partial)
                        </span>
                      )}
                    </p>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
                      {format(new Date(s.started_at), 'h:mm a')}
                      {' · '}{s.completed_reps}/{s.target_reps} reps
                      {s.duration_seconds != null && <>{' · '}{mins > 0 ? `${mins}m ` : ''}{secs}s</>}
                      {s.form_quality_score != null && <>{' · '}target-pose time {Math.round(s.form_quality_score)}%</>}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Milestones — the journey to a real tree */}
      <MilestoneJourney totalStars={progress.totalStars} />
    </main>


    </>
  );
}

function ProgressSkeleton() {
  return (
    <main className="min-h-screen max-w-4xl mx-auto px-4 py-8 pb-24">
      {/* Header */}
      <div className="mb-8">
        <div className="skeleton" style={{ width: '190px', height: '32px', marginBottom: 'var(--space-2)' }} />
        <div className="skeleton" style={{ width: '260px', height: '16px' }} />
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)', marginBottom: 'var(--space-12)' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton" style={{ height: '132px', borderRadius: 'var(--radius-lg)' }} />
        ))}
      </div>

      {/* Calendar */}
      <div className="card mb-8">
        <div className="skeleton" style={{ width: '160px', height: '24px', marginBottom: 'var(--space-6)' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-2)' }}>
          {[...Array(35)].map((_, i) => (
            <div key={i} className="skeleton" style={{ aspectRatio: '1', borderRadius: '50%' }} />
          ))}
        </div>
      </div>

      {/* Milestones */}
      <div className="card">
        <div className="skeleton" style={{ width: '220px', height: '24px', marginBottom: 'var(--space-6)' }} />
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton" style={{ height: '56px', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)' }} />
        ))}
      </div>
    </main>
  );
}

const CheckIcon = ({ size = 18, stroke = 'white' }: { size?: number; stroke?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12l5 5L19 7" />
  </svg>
);

/** A colored spine segment that "grows" (scaleY 0→1) once mounted, so the
 *  path from one milestone to the next appears to sprout upward. */
function Connector({ filled, grown, delay, top = false }: { filled: boolean; grown: boolean; delay: string; top?: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        width: '3px',
        ...(top ? { height: '16px' } : { flex: 1, minHeight: '18px' }),
        background: 'var(--border)',
        borderRadius: '3px',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, var(--primary), #6B8F7A)',
          borderRadius: '3px',
          transformOrigin: 'top',
          transform: `scaleY(${filled && grown ? 1 : 0})`,
          transition: 'transform var(--dur-slow) var(--ease-out)',
          transitionDelay: delay,
        }}
      />
    </div>
  );
}

const JOURNEY_NODES = [
  { stars: 1, label: 'First sapling', sub: 'Your seed takes root', icon: '🌱' },
  { stars: 2, label: 'Growing tree', sub: 'Branches reach upward', icon: '🌿' },
  { stars: 3, label: 'Mature tree', sub: 'Full and strong', icon: '🌳' },
] as const;

const REAL_TREE_STARS = 4;

function MilestoneJourney({ totalStars }: { totalStars: number }) {
  // Toggle after mount so the spine segments animate in from empty.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const currentIndex = JOURNEY_NODES.findIndex((n) => totalStars < n.stars);
  const realTreeReached = totalStars >= REAL_TREE_STARS;
  const starsToRealTree = Math.max(0, REAL_TREE_STARS - totalStars);

  return (
    <div
      className="card"
      style={{
        background: 'linear-gradient(180deg, rgba(107, 143, 122, 0.08), var(--surface) 55%)',
        borderColor: 'rgba(74, 107, 90, 0.20)',
      }}
    >
      <h2 style={{ marginBottom: 'var(--space-1)', color: 'var(--primary)' }}>Your journey to a real tree</h2>
      <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-6)' }}>
        Every star grows your garden. At {REAL_TREE_STARS} stars, you reach your real-tree milestone. Planting requires a separate confirmation from a partner.
      </p>

      {/* Growth stages */}
      <div>
        {JOURNEY_NODES.map((node, i) => {
          const reached = totalStars >= node.stars;
          const isCurrent = i === currentIndex;
          const nextReached = i < JOURNEY_NODES.length - 1
            ? totalStars >= JOURNEY_NODES[i + 1].stars
            : realTreeReached;

          return (
            <div key={node.stars} style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'stretch' }}>
              {/* Spine column */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '44px', flexShrink: 0 }}>
                {i > 0 && <Connector filled={reached} grown={grown} delay={`${i * 120}ms`} top />}
                <div
                  className={isCurrent ? 'gx-node-pulse' : undefined}
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: 'var(--radius-full)',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'var(--text-lg)',
                    background: reached ? 'var(--primary)' : 'var(--surface)',
                    border: isCurrent ? '2px solid var(--primary)' : reached ? 'none' : '2px solid var(--border)',
                    boxShadow: reached ? '0 2px 8px rgba(74, 107, 90, 0.25)' : 'none',
                    filter: reached || isCurrent ? 'none' : 'grayscale(1) opacity(0.55)',
                  }}
                >
                  {reached ? <CheckIcon /> : node.icon}
                </div>
                {i < JOURNEY_NODES.length - 1 && <Connector filled={nextReached} grown={grown} delay={`${i * 120 + 120}ms`} />}
              </div>

              {/* Label */}
              <div style={{ flex: 1, paddingTop: i > 0 ? '16px' : 0, paddingBottom: 'var(--space-5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <p style={{ fontWeight: 600, color: reached || isCurrent ? 'var(--ink)' : 'var(--muted)' }}>{node.label}</p>
                  {isCurrent && (
                    <span
                      style={{
                        fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--primary)',
                        background: 'rgba(74, 107, 90, 0.12)', padding: '2px var(--space-2)',
                        borderRadius: 'var(--radius-full)',
                      }}
                    >
                      You&apos;re here
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginTop: '2px' }}>
                  {reached ? node.sub : `${Math.max(0, node.stars - totalStars)} more ${node.stars - totalStars === 1 ? 'star' : 'stars'}`}
                </p>
              </div>
            </div>
          );
        })}

        {/* Real-tree payoff — the hero at the end of the spine */}
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '44px', flexShrink: 0 }}>
            <Connector filled={realTreeReached} grown={grown} delay={`${JOURNEY_NODES.length * 120}ms`} top />
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 'var(--space-1)' }}>
            <div
              className={realTreeReached ? 'gx-hero-glow' : undefined}
              style={{
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-5)',
                background: realTreeReached
                  ? 'linear-gradient(135deg, rgba(201, 184, 138, 0.30), rgba(74, 107, 90, 0.14))'
                  : 'linear-gradient(135deg, rgba(201, 184, 138, 0.12), rgba(107, 143, 122, 0.06))',
                border: `1px solid ${realTreeReached ? 'rgba(201, 184, 138, 0.7)' : 'rgba(201, 184, 138, 0.4)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                <span style={{ fontSize: '2rem', lineHeight: 1, filter: realTreeReached ? 'none' : 'grayscale(0.4) opacity(0.85)' }}>🌳</span>
                <div>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2 }}>
                    {realTreeReached ? 'Real-tree milestone reached' : 'Your real-tree milestone'}
                  </p>
                  {realTreeReached && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '4px', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--primary)' }}>
                      <CheckIcon size={14} stroke="var(--primary)" /> Star goal reached
                    </span>
                  )}
                </div>
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: realTreeReached ? 'var(--ink)' : 'var(--muted)' }}>
                {realTreeReached
                  ? 'You have reached the star goal. Planting has not been confirmed in the app. Your therapist can share any available partner updates.'
                  : `Keep tending your garden — ${starsToRealTree} more ${starsToRealTree === 1 ? 'star' : 'stars'} to reach this milestone.`}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
