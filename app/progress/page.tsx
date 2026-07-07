'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getProgress, setProgressUid, type ProgressData } from '@/lib/progress';
import { createClient } from '@/lib/supabase/client';
import { startOfMonth, endOfMonth, eachDayOfInterval, format, isSameDay, isSameMonth, addMonths } from 'date-fns';
import { DayFace, MOOD_BG, computeDayMood, type DayMood } from '@/components/DayFace';

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

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setProgressUid(user.id);
      setProgress(getProgress());
    })();
  }, []);

  // Load this month's sessions so each day can be inspected.
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('therapy_sessions')
        .select('id, started_at, completed_at, duration_seconds, completed_reps, target_reps, form_quality_score, exercises(name)')
        .eq('user_id', user.id)
        .gte('started_at', startOfMonth(viewMonth).toISOString())
        .lte('started_at', endOfMonth(viewMonth).toISOString())
        .order('started_at', { ascending: true });

      if (error) {
        console.error('Error loading sessions:', error);
        return;
      }

      setSessions(
        (data ?? []).map((row: any) => ({
          id: row.id,
          started_at: row.started_at,
          completed_at: row.completed_at,
          duration_seconds: row.duration_seconds,
          completed_reps: row.completed_reps,
          target_reps: row.target_reps,
          form_quality_score: row.form_quality_score === null ? null : Number(row.form_quality_score),
          exercise_name: row.exercises?.name ?? 'Exercise',
        }))
      );
    })();
  }, [viewMonth]);

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
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p style={{ color: 'var(--muted)' }}>Loading progress...</p>
        </div>
      </div>
    );
  }

  const today = new Date();
  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const selectedSessions = sessionsByDay.get(selectedDay) ?? [];
  const selectedDate = new Date(`${selectedDay}T00:00:00`);
  const selectedCompleted = progress.completedDates.includes(selectedDay)
    || selectedSessions.some(s => s.completed_at);

  // Thresholds match getTreeStage() in lib/progress.ts (sapling 6, young 16, mature 31).
  const milestones = [
    { stars: 6, label: 'Sapling unlocked', icon: '🌱', reached: progress.totalStars >= 6 },
    { stars: 16, label: 'Growing tree', icon: '🌿', reached: progress.totalStars >= 16 },
    { stars: 31, label: 'Mature tree', icon: '🌳', reached: progress.totalStars >= 31 },
    { stars: 50, label: 'Real tree planted! 🌳', icon: '🏞️', reached: progress.totalStars >= 50 },
  ];

  return (
    <>
    <main
      className="min-h-screen max-w-4xl mx-auto px-4 py-8 pb-24"
      style={{ background: 'linear-gradient(180deg, rgba(74, 107, 90, 0.07), rgba(107, 143, 122, 0.03) 240px, transparent 480px)' }}
    >
      {/* Header */}
      <div className="mb-8 animate-fadeIn" style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
            <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
          </svg>
          <h1 style={{ color: 'var(--primary)' }}>Growth Journal</h1>
        </div>
        <p style={{ color: 'var(--muted)' }}>Every session waters your garden — watch your healing take root</p>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-12)' }}>
        <div
          className="card text-center animate-scaleIn stagger-1"
          style={{
            background: 'linear-gradient(160deg, rgba(201, 184, 138, 0.20), rgba(107, 143, 122, 0.10) 70%)',
            borderColor: 'rgba(74, 107, 90, 0.25)',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 20 20" fill="#C9B88A" style={{ margin: '0 auto var(--space-2)' }}>
            <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
          </svg>
          <p style={{ color: 'var(--primary)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Total Stars</p>
          <p style={{ fontSize: 'var(--text-3xl)', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--primary)' }}>
            {progress.totalStars}
          </p>
        </div>

        <div
          className="card text-center animate-scaleIn stagger-2"
          style={{
            background: 'linear-gradient(160deg, rgba(74, 107, 90, 0.20), rgba(107, 143, 122, 0.08) 70%)',
            borderColor: 'rgba(74, 107, 90, 0.25)',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto var(--space-2)' }}>
            <path d="M12 22v-7" />
            <path d="M12 15q-6 0-7-8 7 1 7 8Z" />
            <path d="M12 13q0-6 7-9-1 9-7 9Z" />
          </svg>
          <p style={{ color: 'var(--primary)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Day Streak</p>
          <p style={{ fontSize: 'var(--text-3xl)', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--primary)' }}>
            {progress.completionStreak}
          </p>
        </div>

        <div
          className="card text-center animate-scaleIn stagger-3"
          style={{
            background: 'linear-gradient(160deg, rgba(107, 143, 122, 0.22), rgba(74, 107, 90, 0.08) 70%)',
            borderColor: 'rgba(74, 107, 90, 0.25)',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto var(--space-2)' }}>
            <path d="M12 22v-5" />
            <path d="M9 8a3 3 0 0 1 6 0c1.5.5 3 2 3 4.5 0 3-2.5 4.5-6 4.5s-6-1.5-6-4.5C6 10 7.5 8.5 9 8Z" />
          </svg>
          <p style={{ color: 'var(--primary)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Tree Stage</p>
          <p style={{ fontSize: 'var(--text-xl)', fontFamily: 'var(--font-display)', fontWeight: 600, textTransform: 'capitalize', color: 'var(--primary)' }}>
            {progress.treeStage}
          </p>
        </div>
      </div>

      {/* Calendar */}
      <div
        className="card mb-8"
        style={{
          background: 'linear-gradient(180deg, rgba(107, 143, 122, 0.08), var(--surface) 55%)',
          borderColor: 'rgba(74, 107, 90, 0.20)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
          <h2 style={{ color: 'var(--primary)' }}>{format(viewMonth, 'MMMM yyyy')}</h2>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              onClick={() => setViewMonth(m => addMonths(m, -1))}
              aria-label="Previous month"
              style={{
                width: '36px', height: '36px', borderRadius: 'var(--radius-full)',
                border: '1px solid rgba(74, 107, 90, 0.35)', background: 'rgba(107, 143, 122, 0.12)',
                color: 'var(--primary)', cursor: 'pointer', fontSize: 'var(--text-base)', fontWeight: 700,
              }}
            >
              ‹
            </button>
            <button
              onClick={() => setViewMonth(m => addMonths(m, 1))}
              disabled={isSameMonth(viewMonth, today)}
              aria-label="Next month"
              style={{
                width: '36px', height: '36px', borderRadius: 'var(--radius-full)',
                border: '1px solid rgba(74, 107, 90, 0.35)', background: 'rgba(107, 143, 122, 0.12)',
                color: 'var(--primary)', cursor: isSameMonth(viewMonth, today) ? 'default' : 'pointer',
                opacity: isSameMonth(viewMonth, today) ? 0.35 : 1, fontSize: 'var(--text-base)', fontWeight: 700,
              }}
            >
              ›
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <div key={day} style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--primary)', fontWeight: 700 }}>
              {day}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-2)' }}>
          {Array.from({ length: (daysInMonth[0].getDay() + 6) % 7 }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}

          {daysInMonth.map((day) => {
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
                  aria-label={format(day, 'MMMM d')}
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

        {/* Legend */}
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', marginTop: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
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
          {selectedCompleted && (
            <span className="star-badge" style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-1) var(--space-3)' }}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
              </svg>
              <span>Star earned</span>
            </span>
          )}
        </div>

        {selectedSessions.length === 0 ? (
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
                      {s.form_quality_score != null && <>{' · '}form {Math.round(s.form_quality_score)}%</>}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Milestones */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(180deg, rgba(107, 143, 122, 0.08), var(--surface) 55%)',
          borderColor: 'rgba(74, 107, 90, 0.20)',
        }}
      >
        <h2 style={{ marginBottom: 'var(--space-6)', color: 'var(--primary)' }}>Growth Milestones</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {milestones.map((milestone) => (
            <div
              key={milestone.stars}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: milestone.reached
                  ? 'linear-gradient(160deg, rgba(74, 107, 90, 0.10), var(--surface) 70%)'
                  : 'transparent',
                border: `1px solid var(--border)`,
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-full)',
                  background: milestone.reached ? 'var(--primary)' : 'var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--text-lg)',
                  flexShrink: 0,
                  filter: milestone.reached ? 'none' : 'grayscale(1) opacity(0.6)',
                }}
              >
                {milestone.icon}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>{milestone.label}</p>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
                  {milestone.reached ? 'Completed!' : `${milestone.stars} stars required`}
                </p>
              </div>
              {milestone.reached && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5L19 7" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <Link href="/" className="nav-item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z" />
            <path d="M12 19v3" />
          </svg>
          <span>Garden</span>
        </Link>
        <Link href="/progress" className="nav-item active">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3v18h18" />
            <path d="M7 16l4-8 4 4 4-12" />
          </svg>
          <span>Progress</span>
        </Link>
      </nav>
    </>
  );
}
