// The look of a box, shared by /levels and /levels/[groupId].
//
// A box carries one colour everywhere it appears: on its card, in the panel it
// expands into, and on its own page. Opening a box should feel like walking
// into the same room, not into a differently painted one — so the tint lives
// here rather than in either page.

export interface BoxTint {
  /** Faint fill: card washes, chips, tracks. */
  wash: string;
  /** Card border and focus ring. */
  edge: string;
  /** Text and icons on a light surface — all pass WCAG AA on white. */
  ink: string;
  /** Solid fill for progress and completed markers. */
  bar: string;
}

/** Stable per-box index, so a box keeps the same mark and the same tint. */
export function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash;
}

/**
 * Four light greens of the same lightness and weight — they tell boxes apart
 * without any of them reading as further along, higher, or next.
 */
export const BOX_TINTS: BoxTint[] = [
  { wash: 'rgba(124, 199, 134, 0.30)', edge: 'rgba(120, 187, 128, 0.55)', ink: '#2F6B45', bar: '#5FAF6B' }, // leaf
  { wash: 'rgba(150, 214, 184, 0.32)', edge: 'rgba(126, 194, 166, 0.55)', ink: '#2C6A5B', bar: '#54B296' }, // mint
  { wash: 'rgba(186, 222, 140, 0.34)', edge: 'rgba(163, 203, 120, 0.55)', ink: '#4E6B27', bar: '#8CC252' }, // spring
  { wash: 'rgba(146, 208, 205, 0.32)', edge: 'rgba(124, 187, 186, 0.55)', ink: '#2A6465', bar: '#57AFAF' }, // eucalyptus
];

/** A finished box leaves the green family for gold. */
export const CLEARED_TINT: BoxTint = {
  wash: 'rgba(201, 184, 138, 0.28)',
  edge: 'rgba(201, 184, 138, 0.60)',
  ink: '#7A6A3E',
  bar: '#C9B88A',
};

export function tintOf(id: string, cleared: boolean): BoxTint {
  return cleared ? CLEARED_TINT : BOX_TINTS[hashId(id) % BOX_TINTS.length];
}

/**
 * Effort, on a three-step scale. Shown as filled dots plus the word, never as
 * a red/amber/green badge: difficulty is information, not a warning, and
 * colour is never the only thing carrying it.
 */
export const DIFFICULTY_STEPS: Record<string, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
};

export function difficultySteps(difficulty: string): number {
  return DIFFICULTY_STEPS[difficulty?.toLowerCase()] ?? 1;
}
