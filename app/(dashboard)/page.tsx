'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getProgress, getDayStrip, type ProgressData, type DayStatus } from '@/lib/progress';

export default function DashboardPage() {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [dayStrip, setDayStrip] = useState<DayStatus[]>([]);

  useEffect(() => {
    setProgress(getProgress());
    setDayStrip(getDayStrip());
  }, []);

  if (!progress) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p style={{ color: 'var(--muted)' }}>Loading your garden...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen">
      {/* Tree Hero Card */}
      <section className="w-full" style={{ minHeight: '60vh', position: 'relative' }}>
        <div className="max-w-2xl mx-auto px-4 py-12 flex flex-col items-center justify-center" style={{ minHeight: '60vh' }}>
          {/* Tree Illustration */}
          <div className="w-full max-w-md mb-8">
            <TreeIllustration stage={progress.treeStage} />
          </div>

          {/* Star Count */}
          <div className="star-badge text-lg">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
            </svg>
            <span>{progress.totalStars} stars earned</span>
          </div>
        </div>
      </section>

      {/* Today's Progress */}
      <section className="max-w-2xl mx-auto px-4 py-8">
        <div className="card mb-8">
          <h2 style={{ marginBottom: 'var(--space-4)' }}>Today's Progress</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-6)' }}>
            {progress.dailyStars}/3 stars today
          </p>

          {/* Progress bar */}
          <div
            style={{
              width: '100%',
              height: '8px',
              background: 'var(--border)',
              borderRadius: 'var(--radius-full)',
              overflow: 'hidden',
              marginBottom: 'var(--space-8)',
            }}
          >
            <div
              style={{
                width: `${(progress.dailyStars / 3) * 100}%`,
                height: '100%',
                background: 'var(--primary)',
                transition: 'width var(--dur-slow) var(--ease-out)',
              }}
            />
          </div>

          {/* Start Session CTA */}
          <Link href="/session" className="btn btn-primary w-full text-center">
            Start Today's Session
          </Link>
        </div>

        {/* Week Strip */}
        <div className="mb-8">
          <h3 style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--text-lg)' }}>This Week</h3>
          <div className="flex gap-2 overflow-x-auto pb-4">
            {dayStrip.map((day, i) => {
              const date = new Date(day.date);
              const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
              const today = new Date().toISOString().split('T')[0];
              const isToday = day.date === today;
              const isFuture = day.date > today;

              return (
                <div
                  key={day.date}
                  className="flex-shrink-0 flex flex-col items-center gap-2"
                  style={{ minWidth: '48px' }}
                >
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: 'var(--radius-md)',
                      background: day.completed
                        ? 'var(--primary)'
                        : isFuture
                        ? 'var(--border)'
                        : 'var(--muted)',
                      border: isToday ? '2px solid var(--primary)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 'var(--text-xs)',
                      color: day.completed ? 'white' : 'var(--ink)',
                      fontWeight: 600,
                    }}
                  >
                    {date.getDate()}
                  </div>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                    {dayName}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Streak */}
        {progress.completionStreak > 0 && (
          <div className="card text-center">
            <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-2)' }}>Current Streak</p>
            <p style={{ fontSize: 'var(--text-3xl)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
              {progress.completionStreak} days
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

function TreeIllustration({ stage }: { stage: 'seed' | 'sapling' | 'young' | 'mature' }) {
  // Simple SVG tree that grows with stage
  const getTreePath = () => {
    switch (stage) {
      case 'seed':
        return (
          <>
            {/* Small seed */}
            <ellipse cx="200" cy="350" rx="15" ry="20" fill="var(--primary)" opacity="0.6" />
            <line x1="200" y1="330" x2="200" y2="310" stroke="var(--primary)" strokeWidth="3" />
          </>
        );
      case 'sapling':
        return (
          <>
            {/* Young sapling */}
            <line x1="200" y1="350" x2="200" y2="250" stroke="var(--primary)" strokeWidth="8" />
            <circle cx="180" cy="270" r="15" fill="var(--primary)" opacity="0.7" />
            <circle cx="220" cy="270" r="15" fill="var(--primary)" opacity="0.7" />
            <circle cx="200" cy="250" r="18" fill="var(--primary)" opacity="0.8" />
          </>
        );
      case 'young':
        return (
          <>
            {/* Growing tree */}
            <line x1="200" y1="350" x2="200" y2="180" stroke="var(--primary)" strokeWidth="12" />
            <line x1="200" y1="250" x2="160" y2="220" stroke="var(--primary)" strokeWidth="6" />
            <line x1="200" y1="250" x2="240" y2="220" stroke="var(--primary)" strokeWidth="6" />
            <circle cx="140" cy="210" r="25" fill="var(--primary)" opacity="0.7" />
            <circle cx="260" cy="210" r="25" fill="var(--primary)" opacity="0.7" />
            <circle cx="180" cy="180" r="30" fill="var(--primary)" opacity="0.8" />
            <circle cx="220" cy="180" r="30" fill="var(--primary)" opacity="0.8" />
            <circle cx="200" cy="160" r="35" fill="var(--primary)" opacity="0.9" />
          </>
        );
      case 'mature':
        return (
          <>
            {/* Full tree */}
            <line x1="200" y1="350" x2="200" y2="150" stroke="var(--primary)" strokeWidth="16" />
            <line x1="200" y1="240" x2="140" y2="200" stroke="var(--primary)" strokeWidth="10" />
            <line x1="200" y1="240" x2="260" y2="200" stroke="var(--primary)" strokeWidth="10" />
            <circle cx="120" cy="180" r="35" fill="var(--primary)" opacity="0.7" />
            <circle cx="280" cy="180" r="35" fill="var(--primary)" opacity="0.7" />
            <circle cx="160" cy="140" r="40" fill="var(--primary)" opacity="0.8" />
            <circle cx="240" cy="140" r="40" fill="var(--primary)" opacity="0.8" />
            <circle cx="200" cy="110" r="50" fill="var(--primary)" opacity="0.9" />
            <circle cx="180" cy="150" r="35" fill="var(--primary)" opacity="0.85" />
            <circle cx="220" cy="150" r="35" fill="var(--primary)" opacity="0.85" />
          </>
        );
    }
  };

  return (
    <svg
      viewBox="0 0 400 400"
      style={{
        width: '100%',
        height: 'auto',
        transition: 'all var(--dur-grow) var(--ease-grow)',
      }}
    >
      {/* Soil background */}
      <rect x="0" y="350" width="400" height="50" fill="var(--surface)" />

      {/* Tree */}
      <g style={{ transformOrigin: '200px 350px' }}>
        {getTreePath()}
      </g>
    </svg>
  );
}
