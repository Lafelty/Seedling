# Multi-tenancy & Roles Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the database a tenant boundary, a real role model, and a therapist→patient relationship, so a therapist can read their own patients' progress and prescribe work — without gaining any ability to write session or star data.

**Architecture:** Six ordered SQL migrations plus one app-code alignment pass. The role model is introduced *additively*: `profiles.role` becomes the source of truth, `public.is_admin()` is rewritten to read it, and `profiles.is_admin` is re-created as a generated column derived from `role`. Because every admin RLS policy calls `is_admin()` rather than reading the column, this changes the role system with **zero rewrites to existing admin policies** — and makes `is_admin` structurally unwritable in the process. Therapist visibility is added by *extending the existing permissive policies* (one policy per action, per the repo's established convention) with a new `public.is_caring_for()` SECURITY DEFINER helper.

**Tech Stack:** PostgreSQL 15 (Supabase), Row Level Security, plpgsql SECURITY DEFINER helpers, Next.js 14 App Router, TypeScript, Vitest.

---

## Global Constraints

- **Every migration is idempotent.** Re-running it must be a no-op. Use `if not exists`, `drop policy if exists` before `create policy`, `create or replace function`. This is the established convention in all fourteen existing migrations.
- **Every migration runs in the Supabase SQL editor**, in filename order, and carries a header comment explaining *why* it exists. Follow the tone of `20260725000000_session_write_lockdown.sql` — it explains the vulnerability, not just the fix.
- **Wrap `auth.uid()` as `(select auth.uid())` inside every policy.** Unwrapped, Postgres re-evaluates it once per row (Supabase linter `auth_rls_initplan`). Same for helper calls: `(select public.is_admin())`.
- **One permissive policy per table per action.** Two overlapping permissive policies both execute on every read (Supabase linter `multiple_permissive_policies`). To add a new grantee, `ALTER POLICY` to widen the existing `USING` expression — do not add a second policy.
- **Every new table gets `revoke all ... from anon, authenticated` before any grant.** Supabase's default privileges grant `authenticated` table-level INSERT/UPDATE on new public tables. A column-level `REVOKE` aimed at a role that holds the table-level grant changes nothing — Postgres satisfies the check from *either* ACL. Revoke at table level first, then grant back only permitted columns.
- **Index every foreign key** (Supabase linter `unindexed_foreign_keys`, 0001).
- **Therapists never receive INSERT or UPDATE on `therapy_sessions`, `rep_data`, or `profiles.total_stars`.** See "The one invariant that must not break" below.
- Migration filenames follow `YYYYMMDDHHMMSS_snake_case.sql` in `supabase/migrations/`.

### The one invariant that must not break

`20260718120000_star_integrity.sql` and `20260725000000_session_write_lockdown.sql` exist because both were previously broken in production. Together they establish:

- `profiles.total_stars` is server-owned. Written only by `award_stars(uuid)` and `admin_set_stars(uuid, integer)`.
- A session's completion columns are stamped only by `complete_session(...)`, which verifies ownership and treats a completed session as final.
- One star per completed session, awarded exactly once, enforced by the `stars_awarded` flag.

A therapist role that receives write access to `therapy_sessions` silently undoes both migrations. **A therapist prescribes work and reads results. A therapist never authors a patient's session record.** Task 6 exists to prove this holds.

---

## Design decisions

**Why `role` as a text column with a CHECK constraint, not a Postgres enum.** Adding a value to an enum (`ALTER TYPE ... ADD VALUE`) cannot run inside a transaction block in older Postgres and complicates the idempotent re-run pattern every migration here uses. A text column with a named CHECK constraint can be dropped and recreated freely.

**Why `is_admin` becomes a generated column instead of being deleted.** Six app files read `profiles.is_admin` (`app/admin/page.tsx:40`, `app/admin/users/[id]/page.tsx:38`, `app/admin/groups/page.tsx:122`, `app/starconfig/page.tsx:112`, `app/(dashboard)/page.tsx:85`, plus `lib/supabase/types.ts`). Deleting the column means a coordinated schema-and-app change in one commit, with a window where deployed code queries a missing column. A generated column keeps every existing read working, cannot drift from `role`, and — because generated columns reject all writes, including from `service_role` — closes the privilege-escalation path that `20260705000000_perf_rls_fixes.sql:127-130` was written to plug.

**Why the four `exercises` policies must be rewritten first.** They reference `profiles.is_admin` inline via subquery (`20260705000000_perf_rls_fixes.sql:84-86, 94-96, 109-113, 120-123`). Postgres records a dependency from each policy to that column, so `ALTER TABLE profiles DROP COLUMN is_admin` fails with `cannot drop column is_admin ... because other objects depend on it` until they route through `public.is_admin()` instead. Rewriting them also makes `exercises` consistent with `exercise_groups`, which already calls the helper (`20260706000001_levels.sql:55`).

**Why `is_caring_for()` must be SECURITY DEFINER.** A policy on `profiles` that subqueries `care_assignments` would trigger `care_assignments`' own policies, which reference `profiles` — infinite RLS recursion. This is the identical reason `public.is_admin()` exists (`20260706000000_stars.sql:5-8`). A definer function bypasses RLS for the check.

**Why `org_id` now, when there is only one organization.** RLS policies are written against table shape. Introducing a tenant column later means rewriting every policy that references `profiles` and migrating live patient data behind them. Done now, at effectively zero real data, it is one migration.

**What org assignment deliberately does not do yet.** New signups are assigned to the single default organization by `handle_new_user()`. Invite-based org membership — where a clinic invites a patient and that determines their org — is out of scope. It is a product flow, not a schema concern, and it needs a real customer to design against.

---

## File structure

**Create:**

| Path | Responsibility |
|---|---|
| `supabase/tests/00_fixtures.sql` | Seeds four impersonatable test accounts; idempotent; includes teardown |
| `supabase/tests/01_verify_roles.sql` | Asserts role backfill, `is_admin()` correctness, `is_admin` unwritable |
| `supabase/tests/02_verify_org.sql` | Asserts org backfill and `my_org_id()` |
| `supabase/tests/03_verify_care.sql` | Asserts `is_caring_for()` and `care_assignments` write scope |
| `supabase/tests/04_verify_programs.sql` | Asserts prescription write scope |
| `supabase/tests/05_verify_therapist_reads.sql` | Asserts therapist reads assigned patients only |
| `supabase/tests/06_verify_no_therapist_writes.sql` | **The security proof.** Asserts every therapist write path to session/star data is denied |
| `supabase/migrations/20260803000000_roles.sql` | Task 2 |
| `supabase/migrations/20260803000001_organizations.sql` | Task 3 |
| `supabase/migrations/20260803000002_care_assignments.sql` | Task 4 |
| `supabase/migrations/20260803000003_patient_programs.sql` | Task 5 |
| `supabase/migrations/20260803000004_therapist_read_access.sql` | Task 6 |
| `supabase/tests/README.md` | How to run the suite, and the live-database warning |

**Modify:**

- `supabase/scripts/set-admin.sql` — must write `role`, not `is_admin` (generated columns reject writes)
- `lib/supabase/types.ts` — `role`, `org_id`, new tables, new RPCs; remove `is_admin` from the Insert type
- `supabase/README.md` — add the new migrations to the run order

**Explicitly out of scope:** therapist UI, patient list page, billing, org self-signup, invitations, audit logging. This plan changes the database only. The one exception is `lib/supabase/types.ts`, which must stay in sync or `npm run typecheck` fails.

---

### ⚠️ Before starting: where does this run?

These migrations run against a **live Supabase project**, and Task 1 seeds test users into `auth.users`. That is acceptable *only* because the project currently has no real patient data. Confirm that is still true before Task 1.

If any real patient has signed up, stop and create a second free-tier Supabase project for verification instead. Do not seed test accounts alongside real patient records.

---

## Task 1: Verification harness and fixtures

Nothing is asserted yet — this task builds the impersonation scaffolding every later task depends on. Deliverable: a fixture script that seeds four accounts and can be re-run and torn down cleanly.

**Files:**
- Create: `supabase/tests/00_fixtures.sql`
- Create: `supabase/tests/README.md`

**Interfaces:**
- Produces: four accounts with fixed UUIDs, referenced by every later verification script:
  - `11111111-1111-1111-1111-111111111111` — `t-patient-a@test.invalid`
  - `22222222-2222-2222-2222-222222222222` — `t-patient-b@test.invalid`
  - `33333333-3333-3333-3333-333333333333` — `t-therapist@test.invalid`
  - `44444444-4444-4444-4444-444444444444` — `t-admin@test.invalid`
- Produces: the impersonation idiom used throughout —
  ```sql
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';
  ```
  `auth.uid()` reads `request.jwt.claims->>'sub'`. `set local` confines it to the transaction.

- [ ] **Step 1: Write the fixture script**

Create `supabase/tests/00_fixtures.sql`:

```sql
-- Test fixtures for the RLS verification suite.
--
-- Seeds four accounts with fixed UUIDs so verification scripts can impersonate
-- them deterministically. The .invalid TLD is reserved by RFC 2606 and can
-- never route mail, so these addresses cannot collide with a real signup.
--
-- Inserting into auth.users fires public.handle_new_user(), which creates the
-- matching public.profiles row. Do not insert into profiles directly.
--
-- Idempotent: safe to re-run. Teardown is at the bottom, commented out.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't-patient-a@test.invalid', '',
   now(), now(), now(), '{"provider":"email"}'::jsonb, '{"name":"Test Patient A"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't-patient-b@test.invalid', '',
   now(), now(), now(), '{"provider":"email"}'::jsonb, '{"name":"Test Patient B"}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't-therapist@test.invalid', '',
   now(), now(), now(), '{"provider":"email"}'::jsonb, '{"name":"Test Therapist"}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't-admin@test.invalid', '',
   now(), now(), now(), '{"provider":"email"}'::jsonb, '{"name":"Test Admin"}'::jsonb)
on conflict (id) do nothing;

-- Confirm the trigger produced four profiles.
do $$
declare n integer;
begin
  select count(*) into n from public.profiles
  where email like 't-%@test.invalid';
  assert n = 4, format('expected 4 test profiles, found %s', n);
end $$;

select id, email, name from public.profiles
where email like 't-%@test.invalid' order by email;

-- ---------------------------------------------------------------------------
-- TEARDOWN — uncomment and run to remove all test data.
-- profiles cascades from auth.users; care_assignments and patient_programs
-- cascade from profiles.
-- ---------------------------------------------------------------------------
-- delete from auth.users where email like 't-%@test.invalid';
```

- [ ] **Step 2: Run it and verify four profiles appear**

Paste into the Supabase SQL editor and run.
Expected: the final `SELECT` returns four rows. If the `assert` fires with fewer than 4, `handle_new_user()` did not run — check the `on_auth_user_created` trigger exists on `auth.users`.

- [ ] **Step 3: Verify teardown works, then re-seed**

Uncomment the teardown line, run it, confirm `select count(*) from public.profiles where email like 't-%@test.invalid'` returns 0. Re-comment, re-run the script, confirm four rows return. This proves the suite is repeatable.

- [ ] **Step 4: Write the suite README**

Create `supabase/tests/README.md`:

```markdown
# RLS verification suite

Run in the Supabase SQL editor, in filename order, **after** applying all
migrations in `supabase/migrations/`.

1. `00_fixtures.sql` — seeds four test accounts. Run once.
2. `01`–`06` — assertions. Each is idempotent and read-only apart from the
   writes it deliberately attempts and expects to fail.

A script that completes without raising is a pass. A failed `assert` aborts
with its message.

## Warning

These scripts insert into `auth.users` on a live project. Only run them against
a database with no real patient data. Teardown is at the bottom of
`00_fixtures.sql`.

## How impersonation works

    set local role authenticated;
    set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';

`auth.uid()` reads `sub` from those claims. `set local` confines the change to
the surrounding transaction, so every test block is wrapped in
`begin; ... rollback;`.
```

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/00_fixtures.sql supabase/tests/README.md
git commit -m "test: add RLS verification fixtures and impersonation harness"
```

---

## Task 2: Role model

**Files:**
- Create: `supabase/migrations/20260803000000_roles.sql`
- Create: `supabase/tests/01_verify_roles.sql`
- Modify: `supabase/scripts/set-admin.sql`

**Interfaces:**
- Produces: `public.profiles.role text not null default 'patient'`, constrained to `patient | therapist | clinic_admin | platform_admin`
- Produces: `public.is_admin() returns boolean` — signature unchanged, now reads `role`
- Produces: `public.profiles.is_admin boolean` — generated, `= (role = 'platform_admin')`, unwritable

- [ ] **Step 1: Write the failing assertions**

Create `supabase/tests/01_verify_roles.sql`:

```sql
-- Verifies the role model from 20260803000000_roles.sql.

-- 1. The role column exists, is constrained, and defaults to 'patient'.
do $$
begin
  assert exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'
  ), 'profiles.role does not exist';

  assert exists (
    select 1 from pg_constraint
    where conname = 'profiles_role_check' and conrelid = 'public.profiles'::regclass
  ), 'profiles_role_check constraint missing';

  assert (select role from public.profiles
          where id = '11111111-1111-1111-1111-111111111111') = 'patient',
         'new profiles should default to role = patient';
