-- Level map (2026-07-06):
--
-- 1. exercise_groups — the "boxes" on the level-select map. Patients clear a
--    box's poses (easy to hard) to unlock the next box.
--
-- 2. exercises gains:
--      group_id          — which box the pose lives in (null = unassigned,
--                          hidden from the patient map)
--      rank_in_group     — position inside the box (1 = easiest, shown first)
--      unlock_min_score  — form accuracy (%) required on the PREVIOUS pose
--                          before this one unlocks; the pose model's
--                          form_quality_score provides the measurement
--      unlock_max_seconds— optional time cap the qualifying session must
--                          also meet (null = no time requirement)
--
-- 3. RLS: any signed-in user can read groups; only admins manage them
--    (uses public.is_admin() from stars_migration.sql).
--
-- 4. Backfill: a default 'Basics' box adopts every unassigned exercise,
--    ranked easy-first by difficulty then age.
--
-- Run in the Supabase SQL editor AFTER stars_migration.sql.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Groups table
-- ---------------------------------------------------------------------------

create table if not exists public.exercise_groups (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.exercise_groups enable row level security;

-- ---------------------------------------------------------------------------
-- 2. RLS policies
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can view groups" on public.exercise_groups;
create policy "Authenticated users can view groups"
  on public.exercise_groups for select
  to authenticated
  using (true);

drop policy if exists "Admins can insert groups" on public.exercise_groups;
create policy "Admins can insert groups"
  on public.exercise_groups for insert
  to authenticated
  with check ((select public.is_admin()));

drop policy if exists "Admins can update groups" on public.exercise_groups;
create policy "Admins can update groups"
  on public.exercise_groups for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins can delete groups" on public.exercise_groups;
create policy "Admins can delete groups"
  on public.exercise_groups for delete
  to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 3. Exercise columns
-- ---------------------------------------------------------------------------

alter table public.exercises
  add column if not exists group_id uuid references public.exercise_groups(id) on delete set null,
  add column if not exists rank_in_group integer not null default 1,
  add column if not exists unlock_min_score integer not null default 70,
  add column if not exists unlock_max_seconds integer;

create index if not exists idx_exercises_group_rank
  on public.exercises (group_id, rank_in_group);

-- ---------------------------------------------------------------------------
-- 4. Backfill default box
-- ---------------------------------------------------------------------------

do $$
declare
  basics_id uuid;
  base_rank integer;
begin
  select id into basics_id from public.exercise_groups where name = 'Basics' limit 1;
  if basics_id is null then
    insert into public.exercise_groups (name, description, sort_order)
    values ('Basics', 'Your first therapy poses', 0)
    returning id into basics_id;
  end if;

  -- Continue numbering after any poses already in the box (re-run safety).
  select coalesce(max(rank_in_group), 0) into base_rank
  from public.exercises where group_id = basics_id;

  with ranked as (
    select id,
           row_number() over (
             order by
               case difficulty
                 when 'beginner' then 0
                 when 'intermediate' then 1
                 else 2
               end,
               created_at
           ) as rn
    from public.exercises
    where group_id is null
  )
  update public.exercises e
  set group_id = basics_id,
      rank_in_group = base_rank + ranked.rn
  from ranked
  where e.id = ranked.id;
end $$;
