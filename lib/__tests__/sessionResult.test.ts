import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetSessionResult, pendingSessionResults, retainSessionResult, saveSessionResult, type SessionResult } from '../sessionResult';

const result: SessionResult = {
  version: 1, userId: 'patient-a', sessionId: 'session-a', exerciseId: 'exercise-a',
  exerciseName: 'Shoulder raise', startedAt: '2026-09-01T09:00:00Z',
  completed: true, durationSeconds: 24, targetReps: 1, formQualityScore: 60,
  reps: [{ id: 'stable-rep-id', repNumber: 1, holdDuration: 500, formScore: 80, timestamp: '2026-09-01T09:00:24Z' }],
};

function clientDouble(fail?: 'rep_data' | 'complete_session' | 'award_stars', userId = result.userId) {
  const calls: string[] = [];
  const response = (step: string, data: unknown = null) => ({
    abortSignal: vi.fn(async () => {
      calls.push(step);
      return { data: fail === step ? null : data, error: fail === step ? { message: 'network failed' } : null };
    }),
  });
  const upsert = vi.fn(() => response('rep_data'));
  const rpc = vi.fn((name: string) => response(name, name === 'complete_session' ? false : 4));
  const raw = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })) },
    from: vi.fn(() => ({ upsert })), rpc,
  };
  return { client: raw as unknown as Parameters<typeof saveSessionResult>[0], calls, upsert, rpc };
}

afterEach(() => vi.unstubAllGlobals());

describe('retryable session writes', () => {
  it('persists reps before completion and awards only after both succeed', async () => {
    const fake = clientDouble();
    expect(await saveSessionResult(fake.client, result)).toBe(4);
    expect(fake.calls).toEqual(['rep_data', 'complete_session', 'award_stars']);
    expect(fake.rpc).toHaveBeenCalledWith('complete_session', expect.objectContaining({ p_duration_seconds: 24, p_completed_reps: 1 }));
  });

  it('retries a lost response with identical rep IDs and conflict-ignore semantics', async () => {
    const fake = clientDouble();
    await saveSessionResult(fake.client, result);
    await saveSessionResult(fake.client, result);
    expect(fake.upsert.mock.calls[0]).toEqual(fake.upsert.mock.calls[1]);
    expect(fake.upsert).toHaveBeenCalledWith([expect.objectContaining({ id: 'stable-rep-id', session_id: result.sessionId })], { onConflict: 'id', ignoreDuplicates: true });
  });

  it.each(['rep_data', 'complete_session', 'award_stars'] as const)('surfaces %s failures without reporting success', async step => {
    const fake = clientDouble(step);
    await expect(saveSessionResult(fake.client, result)).rejects.toThrow(/saved|sync/);
    expect(fake.calls.at(-1)).toBe(step);
  });

  it('does not award stars for a partial session', async () => {
    const fake = clientDouble();
    expect(await saveSessionResult(fake.client, { ...result, completed: false })).toBeNull();
    expect(fake.calls).toEqual(['rep_data', 'complete_session']);
  });

  it('blocks writes when another account is signed in', async () => {
    const fake = clientDouble(undefined, 'patient-b');
    await expect(saveSessionResult(fake.client, result)).rejects.toThrow('Sign in');
    expect(fake.calls).toEqual([]);
  });
});

describe('device recovery storage', () => {
  beforeEach(() => {
    const entries = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() { return entries.size; },
      key: (i: number) => [...entries.keys()][i] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    });
  });

  it('survives reload reads, isolates accounts, and clears only the saved session', () => {
    expect(retainSessionResult(result)).toBe(true);
    retainSessionResult({ ...result, userId: 'patient-b' });
    expect(pendingSessionResults('patient-a')).toEqual([result]);
    forgetSessionResult(result);
    expect(pendingSessionResults('patient-a')).toEqual([]);
    expect(pendingSessionResults('patient-b')).toHaveLength(1);
  });

  it('skips a damaged record without hiding other sessions', () => {
    localStorage.setItem('medproj_pending_session_patient-a_broken', '{');
    retainSessionResult(result);
    retainSessionResult({ ...result, sessionId: 'invalid-date', startedAt: 'broken' });
    expect(pendingSessionResults('patient-a')).toEqual([result]);
  });

  it('reports unavailable storage so the UI can warn to keep the page open', () => {
    vi.stubGlobal('localStorage', { setItem() { throw new Error('denied'); } });
    expect(retainSessionResult(result)).toBe(false);
    expect(() => forgetSessionResult(result)).not.toThrow();
    expect(pendingSessionResults('patient-a')).toEqual([]);
  });
});
