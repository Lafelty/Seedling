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

  const stored = localStorage.getItem(STORAGE_KEY);
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

  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}
