import type { createClient } from './supabase/client';

export interface SessionResult {
  version: 1;
  userId: string;
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  startedAt: string;
  completed: boolean;
  durationSeconds: number;
  targetReps: number;
  formQualityScore: number;
  reps: Array<{
    id: string;
    repNumber: number;
    holdDuration: number;
    formScore: number;
    timestamp: string;
  }>;
}

const PREFIX = 'medproj_pending_session_';
const key = (userId: string, sessionId: string) => `${PREFIX}${userId}_${sessionId}`;

/** Store only session measurements, never camera frames or authentication data. */
export function retainSessionResult(result: SessionResult): boolean {
  try {
    localStorage.setItem(key(result.userId, result.sessionId), JSON.stringify(result));
    return true;
  } catch {
    return false; // The UI must tell the patient to keep this page open.
  }
}

export function forgetSessionResult(result: SessionResult): void {
  try { localStorage.removeItem(key(result.userId, result.sessionId)); } catch { /* unavailable */ }
}

export function pendingSessionResults(userId: string): SessionResult[] {
  try {
    const results: SessionResult[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const entryKey = localStorage.key(i);
      if (!entryKey?.startsWith(`${PREFIX}${userId}_`)) continue;
      try {
        const result = JSON.parse(localStorage.getItem(entryKey) ?? 'null') as SessionResult;
        if (result?.version === 1 && result.userId === userId &&
            typeof result.sessionId === 'string' && typeof result.exerciseId === 'string' &&
            typeof result.exerciseName === 'string' && typeof result.completed === 'boolean' &&
            Number.isFinite(Date.parse(result.startedAt)) &&
            Number.isFinite(result.durationSeconds) && Number.isFinite(result.formQualityScore) &&
            Number.isFinite(result.targetReps) && Array.isArray(result.reps) &&
            result.reps.every(rep => typeof rep.id === 'string' &&
              Number.isFinite(rep.repNumber) && Number.isFinite(rep.holdDuration) &&
              Number.isFinite(rep.formScore) && Number.isFinite(Date.parse(rep.timestamp)))) {
          results.push(result);
        }
      } catch { /* One damaged record must not hide the other recoverable sessions. */ }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Each step is retryable after an ambiguous network response: rep IDs are
 * stable, completion is final, and the award RPC deduplicates by session ID.
 * Never announce success until every required write has succeeded.
 */
export async function saveSessionResult(
  client: ReturnType<typeof createClient>,
  result: SessionResult,
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const auth = client.auth.getUser();
    const { data: { user }, error: authError } = await Promise.race([
      auth,
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => {
        reject(new Error('Checking your account timed out. Check your connection and retry.'));
      }, { once: true })),
    ]);
    if (authError || user?.id !== result.userId) {
      throw new Error('Sign in to the account that started this session, then retry saving.');
    }
    if (result.reps.length) {
      const { error } = await client.from('rep_data').upsert(
        result.reps.map(rep => ({
          id: rep.id,
          session_id: result.sessionId,
          rep_number: rep.repNumber,
          hold_duration_ms: rep.holdDuration,
          form_score: rep.formScore,
          timestamp: rep.timestamp,
        })),
        { onConflict: 'id', ignoreDuplicates: true },
      ).abortSignal(controller.signal);
      if (error) throw new Error('Your repetitions could not be saved. Check your connection and retry.');
    }

    const { data: stamped, error } = await client.rpc('complete_session', {
      p_session_id: result.sessionId,
      p_completed: result.completed,
      p_duration_seconds: result.durationSeconds,
      p_completed_reps: result.reps.length,
      p_form_quality_score: result.formQualityScore,
    }).abortSignal(controller.signal);
    if (error || typeof stamped !== 'boolean') {
      throw new Error('Your session could not be saved. Check your connection and retry.');
    }

    if (!result.completed) return null;

    const award = await client.rpc('award_stars', { p_session_id: result.sessionId })
      .abortSignal(controller.signal);
    if (award.error || typeof award.data !== 'number' || !Number.isFinite(award.data) || award.data < 0) {
      throw new Error('Your session is saved, but its star is still waiting to sync. Retry to finish.');
    }
    return award.data;
  } finally {
    clearTimeout(timer);
  }
}
