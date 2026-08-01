// The maths behind /dashboard: which sessions fall in the selected period, how
// they bucket into days, and how this period compares with the one before it.
//
// Kept clear of React and Supabase so it can be unit-tested in the node
// environment the rest of lib/ uses. The page fetches rows and holds a period;
// everything else it renders comes from here.

import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns';
import { dayKey } from './progress';

/** Exactly the columns /dashboard selects. */
export interface SessionRow {
  id: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  completed_reps: number;
  target_reps: number;
  form_quality_score: number | null;
}

export type PeriodMode = 'week' | 'month';

/** What the page holds in state: a mode, and any date inside the shown period. */
export interface Period {
  mode: PeriodMode;
  anchor: Date;
}

export interface ResolvedPeriod {
  mode: PeriodMode;
  start: Date;
  end: Date;
  /** The same span immediately before — what every "vs last …" caption uses. */
  prevStart: Date;
  prevEnd: Date;
  label: string;
  /** Word for captions: "vs last week" / "vs last month". */
  unit: string;
  isCurrent: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/**
 * One fetch on mount covers a year. Switching weeks or months after that is
 * slicing an array in memory, so the stepper never shows a spinner.
 */
export const FETCH_MONTHS = 12;

/** Weeks run Monday–Sunday, matching the week strip on the home page. */
const WEEK_OPTS = { weekStartsOn: 1 as const };

export function fetchWindowStart(now: Date = new Date()): Date {
  return startOfMonth(subMonths(now, FETCH_MONTHS - 1));
}

export function resolvePeriod(period: Period, now: Date = new Date()): ResolvedPeriod {
  const week = period.mode === 'week';

  const start = week ? startOfWeek(period.anchor, WEEK_OPTS) : startOfMonth(period.anchor);
  const end = week ? endOfWeek(period.anchor, WEEK_OPTS) : endOfMonth(period.anchor);

  const prevAnchor = week ? subWeeks(period.anchor, 1) : subMonths(period.anchor, 1);
  const prevStart = week ? startOfWeek(prevAnchor, WEEK_OPTS) : startOfMonth(prevAnchor);
  const prevEnd = week ? endOfWeek(prevAnchor, WEEK_OPTS) : endOfMonth(prevAnchor);

  const isCurrent = now >= start && now <= end;

  // A period is only worth labelling by its dates once it isn't the one the
  // patient is living in — "This week" reads faster than "28 Jul – 3 Aug".
  let label: string;
  if (isCurrent) {
    label = week ? 'This week' : 'This month';
  } else if (week) {
    const sameMonth = start.getMonth() === end.getMonth();
    label = sameMonth
      ? `${format(start, 'd')}–${format(end, 'd MMM')}`
      : `${format(start, 'd MMM')} – ${format(end, 'd MMM')}`;
  } else {
    label = format(start, 'MMMM yyyy');
  }

  return {
    mode: period.mode,
    start,
    end,
    prevStart,
    prevEnd,
    label,
    unit: week ? 'week' : 'month',
    isCurrent,
    // Stepping back is capped at the fetch window: there are no rows behind it,
    // and an empty screen the user can keep scrolling into reads as a bug.
    canGoBack: start > fetchWindowStart(now),
    canGoForward: !isCurrent && start < now,
  };
}

export function shiftPeriod(period: Period, delta: number): Period {
  return {
    mode: period.mode,
    anchor: period.mode === 'week' ? addWeeks(period.anchor, delta) : addMonths(period.anchor, delta),
  };
}

/**
 * Switching mode keeps the patient where they were in time rather than snapping
 * back to today: looking at March and tapping "Week" lands on a week in March.
 */
export function setPeriodMode(period: Period, mode: PeriodMode, now: Date = new Date()): Period {
  if (mode === period.mode) return period;
  const resolved = resolvePeriod(period, now);
  // A current period stays current; a past one keeps its start date.
  return { mode, anchor: resolved.isCurrent ? now : resolved.start };
}

/** A session counts as finished only once it has been properly closed. */
export function isFinished(row: SessionRow): boolean {
  return row.completed_at !== null;
}

export function inRange(row: SessionRow, start: Date, end: Date): boolean {
  const at = new Date(row.started_at).getTime();
  return at >= start.getTime() && at <= end.getTime();
}

export interface DayBucket {
  key: string;
  label: string;
  finished: number;
  unfinished: number;
  reps: number;
  /** Average form over that day's finished sessions; null on a day with none. */
  formQuality: number | null;
}

/**
 * One entry per calendar day in the range, zero-filled.
 *
 * The old dashboard grouped only days that had sessions and then took the last
 * 14 of them, so a patient who practised twice in June and once in August saw
 * three points labelled "Last 14 days" — an axis silently spanning two months.
 * Filling the range means a gap in practice looks like a gap.
 */
export function bucketByDay(
  rows: SessionRow[],
  start: Date,
  end: Date,
  mode: PeriodMode = 'week'
): DayBucket[] {
  const byDay = new Map<string, SessionRow[]>();
  for (const row of rows) {
    if (!inRange(row, start, end)) continue;
    const key = dayKey(new Date(row.started_at));
    const bucket = byDay.get(key);
    if (bucket) bucket.push(row);
    else byDay.set(key, [row]);
  }

  return eachDayOfInterval({ start, end }).map((date) => {
    const key = dayKey(date);
    const day = byDay.get(key) ?? [];
    const finished = day.filter(isFinished);
    const scored = finished.filter((r) => r.form_quality_score !== null);

    return {
      key,
      // A month of "12 Aug" labels overruns the axis; a week of bare numbers
      // loses the shape of the week.
      label: mode === 'week' ? format(date, 'EEE') : format(date, 'd'),
      finished: finished.length,
      unfinished: day.length - finished.length,
      reps: day.reduce((sum, r) => sum + (r.completed_reps ?? 0), 0),
      formQuality: scored.length
        ? Math.round(scored.reduce((sum, r) => sum + (r.form_quality_score ?? 0), 0) / scored.length)
        : null,
    };
  });
}

export interface PeriodStats {
  finished: number;
  unfinished: number;
  totalSessions: number;
  /** 0–100, averaged over finished sessions only. 0 when the period is empty. */
  avgForm: number;
  totalReps: number;
  prevFinished: number;
  prevAvgForm: number;
  prevTotalReps: number;
  /** Signed % change in average form against the previous period. */
  improvement: number;
  /** False when the previous period has no form score to compare against. */
  improvementComparable: boolean;
}

function averageForm(rows: SessionRow[]): number {
  const scored = rows.filter((r) => r.form_quality_score !== null);
  if (!scored.length) return 0;
  return Math.round(scored.reduce((sum, r) => sum + (r.form_quality_score ?? 0), 0) / scored.length);
}

export function periodStats(rows: SessionRow[], period: ResolvedPeriod): PeriodStats {
  const current = rows.filter((r) => inRange(r, period.start, period.end));
  const previous = rows.filter((r) => inRange(r, period.prevStart, period.prevEnd));

  // Session counts and the form average look at finished sessions only. Counting
  // abandoned attempts inflated "Sessions This Week" and dragged the average
  // down with the partial scores of sessions the patient walked away from.
  const finished = current.filter(isFinished);
  const prevFinished = previous.filter(isFinished);

  const avgForm = averageForm(finished);
  const prevAvgForm = averageForm(prevFinished);

  return {
    finished: finished.length,
    unfinished: current.length - finished.length,
    totalSessions: current.length,
    avgForm,
    // Reps are counted across every session: a rep performed in a session the
    // patient abandoned is still a rep they performed.
    totalReps: current.reduce((sum, r) => sum + (r.completed_reps ?? 0), 0),
    prevFinished: prevFinished.length,
    prevAvgForm,
    prevTotalReps: previous.reduce((sum, r) => sum + (r.completed_reps ?? 0), 0),
    improvement: prevAvgForm > 0 ? Math.round(((avgForm - prevAvgForm) / prevAvgForm) * 100) : 0,
    improvementComparable: prevAvgForm > 0,
  };
}

export interface Delta {
  direction: 'up' | 'down' | 'flat';
  text: string;
}

/**
 * The "vs last week" caption.
 *
 * Returns an absolute delta when the baseline is zero. The old card divided by
 * the baseline unconditionally, so a patient going from 0 sessions to 3 was told
 * "↑ 0% vs last week" — the one week where the number most deserved to be seen.
 */
export function formatDelta(value: number, baseline: number, unit: string): Delta | null {
  const change = value - baseline;
  if (change === 0) return { direction: 'flat', text: `Same as last ${unit}` };

  const direction = change > 0 ? 'up' : 'down';
  const arrow = change > 0 ? '↑' : '↓';

  if (baseline === 0) {
    return { direction, text: `${arrow} ${Math.abs(change)} vs last ${unit}` };
  }

  const percent = Math.abs(Math.round((change / baseline) * 100));
  return { direction, text: `${arrow} ${percent}% vs last ${unit}` };
}