end $$;

-- 2. The constraint actually rejects an unknown role.
do $$
begin
  begin
    update public.profiles set role = 'wizard'
    where id = '11111111-1111-1111-1111-111111111111';
    assert false, 'CHECK constraint did not reject an unknown role';
  exception when check_violation then
    null; -- expected
  end;
end $$;

-- 3. is_admin is generated and rejects direct writes, even as the owner role.
do $$
begin
  assert (select is_generated from information_schema.columns
          where table_schema = 'public' and table_name = 'profiles'
            and column_name = 'is_admin') = 'ALWAYS',
         'profiles.is_admin is not a generated column';

  begin
    update public.profiles set is_admin = true
    where id = '11111111-1111-1111-1111-111111111111';
    assert false, 'a direct write to the generated is_admin column succeeded';
  exception when others then
    null; -- expected: generated columns cannot be written
  end;
end $$;

-- 4. is_admin() tracks role, and the generated column tracks it too.
begin;
  update public.profiles set role = 'platform_admin'
  where id = '44444444-4444-4444-4444-444444444444';

  do $$
  begin
    assert (select is_admin from public.profiles
            where id = '44444444-4444-4444-4444-444444444444') = true,
           'generated is_admin did not follow role = platform_admin';
  end $$;

  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
  do $$
  begin
    assert public.is_admin() = true, 'is_admin() false for a platform_admin';
  end $$;

  set local request.jwt.claims to
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  do $$
  begin
    assert public.is_admin() = false, 'is_admin() true for a patient';
  end $$;
