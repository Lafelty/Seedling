-- Phone number + profile picture (2026-08-02):
--
-- 1. profiles.phone — a therapist needs a way to reach a patient outside the
--    app. Free text: the app normalises and length-checks it, but numbering
--    plans vary too much to constrain in SQL.
--
-- 2. profiles.avatar_path — the *object path* inside the avatars bucket, not a
--    URL. The bucket is private, so a URL would be a signed one that expires;
--    storing the path lets any page mint a fresh signature on load.
--
-- 3. The avatars bucket itself. Unlike exercise-demos (public, because those
--    pictures are the same for everyone), a patient's photo is theirs — it is
--    read through short-lived signed URLs, and the policies below are the only
--    thing that decides who can ask for one.
--
-- Run in the Supabase SQL editor BEFORE deploying the app code that reads these
-- columns. Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists phone text,
  add column if not exists avatar_path text;

-- 20260725000000_session_write_lockdown.sql revoked UPDATE on profiles wholesale
-- and re-granted an explicit column list. Column grants accumulate, so the two
-- new columns only need adding here — is_admin, total_stars and email stay
-- un-writable by client roles.
grant update (phone, avatar_path) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Private bucket for profile pictures
-- ---------------------------------------------------------------------------

-- The size and type limits mirror the checks in lib/avatar.ts. Having them here
-- too means a client that skips the check still cannot land a 40 MB TIFF.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 3. Storage policies
-- ---------------------------------------------------------------------------
--
-- Objects live at <user-id>/<file>, so the first path segment IS the owner —
-- that is what every policy below checks. One policy per action, scoped `to
-- authenticated`, matching 20260713015700_security_lint_fixes.sql.

drop policy if exists "Users read own avatar" on storage.objects;
create policy "Users read own avatar" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users upload own avatar" on storage.objects;
create policy "Users upload own avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users update own avatar" on storage.objects;
create policy "Users update own avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users delete own avatar" on storage.objects;
create policy "Users delete own avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- SELECT only: the therapist views patient photos on /starconfig but never
-- uploads one on a patient's behalf.
drop policy if exists "Admins read avatars" on storage.objects;
create policy "Admins read avatars" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (select public.is_admin()));
