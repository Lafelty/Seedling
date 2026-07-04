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

export function updateProgress(starsEarned: number): ProgressData {
  const current = getProgress();
  const today = new Date().toISOString().split('T')[0];

  const newTotalStars = current.totalStars + starsEarned;

  // Update completed dates array
  const newCompletedDates = current.completedDates.includes(today)
    ? current.completedDates
    : [...current.completedDates, today];

  // Update streak
  let newStreak = current.completionStreak;
  if (current.lastSessionDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (current.lastSessionDate === yesterdayStr) {
      newStreak += 1;
    } else if (current.lastSessionDate !== null) {
      newStreak = 1;
    } else {
      newStreak = 1;
    }
  }

  const updated: ProgressData = {
    totalStars: newTotalStars,
    dailyStars: current.lastSessionDate === today ? current.dailyStars + starsEarned : starsEarned,
    completionStreak: newStreak,
    treeStage: getTreeStage(newTotalStars),
    lastSessionDate: today,
    completedDates: newCompletedDates,
    hasSeenOnboarding: current.hasSeenOnboarding,
  };

  localStorage.setItem(storageKey(), JSON.stringify(updated));
  return updated;
}

export function getTreeStage(totalStars: number): 'seed' | 'sapling' | 'young' | 'mature' {
  if (totalStars >= 31) return 'mature';
  if (totalStars >= 16) return 'young';
  if (totalStars >= 6) return 'sapling';
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