rollback;

select 'roles: PASS' as result;
```

- [ ] **Step 2: Run it to verify it fails**

Run `01_verify_roles.sql` in the SQL editor.
Expected: aborts on the first assertion — `profiles.role does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260803000000_roles.sql`:

```sql
-- Role model (2026-08-03):
--
-- profiles.is_admin was a single boolean: one global super-admin, no way to
-- express "therapist". This migration makes profiles.role the source of truth
-- and rebuilds is_admin as a column generated from it.
--
-- Why the rebuild rather than a plain drop: six app files read
-- profiles.is_admin. A generated column keeps every existing read working and
-- cannot drift from role. It also closes a hole for good — generated columns
-- reject all writes, including from service_role, so the escalation path that
-- 20260705000000_perf_rls_fixes.sql revoked can no longer be re-granted by
-- accident.
--
-- Why the exercises policies are rewritten here: they reference
-- profiles.is_admin inline (20260705000000_perf_rls_fixes.sql:84-123), which
-- makes Postgres refuse to drop the column. Routing them through
-- public.is_admin() removes the dependency and matches exercise_groups, which
-- already calls the helper.
--
-- Run in the Supabase SQL editor. Idempotent: safe to re-run.
-- Run the whole file as one transaction — the drop/re-add of is_admin must not
-- be left half-applied.

begin;

-- ---------------------------------------------------------------------------
-- 1. role column, constrained, backfilled from is_admin
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists role text not null default 'patient';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('patient', 'therapist', 'clinic_admin', 'platform_admin'));

-- Backfill before is_admin is replaced. Guarded so a re-run is a no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'is_admin' and is_generated = 'NEVER'
  ) then
    execute $q$
      update public.profiles set role = 'platform_admin'
      where is_admin = true and role <> 'platform_admin'
    $q$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. is_admin() reads role. Signature unchanged, so every policy calling it
--    keeps working with no rewrite.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p.role = 'platform_admin' from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Break the exercises policies' dependency on the is_admin column
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view active exercises" on public.exercises;
create policy "Users can view active exercises"
  on public.exercises for select
  using (
    (is_active = true and (select auth.uid()) is not null)
    or (select public.is_admin())
  );

drop policy if exists "Admins can insert exercises" on public.exercises;
create policy "Admins can insert exercises"
  on public.exercises for insert
  with check ((select public.is_admin()));

drop policy if exists "Admins can update exercises" on public.exercises;
create policy "Admins can update exercises"
  on public.exercises for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins can delete exercises" on public.exercises;
create policy "Admins can delete exercises"
  on public.exercises for delete
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 4. Rebuild is_admin as a generated column
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'is_admin' and is_generated = 'NEVER'
  ) then
    alter table public.profiles drop column is_admin;
  end if;
end $$;

alter table public.profiles
  add column if not exists is_admin boolean
  generated always as (role = 'platform_admin') stored;

-- ---------------------------------------------------------------------------
-- 5. Restate the write allowlist. role is absent deliberately: it is granted
--    through supabase/scripts/set-admin.sql with SQL-editor privileges only.
-- ---------------------------------------------------------------------------

revoke update on public.profiles from anon, authenticated;
grant update (name, height_cm, weight_kg, guardian_email, guardian_notify, updated_at)
  on public.profiles to authenticated;

commit;
```

- [ ] **Step 4: Run the migration, then re-run the assertions**

Run `20260803000000_roles.sql`, then `01_verify_roles.sql`.
Expected: `roles: PASS`.

- [ ] **Step 5: Verify existing behaviour still works**

Run `npm run dev`, sign in as an existing admin account, and open `/admin`. The page reads `is_admin` (`app/admin/page.tsx:40`) and must still grant access. Then open `/levels` as a patient and confirm exercises still load — this exercises the rewritten SELECT policy.

If the admin page now rejects a previously-working admin, the backfill in section 1 did not run. Check `select email, role, is_admin from public.profiles where role = 'platform_admin'`.

- [ ] **Step 6: Fix the admin-granting script**

`supabase/scripts/set-admin.sql` writes `is_admin = TRUE`, which now fails — generated columns reject writes. Replace the two statements at the bottom of the file (leave the header comment's warnings about never hardcoding an address intact, and update its wording from "flips public.profiles.is_admin" to "sets public.profiles.role"):

```sql
UPDATE public.profiles
SET role = 'platform_admin'
WHERE lower(email) = lower(:'admin_email');

-- Verify the change
SELECT id, email, role, is_admin, created_at
FROM public.profiles
WHERE lower(email) = lower(:'admin_email');
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260803000000_roles.sql \
        supabase/tests/01_verify_roles.sql \
        supabase/scripts/set-admin.sql
