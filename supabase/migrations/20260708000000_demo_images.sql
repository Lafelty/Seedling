-- Per-exercise demonstration pictures, shown on the "Ready?" screen before a
-- session starts (replaces the hardcoded two wrist photos). Additive and safe
-- on a live database: existing rows get an empty list and the app shows a
-- "no pictures" placeholder. Run in the Supabase SQL editor.
--
-- demo_images is a JSON array of public URLs (normally two) pointing into the
-- exercise-demos storage bucket, e.g.
--   ["https://<proj>.supabase.co/storage/v1/object/public/exercise-demos/<exercise-id>/slot0-....jpg"]

ALTER TABLE exercises
  ADD COLUMN demo_images JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Public bucket the editor uploads into. Public read is intentional: the URLs
-- are stored in exercises rows and rendered with plain <img> tags.
INSERT INTO storage.buckets (id, name, public)
VALUES ('exercise-demos', 'exercise-demos', true)
ON CONFLICT (id) DO NOTHING;

-- Only admins (therapists) may write; everyone may read.
-- Uses public.is_admin() from 20260706000000_stars.sql.
CREATE POLICY "Admins upload exercise demo images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'exercise-demos' AND (SELECT public.is_admin()));

CREATE POLICY "Admins update exercise demo images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'exercise-demos' AND (SELECT public.is_admin()))
  WITH CHECK (bucket_id = 'exercise-demos' AND (SELECT public.is_admin()));

CREATE POLICY "Admins delete exercise demo images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'exercise-demos' AND (SELECT public.is_admin()));

CREATE POLICY "Public read exercise demo images" ON storage.objects
  FOR SELECT USING (bucket_id = 'exercise-demos');
