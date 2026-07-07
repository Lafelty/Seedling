// Mood-face day cells shared by the progress calendar and the dashboard
// week strip. One face per day, colored by how the day went.

export type DayMood = 'great' | 'happy' | 'partial' | 'rest' | 'future';

export const MOOD_BG: Record<DayMood, string> = {
  great: '#F0DC8B',
  happy: '#AED8A0',
  partial: '#7BAE89',
  rest: '#D3D6D0',
  future: 'rgba(107, 143, 122, 0.10)',
};

export interface DayMoodInput {
  completedCount: number;
  startedCount: number;
  avgForm: number | null;
  fallbackCompleted: boolean;
  isFuture: boolean;
}

export function computeDayMood({ completedCount, startedCount, avgForm, fallbackCompleted, isFuture }: DayMoodInput): DayMood {
  if (isFuture) return 'future';
  const hasCompleted = fallbackCompleted || completedCount > 0;
  if (hasCompleted && (completedCount >= 2 || (avgForm != null && avgForm >= 80))) return 'great';
  if (hasCompleted) return 'happy';
  if (startedCount > 0) return 'partial';
  return 'rest';
}

export function DayFace({ mood }: { mood: DayMood }) {
  const face = '#2F3B33';
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true" style={{ display: 'block', opacity: mood === 'future' ? 0.25 : 1 }}>
      {mood === 'great' ? (
        <>
          <circle cx="16.5" cy="19" r="3" fill={face} />
          <circle cx="31.5" cy="19" r="3" fill={face} />
          <path d="M14.5 27 q9.5 13 19 0 z" fill={face} />
        </>
      ) : mood === 'happy' ? (
        <>
          <circle cx="16.5" cy="19.5" r="2.6" fill={face} />
          <circle cx="31.5" cy="19.5" r="2.6" fill={face} />
          <path d="M16 27.5 q8 7.5 16 0" fill="none" stroke={face} strokeWidth="3" strokeLinecap="round" />
        </>
      ) : mood === 'partial' ? (
        <>
          <circle cx="16.5" cy="19.5" r="2.6" fill={face} />
          <circle cx="31.5" cy="19.5" r="2.6" fill={face} />
          <line x1="17" y1="29" x2="31" y2="29" stroke={face} strokeWidth="3" strokeLinecap="round" />
        </>
      ) : (
        // rest / future: sleepy dash-dot eyes, flat mouth
        <>
          <line x1="13.5" y1="19.5" x2="19" y2="19.5" stroke={face} strokeWidth="3" strokeLinecap="round" />
          <circle cx="31.5" cy="19.5" r="2.6" fill={face} />
          <line x1="18" y1="29" x2="30" y2="29" stroke={face} strokeWidth="3" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