git commit -m "feat: replace is_admin boolean with a role model"
```

---

## Task 3: Organizations and tenant column

**Files:**
- Create: `supabase/migrations/20260803000001_organizations.sql`
- Create: `supabase/tests/02_verify_org.sql`

**Interfaces:**
- Consumes: `public.profiles.role` (Task 2)
- Produces: `public.organizations (id uuid, name text, created_at timestamptz)`
- Produces: `public.profiles.org_id uuid null references organizations(id)`
- Produces: `public.my_org_id() returns uuid` — SECURITY DEFINER, the caller's org

- [ ] **Step 1: Write the failing assertions**

Create `supabase/tests/02_verify_org.sql`:

```sql
-- Verifies 20260803000001_organizations.sql.

-- 1. Table and column exist; every profile is backfilled into an org.
do $$
declare orphans integer;
begin
  assert to_regclass('public.organizations') is not null,
         'organizations table does not exist';

  assert exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'org_id'
  ), 'profiles.org_id does not exist';

  select count(*) into orphans from public.profiles where org_id is null;
  assert orphans = 0, format('%s profiles have no org_id', orphans);
end $$;

-- 2. my_org_id() returns the caller's org, and a member can read that org row.
begin;
  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  do $$
  declare v_org uuid; v_visible integer;
  begin
    v_org := public.my_org_id();
    assert v_org is not null, 'my_org_id() returned null for a seeded patient';

    select count(*) into v_visible from public.organizations;
    assert v_visible = 1,
      format('a member should see exactly their own org row, saw %s', v_visible);
  end $$;
rollback;

-- 3. Clients cannot write organizations.
begin;
  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  do $$
  begin
    begin
      insert into public.organizations (name) values ('Rogue Clinic');
      assert false, 'an authenticated client inserted an organization';
    exception when insufficient_privilege or check_violation then
      null; -- expected
    end;
  end $$;
rollback;

select 'organizations: PASS' as result;
```

- [ ] **Step 2: Run it to verify it fails**

Expected: aborts with `organizations table does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260803000001_organizations.sql`:

```sql
-- Organizations / tenant column (2026-08-03):
--
-- No table carried a tenant column, so a second clinic could not be added
-- without rewriting every RLS policy that references profiles. This adds the
-- column while the database holds effectively no real data.
--
-- Only one organization exists today; every profile is backfilled into it and
-- handle_new_user() assigns it to new signups. Invite-based org membership is
-- deliberately out of scope — it is a product flow, not a schema concern.
--
-- Run in the Supabase SQL editor AFTER 20260803000000_roles.sql. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.organizations enable row level security;

-- Supabase default privileges hand `authenticated` table-level DML on new
-- public tables. Revoke before granting anything back (see the header of
-- 20260725000000_session_write_lockdown.sql). Read-only for clients: orgs are
-- created by the SQL editor / service_role.
revoke all on public.organizations from anon, authenticated;
grant select on public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tenant column on profiles
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists org_id uuid references public.organizations(id) on delete set null;

create index if not exists idx_profiles_org_id on public.profiles (org_id);

-- ---------------------------------------------------------------------------
-- 3. Default org + backfill
-- ---------------------------------------------------------------------------

do $$
declare v_org uuid;
begin
  select id into v_org from public.organizations where name = 'Default Clinic' limit 1;
  if v_org is null then
    insert into public.organizations (name) values ('Default Clinic') returning id into v_org;
  end if;

  update public.profiles set org_id = v_org where org_id is null;
end $$;

-- ---------------------------------------------------------------------------
-- 4. my_org_id() — SECURITY DEFINER for the same reason as is_admin():
--    a policy on organizations that subqueries profiles would evaluate the
--    profiles policies, which will reference organizations from Task 4 on.
-- ---------------------------------------------------------------------------

create or replace function public.my_org_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select p.org_id from public.profiles p where p.id = auth.uid();
$$;

revoke all on function public.my_org_id() from public, anon;
grant execute on function public.my_org_id() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Policy: a member reads only their own organization
-- ---------------------------------------------------------------------------

drop policy if exists "Members can view own organization" on public.organizations;
create policy "Members can view own organization"
  on public.organizations for select
  to authenticated
  using (id = (select public.my_org_id()) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 6. New signups join the default organization
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, org_id)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'name',
    (select o.id from public.organizations o where o.name = 'Default Clinic' limit 1)
  );
  return new;
end;
$$;

-- create or replace preserves the ACL, but restate it: this function is
-- trigger-only and no client role may call it (20260713015700:49).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
```

- [ ] **Step 4: Run the migration, then re-run the assertions**

Run the migration, then `02_verify_org.sql`.
Expected: `organizations: PASS`.

- [ ] **Step 5: Verify signup still assigns an org**

Sign up a throwaway account through `/signup`, then run:

```sql
select p.email, o.name from public.profiles p
join public.organizations o on o.id = p.org_id
order by p.created_at desc limit 1;
```

Expected: the new account is in `Default Clinic`. If `org_id` is null, `handle_new_user()` did not take the replacement — confirm the trigger points at the current function.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260803000001_organizations.sql supabase/tests/02_verify_org.sql
git commit -m "feat: add organizations table and tenant column on profiles"
```

---

## Task 4: Care assignments

**Files:**
- Create: `supabase/migrations/20260803000002_care_assignments.sql`
- Create: `supabase/tests/03_verify_care.sql`

**Interfaces:**
- Consumes: `public.my_org_id()` (Task 3), `public.profiles.role` (Task 2)
- Produces: `public.care_assignments (id, therapist_id, patient_id, org_id, assigned_at, is_active)`, unique on `(therapist_id, patient_id)`
- Produces: `public.is_caring_for(p_patient_id uuid) returns boolean` — used by every therapist read policy in Task 6

- [ ] **Step 1: Write the failing assertions**

Create `supabase/tests/03_verify_care.sql`:

