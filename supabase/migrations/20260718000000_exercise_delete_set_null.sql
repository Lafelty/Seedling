-- Allow deleting an exercise that has recorded therapy sessions.
-- Session history (stars, reps, duration) must survive the delete, so the
-- reference is nulled out instead of cascading. The UI already renders a
-- generic "Exercise" label when the join comes back null.

alter table public.therapy_sessions
  drop constraint therapy_sessions_exercise_id_fkey;

alter table public.therapy_sessions
  add constraint therapy_sessions_exercise_id_fkey
    foreign key (exercise_id) references public.exercises(id)
    on delete set null;
