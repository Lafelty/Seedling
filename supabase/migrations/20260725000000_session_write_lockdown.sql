-- Session write lockdown (2026-07-25) — C3 in docs/AUDIT_2026-07-25.md.
--
-- 20260718120000_star_integrity.sql made total_stars server-owned but left
-- therapy_sessions itself fully client-writable:
--
--   1. "Users can update own sessions" permits a whole-row UPDATE of your own
--      rows and nothing was revoked on the table. From the browser console,
--      update({ stars_awarded: false }) on an already-claimed session followed
--      by rpc('award_stars', ...) granted another star, repeatable without
--      limit — the "awarded exactly once" invariant did not hold.
--   2. INSERT was equally open: a client could insert a row with completed_at
--      set and form_quality_score = 100, minting completed sessions and
--      unlocking every level (lib/levels.ts).
--
-- The two earlier column-level revokes also never took effect:
--
--   revoke update (is_admin)    on public.profiles  -- 20260705000000:130
--   revoke update (total_stars) on public.profiles  -- 20260718120000:110
--
-- Postgres satisfies a column privilege check from *either* the column ACL or
-- the table-level grant, and Supabase's default privileges give `authenticated`
-- table-level UPDATE on public tables. A column-level REVOKE aimed at a role
-- that holds the table-level privilege changes nothing. The form that works is
-- REVOKE at table level, then GRANT back only the permitted columns — applied
-- below to both tables.
--
-- After this migration the client may open a session (INSERT, opening columns
-- only) and read it. Every completion column is stamped by complete_session(),
-- which verifies ownership, clamps the values, and treats a completed session
-- as final.
--
-- Residual limitation: completed_reps and form_quality_score still originate in
-- the browser, so a determined user can still mis-report their own form. What
-- is now unforgeable is the star ledger (stars_awarded — one award per session)
-- and the shape of a completed row.
--
-- Run in the Supabase SQL editor AFTER 20260718120000_star_integrity.sql.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. therapy_sessions: no client UPDATE, INSERT limited to opening a session
-- ---------------------------------------------------------------------------

revoke insert, update on public.therapy_sessions from anon, authenticated;

-- Opening a session is all the client writes directly. Everything else is a
-- column default (id, created_at, completed_reps, stars_awarded) or is stamped
-- by complete_session() below.
grant insert (user_id, exercise_id, exercise_type, started_at, target_reps, notes)
  on public.therapy_sessions to authenticated;

-- No role holds UPDATE any more, so this policy is unreachable — and it reads
-- as though clients may edit their sessions. Drop it, so that re-granting
-- UPDATE later cannot silently reopen the hole.
drop policy if exists "Users can update own sessions" on public.therapy_sessions;

-- ---------------------------------------------------------------------------
-- 2. complete_session: the only path that stamps the completion columns
-- ---------------------------------------------------------------------------

create or replace function public.complete_session(
  p_session_id uuid,
  p_completed boolean,
  p_duration_seconds integer,
  p_completed_reps integer,
  p_form_quality_score numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned boolean;
begin
  -- Only the caller's own, still-open session is stamped. completed_at is never
  -- cleared and never overwritten, so a completed session cannot be re-completed
  -- to re-arm the stars_awarded claim in award_stars().
  update public.therapy_sessions s
  set completed_at = case
                       when p_completed then timezone('utc'::text, now())
                       else null
                     end,
      duration_seconds = greatest(0, coalesce(p_duration_seconds, 0)),
      completed_reps = least(greatest(0, coalesce(p_completed_reps, 0)), s.target_reps),
      form_quality_score = least(100, greatest(0, coalesce(p_form_quality_score, 0)))
  where s.id = p_session_id
    and s.user_id = auth.uid()
    and s.completed_at is null;

  if found then
    return true;
  end if;

  -- Nothing stamped: either the session is already complete (a retry, or
  -- save-and-exit racing completion — both are no-ops), or the row is not the
  -- caller's, which is worth surfacing.
  select true into v_owned
  from public.therapy_sessions
  where id = p_session_id
    and user_id = auth.uid();

  if not found then
    raise exception 'session % not found for this user', p_session_id
      using errcode = '42501';
  end if;

  return false;
end;
$$;

revoke all on function
  public.complete_session(uuid, boolean, integer, integer, numeric)
  from public, anon;
grant execute on function
  public.complete_session(uuid, boolean, integer, integer, numeric)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. profiles: redo the ineffective column revokes as revoke-then-grant
-- ---------------------------------------------------------------------------

revoke update on public.profiles from anon, authenticated;

-- The only columns the client writes (app/profile/page.tsx). is_admin,
-- total_stars and email are left out deliberately: admin rights come from
-- supabase/scripts/set-admin.sql, stars from award_stars() / admin_set_stars(),
-- and email mirrors auth.users. This also narrows what an admin can edit on
-- another patient's profile to those same columns.
grant update (name, height_cm, weight_kg, guardian_email, guardian_notify, updated_at)
  on public.profiles to authenticated;
