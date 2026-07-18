-- Star integrity (2026-07-18):
--
-- Stars back both the garden reveals and the real-tree NGO promise, so the
-- client must not be able to mint or forge them. Before this migration:
--   1. profiles UPDATE let a user set their own total_stars (only is_admin was
--      column-revoked), so a console `update({ total_stars: 9999 })` worked.
--   2. award_stars(star_count) trusted the caller for the amount and had no
--      session binding or dedup, so a loop granted unlimited stars.
--   3. the admin star editor and the home-page localStorage seed both wrote
--      total_stars directly, which is why (1) could not simply be revoked.
--
-- This migration makes total_stars server-owned:
--   - one star per completed session, awarded exactly once (stars_awarded flag);
--   - award_stars now takes a session id and verifies ownership + completion;
--   - admins set stars through a SECURITY DEFINER RPC (admin_set_stars);
--   - direct client UPDATE of total_stars is revoked.
--
-- Run in the Supabase SQL editor AFTER 20260706000000_stars.sql. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Per-session award marker + backfill
-- ---------------------------------------------------------------------------

alter table public.therapy_sessions
  add column if not exists stars_awarded boolean not null default false;

-- Existing completed sessions already contributed to today's totals under the
-- old RPC; mark them awarded so they can never be re-claimed via the new one.
update public.therapy_sessions
set stars_awarded = true
where completed_at is not null and stars_awarded = false;

-- ---------------------------------------------------------------------------
-- 2. award_stars: session-bound, single-award, server-decided amount
-- ---------------------------------------------------------------------------

-- Drop the old amount-taking signature (return type/args change).
drop function if exists public.award_stars(integer);

create or replace function public.award_stars(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  -- Claim the session atomically: only the owner's own, completed, not-yet-
  -- awarded session flips the flag. A concurrent second call finds no row.
  update public.therapy_sessions
  set stars_awarded = true
  where id = p_session_id
    and user_id = auth.uid()
    and completed_at is not null
    and stars_awarded = false;

  if not found then
    select total_stars into v_total from public.profiles where id = auth.uid();
    return coalesce(v_total, 0);
  end if;

  update public.profiles
  set total_stars = total_stars + 1,
      updated_at = timezone('utc'::text, now())
  where id = auth.uid()
  returning total_stars into v_total;

  return coalesce(v_total, 0);
end;
$$;

revoke all on function public.award_stars(uuid) from public, anon;
grant execute on function public.award_stars(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. admin_set_stars: the only path allowed to set an absolute total
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_stars(p_user_id uuid, p_stars integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  update public.profiles
  set total_stars = greatest(0, p_stars),
      updated_at = timezone('utc'::text, now())
  where id = p_user_id
  returning total_stars into v_total;

  return coalesce(v_total, 0);
end;
$$;

revoke all on function public.admin_set_stars(uuid, integer) from public, anon;
grant execute on function public.admin_set_stars(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Stop clients from writing total_stars directly
-- ---------------------------------------------------------------------------

revoke update (total_stars) on public.profiles from anon, authenticated;