```sql
-- Verifies 20260803000002_care_assignments.sql.

-- Give the therapist fixture its role, then assign patient A only.
update public.profiles set role = 'therapist'
where id = '33333333-3333-3333-3333-333333333333';

insert into public.care_assignments (therapist_id, patient_id, org_id)
select '33333333-3333-3333-3333-333333333333',
       '11111111-1111-1111-1111-111111111111',
       org_id
from public.profiles where id = '11111111-1111-1111-1111-111111111111'
on conflict (therapist_id, patient_id) do update set is_active = true;

-- 1. is_caring_for() is true for the assigned patient, false for the other.
begin;
  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

  do $$
  begin
    assert public.is_caring_for('11111111-1111-1111-1111-111111111111') = true,
           'is_caring_for false for an assigned patient';
    assert public.is_caring_for('22222222-2222-2222-2222-222222222222') = false,
           'is_caring_for true for an UNASSIGNED patient';
  end $$;
rollback;

-- 2. A patient cannot assign themselves to a therapist.
begin;
  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  do $$
  begin
    begin
      insert into public.care_assignments (therapist_id, patient_id)
      values ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222');
      assert false, 'a patient created a care assignment';
    exception when insufficient_privilege or check_violation then
      null; -- expected
    end;
  end $$;
rollback;

-- 3. A therapist cannot assign a patient to a DIFFERENT therapist.
begin;
  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

  do $$
  begin
    begin
      insert into public.care_assignments (therapist_id, patient_id)
      values ('44444444-4444-4444-4444-444444444444',
              '22222222-2222-2222-2222-222222222222');
      assert false, 'a therapist assigned a patient on another therapist''s behalf';
    exception when insufficient_privilege or check_violation then
      null; -- expected
    end;
  end $$;
rollback;

-- 4. Clients hold no DELETE on the table — assignments are deactivated,
--    never erased, so the record of who saw what survives.
do $$
begin
  assert not has_table_privilege('authenticated', 'public.care_assignments', 'DELETE'),
         'authenticated holds DELETE on care_assignments';
end $$;

select 'care_assignments: PASS' as result;
```

- [ ] **Step 2: Run it to verify it fails**

Expected: aborts — `relation "public.care_assignments" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260803000002_care_assignments.sql`:

```sql
-- Care assignments (2026-08-03):
--
-- The therapist→patient relationship. Without it a therapist has no caseload
-- and the database cannot answer "who are my patients", which is the whole of
-- the therapist-facing product.
--
-- is_caring_for() is SECURITY DEFINER for the same reason is_admin() is
-- (20260706000000_stars.sql:5-8): the profiles read policy in
-- 20260803000004 subqueries this relation, and this relation's own policies
-- reference profiles — a plain subquery would recurse.
--
-- No DELETE is granted to clients. An ended episode of care sets
-- is_active = false; the record that a therapist once had access survives.
--
-- Run in the Supabase SQL editor AFTER 20260803000001_organizations.sql.
-- Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table if not exists public.care_assignments (
  id uuid default gen_random_uuid() primary key,
  therapist_id uuid not null references public.profiles(id) on delete cascade,
  patient_id   uuid not null references public.profiles(id) on delete cascade,
  org_id       uuid references public.organizations(id) on delete set null,
  assigned_at  timestamp with time zone not null default timezone('utc'::text, now()),
  is_active    boolean not null default true,
  constraint care_assignments_unique_pair unique (therapist_id, patient_id),
  constraint care_assignments_no_self check (therapist_id <> patient_id)
);

create index if not exists idx_care_assignments_therapist
  on public.care_assignments (therapist_id) where is_active;
create index if not exists idx_care_assignments_patient
  on public.care_assignments (patient_id);
create index if not exists idx_care_assignments_org
  on public.care_assignments (org_id);

alter table public.care_assignments enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Grants: revoke first, then hand back only what a therapist writes
-- ---------------------------------------------------------------------------

revoke all on public.care_assignments from anon, authenticated;
grant select on public.care_assignments to authenticated;
grant insert (therapist_id, patient_id, org_id) on public.care_assignments to authenticated;
grant update (is_active) on public.care_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Policies
-- ---------------------------------------------------------------------------

-- Both sides of the relationship can see it. A patient is entitled to know
-- which clinician has access to their records.
drop policy if exists "Participants can view assignments" on public.care_assignments;
create policy "Participants can view assignments"
  on public.care_assignments for select
  to authenticated
  using (
    therapist_id = (select auth.uid())
    or patient_id = (select auth.uid())
    or (select public.is_admin())
  );

-- A therapist may only enrol a patient to themselves, and only within their
-- own organization.
drop policy if exists "Therapists can assign own patients" on public.care_assignments;
create policy "Therapists can assign own patients"
  on public.care_assignments for insert
  to authenticated
  with check (
    therapist_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('therapist', 'clinic_admin')
    )
    and exists (
      select 1 from public.profiles pt
      where pt.id = patient_id
        and pt.org_id = (select public.my_org_id())
    )
  );

drop policy if exists "Therapists can deactivate own assignments" on public.care_assignments;
create policy "Therapists can deactivate own assignments"
  on public.care_assignments for update
  to authenticated
  using (therapist_id = (select auth.uid()))
  with check (therapist_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. is_caring_for()
-- ---------------------------------------------------------------------------

create or replace function public.is_caring_for(p_patient_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.care_assignments ca
    where ca.patient_id = p_patient_id
      and ca.therapist_id = auth.uid()
      and ca.is_active
  );
$$;

revoke all on function public.is_caring_for(uuid) from public, anon;
grant execute on function public.is_caring_for(uuid) to authenticated;
```

- [ ] **Step 4: Run the migration, then re-run the assertions**

Expected: `care_assignments: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803000002_care_assignments.sql supabase/tests/03_verify_care.sql
git commit -m "feat: add care_assignments and the is_caring_for RLS helper"
```

---

## Task 5: Patient programs (prescription)

**Files:**
- Create: `supabase/migrations/20260803000003_patient_programs.sql`
- Create: `supabase/tests/04_verify_programs.sql`

**Interfaces:**
- Consumes: `public.is_caring_for(uuid)` (Task 4), `public.exercise_groups.id` (`20260706000001_levels.sql:29`)
- Produces: `public.patient_programs (id, patient_id, exercise_group_id, sets, reps, frequency_per_week, assigned_by, is_active, created_at)`, unique on `(patient_id, exercise_group_id)`

- [ ] **Step 1: Write the failing assertions**

Create `supabase/tests/04_verify_programs.sql`:

