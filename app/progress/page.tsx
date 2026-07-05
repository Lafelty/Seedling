'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getProgress, setProgressUid, type ProgressData } from '@/lib/progress';
import { createClient } from '@/lib/supabase/client';
import { startOfMonth, endOfMonth, eachDayOfInterval, format, isSameDay } from 'date-fns';

export default function ProgressPage() {
  const [progress, setProgress] = useState<ProgressData | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setProgressUid(user.id);
      setProgress(getProgress());
    })();
  }, []);

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
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Thresholds match getTreeStage() in lib/progress.ts (sapling 6, young 16, mature 31).
  const milestones = [
    { stars: 6, label: 'Sapling unlocked', reached: progress.totalStars >= 6 },
    { stars: 16, label: 'Growing tree', reached: progress.totalStars >= 16 },
    { stars: 31, label: 'Mature tree', reached: progress.totalStars >= 31 },
    { stars: 50, label: 'Real tree planted! 🌳', reached: progress.totalStars >= 50 },
  ];

  return (
    <>
    <main className="min-h-screen max-w-4xl mx-auto px-4 py-8 pb-24">
      <div className="mb-8 animate-fadeIn">
        <h1 style={{ marginBottom: 'var(--space-2)' }}>Your Progress</h1>
        <p style={{ color: 'var(--muted)' }}>Track your journey and celebrate milestones</p>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-12)' }}>
        <div className="card text-center animate-scaleIn stagger-1">
          <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-2)' }}>Total Stars</p>
          <p style={{ fontSize: 'var(--text-3xl)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
            {progress.totalStars}
          </p>
        </div>

        <div className="card text-center animate-scaleIn stagger-2">
          <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-2)' }}>Current Streak</p>
          <p style={{ fontSize: 'var(--text-3xl)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
            {progress.completionStreak}
          </p>
        </div>

        <div className="card text-center animate-scaleIn stagger-3">
          <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-2)' }}>Tree Stage</p>
          <p style={{ fontSize: 'var(--text-xl)', fontFamily: 'var(--font-display)', fontWeight: 600, textTransform: 'capitalize' }}>
            {progress.treeStage}
          </p>
        </div>
      </div>

      {/* Calendar */}
      <div className="card mb-8">
        <h2 style={{ marginBottom: 'var(--space-6)' }}>{format(today, 'MMMM yyyy')}</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--muted)', fontWeight: 600 }}>
              {day}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-2)' }}>
          {Array.from({ length: daysInMonth[0].getDay() }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}

          {daysInMonth.map((day) => {
            const isToday = isSameDay(day, today);
            const isPast = day < today && !isToday;
            const isFuture = day > today;
            const dayStr = format(day, 'yyyy-MM-dd');
            const hasSession = progress.completedDates.includes(dayStr);

            return (
              <div
                key={day.toISOString()}
                style={{
                  aspectRatio: '1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  background: hasSession
                    ? 'var(--primary)'
                    : isFuture
                    ? 'transparent'
                    : 'var(--border)',
                  color: hasSession ? 'white' : 'var(--ink)',
                  border: isToday ? '2px solid var(--primary)' : 'none',
                  opacity: isFuture ? 0.3 : 1,
                }}
              >
                {format(day, 'd')}
              </div>
            );
          })}
        </div>
      </div>

      {/* Milestones */}
      <div className="card">
        <h2 style={{ marginBottom: 'var(--space-6)' }}>Milestones</h2>

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
                background: milestone.reached ? 'var(--surface)' : 'transparent',
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
                  color: milestone.reached ? 'white' : 'var(--muted)',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {milestone.reached ? '✓' : milestone.stars}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>{milestone.label}</p>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
                  {milestone.reached ? 'Completed!' : `${milestone.stars} stars required`}
                </p>
              </div>
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
