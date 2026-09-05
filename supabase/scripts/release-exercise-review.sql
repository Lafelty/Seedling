-- Read-only exercise configuration export for the Phase 3 therapist review.
-- Run in the approved staging project. Contains no patient/session records.
select
  id, name, description, exercise_type, tracking_mode,
  target_reps, hold_duration_ms, pose_criteria, feedback_messages,
  group_id, rank_in_group, unlock_min_score, unlock_max_seconds,
  demo_images, reference_image_url, reference_video_url,
  jsonb_array_length(coalesce(recorded_paths, '[]'::jsonb)) as recorded_demo_count,
  updated_at
from public.exercises
order by group_id nulls last, rank_in_group, name;
