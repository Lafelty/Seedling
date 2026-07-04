-- Add admin role to profiles
ALTER TABLE profiles ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;

-- Create exercises table
CREATE TABLE exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  exercise_type TEXT NOT NULL, -- 'static' or 'dynamic'
  difficulty TEXT DEFAULT 'beginner', -- 'beginner', 'intermediate', 'advanced'

  -- Recording data (from Option 3)
  recorded_paths JSONB, -- Array of recorded demonstrations

  -- Refined criteria (from Option 1)
  pose_criteria JSONB NOT NULL, -- Target angles, tolerances, rules

  -- Exercise config
  target_reps INTEGER DEFAULT 10,
  hold_duration_ms INTEGER DEFAULT 500,

  -- Feedback messages
  feedback_messages JSONB DEFAULT '{"perfect": "Perfect form!", "tooLow": "Raise higher", "tooHigh": "Lower slightly", "notLevel": "Keep level"}'::jsonb,

  -- Visual aids
  reference_image_url TEXT,
  reference_video_url TEXT,

  -- Metadata
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- Update therapy_sessions to reference exercises
ALTER TABLE therapy_sessions ADD COLUMN exercise_id UUID REFERENCES exercises(id);

-- Create index for faster lookups
CREATE INDEX idx_exercises_active ON exercises(is_active, created_at);
CREATE INDEX idx_exercises_created_by ON exercises(created_by);

-- Enable RLS on exercises
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;

-- Admins can do everything with exercises
CREATE POLICY "Admins can manage exercises"
  ON exercises
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = TRUE
    )
  );

-- Regular users can only view active exercises
CREATE POLICY "Users can view active exercises"
  ON exercises
  FOR SELECT
  USING (is_active = TRUE);

-- Insert default shoulder raise exercise (migrating existing)
INSERT INTO exercises (
  name,
  description,
  exercise_type,
  difficulty,
  pose_criteria,
  target_reps,
  hold_duration_ms,
  is_active
) VALUES (
  'Shoulder Raise',
  'Raise both arms above shoulder height and hold',
  'static',
  'beginner',
  '{
    "targetBodyParts": ["leftShoulder", "rightShoulder", "leftElbow", "rightElbow"],
    "criteria": [
      {
        "joint": "leftShoulder",
        "minAngle": 80,
        "maxAngle": 100,
        "targetAngle": 90,
        "relativeTo": ["leftElbow", "leftHip"]
      },
      {
        "joint": "rightShoulder",
        "minAngle": 80,
        "maxAngle": 100,
        "targetAngle": 90,
        "relativeTo": ["rightElbow", "rightHip"]
      }
    ],
    "levelingRules": [
      {
        "joints": ["leftShoulder", "rightShoulder"],
        "maxDifference": 10,
        "message": "Keep shoulders level"
      }
    ]
  }'::jsonb,
  10,
  500,
  TRUE
);

COMMENT ON TABLE exercises IS 'Custom therapy exercises created by admins';
COMMENT ON COLUMN exercises.recorded_paths IS 'Array of recorded demonstrations with keypoint data';
COMMENT ON COLUMN exercises.pose_criteria IS 'Refined pose criteria: target angles, tolerances, and validation rules';
