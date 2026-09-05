import { describe, expect, it } from 'vitest';
import { buildLevelMap, sessionClears, type LevelExercise } from '../levels';

const first: LevelExercise = { id: 'first', name: 'First', difficulty: 'easy', group_id: 'group', rank_in_group: 1, unlock_min_score: 50, unlock_max_seconds: 60 };
const second: LevelExercise = { ...first, id: 'second', name: 'Second', rank_in_group: 2, unlock_min_score: 90, unlock_max_seconds: 30 };

describe('level requirements', () => {
  it('uses the previous exercise’s own thresholds to unlock its successor', () => {
    const [group] = buildLevelMap([{ id: 'group', name: 'Box', description: null, sort_order: 0 }], [first, second], [{ exercise_id: 'first', form_quality_score: 60, duration_seconds: 50 }]);
    expect(group.exercises.map(node => node.status)).toEqual(['cleared', 'unlocked']);
  });

  it('requires both target-pose time and the configured duration cap', () => {
    expect(sessionClears(first, { exercise_id: first.id, form_quality_score: 50, duration_seconds: 60 })).toBe(true);
    expect(sessionClears(first, { exercise_id: first.id, form_quality_score: 90, duration_seconds: 61 })).toBe(false);
    expect(sessionClears(first, { exercise_id: first.id, form_quality_score: null, duration_seconds: 50 })).toBe(false);
  });
});
