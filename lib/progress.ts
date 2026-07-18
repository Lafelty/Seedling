export interface ProgressData {
  totalStars: number;
  dailyStars: number;
  completionStreak: number;
  treeStage: 'seed' | 'sapling' | 'young' | 'mature';
  lastSessionDate: string | null;
  completedDates: string[]; // Full history of completed session dates
  hasSeenOnboarding: boolean;
}

export interface DayStatus {
  date: string;
  completed: boolean;
  stars: number;
}

const STORAGE_KEY = 'medproj_progress';
const UID_KEY = 'medproj_current_uid';

/**
 * Bind garden progress to a specific signed-in user so two accounts sharing a
 * browser never see each other's stars. Call once the auth user resolves.
 */
export function setProgressUid(uid: string): void {
  if (typeof window === 'undefined') return;
  const prev = localStorage.getItem(UID_KEY);
  localStorage.setItem(UID_KEY, uid);

  // One-time migration: the first user to sign in on a browser that has legacy
  // (pre-namespacing) progress inherits it. Later users start fresh.
  const userKey = `${STORAGE_KEY}_${uid}`;
  if (!localStorage.getItem(userKey) && (!prev || prev === uid)) {
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy) localStorage.setItem(userKey, legacy);
  }
}

function storageKey(): string {
  if (typeof window === 'undefined') return STORAGE_KEY;
  const uid = localStorage.getItem(UID_KEY);
  return uid ? `${STORAGE_KEY}_${uid}` : STORAGE_KEY;
}

export function getProgress(): ProgressData {
  if (typeof window === 'undefined') {
    return {
      totalStars: 0,
      dailyStars: 0,
      completionStreak: 0,
      treeStage: 'seed',
      lastSessionDate: null,
      completedDates: [],
      hasSeenOnboarding: false,
    };
  }

  const stored = localStorage.getItem(storageKey());
  if (!stored) {
    return {
      totalStars: 0,
      dailyStars: 0,
      completionStreak: 0,
      treeStage: 'seed',
      lastSessionDate: null,
      completedDates: [],
      hasSeenOnboarding: false,
    };
  }

  const parsed = JSON.parse(stored);

  // Migration: add new fields if they don't exist
  return {
    ...parsed,
    completedDates: parsed.completedDates || [],
    hasSeenOnboarding: parsed.hasSeenOnboarding || false,
  };
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Consecutive-day streak ending today (or yesterday, so a not-yet-practiced
 * today doesn't break it). Derived from a set of 'yyyy-MM-dd' completion dates
 * — pass the database's completed-session dates for the authoritative value.
 */
export function computeStreak(completedDates: string[]): number {
  if (completedDates.length === 0) return 0;
  const set = new Set(completedDates);

  const cursor = new Date();
  const today = todayStr();
  if (!set.has(today)) {
    cursor.setDate(cursor.getDate() - 1);
    if (!set.has(cursor.toISOString().split('T')[0])) return 0; // gap at today and yesterday
  }

  let streak = 0;
  while (set.has(cursor.toISOString().split('T')[0])) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * Mirror the database's authoritative progress into the local cache. The
 * database owns total_stars (server-awarded per completed session) and the
 * completion history, so it always wins — no more localStorage → database
 * seeding, which used to revert an admin's star edit and let the two totals
 * drift apart. `completedDates` should be the database's completed-session
 * dates ('yyyy-MM-dd'); pass [] to refresh only the star total.
 */
export function applyServerProgress(dbStars: number, completedDates: string[] = []): ProgressData {
  const current = getProgress();
  const dates = completedDates.length
    ? Array.from(new Set(completedDates)).sort()
    : current.completedDates;

  const updated: ProgressData = {
    ...current,
    totalStars: dbStars,
    completionStreak: computeStreak(dates),
    treeStage: getTreeStage(dbStars),
    completedDates: dates,
    lastSessionDate: dates.length ? dates[dates.length - 1] : current.lastSessionDate,
  };

  if (typeof window !== 'undefined') {
    localStorage.setItem(storageKey(), JSON.stringify(updated));
  }
  return updated;
}

/**
 * Advance local progress after a completed session. `totalStars` is the
 * authoritative total returned by the award_stars RPC (not a local +1), so the
 * cache never drifts ahead of the database when the award fails. Streak and
 * dates are recomputed locally for the reward screen; the home page re-syncs
 * from the database on arrival.
 */
export function recordCompletion(totalStars: number): ProgressData {
  const current = getProgress();
  const today = todayStr();

  const completedDates = current.completedDates.includes(today)
    ? current.completedDates
    : [...current.completedDates, today];

  const updated: ProgressData = {
    totalStars,
    dailyStars: current.lastSessionDate === today ? current.dailyStars + 1 : 1,
    completionStreak: computeStreak(completedDates),
    treeStage: getTreeStage(totalStars),
    lastSessionDate: today,
    completedDates,
    hasSeenOnboarding: current.hasSeenOnboarding,
  };

  localStorage.setItem(storageKey(), JSON.stringify(updated));
  return updated;
}

export function getTreeStage(totalStars: number): 'seed' | 'sapling' | 'young' | 'mature' {
  if (totalStars >= 3) return 'mature';
  if (totalStars >= 2) return 'young';
  if (totalStars >= 1) return 'sapling';
  return 'seed';
}

export function getDayStrip(): DayStatus[] {
  const progress = getProgress();
  const days: DayStatus[] = [];
  const today = new Date();

  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    days.push({
      date: dateStr,
      completed: progress.completedDates.includes(dateStr),
      stars: 0, // TODO: track stars per day if needed
    });
  }

  return days;
}

export function markOnboardingComplete(): void {
  const current = getProgress();
  const updated = { ...current, hasSeenOnboarding: true };
  localStorage.setItem(storageKey(), JSON.stringify(updated));
}