```sql
-- Verifies 20260803000003_patient_programs.sql.
-- Depends on the therapist→patient-A assignment made in 03_verify_care.sql.

-- 1. A therapist may prescribe to an assigned patient, but not to a stranger.
begin;
  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

  do $$
  declare v_group uuid;
  begin
    select id into v_group from public.exercise_groups order by sort_order limit 1;
    assert v_group is not null, 'no exercise_groups exist to prescribe';

    insert into public.patient_programs
      (patient_id, exercise_group_id, sets, reps, frequency_per_week, assigned_by)
    values ('11111111-1111-1111-1111-111111111111', v_group, 3, 12, 5,
            '33333333-3333-3333-3333-333333333333');

    begin
      insert into public.patient_programs
        (patient_id, exercise_group_id, sets, reps, frequency_per_week, assigned_by)
      values ('22222222-2222-2222-2222-222222222222', v_group, 3, 12, 5,
              '33333333-3333-3333-3333-333333333333');
      assert false, 'a therapist prescribed to an UNASSIGNED patient';
    exception when insufficient_privilege or check_violation then
      null; -- expected
    end;
  end $$;
rollback;

-- 2. A patient can read their own prescription but cannot write one.
begin;
  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  do $$
  declare v_group uuid;
  begin
    select id into v_group from public.exercise_groups order by sort_order limit 1;
    begin
      insert into public.patient_programs
        (patient_id, exercise_group_id, sets, reps, frequency_per_week)
      values ('11111111-1111-1111-1111-111111111111', v_group, 99, 99, 14);
      assert false, 'a patient prescribed their own program';
    exception when insufficient_privilege or check_violation then
      null; -- expected
    end;
  end $$;
rollback;

-- 3. Dosage bounds are enforced by the database, not only by the UI.
do $$
begin
  begin
    insert into public.patient_programs
      (patient_id, exercise_group_id, sets, reps, frequency_per_week)
    select '11111111-1111-1111-1111-111111111111', id, 3, 12, 99
    from public.exercise_groups order by sort_order limit 1;
    assert false, 'frequency_per_week = 99 was accepted';
  exception when check_violation then
    null; -- expected
  end;
end $$;

select 'patient_programs: PASS' as result;
```

- [ ] **Step 2: Run it to verify it fails**

Expected: aborts — `relation "public.patient_programs" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260803000003_patient_programs.sql`:

```sql
-- Patient programs (2026-08-03):
--
-- exercises and exercise_groups are global: every patient sees the same
-- catalogue, so a therapist cannot prescribe a dose to one person. This table
-- is the prescription — which box of poses, how much, how often.
--
-- Dosage bounds are CHECK constraints rather than UI validation. This is
-- clinical dosage; a typo that reaches the database should be rejected by the
-- database.
--
-- Run in the Supabase SQL editor AFTER 20260803000002_care_assignments.sql.
-- Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table if not exists public.patient_programs (
  id uuid default gen_random_uuid() primary key,
  patient_id        uuid not null references public.profiles(id) on delete cascade,
  exercise_group_id uuid not null references public.exercise_groups(id) on delete cascade,
  sets               integer not null default 1  check (sets between 1 and 20),
  reps               integer not null default 10 check (reps between 1 and 200),
  frequency_per_week integer not null default 3  check (frequency_per_week between 1 and 14),
  assigned_by uuid references public.profiles(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamp with time zone not null default timezone('utc'::text, now()),
  constraint patient_programs_unique_group unique (patient_id, exercise_group_id)
);

create index if not exists idx_patient_programs_patient
  on public.patient_programs (patient_id) where is_active;
create index if not exists idx_patient_programs_group
  on public.patient_programs (exercise_group_id);
create index if not exists idx_patient_programs_assigned_by
  on public.patient_programs (assigned_by);

alter table public.patient_programs enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Grants: revoke first (Supabase default privileges), then narrow
-- ---------------------------------------------------------------------------

revoke all on public.patient_programs from anon, authenticated;
grant select on public.patient_programs to authenticated;
grant insert (patient_id, exercise_group_id, sets, reps, frequency_per_week, assigned_by)
  on public.patient_programs to authenticated;
grant update (sets, reps, frequency_per_week, is_active)
  on public.patient_programs to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Policies
-- ---------------------------------------------------------------------------

drop policy if exists "Patient and carer can view programs" on public.patient_programs;
create policy "Patient and carer can view programs"
  on public.patient_programs for select
  to authenticated
  using (
    patient_id = (select auth.uid())
    or (select public.is_caring_for(patient_id))
    or (select public.is_admin())
  );

drop policy if exists "Carer can prescribe" on public.patient_programs;
create policy "Carer can prescribe"
  on public.patient_programs for insert
  to authenticated
  with check (
    (select public.is_caring_for(patient_id)) or (select public.is_admin())
  );

drop policy if exists "Carer can adjust prescription" on public.patient_programs;
create policy "Carer can adjust prescription"
  on public.patient_programs for update
  to authenticated
  using (
    (select public.is_caring_for(patient_id)) or (select public.is_admin())
  )
  with check (
    (select public.is_caring_for(patient_id)) or (select public.is_admin())
  );
```

- [ ] **Step 4: Run the migration, then re-run the assertions**

Expected: `patient_programs: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803000003_patient_programs.sql supabase/tests/04_verify_programs.sql
git commit -m "feat: add patient_programs for per-patient prescription"
```

---

## Task 6: Therapist read access — and proof of no write access

The security-critical task. Everything before it added structure; this one widens who can read patient data.

**Files:**
- Create: `supabase/migrations/20260803000004_therapist_read_access.sql`
- Create: `supabase/tests/05_verify_therapist_reads.sql`
- Create: `supabase/tests/06_verify_no_therapist_writes.sql`

**Interfaces:**
- Consumes: `public.is_caring_for(uuid)` (Task 4)
- Produces: widened `USING` expressions on the existing policies `Users can view own profile`, `Users can view own sessions`, `Users can view own rep data`

**Note on scope:** this also grants `platform_admin` read access to `therapy_sessions` and `rep_data`, which it did not previously have (`20260706000000_stars.sql` widened only the `profiles` policies). That is deliberate — the admin patient-record view needs it. If you do not want it, drop the `public.is_admin()` clause from the two session policies below; nothing else depends on it.

- [ ] **Step 1: Write the failing read assertions**

Create `supabase/tests/05_verify_therapist_reads.sql`:

