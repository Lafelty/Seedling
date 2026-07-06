-- Patient profile info + guardian notifications (2026-07-06):
--
-- 1. height_cm / weight_kg — patients fill these in on /profile.
-- 2. guardian_email + guardian_notify — when the toggle is on, the app's
--    /api/notify-guardian route emails this address after each completed
--    session. The route reads these values server-side (never from the
--    request body), so a tampered client cannot redirect mail.
--
-- Existing "Users can update own profile" RLS policy already covers these
-- columns; is_admin remains UPDATE-revoked from client roles.
--
-- Run in the Supabase SQL editor. Idempotent: safe to re-run.

alter table public.profiles
  add column if not exists height_cm numeric(5,1),
  add column if not exists weight_kg numeric(5,1),
  add column if not exists guardian_email text,
  add column if not exists guardian_notify boolean not null default false;
