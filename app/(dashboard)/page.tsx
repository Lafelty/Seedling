'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getProgress, getDayStrip, markOnboardingComplete, type ProgressData, type DayStatus } from '@/lib/progress';

export default function DashboardPage() {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [dayStrip, setDayStrip] = useState<DayStatus[]>([]);

  useEffect(() => {
    const data = getProgress();
    setProgress(data);
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

  const starsNeeded = getStarsNeededForNextStage(progress.treeStage, progress.totalStars);

  return (
    <>
      <main className="min-h-screen pb-24">
        {/* Header */}
        <header className="px-6 pt-8 pb-4">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <div>
              <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>
                Good morning
              </p>
              <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700 }}>Your garden</h1>
            </div>
            <div className="star-badge">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
              </svg>
              <span>{progress.totalStars}</span>
            </div>
          </div>
        </header>

        {/* Garden State */}
        <section className="px-6 py-12">
          <div className="max-w-2xl mx-auto text-center">
            {/* Soil/Garden Illustration */}
            <div className="mb-8">
              <SoilIllustration stage={progress.treeStage} />
            </div>

            <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
              {getStageName(progress.treeStage)}
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: 'var(--text-base)' }}>
              {starsNeeded} more stars until "{getNextStageName(progress.treeStage)}"
            </p>
          </div>
        </section>

        {/* This Week */}
        <section className="px-6 py-4">
          <div className="max-w-2xl mx-auto">
            <div className="bg-[var(--surface)] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>This week</h3>
                <div className="flex items-center gap-1" style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
                  <span>{progress.completionStreak}</span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0l2 5h5l-4 3 1.5 5L8 10l-4.5 3L5 8 1 5h5z" />
                  </svg>
                  <span>today</span>
                </div>
              </div>

              {/* Week Strip */}
              <div className="flex gap-3 justify-between">
                {dayStrip.map((day) => {
                  const date = new Date(day.date);
                  const dayLetter = date.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0);
                  const today = new Date().toISOString().split('T')[0];
                  const isToday = day.date === today;
                  const isFuture = day.date > today;

                  return (
                    <div
                      key={day.date}
                      className="flex flex-col items-center gap-2 flex-1"
                    >
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', fontWeight: 500 }}>
                        {dayLetter}
                      </span>
                      <div
                        style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '50%',
                          background: day.completed ? 'var(--success)' : 'var(--border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 'var(--text-base)',
                          color: day.completed ? 'white' : 'var(--muted)',
                          fontWeight: 600,
                          opacity: isFuture ? 0.3 : 1,
                        }}
                      >
                        {day.completed ? (
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M5 12l5 5L19 7" />
                          </svg>
                        ) : (
                          date.getDate()
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Begin Session Button */}
        <section className="px-6 py-8">
          <div className="max-w-2xl mx-auto">
            <Link href="/session" className="btn btn-primary w-full text-center flex items-center justify-center gap-2">
              Begin today's session
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 10h10M10 5l5 5-5 5" />
              </svg>
            </Link>
          </div>
        </section>
      </main>

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <Link href="/" className="nav-item active">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7v7c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          <span>Garden</span>
        </Link>
        <Link href="/progress" className="nav-item">
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

function SoilIllustration({ stage }: { stage: 'seed' | 'sapling' | 'young' | 'mature' }) {
  return (
    <div className="relative w-full max-w-sm mx-auto" style={{ height: '280px' }}>
      {/* Soil ellipse */}
      <div
        style={{
          position: 'absolute',
          bottom: '60px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '200px',
          height: '60px',
          borderRadius: '50%',
          background: 'linear-gradient(180deg, #D4C4B0 0%, #B8A890 100%)',
          opacity: 0.6,
        }}
      />

      {/* Stage-specific illustration */}
      <div className="absolute inset-0 flex items-center justify-center">
        {stage === 'seed' && <SeedStage />}
        {stage === 'sapling' && <SaplingStage />}
        {stage === 'young' && <YoungTreeStage />}
        {stage === 'mature' && <MatureTreeStage />}
      </div>
    </div>
  );
}

function SeedStage() {
  return (
    <div className="text-center">
      <div
        style={{
          width: '20px',
          height: '28px',
          borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
          background: 'var(--primary)',
          margin: '0 auto',
          opacity: 0.7,
        }}
      />
    </div>
  );
}

function SaplingStage() {
  return (
    <svg width="80" height="120" viewBox="0 0 80 120">
      <line x1="40" y1="120" x2="40" y2="60" stroke="var(--primary)" strokeWidth="4" />
      <circle cx="30" cy="70" r="12" fill="var(--primary)" opacity="0.6" />
      <circle cx="50" cy="70" r="12" fill="var(--primary)" opacity="0.6" />
      <circle cx="40" cy="60" r="15" fill="var(--primary)" opacity="0.7" />
    </svg>
  );
}

function YoungTreeStage() {
  return (
    <svg width="120" height="160" viewBox="0 0 120 160">
      <line x1="60" y1="160" x2="60" y2="60" stroke="var(--primary)" strokeWidth="6" />
      <line x1="60" y1="100" x2="35" y2="80" stroke="var(--primary)" strokeWidth="4" />
      <line x1="60" y1="100" x2="85" y2="80" stroke="var(--primary)" strokeWidth="4" />
      <circle cx="20" cy="75" r="18" fill="var(--primary)" opacity="0.6" />
      <circle cx="100" cy="75" r="18" fill="var(--primary)" opacity="0.6" />
      <circle cx="45" cy="60" r="22" fill="var(--primary)" opacity="0.7" />
      <circle cx="75" cy="60" r="22" fill="var(--primary)" opacity="0.7" />
      <circle cx="60" cy="45" r="25" fill="var(--primary)" opacity="0.8" />
    </svg>
  );
}

function MatureTreeStage() {
  return (
    <svg width="160" height="200" viewBox="0 0 160 200">
      <line x1="80" y1="200" x2="80" y2="80" stroke="var(--primary)" strokeWidth="10" />
      <line x1="80" y1="130" x2="40" y2="100" stroke="var(--primary)" strokeWidth="6" />
      <line x1="80" y1="130" x2="120" y2="100" stroke="var(--primary)" strokeWidth="6" />
      <circle cx="20" cy="90" r="25" fill="var(--primary)" opacity="0.6" />
      <circle cx="140" cy="90" r="25" fill="var(--primary)" opacity="0.6" />
      <circle cx="50" cy="70" r="28" fill="var(--primary)" opacity="0.7" />
      <circle cx="110" cy="70" r="28" fill="var(--primary)" opacity="0.7" />
      <circle cx="80" cy="50" r="35" fill="var(--primary)" opacity="0.8" />
      <circle cx="65" cy="75" r="22" fill="var(--primary)" opacity="0.75" />
      <circle cx="95" cy="75" r="22" fill="var(--primary)" opacity="0.75" />
    </svg>
  );
}

function getStageName(stage: string): string {
  switch (stage) {
    case 'seed': return 'Resting soil';
    case 'sapling': return 'Young sapling';
    case 'young': return 'Growing tree';
    case 'mature': return 'Mature tree';
    default: return 'Your garden';
  }
}

function getNextStageName(stage: string): string {
  switch (stage) {
    case 'seed': return 'First sapling';
    case 'sapling': return 'Growing tree';
    case 'young': return 'Mature tree';
    case 'mature': return 'Forest begins';
    default: return 'Next stage';
  }
}

function getStarsNeededForNextStage(stage: string, totalStars: number): number {
  switch (stage) {
    case 'seed': return Math.max(0, 6 - totalStars);
    case 'sapling': return Math.max(0, 16 - totalStars);
    case 'young': return Math.max(0, 31 - totalStars);
    case 'mature': return Math.max(0, 50 - totalStars);
    default: return 0;
  }
}
