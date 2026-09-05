import { describe, expect, it, vi } from 'vitest';
import { loadProgressSnapshot } from '../progressSync';

function clientDouble(fail?: 'profiles' | 'therapy_sessions', pages = 1) {
  const range = vi.fn();
  let page = 0;
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'not', 'order', 'abortSignal']) chain[name] = () => chain;
      chain.range = (from: number, to: number) => { range(from, to); return chain; };
      chain.single = () => chain;
      chain.then = (resolve: (value: unknown) => void) => resolve({
        data: fail === table ? null : table === 'profiles'
          ? { name: 'Patient', is_admin: false, total_stars: 4 }
          : Array.from({ length: ++page < pages ? 500 : 1 }, () => ({ started_at: '2026-09-01T09:00:00Z' })),
        error: fail === table ? { message: 'offline' } : null,
      });
      return chain;
    },
  };
  return { client: client as unknown as Parameters<typeof loadProgressSnapshot>[0], range };
}

describe('authoritative progress loading', () => {
  it.each(['profiles', 'therapy_sessions'] as const)('rejects a failed %s request instead of returning a zero snapshot', async table => {
    await expect(loadProgressSnapshot(clientDouble(table).client, 'patient')).rejects.toThrow('could not be loaded');
  });

  it('paginates all completion history and deduplicates calendar days', async () => {
    const fake = clientDouble(undefined, 3);
    const snapshot = await loadProgressSnapshot(fake.client, 'patient');
    expect(snapshot.profile.total_stars).toBe(4);
    expect(snapshot.completedDates).toEqual(['2026-09-01']);
    expect(fake.range.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });
});
