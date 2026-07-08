// Level-map progression logic shared by /levels and /levels/[groupId].
//
// Unlock model: inside a box (group) poses are ordered by rank_in_group.
// A pose is "cleared" when some completed session on it reached the
// pose's requirements — form_quality_score >= unlock_min_score and, when
// unlock_max_seconds is set, duration_seconds within the cap. The AI pose
// model produces form_quality_score during the session, so no extra
// analysis pass is needed here.
//
// Every box is open — patients can enter any box in any order. Progression
// still applies inside a box: poses unlock in rank_in_group order as earlier
// poses are cleared.

export interface LevelGroup {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
}

export interface LevelExercise {
  id: string;
  name: string;
  description?: string | null;
  difficulty: string;
  group_id: string | null;
  rank_in_group: number;
  unlock_min_score: number;
  unlock_max_seconds: number | null;
}

export interface CompletedSession {
  exercise_id: string | null;
  form_quality_score: number | string | null;
  duration_seconds: number | null;
}

export type NodeStatus = 'cleared' | 'unlocked' | 'locked';

export interface ExerciseNode {
  exercise: LevelExercise;
  status: NodeStatus;
  bestScore: number | null;
  attempts: number;
}

export interface GroupNode {
  group: LevelGroup;
  exercises: ExerciseNode[];
  status: NodeStatus;
  clearedCount: number;
  total: number;
}

/** Does this completed session satisfy the exercise's clear requirements? */
export function sessionClears(ex: LevelExercise, s: CompletedSession): boolean {
  const score = s.form_quality_score == null ? null : Number(s.form_quality_score);
  if (score == null || Number.isNaN(score) || score < ex.unlock_min_score) return false;
  if (ex.unlock_max_seconds != null) {
    if (s.duration_seconds == null || s.duration_seconds > ex.unlock_max_seconds) return false;
  }
  return true;
}

export function buildLevelMap(
  groups: LevelGroup[],
  exercises: LevelExercise[],
  sessions: CompletedSession[],
): GroupNode[] {
  const byExercise = new Map<string, CompletedSession[]>();
  for (const s of sessions) {
    if (!s.exercise_id) continue;
    const list = byExercise.get(s.exercise_id) ?? [];
    list.push(s);
    byExercise.set(s.exercise_id, list);
  }

  const sortedGroups = [...groups].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );

  const out: GroupNode[] = [];

  for (const group of sortedGroups) {
    const groupExercises = exercises
      .filter((e) => e.group_id === group.id)
      .sort((a, b) => a.rank_in_group - b.rank_in_group || a.name.localeCompare(b.name));

    const nodes: ExerciseNode[] = [];
    let clearedCount = 0;
    let prevCleared = true; // rank 1 is always available in an unlocked box

    for (const ex of groupExercises) {
      const exSessions = byExercise.get(ex.id) ?? [];
      const cleared = exSessions.some((s) => sessionClears(ex, s));
      let bestScore: number | null = null;
      for (const s of exSessions) {
        const score = s.form_quality_score == null ? null : Number(s.form_quality_score);
        if (score != null && !Number.isNaN(score) && (bestScore == null || score > bestScore)) {
          bestScore = score;
        }
      }

      const status: NodeStatus = cleared
        ? 'cleared'
        : prevCleared
        ? 'unlocked'
        : 'locked';

      if (cleared) clearedCount++;
      nodes.push({ exercise: ex, status, bestScore, attempts: exSessions.length });
      prevCleared = cleared;
    }

    const groupCleared = groupExercises.length === 0 || clearedCount === groupExercises.length;
    const status: NodeStatus = groupCleared && groupExercises.length > 0
      ? 'cleared'
      : 'unlocked';

    out.push({ group, exercises: nodes, status, clearedCount, total: groupExercises.length });
  }

  return out;
}
