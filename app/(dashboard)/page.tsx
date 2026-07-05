'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getProgress, getDayStrip, markOnboardingComplete, setProgressUid, type ProgressData, type DayStatus } from '@/lib/progress';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [dayStrip, setDayStrip] = useState<DayStatus[]>([]);
  const [showEmptyState, setShowEmptyState] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Check if user is logged in (only in browser)
    if (typeof window !== 'undefined') {
      try {
        const supabase = createClient();
        supabase.auth.getUser().then(async ({ data: { user } }) => {
          if (!user) {
            router.push('/login');
            return;
          }

          setUser(user);

          // Re-read garden progress under this user's namespace (the initial
          // synchronous read below may have used a stale/anon key).
          setProgressUid(user.id);
          setProgress(getProgress());
          setDayStrip(getDayStrip());

          if (user) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('is_admin')
              .eq('id', user.id)
              .single();

            if (profile?.is_admin) {
              setIsAdmin(true);
            }
          }
        }).catch((error) => {
          console.error('Error checking auth:', error);
        });
      } catch (error) {
        console.error('Error creating Supabase client:', error);
      }
    }

    const data = getProgress();
    setProgress(data);
    setDayStrip(getDayStrip());

    // Show empty state if no stars and no completed days
    if (data.totalStars === 0 && data.completedDates.length === 0) {
      setShowEmptyState(true);
    }
  }, []);

  if (!progress) {
    return (
      <div className="min-h-screen pb-24">
        {/* Skeleton Header */}
        <header className="px-6 pt-8 pb-4">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <div>
              <div className="skeleton" style={{ width: '100px', height: '14px', marginBottom: '8px' }} />
              <div className="skeleton" style={{ width: '150px', height: '32px' }} />
            </div>
            <div className="skeleton" style={{ width: '80px', height: '40px', borderRadius: 'var(--radius-full)' }} />
          </div>
        </header>

        {/* Skeleton Garden */}
        <section className="px-6 py-12">
          <div className="max-w-2xl mx-auto text-center">
            <div className="skeleton mx-auto" style={{ width: '200px', height: '280px', marginBottom: '32px', borderRadius: 'var(--radius-lg)' }} />
            <div className="skeleton mx-auto" style={{ width: '200px', height: '28px', marginBottom: '8px' }} />
            <div className="skeleton mx-auto" style={{ width: '280px', height: '20px' }} />
          </div>
        </section>

        {/* Skeleton Week Card */}
        <section className="px-6 py-4">
          <div className="max-w-2xl mx-auto">
            <div className="bg-[var(--surface)] rounded-2xl p-6">
              <div className="skeleton" style={{ width: '100px', height: '24px', marginBottom: '16px' }} />
              <div className="flex gap-3 justify-between">
                {[...Array(7)].map((_, i) => (
                  <div key={i} className="flex-1">
                    <div className="skeleton mx-auto" style={{ width: '48px', height: '48px', borderRadius: '50%' }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const starsNeeded = getStarsNeededForNextStage(progress.treeStage, progress.totalStars);
  const displayName =
    user?.user_metadata?.name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'there';

  return (
    <>
      <main className="min-h-screen pb-24">
        {/* Header */}
        <header className="px-6 pt-8 pb-4 animate-fadeIn">
          <div className="max-w-2xl mx-auto">
            {/* Top row: greeting + star badge */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>
                  {getGreeting()}
                </p>
                <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700 }}>{displayName}</h1>
              </div>
              <div className="star-badge animate-scaleIn" style={{ animationDelay: '100ms' }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="animate-starShine">
                  <path d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z" />
                </svg>
                <span>{progress.totalStars}</span>
              </div>
            </div>

            {/* Action row: wraps cleanly on small screens */}
            <div className="flex items-center gap-2 flex-wrap mt-4">
              {user ? (
                <>
                  {isAdmin && (
                    <Link href="/admin" className="pill-btn pill-btn-primary">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      Admin
                    </Link>
                  )}
                  <Link href="/dashboard" className="pill-btn pill-btn-outline">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3v18h18" />
                      <path d="M7 16l4-8 4 4 4-12" />
                    </svg>
                    Dashboard
                  </Link>
                  <button
                    onClick={async () => {
                      const supabase = createClient();
                      await supabase.auth.signOut();
                      router.push('/login');
                      router.refresh();
                    }}
                    className="pill-btn pill-btn-ghost"
                    style={{ marginLeft: 'auto' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <path d="M16 17l5-5-5-5" />
                      <path d="M21 12H9" />
                    </svg>
                    Sign Out
                  </button>
                </>
              ) : (
                <>
                  <Link href="/login" className="pill-btn pill-btn-outline">
                    Sign In
                  </Link>
                  <Link href="/signup" className="pill-btn pill-btn-primary">
                    Sign Up
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Garden State */}
        <section className="px-6 py-12 animate-fadeInUp" style={{ animationDelay: '150ms' }}>
          <div className="max-w-2xl mx-auto text-center">
            {/* Soil/Garden Illustration */}
            <div className="mb-8 animate-treeGrow" style={{ animationDelay: '200ms' }}>
              <SoilIllustration stage={progress.treeStage} />
            </div>

            {showEmptyState ? (
              <>
                <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                  Your garden awaits 🌱
                </h2>
                <p style={{ color: 'var(--muted)', fontSize: 'var(--text-base)', marginBottom: 'var(--space-4)' }}>
                  Complete your first session to plant your seed and begin your journey
                </p>
                <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
                  Each session you complete earns a star and helps your tree grow stronger
                </p>
              </>
            ) : (
              <>
                <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                  {getStageName(progress.treeStage)}
                </h2>
                <p style={{ color: 'var(--muted)', fontSize: 'var(--text-base)' }}>
                  {starsNeeded} more stars until "{getNextStageName(progress.treeStage)}"
                </p>

                {/* Stage progress bar */}
                <div style={{ maxWidth: '240px', margin: 'var(--space-4) auto 0' }}>
                  <div
                    style={{
                      height: '8px',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--border)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${getStageProgressPercent(progress.treeStage, progress.totalStars)}%`,
                        borderRadius: 'var(--radius-full)',
                        background: 'linear-gradient(90deg, var(--primary), #6B8F7A)',
                        transition: 'width var(--dur-slow) var(--ease-out)',
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* This Week */}
        <section className="px-6 py-4 animate-fadeInUp" style={{ animationDelay: '300ms' }}>
          <div className="max-w-2xl mx-auto">
            <div
              className="bg-[var(--surface)] rounded-2xl p-6"
              style={{ border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>This week</h3>
                <div
                  className="flex items-center gap-1"
                  style={{
                    color: 'var(--primary)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 600,
                    background: 'rgba(74, 107, 90, 0.08)',
                    padding: 'var(--space-1) var(--space-3)',
                    borderRadius: 'var(--radius-full)',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0l2 5h5l-4 3 1.5 5L8 10l-4.5 3L5 8 1 5h5z" />
                  </svg>
                  <span>{progress.completionStreak} day streak</span>
                </div>
              </div>

              {/* Week Strip */}
              <div className="flex gap-2 sm:gap-3 justify-between">
                {dayStrip.map((day, index) => {
                  const date = new Date(day.date);
                  const dayLetter = date.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0);
                  const today = new Date().toISOString().split('T')[0];
                  const isToday = day.date === today;
                  const isFuture = day.date > today;

                  return (
                    <div
                      key={day.date}
                      className={`flex flex-col items-center gap-2 flex-1 animate-scaleIn stagger-${index + 1}`}
                    >
                      <span
                        style={{
                          fontSize: 'var(--text-sm)',
                          color: isToday ? 'var(--primary)' : 'var(--muted)',
                          fontWeight: isToday ? 700 : 500,
                        }}
                      >
                        {dayLetter}
                      </span>
                      <div
                        style={{
                          width: '100%',
                          maxWidth: '48px',
                          aspectRatio: '1',
                          borderRadius: '50%',
                          background: day.completed ? 'var(--success)' : 'var(--border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 'var(--text-base)',
                          color: day.completed ? 'white' : 'var(--muted)',
                          fontWeight: 600,
                          opacity: isFuture ? 0.3 : 1,
                          boxShadow: isToday
                            ? '0 0 0 2px var(--surface), 0 0 0 4px var(--primary)'
                            : 'none',
                        }}
                      >
                        {day.completed ? (
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="animate-checkPop">
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
        <section className="px-6 py-8 animate-fadeInUp" style={{ animationDelay: '400ms' }}>
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
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z" />
            <path d="M12 19v3" />
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
      {/* Soft ambient glow behind the garden */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(closest-side, rgba(74, 107, 90, 0.10), rgba(74, 107, 90, 0.04) 60%, transparent)',
        }}
      />

      {/* Soil mound */}
      <div
        style={{
          position: 'absolute',
          bottom: '52px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '210px',
          height: '56px',
          borderRadius: '50%',
          background: 'linear-gradient(180deg, #D4C4B0 0%, #B8A890 100%)',
          opacity: 0.7,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '62px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '140px',
          height: '32px',
          borderRadius: '50%',
          background: 'linear-gradient(180deg, #C3B098 0%, #A99878 100%)',
          opacity: 0.5,
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
    <svg width="80" height="130" viewBox="0 0 80 130">
      {/* Sprout stem */}
      <path d="M40 108 Q40 92 40 80" stroke="#4A6B5A" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      {/* Left leaf */}
      <path d="M40 88 Q26 84 22 70 Q37 70 40 86" fill="#6B8F7A" />
      {/* Right leaf */}
      <path d="M40 82 Q54 78 58 64 Q43 64 40 80" fill="#4A6B5A" />
    </svg>
  );
}

function SaplingStage() {
  return (
    <svg width="100" height="150" viewBox="0 0 100 150">
      {/* Trunk */}
      <path d="M50 128 L50 74" stroke="#8B6F47" strokeWidth="5" strokeLinecap="round" />
      {/* Foliage — layered greens */}
      <circle cx="35" cy="78" r="15" fill="#6B8F7A" />
      <circle cx="65" cy="78" r="15" fill="#6B8F7A" />
      <circle cx="50" cy="76" r="13" fill="#5A7D69" />
      <circle cx="50" cy="62" r="18" fill="#4A6B5A" />
    </svg>
  );
}

function YoungTreeStage() {
  return (
    <svg width="140" height="185" viewBox="0 0 140 185">
      {/* Trunk and branches */}
      <path d="M70 163 L70 72" stroke="#8B6F47" strokeWidth="7" strokeLinecap="round" />
      <path d="M70 118 L46 94" stroke="#8B6F47" strokeWidth="5" strokeLinecap="round" />
      <path d="M70 118 L94 94" stroke="#8B6F47" strokeWidth="5" strokeLinecap="round" />
      {/* Canopy — light outer, dark core */}
      <circle cx="36" cy="88" r="21" fill="#6B8F7A" />
      <circle cx="104" cy="88" r="21" fill="#6B8F7A" />
      <circle cx="52" cy="66" r="24" fill="#5A7D69" />
      <circle cx="88" cy="66" r="24" fill="#5A7D69" />
      <circle cx="70" cy="50" r="27" fill="#4A6B5A" />
    </svg>
  );
}

function MatureTreeStage() {
  return (
    <svg width="160" height="205" viewBox="0 0 160 205">
      {/* Trunk and branches */}
      <path d="M80 183 L80 84" stroke="#8B6F47" strokeWidth="10" strokeLinecap="round" />
      <path d="M80 132 L42 102" stroke="#8B6F47" strokeWidth="6" strokeLinecap="round" />
      <path d="M80 132 L118 102" stroke="#8B6F47" strokeWidth="6" strokeLinecap="round" />
      {/* Canopy — light outer, dark core */}
      <circle cx="26" cy="94" r="25" fill="#6B8F7A" />
      <circle cx="134" cy="94" r="25" fill="#6B8F7A" />
      <circle cx="50" cy="72" r="28" fill="#5A7D69" />
      <circle cx="110" cy="72" r="28" fill="#5A7D69" />
      <circle cx="65" cy="82" r="22" fill="#5A7D69" />
      <circle cx="95" cy="82" r="22" fill="#5A7D69" />
      <circle cx="80" cy="52" r="35" fill="#4A6B5A" />
      {/* Golden berries — reward accents */}
      <circle cx="58" cy="60" r="4" fill="#C9B88A" />
      <circle cx="102" cy="64" r="4" fill="#C9B88A" />
      <circle cx="80" cy="38" r="4" fill="#C9B88A" />
      <circle cx="36" cy="86" r="3.5" fill="#C9B88A" />
      <circle cx="124" cy="86" r="3.5" fill="#C9B88A" />
    </svg>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getStageProgressPercent(stage: string, totalStars: number): number {
  // Star ranges per stage, matching getTreeStage thresholds in lib/progress
  const ranges: Record<string, [number, number]> = {
    seed: [0, 6],
    sapling: [6, 16],
    young: [16, 31],
    mature: [31, 50],
  };
  const range = ranges[stage];
  if (!range) return 0;
  const [lo, hi] = range;
  return Math.min(100, Math.max(0, ((totalStars - lo) / (hi - lo)) * 100));
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
