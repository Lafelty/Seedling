// Pinned east of UTC, matching progress.test.ts: local and UTC calendar days
// disagree for part of every day, and the day bucketing here has to land on the
// local one. Must run before date-fns is imported.
process.env.TZ = 'Asia/Bangkok'; // UTC+7

import { describe, expect, it } from 'vitest';
import {
  bucketByDay,
  formatDelta,
  periodStats,
  resolvePeriod,
  setPeriodMode,
  shiftPeriod,
  type SessionRow,
} from '../dashboard-stats';

// Saturday 2026-08-01, 10:00 local.
const NOW = new Date('2026-08-01T03:00:00Z');

let nextId = 0;
function session(startedAt: string, opts: Partial<SessionRow> = {}): SessionRow {
  return {
    id: `s${nextId++}`,
    started_at: startedAt,
    completed_at: `${startedAt.slice(0, 19)}Z`,
    duration_seconds: 300,
    completed_reps: 10,
    target_reps: 10,
    form_quality_score: 80,
    ...opts,
  };
}

/** A session that was started and walked away from. */
function abandoned(startedAt: string, opts: Partial<SessionRow> = {}): SessionRow {
  return session(startedAt, { completed_at: null, ...opts });
}

describe('resolvePeriod', () => {
  it('runs weeks Monday to Sunday around the anchor', () => {
    const p = resolvePeriod({ mode: 'week', anchor: NOW }, NOW);
    // 2026-08-01 is a Saturday, so its week is Mon 27 Jul – Sun 2 Aug.
    expect(p.start.getDate()).toBe(27);
    expect(p.start.getMonth()).toBe(6); // July
    expect(p.end.getDate()).toBe(2);
    expect(p.end.getMonth()).toBe(7); // August
  });

  it('points the previous span at the week immediately before', () => {
    const p = resolvePeriod({ mode: 'week', anchor: NOW }, NOW);
    expect(p.prevStart.getDate()).toBe(20);
    expect(p.prevEnd.getDate()).toBe(26);
  });

  it('spans the whole calendar month in month mode', () => {
    const p = resolvePeriod({ mode: 'month', anchor: NOW }, NOW);
    expect(p.start.getDate()).toBe(1);
    expect(p.end.getDate()).toBe(31);
    expect(p.prevStart.getMonth()).toBe(6); // July
    expect(p.prevEnd.getDate()).toBe(31); // July has 31 days
  });

  it('names the period the patient is in rather than dating it', () => {
    expect(resolvePeriod({ mode: 'week', anchor: NOW }, NOW).label).toBe('This week');
    expect(resolvePeriod({ mode: 'month', anchor: NOW }, NOW).label).toBe('This month');
  });

  it('dates a past period', () => {
    const march = new Date('2026-03-15T03:00:00Z');
    expect(resolvePeriod({ mode: 'month', anchor: march }, NOW).label).toBe('March 2026');
    expect(resolvePeriod({ mode: 'week', anchor: march }, NOW).label).toBe('9–15 Mar');
  });

  it('will not step forward past the current period', () => {
    expect(resolvePeriod({ mode: 'month', anchor: NOW }, NOW).canGoForward).toBe(false);
    const july = resolvePeriod({ mode: 'month', anchor: new Date('2026-07-10T03:00:00Z') }, NOW);
    expect(july.canGoForward).toBe(true);
  });

  it('will not step back past the fetched window', () => {
    // The window starts at the beginning of the month 11 months back: Sep 2025.
    const sept2025 = resolvePeriod({ mode: 'month', anchor: new Date('2025-09-10T03:00:00Z') }, NOW);
    expect(sept2025.canGoBack).toBe(false);

    const oct2025 = resolvePeriod({ mode: 'month', anchor: new Date('2025-10-10T03:00:00Z') }, NOW);
    expect(oct2025.canGoBack).toBe(true);
  });
});

describe('shiftPeriod and setPeriodMode', () => {
  it('steps a week at a time in week mode', () => {
    const back = shiftPeriod({ mode: 'week', anchor: NOW }, -1);
    expect(resolvePeriod(back, NOW).start.getDate()).toBe(20);
  });

  it('steps a month at a time in month mode', () => {
    const back = shiftPeriod({ mode: 'month', anchor: NOW }, -1);
    expect(resolvePeriod(back, NOW).start.getMonth()).toBe(6); // July
  });

  it('keeps the patient in the month they were looking at when switching mode', () => {
    const march = { mode: 'month' as const, anchor: new Date('2026-03-15T03:00:00Z') };
    const asWeek = setPeriodMode(march, 'week', NOW);
    // March's start is Sunday 1 March, whose Monday-based week starts 23 Feb.
    expect(resolvePeriod(asWeek, NOW).start.getMonth()).toBe(1); // February
    expect(asWeek.mode).toBe('week');
  });

  it('stays on the current period when switching mode from the current one', () => {
    const asWeek = setPeriodMode({ mode: 'month', anchor: NOW }, 'week', NOW);
    expect(resolvePeriod(asWeek, NOW).isCurrent).toBe(true);
  });
});

