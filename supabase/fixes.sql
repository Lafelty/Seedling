-- ============================================================================
-- MedProj bug-fix migration — run once in the Supabase SQL editor.
-- Repairs live data that the source-file fixes cannot reach.
-- Safe to re-run (idempotent).
-- ============================================================================

-- 1) Deactivate any exercise that was published without real validation
--    criteria. The session engine cannot count reps against an empty ruleset,
--    so these must not appear as the "active" exercise.
UPDATE exercises
SET is_active = FALSE
WHERE is_active = TRUE
  AND (pose_criteria -> 'criteria') IS NULL
  AND (pose_criteria -> 'levelingRules') IS NULL;

-- 2) Ensure a correct, ready-to-use Shoulder Raise exists and is active.
--    MoveNet keypoint names are snake_case (left_shoulder, not leftShoulder).
INSERT INTO exercises (
  name, description, exercise_type, difficulty,
  pose_criteria, target_reps, hold_duration_ms, is_active
)
SELECT
  'Shoulder Raise',
  'Raise both arms above shoulder height and hold',
  'static',
  'beginner',
  '{
    "targetBodyParts": ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow"],
    "criteria": [
      { "joint": "left_shoulder",  "minAngle": 80, "maxAngle": 100, "targetAngle": 90, "relativeTo": ["left_elbow", "left_hip"] },
      { "joint": "right_shoulder", "minAngle": 80, "maxAngle": 100, "targetAngle": 90, "relativeTo": ["right_elbow", "right_hip"] }
    ],
    "levelingRules": [
      { "joints": ["left_shoulder", "right_shoulder"], "maxDifference": 10, "message": "Keep shoulders level" }
    ]
  }'::jsonb,
  10, 500, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM exercises
  WHERE name = 'Shoulder Raise' AND is_active = TRUE
);

-- 3) Tighten the read policy: only signed-in users may list active exercises
--    (previously readable by anonymous clients).
DROP POLICY IF EXISTS "Users can view active exercises" ON exercises;
CREATE POLICY "Users can view active exercises"
  ON exercises
  FOR SELECT
  USING (is_active = TRUE AND auth.uid() IS NOT NULL);

-- 4) Grant admin case-insensitively (auth emails are stored lowercased).
UPDATE profiles
SET is_admin = TRUE
WHERE lower(email) = lower('adminNeena@gmail.com');
