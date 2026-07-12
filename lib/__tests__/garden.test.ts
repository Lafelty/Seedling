import { describe, expect, it } from 'vitest';
import {
  GARDEN_STAGE_COUNT,
  GARDEN_STAGE_NAMES,
  GARDEN_THRESHOLDS,
  getGardenImagePath,
  getGardenProgressPercent,
  getGardenStage,
  getGardenStageName,
  getStarsToNextBloom,
} from '../garden';

describe('garden model shape', () => {
  it('has one name per stage and one threshold per reveal', () => {
    expect(GARDEN_STAGE_NAMES).toHaveLength(GARDEN_STAGE_COUNT);
    expect(GARDEN_THRESHOLDS).toHaveLength(GARDEN_STAGE_COUNT - 1);
  });

  it('thresholds strictly increase', () => {
    for (let i = 1; i < GARDEN_THRESHOLDS.length; i++) {
      expect(GARDEN_THRESHOLDS[i]).toBeGreaterThan(GARDEN_THRESHOLDS[i - 1]);
    }
  });
});

describe('getGardenStage', () => {
  it('starts at the empty plot', () => {
    expect(getGardenStage(0)).toBe(0);
  });

  it('reveals the first element at 1 star', () => {
    expect(getGardenStage(1)).toBe(1);
  });

  it('steps exactly at each threshold', () => {
    GARDEN_THRESHOLDS.forEach((threshold, i) => {
      expect(getGardenStage(threshold - 1)).toBe(i);
      expect(getGardenStage(threshold)).toBe(i + 1);
    });
  });

  it('caps at the final stage', () => {
    expect(getGardenStage(13)).toBe(13);
    expect(getGardenStage(1000)).toBe(13);
  });
});

describe('getStarsToNextBloom', () => {
  it('counts down to the next threshold', () => {
    expect(getStarsToNextBloom(0)).toBe(1);
    expect(getStarsToNextBloom(1)).toBe(1);
    expect(getStarsToNextBloom(2)).toBe(1);
    expect(getStarsToNextBloom(9)).toBe(1);
  });

  it('returns 0 once the garden is complete', () => {
    expect(getStarsToNextBloom(13)).toBe(0);
    expect(getStarsToNextBloom(100)).toBe(0);
  });
});

describe('getGardenProgressPercent', () => {
  it('is 0 at a fresh threshold and 100 when complete', () => {
    expect(getGardenProgressPercent(0)).toBe(0);
    expect(getGardenProgressPercent(13)).toBe(100);
  });

  it('is halfway between thresholds', () => {
    // each stage spans exactly 1 star, so progress is always 0% or 100%
    expect(getGardenProgressPercent(6)).toBe(0);
    expect(getGardenProgressPercent(7)).toBe(0);
  });
});

describe('asset helpers', () => {
  it('builds zero-padded image paths and clamps out-of-range stages', () => {
    expect(getGardenImagePath(0)).toBe('/garden/stage00.png');
    expect(getGardenImagePath(13)).toBe('/garden/stage13.png');
    expect(getGardenImagePath(99)).toBe('/garden/stage13.png');
    expect(getGardenImagePath(-1)).toBe('/garden/stage00.png');
  });

  it('clamps stage names', () => {
    expect(getGardenStageName(0)).toBe('An empty plot');
    expect(getGardenStageName(13)).toBe('Your garden is in full bloom');
    expect(getGardenStageName(99)).toBe('Your garden is in full bloom');
  });
});
