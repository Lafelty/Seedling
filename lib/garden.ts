/**
 * Garden growth model — an alternate visualization of the same star total
 * that drives the tree (profiles.total_stars via lib/progress).
 *
 * The artwork (public/garden/stage00.png … stage13.png, extracted from
 * GardenPack.pdf) is a single scene that fills in cumulatively: stage 0 is
 * an empty plot, stage 13 the full garden. One star reveals the next stage.
 */

export const GARDEN_STAGE_COUNT = 14;

/** Stars required to reach stage i+1 (stage 0 is the empty plot). */
export const GARDEN_THRESHOLDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

/** What appears at each stage 1..13, shown as the stage caption. */
export const GARDEN_STAGE_NAMES = [
  'An empty plot',
  'A yellow flower blooms',
  'A red flower joins in',
  'A bunny moves in',
  'A tree takes root',
  'Acorns and greens appear',
  'A snail comes to visit',
  'A cat plays in the clover',
  'A sunflower is potted',
  'New sprouts are planted',
  'Bellflowers hang overhead',
  'Berries ripen on the vine',
  'Clover spreads everywhere',
  'Your garden is in full bloom',
] as const;

export function getGardenStage(totalStars: number): number {
  let stage = 0;
  for (const threshold of GARDEN_THRESHOLDS) {
    if (totalStars >= threshold) stage++;
    else break;
  }
  return stage;
}

export function getGardenStageName(stage: number): string {
  return GARDEN_STAGE_NAMES[Math.min(Math.max(stage, 0), GARDEN_STAGE_COUNT - 1)];
}

export function getGardenImagePath(stage: number): string {
  const clamped = Math.min(Math.max(stage, 0), GARDEN_STAGE_COUNT - 1);
  return `/garden/stage${String(clamped).padStart(2, '0')}.png`;
}

/** Stars still needed for the next reveal; 0 when the garden is complete. */
export function getStarsToNextBloom(totalStars: number): number {
  for (const threshold of GARDEN_THRESHOLDS) {
    if (totalStars < threshold) return threshold - totalStars;
  }
  return 0;
}

/** Progress (0-100) from the previous threshold toward the next reveal. */
export function getGardenProgressPercent(totalStars: number): number {
  const stage = getGardenStage(totalStars);
  if (stage >= GARDEN_THRESHOLDS.length) return 100;
  const lo = stage === 0 ? 0 : GARDEN_THRESHOLDS[stage - 1];
  const hi = GARDEN_THRESHOLDS[stage];
  return Math.min(100, Math.max(0, ((totalStars - lo) / (hi - lo)) * 100));
}
