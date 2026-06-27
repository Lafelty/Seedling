'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getProgress, getDayStrip, markOnboardingComplete, type ProgressData, type DayStatus } from '@/lib/progress';

export default function DashboardPage() {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [dayStrip, setDayStrip] = useState<DayStatus[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  useEffect(() => {
    const data = getProgress();
    setProgress(data);
    setDayStrip(getDayStrip());

    // Show onboarding for first-time users
    if (!data.hasSeenOnboarding) {
      setShowOnboarding(true);
    }
  }, []);

  const handleOnboardingNext = () => {
    if (onboardingStep < 2) {
      setOnboardingStep(onboardingStep + 1);
    } else {
      setShowOnboarding(false);
      markOnboardingComplete();
    }
  };

  const handleOnboardingSkip = () => {
    setShowOnboarding(false);
    markOnboardingComplete();
  };

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

  const onboardingSteps = [
    {
      title: 'Your tree grows with you',
      description: 'Complete exercise sessions to earn stars. Each star helps your tree grow from a tiny seed into a mature tree.',
      icon: '🌱',
    },
    {
      title: 'Sessions are short and guided',
      description: 'Each session is 10 shoulder raises. Our AI watches your posture through the camera to guide your movements in real-time.',
      icon: '💪',
    },
    {
      title: 'Your privacy matters',
      description: 'Camera footage is processed locally on your device. Nothing is recorded or sent to our servers. You can pause or stop anytime.',
      icon: '🔒',
    },
  ];

  return (
    <>
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
                  width: '100%',
                  height: '100%',
                  background: 'var(--primary)',
                  transformOrigin: 'left',
                  transform: `scaleX(${progress.dailyStars / 3})`,
                  transition: 'transform var(--dur-slow) var(--ease-out)',
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

      {/* Onboarding Overlay */}
      {showOnboarding && (
        <div className="fixed inset-0 bg-[var(--ink)]/80 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-[var(--surface)] rounded-2xl max-w-md w-full p-8 text-center">
            <div className="text-6xl mb-6">{onboardingSteps[onboardingStep].icon}</div>
            <h2 className="text-2xl font-display mb-4" style={{ color: 'var(--ink)' }}>
              {onboardingSteps[onboardingStep].title}
            </h2>
            <p className="text-base mb-8" style={{ color: 'var(--muted)' }}>
              {onboardingSteps[onboardingStep].description}
            </p>

            {/* Step Indicators */}
            <div className="flex justify-center gap-2 mb-8">
              {onboardingSteps.map((_, index) => (
                <div
                  key={index}
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: index === onboardingStep ? 'var(--primary)' : 'var(--border)',
                    transition: 'background var(--dur-fast) var(--ease-out)',
                  }}
                />
              ))}
            </div>

            {/* Buttons */}
            <div className="flex flex-col gap-3">
              <button
                onClick={handleOnboardingNext}
                className="btn btn-primary w-full"
              >
                {onboardingStep < 2 ? 'Next' : 'Get Started'}
              </button>
              {onboardingStep === 0 && (
                <button
                  onClick={handleOnboardingSkip}
                  className="text-sm"
                  style={{ color: 'var(--muted)' }}
                >
                  Skip tutorial
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
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
