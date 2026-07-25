-- Grant therapist/admin rights to one existing account.
--
-- The account must already exist in auth.users (sign up through /signup first);
-- this only flips public.profiles.is_admin, which is UPDATE-revoked for client
-- roles, so it can only be run with service_role / SQL-editor privileges.
--
-- NEVER hardcode an address or a password in this file. Passwords live only in
-- Supabase Auth; anything written here is readable by everyone with repo access
-- and stays in git history forever.
--
-- Usage with psql:
--   psql "$DATABASE_URL" -v admin_email='person@example.com' \
--     -f supabase/scripts/set-admin.sql
--
-- Usage in the Supabase SQL editor (no variable support): replace both
-- :'admin_email' occurrences below with a quoted address, run, then discard the
-- edit — do not commit it.

UPDATE public.profiles
SET is_admin = TRUE
WHERE lower(email) = lower(:'admin_email');

-- Verify the change
SELECT id, email, is_admin, created_at
FROM public.profiles
WHERE lower(email) = lower(:'admin_email');
