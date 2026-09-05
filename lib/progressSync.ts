import { format } from 'date-fns';
import type { createClient } from './supabase/client';

/** Read a complete snapshot before replacing the local progress cache. */
export async function loadProgressSnapshot(client: ReturnType<typeof createClient>, userId: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const [profile, completedDates] = await Promise.all([
      client.from('profiles').select('name, is_admin, total_stars')
        .eq('id', userId).abortSignal(controller.signal).single(),
      (async () => {
        const dates = new Set<string>();
        const pageSize = 500;
        for (let offset = 0; ; offset += pageSize) {
          const { data, error } = await client.from('therapy_sessions').select('started_at')
            .eq('user_id', userId).not('completed_at', 'is', null)
            .order('id', { ascending: true }).range(offset, offset + pageSize - 1)
            .abortSignal(controller.signal);
          if (error || !data) throw new Error('Session history could not be loaded.');
          data.forEach(row => dates.add(format(new Date(row.started_at), 'yyyy-MM-dd')));
          if (data.length < pageSize) return [...dates].sort();
        }
      })(),
    ]);
    if (profile.error || !profile.data) throw new Error('Your profile could not be loaded.');
    return { profile: profile.data, completedDates };
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}