```sql
-- Verifies 20260803000004_therapist_read_access.sql.
-- Depends on the therapist→patient-A assignment made in 03_verify_care.sql.

-- Seed one completed session for each patient, as the owner.
insert into public.therapy_sessions
  (id, user_id, exercise_type, started_at, completed_at, target_reps, completed_reps, form_quality_score)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'shoulder-raise', now() - interval '1 hour', now(), 10, 10, 88.0),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'shoulder-raise', now() - interval '1 hour', now(), 10, 9, 74.0)
on conflict (id) do nothing;

insert into public.rep_data (session_id, rep_number, hold_duration_ms, form_score, timestamp)
values ('aaaaaaaa-0000-0000-0000-000000000001', 1, 500, 90.0, now())
on conflict do nothing;

-- The therapist sees patient A and not patient B — profiles, sessions, reps.
begin;
  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

  do $$
  declare n integer;
  begin
    select count(*) into n from public.profiles
    where id = '11111111-1111-1111-1111-111111111111';
    assert n = 1, 'therapist cannot read an ASSIGNED patient profile';

    select count(*) into n from public.profiles
    where id = '22222222-2222-2222-2222-222222222222';
    assert n = 0, 'therapist CAN read an unassigned patient profile — data leak';

    select count(*) into n from public.therapy_sessions
    where user_id = '11111111-1111-1111-1111-111111111111';
    assert n >= 1, 'therapist cannot read an assigned patient session';

    select count(*) into n from public.therapy_sessions
    where user_id = '22222222-2222-2222-2222-222222222222';
    assert n = 0, 'therapist CAN read an unassigned patient session — data leak';

    select count(*) into n from public.rep_data
    where session_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    assert n >= 1, 'therapist cannot read assigned patient rep_data';

    select count(*) into n from public.rep_data
    where session_id = 'bbbbbbbb-0000-0000-0000-000000000002';
    assert n = 0, 'therapist CAN read unassigned patient rep_data — data leak';
  end $$;
rollback;

-- Deactivating the assignment revokes the read immediately.
begin;
  update public.care_assignments set is_active = false
  where therapist_id = '33333333-3333-3333-3333-333333333333'
    and patient_id   = '11111111-1111-1111-1111-111111111111';

  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

  do $$
  declare n integer;
  begin
    select count(*) into n from public.therapy_sessions
    where user_id = '11111111-1111-1111-1111-111111111111';
    assert n = 0, 'a DEACTIVATED assignment still grants read access';
  end $$;
rollback;

-- A patient still cannot read another patient.
begin;
  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  do $$
  declare n integer;
  begin
    select count(*) into n from public.therapy_sessions
    where user_id = '22222222-2222-2222-2222-222222222222';
    assert n = 0, 'patient A can read patient B sessions — regression';
  end $$;
rollback;

select 'therapist reads: PASS' as result;
```

- [ ] **Step 2: Write the write-denial assertions**

Create `supabase/tests/06_verify_no_therapist_writes.sql`. This is the proof that the star and session integrity migrations still hold:

```sql
-- The security proof for 20260803000004_therapist_read_access.sql.
--
-- 20260718120000_star_integrity.sql and 20260725000000_session_write_lockdown.sql
-- make session and star data server-owned. A therapist role with write access
-- to therapy_sessions silently undoes both. This asserts it does not.

-- 1. Table-level privilege check — the therapist role holds no write grant.
do $$
begin
  assert not has_table_privilege('authenticated', 'public.therapy_sessions', 'UPDATE'),
         'authenticated holds UPDATE on therapy_sessions';
  assert not has_table_privilege('authenticated', 'public.therapy_sessions', 'DELETE'),
         'authenticated holds DELETE on therapy_sessions';
  assert not has_column_privilege('authenticated', 'public.profiles', 'total_stars', 'UPDATE'),
         'authenticated holds UPDATE on profiles.total_stars';
  assert not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'),
         'authenticated holds UPDATE on profiles.role — privilege escalation';
end $$;

-- 2. Behavioural check — a therapist cannot alter an assigned patient's data.
begin;
  update public.care_assignments set is_active = true
  where therapist_id = '33333333-3333-3333-3333-333333333333'
    and patient_id   = '11111111-1111-1111-1111-111111111111';

  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

  do $$
  begin
    begin
      update public.therapy_sessions set form_quality_score = 100
      where id = 'aaaaaaaa-0000-0000-0000-000000000001';
      assert false, 'therapist UPDATED an assigned patient session';
    exception when insufficient_privilege then null;
    end;

    begin
      insert into public.therapy_sessions (user_id, exercise_type, started_at, target_reps)
      values ('11111111-1111-1111-1111-111111111111', 'shoulder-raise', now(), 10);
      assert false, 'therapist INSERTED a session on a patient''s behalf';
    exception when insufficient_privilege or check_violation then null;
    end;

    begin
      update public.profiles set total_stars = 9999
      where id = '11111111-1111-1111-1111-111111111111';
      assert false, 'therapist WROTE a patient total_stars';
    exception when insufficient_privilege then null;
    end;

    begin
      update public.profiles set role = 'platform_admin'
      where id = '33333333-3333-3333-3333-333333333333';
      assert false, 'therapist ESCALATED their own role';
    exception when insufficient_privilege then null;
    end;
  end $$;
rollback;

-- 3. The star ledger cannot be re-armed through award_stars().
begin;
  set local role authenticated;
  set local request.jwt.claims to
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

  do $$
  declare v_before integer; v_after integer;
  begin
    select total_stars into v_before from public.profiles
    where id = '11111111-1111-1111-1111-111111111111';

    -- award_stars() is bound to auth.uid(); called by a therapist against a
    -- patient's session it must be a no-op on that patient's total.
    perform public.award_stars('aaaaaaaa-0000-0000-0000-000000000001');

    select total_stars into v_after from public.profiles
    where id = '11111111-1111-1111-1111-111111111111';

    assert v_before = v_after,
      format('therapist minted stars for a patient: %s -> %s', v_before, v_after);
  end $$;
rollback;

select 'no therapist writes: PASS' as result;
```

- [ ] **Step 3: Run both to verify they fail**

Run `05_verify_therapist_reads.sql`.
Expected: aborts with `therapist cannot read an ASSIGNED patient profile` — the read has not been granted yet.

Run `06_verify_no_therapist_writes.sql`.
Expected: **PASS already.** Nothing has widened writes yet, so this file passes before the migration. That is the point — it is a regression guard. Note the result, then confirm it still passes in Step 5.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260803000004_therapist_read_access.sql`:

```sql
-- Therapist read access (2026-08-03):
--
-- Widens the three patient-data SELECT policies so a therapist can read the
-- patients assigned to them in care_assignments. Read only. No INSERT, UPDATE
-- or DELETE is granted to any therapist on session, rep or star data —
-- 20260718120000_star_integrity.sql and 20260725000000_session_write_lockdown.sql
-- make that data server-owned, and a therapist write path would undo both.
-- supabase/tests/06_verify_no_therapist_writes.sql asserts this.
--
-- ALTER POLICY rather than a second permissive policy: two permissive policies
-- on the same action both execute on every row (linter
-- multiple_permissive_policies). Same reason as 20260705000000:8-11.
--
-- Note: this also gives platform_admin read on therapy_sessions and rep_data,
-- which it did not have before. Deliberate — the admin patient view needs it.
--
-- Run in the Supabase SQL editor AFTER 20260803000002_care_assignments.sql.
-- Idempotent.

