-- Hand/finger tracking: which landmark model an exercise is validated with.
-- Additive and safe to run on a live database: existing rows become 'body'
-- and no criteria migration is needed. Run in the Supabase SQL editor BEFORE
-- creating hand exercises (the app null-coalesces missing values to 'body').

ALTER TABLE exercises
  ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'body'
  CHECK (tracking_mode IN ('body', 'hand'));
