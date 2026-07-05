-- Fixes for Supabase database linter warnings (2026-07-05):
--
-- 1. auth_rls_initplan (9 policies): auth.uid() was re-evaluated per row.
--    Wrapping it as (select auth.uid()) lets Postgres evaluate it once per
--    query (InitPlan) instead of once per row.
--
-- 2. multiple_permissive_policies on exercises/SELECT: "Admins can manage
--    exercises" (FOR ALL) overlapped "Users can view active exercises" on
--    SELECT, so every read ran both policies. The ALL policy is split into
--    INSERT/UPDATE/DELETE, and admin visibility is folded into the single
--    SELECT policy (admins still see inactive drafts).
--
-- 3. SECURITY: profiles UPDATE policy had no column restriction, so any user
--    could set is_admin = true on their own row. Column-level UPDATE on
--    is_admin is revoked from client roles; only service_role / SQL editor
--    can grant admin (see set-admin.sql).
--
-- Run in the Supabase SQL editor. Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. auth_rls_initplan — wrap auth.uid() in a scalar subquery
-- ---------------------------------------------------------------------------

alter policy "Users can view own profile"
  on public.profiles
  using ((select auth.uid()) = id);

alter policy "Users can update own profile"
  on public.profiles
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

alter policy "Users can view own sessions"
  on public.therapy_sessions
  using ((select auth.uid()) = user_id);

alter policy "Users can insert own sessions"
  on public.therapy_sessions
  with check ((select auth.uid()) = user_id);

alter policy "Users can update own sessions"
  on public.therapy_sessions
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "Users can view own rep data"
  on public.rep_data
  using (
    exists (
      select 1 from public.therapy_sessions
      where therapy_sessions.id = rep_data.session_id
      and therapy_sessions.user_id = (select auth.uid())
    )
  );

alter policy "Users can insert own rep data"
  on public.rep_data
  with check (
    exists (
      select 1 from public.therapy_sessions
      where therapy_sessions.id = rep_data.session_id
      and therapy_sessions.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 2. exercises — one SELECT policy, per-action admin policies
-- ---------------------------------------------------------------------------

drop policy if exists "Admins can manage exercises" on public.exercises;
drop policy if exists "Users can view active exercises" on public.exercises;
drop policy if exists "Admins can insert exercises" on public.exercises;
drop policy if exists "Admins can update exercises" on public.exercises;
drop policy if exists "Admins can delete exercises" on public.exercises;

-- Single permissive SELECT policy: patients see active exercises,
-- admins additionally see inactive drafts.
create policy "Users can view active exercises"
  on public.exercises for select
  using (
    (is_active = true and (select auth.uid()) is not null)
    or exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
      and profiles.is_admin = true
    )
  );

create policy "Admins can insert exercises"
  on public.exercises for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
      and profiles.is_admin = true
    )
  );

create policy "Admins can update exercises"
  on public.exercises for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
      and profiles.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
      and profiles.is_admin = true
    )
  );

create policy "Admins can delete exercises"
  on public.exercises for delete
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
      and profiles.is_admin = true
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Security: stop clients from writing profiles.is_admin
-- ---------------------------------------------------------------------------

revoke update (is_admin) on public.profiles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. unindexed_foreign_keys — cover therapy_sessions.exercise_id
--    (linter 0001; supports FK checks and per-exercise analytics)
-- ---------------------------------------------------------------------------

create index if not exists idx_therapy_sessions_exercise_id
  on public.therapy_sessions (exercise_id);