describe('bucketByDay', () => {
  const period = resolvePeriod({ mode: 'week', anchor: NOW }, NOW);

  it('returns one entry per calendar day even where nothing was practised', () => {
    // Regression: the old page grouped only days that had sessions, so two
    // sparse points could be labelled as a fortnight while spanning months.
    const days = bucketByDay([session('2026-07-29T02:00:00Z')], period.start, period.end);
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.finished)).toEqual([0, 0, 1, 0, 0, 0, 0]);
  });

  it('buckets on the local calendar day, not the UTC one', () => {
    // 2026-07-29T18:00Z is 01:00 on the 30th in Bangkok.
    const days = bucketByDay([session('2026-07-29T18:00:00Z')], period.start, period.end);
    const thirtieth = days.find((d) => d.key === '2026-07-30');
    expect(thirtieth?.finished).toBe(1);
  });

  it('separates finished from abandoned on the same day', () => {
    const days = bucketByDay(
      [session('2026-07-29T02:00:00Z'), abandoned('2026-07-29T04:00:00Z')],
      period.start,
      period.end
    );
    const day = days.find((d) => d.key === '2026-07-29');
    expect(day).toMatchObject({ finished: 1, unfinished: 1 });
  });

  it('averages form over finished sessions and leaves an empty day null', () => {
    const days = bucketByDay(
      [
        session('2026-07-29T02:00:00Z', { form_quality_score: 60 }),
        session('2026-07-29T04:00:00Z', { form_quality_score: 80 }),
      ],
      period.start,
      period.end
    );
    expect(days.find((d) => d.key === '2026-07-29')?.formQuality).toBe(70);
    expect(days.find((d) => d.key === '2026-07-28')?.formQuality).toBeNull();
  });

  it('drops sessions outside the range', () => {
    const days = bucketByDay([session('2026-06-01T02:00:00Z')], period.start, period.end);
    expect(days.every((d) => d.finished === 0 && d.unfinished === 0)).toBe(true);
  });

  it('labels weekdays in week mode and dates in month mode', () => {
    const week = bucketByDay([], period.start, period.end, 'week');
    expect(week[0].label).toBe('Mon');

    const month = resolvePeriod({ mode: 'month', anchor: NOW }, NOW);
    const days = bucketByDay([], month.start, month.end, 'month');
    expect(days[0].label).toBe('1');
    expect(days).toHaveLength(31);
  });
});

describe('periodStats', () => {
  const period = resolvePeriod({ mode: 'week', anchor: NOW }, NOW);

  it('counts only closed sessions as finished', () => {
    const stats = periodStats(
      [session('2026-07-29T02:00:00Z'), abandoned('2026-07-30T02:00:00Z')],
      period
    );
    expect(stats).toMatchObject({ finished: 1, unfinished: 1, totalSessions: 2 });
  });

  it('keeps abandoned sessions out of the form average', () => {
    // Regression: an abandoned session's partial score used to drag the week's
    // average down, so walking away from one rep looked like poor form.
    const stats = periodStats(
      [
        session('2026-07-29T02:00:00Z', { form_quality_score: 90 }),
        abandoned('2026-07-30T02:00:00Z', { form_quality_score: 10 }),
      ],
      period
    );
    expect(stats.avgForm).toBe(90);
  });

  it('counts reps from every session, finished or not', () => {
    const stats = periodStats(
      [
        session('2026-07-29T02:00:00Z', { completed_reps: 10 }),
        abandoned('2026-07-30T02:00:00Z', { completed_reps: 4 }),
      ],
      period
    );
    expect(stats.totalReps).toBe(14);
  });

  it('compares against the previous week', () => {
    const stats = periodStats(
      [
        session('2026-07-29T02:00:00Z', { form_quality_score: 88, completed_reps: 10 }),
        session('2026-07-22T02:00:00Z', { form_quality_score: 80, completed_reps: 6 }),
      ],
      period
    );
    expect(stats.prevFinished).toBe(1);
    expect(stats.prevAvgForm).toBe(80);
    expect(stats.prevTotalReps).toBe(6);
    expect(stats.improvement).toBe(10);
    expect(stats.improvementComparable).toBe(true);
  });

  it('reports a decline as a negative improvement', () => {
    const stats = periodStats(
      [
        session('2026-07-29T02:00:00Z', { form_quality_score: 60 }),
        session('2026-07-22T02:00:00Z', { form_quality_score: 80 }),
      ],
      period
    );
    expect(stats.improvement).toBe(-25);
  });

  it('flags improvement as incomparable when there is no baseline', () => {
    const stats = periodStats([session('2026-07-29T02:00:00Z')], period);
    expect(stats.improvement).toBe(0);
    expect(stats.improvementComparable).toBe(false);
  });

  it('returns zeros rather than NaN for an empty period', () => {
    const stats = periodStats([], period);
    expect(stats).toMatchObject({ finished: 0, unfinished: 0, avgForm: 0, totalReps: 0 });
    expect(Number.isNaN(stats.improvement)).toBe(false);
  });
});

describe('formatDelta', () => {
  it('shows a percentage against a real baseline', () => {
    expect(formatDelta(11, 10, 'week')).toEqual({ direction: 'up', text: '↑ 10% vs last week' });
    expect(formatDelta(8, 10, 'week')).toEqual({ direction: 'down', text: '↓ 20% vs last week' });
  });

  it('shows the absolute change when the baseline is zero', () => {
    // Regression: dividing by a zero baseline rendered 0 → 3 as "↑ 0%".
    expect(formatDelta(3, 0, 'week')).toEqual({ direction: 'up', text: '↑ 3 vs last week' });
  });

  it('says so plainly when nothing changed', () => {
    expect(formatDelta(0, 0, 'month')).toEqual({ direction: 'flat', text: 'Same as last month' });
    expect(formatDelta(5, 5, 'month')).toEqual({ direction: 'flat', text: 'Same as last month' });
  });
});
