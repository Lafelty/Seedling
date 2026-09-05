import { format } from 'date-fns';

/**
 * Every day key in this app is a LOCAL calendar day, formatted with date-fns
 * `format(d, 'yyyy-MM-dd')` — the same call the dashboard and progress pages
 * use when they bucket sessions.
 *
 * These used to be derived with `toISOString().split('T')[0]`, which is UTC. At
 * UTC+7 a session logged before 07:00 local landed on the previous UTC day, so
 * the keys produced here did not match the keys the pages looked up: streaks
 * read 0 on a day the patient had practiced, week-strip faces rendered as rest
 * days, and the "today" ring sat on the wrong cell around midnight.
 */
export function dayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

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
// Kept in this tab, not in shared storage: another account in a second tab
// must never switch this tab's progress namespace.
let activeUid: string | null = null;
const memoryCache = new Map<string, ProgressData>();

export function setProgressUid(uid: string): void {
  activeUid = uid;
}

function storageKey(): string {
  return activeUid ? `${STORAGE_KEY}_${activeUid}` : STORAGE_KEY;
}

function emptyProgress(): ProgressData {
  return {
    totalStars: 0, dailyStars: 0, completionStreak: 0, treeStage: 'seed',
    lastSessionDate: null, completedDates: [], hasSeenOnboarding: false,
  };
}

export function getProgress(): ProgressData {
  if (typeof window === 'undefined' || !activeUid) return emptyProgress();
  const cacheKey = storageKey();
  try {
    const stored = localStorage.getItem(cacheKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && Number.isFinite(parsed.totalStars) && parsed.totalStars >= 0) {
        const dates = Array.isArray(parsed.completedDates)
          ? parsed.completedDates.filter((date: unknown): date is string =>
              typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) : [];
        const progress: ProgressData = {
          ...emptyProgress(),
          totalStars: parsed.totalStars,
          dailyStars: Number.isFinite(parsed.dailyStars) ? parsed.dailyStars : 0,
          completedDates: dates,
          completionStreak: computeStreak(dates),
          treeStage: getTreeStage(parsed.totalStars),
          lastSessionDate: [...dates].sort().at(-1) ?? null,
          hasSeenOnboarding: parsed.hasSeenOnboarding === true,
        };
        memoryCache.set(cacheKey, progress);
        return progress;
      }
    }
  } catch { /* A corrupt or unavailable cache must not break server saving. */ }
  return memoryCache.get(cacheKey) ?? emptyProgress();
}

function cacheProgress(progress: ProgressData): void {
  if (typeof window === 'undefined' || !activeUid) return;
  memoryCache.set(storageKey(), progress);
  try { localStorage.setItem(storageKey(), JSON.stringify(progress)); } catch { /* memory only */ }
}

function todayStr(): string {
  return dayKey(new Date());
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
    if (!set.has(dayKey(cursor))) return 0; // gap at today and yesterday
  }

  let streak = 0;
  while (set.has(dayKey(cursor))) {
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
 * dates ('yyyy-MM-dd'); omit dates to refresh only the star total. An explicit
 * empty array clears stale completion history.
 */
export function applyServerProgress(dbStars: number, completedDates?: string[]): ProgressData {
  const current = getProgress();
  const dates = completedDates !== undefined
    ? Array.from(new Set(completedDates)).sort()
    : current.completedDates;

  const updated: ProgressData = {
    ...current,
    totalStars: dbStars,
    completionStreak: computeStreak(dates),
    treeStage: getTreeStage(dbStars),
    completedDates: dates,
    lastSessionDate: dates.length ? dates[dates.length - 1] : null,
  };

  cacheProgress(updated);
  return updated;
}

/**
 * Advance local progress after a completed session. `totalStars` is the
 * authoritative total returned by the award_stars RPC (not a local +1), so the
 * cache never drifts ahead of the database when the award fails. Streak and
 * dates are recomputed locally for the reward screen; the home page re-syncs
 * from the database on arrival.
 */
export function recordCompletion(totalStars: number, sessionDate = new Date()): ProgressData {
  const current = getProgress();
  const today = dayKey(sessionDate);

  const completedDates = current.completedDates.includes(today)
    ? current.completedDates
    : [...current.completedDates, today].sort();

  const updated: ProgressData = {
    totalStars,
    dailyStars: today === todayStr()
      ? (current.lastSessionDate === today ? current.dailyStars : 0) + (totalStars > current.totalStars ? 1 : 0)
      : current.dailyStars,
    completionStreak: computeStreak(completedDates),
    treeStage: getTreeStage(totalStars),
    lastSessionDate: completedDates[completedDates.length - 1] ?? null,
    completedDates,
    hasSeenOnboarding: current.hasSeenOnboarding,
  };

  cacheProgress(updated);
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
    const dateStr = dayKey(date);

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
  cacheProgress(updated);
}
