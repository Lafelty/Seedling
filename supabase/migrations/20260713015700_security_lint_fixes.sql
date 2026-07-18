-- Security lint fixes (Supabase database linter, 2026-07-13). Idempotent,
-- no schema change — safe on live data, `lib/supabase/types.ts` unaffected.
--
-- 1. 0011 function_search_path_mutable — public.handle_new_user had no pinned
--    search_path. A SECURITY DEFINER function with a mutable search_path can be
--    hijacked by look-alike objects in schemas earlier on the caller's path.
--    The body already schema-qualifies everything, so pin it to '' (pg_catalog
--    stays implicitly available).
--
-- 2. 0028/0029 *_security_definer_function_executable — Supabase's default
--    privileges grant EXECUTE on new functions to anon and authenticated
--    EXPLICITLY, so the `revoke ... from public` in 20260706000000_stars.sql
--    removed only the PUBLIC pseudo-role grant and left these callable via
--    /rest/v1/rpc/*:
--      - handle_new_user: trigger-only (fires on auth.users insert; trigger
--        dispatch does not check the client's EXECUTE privilege). No client
--        role ever calls it — revoke from anon AND authenticated.
--      - is_admin: evaluated inside RLS policies as the querying role, so
--        authenticated must keep EXECUTE. Revoke anon. Note: the profiles
--        policies are not scoped `to authenticated`, so an anon profiles query
--        now errors (permission denied on is_admin) instead of returning empty
--        — the app never queries profiles anonymously, and either way anon
--        gets no rows.
--      - award_stars: intentional client RPC on session completion —
--        authenticated keeps EXECUTE (the remaining 0029 warning for it is
--        accepted; the function clamps to 1..10 stars and only touches the
--        caller's own row). Revoke anon.
--
-- 3. 0025 public_bucket_allows_listing — the broad SELECT policy let any
--    client enumerate every object in exercise-demos. Public-URL access to a
--    public bucket needs no SELECT policy; only the admin editor's
--    `upload(..., { upsert: true })` path reads existing objects. Replace the
--    public policy with an admin-only one.
--
-- Not fixable in SQL: auth_leaked_password_protection — enable in the
-- dashboard under Authentication > Passwords (leaked password protection,
-- HaveIBeenPwned check).

-- ---------------------------------------------------------------------------
-- 1. Pin search_path
-- ---------------------------------------------------------------------------

alter function public.handle_new_user() set search_path = '';

-- ---------------------------------------------------------------------------
-- 2. Remove client EXECUTE grants left by default privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.award_stars(integer) from anon;

-- ---------------------------------------------------------------------------
-- 3. Storage: admin-only SELECT instead of public listing
-- ---------------------------------------------------------------------------

drop policy if exists "Public read exercise demo images" on storage.objects;

drop policy if exists "Admins read exercise demo images" on storage.objects;
create policy "Admins read exercise demo images" on storage.objects
  for select to authenticated
  using (bucket_id = 'exercise-demos' and (select public.is_admin()));
