-- Let therapists review a patient's progress dashboard without weakening the
-- session write lockdown. This changes SELECT visibility only; authenticated
-- clients still cannot update therapy_sessions directly.

drop policy if exists "Users can view own sessions" on public.therapy_sessions;
drop policy if exists "Users and admins can view sessions" on public.therapy_sessions;

create policy "Users and admins can view sessions"
  on public.therapy_sessions
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or (select public.is_admin())
  );