alter policy "Users can view own profile"
  on public.profiles
  using (
    (select auth.uid()) = id
    or (select public.is_admin())
    or (select public.is_caring_for(id))
  );

alter policy "Users can view own sessions"
  on public.therapy_sessions
  using (
    (select auth.uid()) = user_id
    or (select public.is_admin())
    or (select public.is_caring_for(user_id))
  );

alter policy "Users can view own rep data"
  on public.rep_data
  using (
    exists (
      select 1 from public.therapy_sessions s
      where s.id = rep_data.session_id
        and (
          s.user_id = (select auth.uid())
          or (select public.is_admin())
          or (select public.is_caring_for(s.user_id))
        )
    )
  );

-- Deliberately NOT touched, and listed so a future reader sees the omission
-- was a decision rather than an oversight:
--   "Users can insert own sessions"  — patients only
--   "Users can insert own rep data"  — patients only
-- No UPDATE policy exists on therapy_sessions; 20260725000000 dropped it and
-- revoked the privilege. Do not recreate either.
```

- [ ] **Step 5: Run the migration, then run the whole suite in order**

Run `20260803000004_therapist_read_access.sql`, then every verification script in filename order: `01`, `02`, `03`, `04`, `05`, `06`.

Expected: six `PASS` results. **`06` passing after the migration is the deliverable of this task** — it proves the new read access did not open a write path.

If `06` now fails where it passed in Step 3, stop. A write grant leaked in. Do not commit.

- [ ] **Step 6: Verify the patient-facing app is unchanged**

Run `npm run dev`. As a patient account: complete a session, confirm a star is awarded, confirm `/dashboard` and `/levels` render. The widened policies must be invisible to patients.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260803000004_therapist_read_access.sql \
        supabase/tests/05_verify_therapist_reads.sql \
        supabase/tests/06_verify_no_therapist_writes.sql
git commit -m "feat: give therapists read access to assigned patients only"
```

---

## Task 7: TypeScript types and documentation

Without this, `npm run typecheck` fails and the schema is invisible to app code.

**Files:**
- Modify: `lib/supabase/types.ts`
- Modify: `supabase/README.md`

**Interfaces:**
- Consumes: every table and function from Tasks 2–6

- [ ] **Step 1: Verify the types are currently wrong**

Run: `npm run typecheck`
Expected: passes — but that is a false negative. The types are hand-maintained, so a missing table produces no error until something queries it. Confirm the gap directly instead:

```bash
grep -n "role\|org_id\|care_assignments\|patient_programs" lib/supabase/types.ts
```

Expected: `role` and `org_id` absent from the `profiles` Row type; neither new table present.

- [ ] **Step 2: Update the profiles types**

In `lib/supabase/types.ts`, add to the `profiles` `Row` type:

```typescript
role: 'patient' | 'therapist' | 'clinic_admin' | 'platform_admin';
org_id: string | null;
```

Add `org_id?: string | null` to the `Insert` and `Update` types.

**Remove `is_admin` from the `Insert` and `Update` types** (currently `lib/supabase/types.ts:57`). It is now a generated column and any write is rejected by Postgres. Leave it in `Row` — it is still readable, and six files read it.

Add `role` to the admin-columns union at `lib/supabase/types.ts:256`.

- [ ] **Step 3: Add the new table types**

Add to the `Tables` interface, following the shape of the existing entries:

```typescript
organizations: {
  Row: { id: string; name: string; created_at: string };
  Insert: { id?: string; name: string; created_at?: string };
  Update: { id?: string; name?: string; created_at?: string };
};
care_assignments: {
  Row: {
    id: string;
    therapist_id: string;
    patient_id: string;
    org_id: string | null;
    assigned_at: string;
    is_active: boolean;
  };
  Insert: { therapist_id: string; patient_id: string; org_id?: string | null };
  Update: { is_active?: boolean };
};
patient_programs: {
  Row: {
    id: string;
    patient_id: string;
    exercise_group_id: string;
    sets: number;
    reps: number;
    frequency_per_week: number;
    assigned_by: string | null;
    is_active: boolean;
    created_at: string;
  };
  Insert: {
    patient_id: string;
    exercise_group_id: string;
    sets?: number;
    reps?: number;
    frequency_per_week?: number;
    assigned_by?: string | null;
  };
  Update: {
    sets?: number;
    reps?: number;
    frequency_per_week?: number;
    is_active?: boolean;
  };
};
```

- [ ] **Step 4: Add the new function types**

Next to the existing `is_admin` entry at `lib/supabase/types.ts:221`:

```typescript
my_org_id: { Args: Record<string, never>; Returns: string | null };
is_caring_for: { Args: { p_patient_id: string }; Returns: boolean };
```

- [ ] **Step 5: Verify the build**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all pass. The seven existing Vitest suites in `lib/__tests__/` are pure-logic and must be unaffected — if one fails, a type change reached further than intended.

- [ ] **Step 6: Update the migration run order**

Add the five new migrations to `supabase/README.md` in filename order, and add a line pointing at `supabase/tests/README.md` for the verification suite.

- [ ] **Step 7: Commit and push**

```bash
git add lib/supabase/types.ts supabase/README.md
git commit -m "chore: add role, org and care types to the Supabase schema types"
git push -u origin feat/multitenancy-roles
```

---

## Done means

- All five migrations applied, in order, on the Supabase project.
- All six verification scripts return `PASS`, `06` included.
- `npm run typecheck && npm run lint && npm run test` green.
- A patient can still sign up, complete a session, and earn exactly one star for it.
- An existing admin can still open `/admin`.
- A therapist can read only the patients assigned to them, and cannot write any session, rep, star, or role data.

## Not done, deliberately

No therapist UI exists yet. The database can answer "who are my patients" and "what did they do", but nothing renders it. That is the next plan, and per the business model doc it should be written **after** the five therapist interviews — what belongs on that screen is exactly what those conversations are for.

Also absent, and each needing a real customer before it is worth building: billing and seat counting, org self-signup, therapist invitations, audit logging, and PDPA consent capture.

## Risks

**These migrations run against the live project.** Task 2 drops and re-adds a column. Take a database backup from the Supabase dashboard before starting, and run Task 2's file as the single transaction it is written as.

**Test accounts are seeded into `auth.users`.** Acceptable only while no real patient data exists. Teardown is at the bottom of `00_fixtures.sql` — run it when verification is finished.

**`handle_new_user()` gains a dependency on an organization named `Default Clinic`.** If that row is ever renamed or deleted, new signups get `org_id = null` and silently fall outside every org-scoped policy. Worth an explicit guard when invitations are built; not worth one now, but do not rename that row.
