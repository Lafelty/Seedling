# Database migrations

## Layout

- `migrations/` — ordered schema migrations. The timestamp prefix (`YYYYMMDDHHMMSS_name.sql`)
  is the apply order. Filename order **is** deploy order; never apply out of order.
- `scripts/` — one-off data operations (e.g. granting admin to an account).
  These are not schema migrations and are run manually when needed.

## Current state

Every migration in `migrations/` has already been applied to the production
Supabase project (as of 2026-07-11). A fresh environment must run all of them,
in filename order, top to bottom.

The application code assumes the full schema exists. There are **no runtime
fallbacks** for missing tables or columns — an un-applied migration fails loudly
(console errors / error UI), it does not silently degrade. If a page reports a
load failure right after a deploy, check that any new migration was applied first.

## Deploy order rule

**Migrations are applied before the app code that depends on them ships.**

1. Write a new file: `migrations/<YYYYMMDDHHMMSS>_<short_name>.sql`
   (use the current UTC timestamp; never reuse or edit an already-applied file).
2. Make it additive and safe on live data (defaults for new NOT NULL columns,
   `IF NOT EXISTS` where possible).
3. Apply it in the Supabase SQL editor (or `supabase db push` if using the CLI).
4. Then deploy the app change that uses it.

## Applying with the Supabase CLI (optional)

The folder follows the Supabase CLI convention, so the project can be linked and
pushed instead of hand-pasting into the SQL editor:

```sh
supabase link --project-ref <project-ref>
supabase migration list          # compare local vs remote
supabase db push                 # applies any un-applied migrations, in order
```

Because the existing files were originally applied by hand, the first CLI run
will see them as un-applied. Baseline them once with:

```sh
supabase migration repair --status applied <timestamp> [...]
```

for each already-applied timestamp, then `supabase db push` works normally from
that point on.

## Migration index

| File | What it adds |
| --- | --- |
| `20260703000000_initial_schema.sql` | profiles, therapy_sessions, base RLS |
| `20260703000001_exercises_and_admin.sql` | `profiles.is_admin`, exercises table |
| `20260704000000_data_fixes.sql` | live-data repairs (idempotent) |
| `20260705000000_perf_rls_fixes.sql` | RLS linter fixes (InitPlan, policy split) |
| `20260706000000_stars.sql` | `profiles.total_stars`, `public.is_admin()` helper |
| `20260706000001_levels.sql` | exercise_groups + level-map columns on exercises |
| `20260706000002_profile_info.sql` | height/weight, guardian email + notify |
| `20260707000000_hand_tracking.sql` | `exercises.tracking_mode` (body/hand) |
| `20260708000000_demo_images.sql` | `exercises.demo_images` JSONB |
| `20260713015700_security_lint_fixes.sql` | linter fixes: search_path pin, RPC grants, bucket listing |
| `20260718000000_exercise_delete_set_null.sql` | `therapy_sessions.exercise_id` FK → `on delete set null` |
| `20260718120000_star_integrity.sql` | server-owned stars: session-bound `award_stars`, `admin_set_stars`, revoke client `total_stars` writes |

When a migration changes the schema, update `lib/supabase/types.ts` to match —
the typed client is what keeps queries honest end to end.
