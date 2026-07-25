// Pinned east of UTC so "local day" and "UTC day" disagree for part of every
// day — the condition the day-key bugs needed. Must run before date-fns and
// lib/progress are imported, or the first Date call caches the old zone.
process.env.TZ = 'Asia/Bangkok'; // UTC+7

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { format } from 'date-fns';
import { dayKey, computeStreak, getDayStrip } from '../progress';

// 01:00 local on 2026-07-25 in Bangkok — still 2026-07-24 in UTC. Every
// assertion below distinguishes the two.
const EARLY_MORNING = new Date('2026-07-24T18:00:00Z');

describe('day keys are local calendar days', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(EARLY_MORNING);
  });
  afterEach(() => vi.useRealTimers());

  it('sanity: the fixture really does straddle the UTC boundary', () => {
    expect(EARLY_MORNING.toISOString().split('T')[0]).toBe('2026-07-24');
    expect(format(EARLY_MORNING, 'yyyy-MM-dd')).toBe('2026-07-25');
  });

  it('dayKey matches the date-fns format the pages bucket sessions with', () => {
    expect(dayKey(EARLY_MORNING)).toBe('2026-07-25');
    expect(dayKey(EARLY_MORNING)).toBe(format(EARLY_MORNING, 'yyyy-MM-dd'));
  });

  it('counts a streak for a session logged early on the local day', () => {
    // Regression: a UTC key read "today" as 2026-07-24, found neither that nor
    // 2026-07-23 in the set, and reported no streak on a day just practiced.
    expect(computeStreak(['2026-07-25'])).toBe(1);
  });

  it('walks consecutive local days backwards', () => {
    expect(computeStreak(['2026-07-23', '2026-07-24', '2026-07-25'])).toBe(3);
  });

  it('keeps a streak alive on a not-yet-practiced today', () => {
    expect(computeStreak(['2026-07-23', '2026-07-24'])).toBe(2);
  });

  it('breaks the streak on a gap at both today and yesterday', () => {
    expect(computeStreak(['2026-07-22', '2026-07-23'])).toBe(0);
  });

  it('ends the week strip on the local today, so the ring lands on it', () => {
    const strip = getDayStrip();
    expect(strip).toHaveLength(7);
    expect(strip[6].date).toBe('2026-07-25');
    expect(strip[0].date).toBe('2026-07-19');
  });
});
