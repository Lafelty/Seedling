-- Stars in database (2026-07-06):
--
-- 1. profiles.total_stars — star tracking moves from browser localStorage
--    into the database so admins can view and edit each patient's stars.
--
-- 2. public.is_admin() SECURITY DEFINER helper — profiles policies cannot
--    subquery profiles directly (infinite RLS recursion); the definer
--    function bypasses RLS for the admin check.
--
-- 3. Profiles SELECT/UPDATE policies extended so admins can list all users
--    and edit their stars. Kept as one permissive policy per action to avoid
--    multiple_permissive_policies linter warnings (same approach as
--    perf_rls_fixes.sql). is_admin stays UPDATE-revoked from client roles,
--    so this adds no privilege-escalation path.
--
-- 4. public.award_stars() RPC — atomic increment on session completion,
--    avoiding read-modify-write races when a patient uses two devices.
--
-- Run in the Supabase SQL editor AFTER perf_rls_fixes.sql.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists total_stars integer not null default 0;

-- ---------------------------------------------------------------------------
-- 2. Admin check without RLS recursion
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Profiles policies: admins see and update every profile
-- ---------------------------------------------------------------------------

alter policy "Users can view own profile"
  on public.profiles
  using ((select auth.uid()) = id or (select public.is_admin()));

alter policy "Users can update own profile"
  on public.profiles
  using ((select auth.uid()) = id or (select public.is_admin()))
  with check ((select auth.uid()) = id or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 4. Atomic star award for session completion
-- ---------------------------------------------------------------------------

create or replace function public.award_stars(star_count integer default 1)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set total_stars = total_stars + greatest(1, least(star_count, 10)),
      updated_at = timezone('utc'::text, now())
  where id = auth.uid()
  returning total_stars;
$$;

revoke all on function public.award_stars(integer) from public;
grant execute on function public.award_stars(integer) to authenticated;
