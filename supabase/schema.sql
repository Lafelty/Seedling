-- Create users table (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  name text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create therapy_sessions table
create table public.therapy_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  exercise_type text not null default 'shoulder-raise',
  started_at timestamp with time zone not null,
  completed_at timestamp with time zone,
  duration_seconds integer,
  target_reps integer not null default 10,
  completed_reps integer not null default 0,
  form_quality_score numeric(5,2), -- 0-100 average
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create rep_data table
create table public.rep_data (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.therapy_sessions(id) on delete cascade not null,
  rep_number integer not null,
  hold_duration_ms integer not null,
  form_score numeric(5,2) not null, -- 0-100
  timestamp timestamp with time zone not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.profiles enable row level security;
alter table public.therapy_sessions enable row level security;
alter table public.rep_data enable row level security;

-- Profiles policies
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Therapy sessions policies
create policy "Users can view own sessions"
  on public.therapy_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert own sessions"
  on public.therapy_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own sessions"
  on public.therapy_sessions for update
  using (auth.uid() = user_id);

-- Rep data policies
create policy "Users can view own rep data"
  on public.rep_data for select
  using (
    exists (
      select 1 from public.therapy_sessions
      where therapy_sessions.id = rep_data.session_id
      and therapy_sessions.user_id = auth.uid()
    )
  );

create policy "Users can insert own rep data"
  on public.rep_data for insert
  with check (
    exists (
      select 1 from public.therapy_sessions
      where therapy_sessions.id = rep_data.session_id
      and therapy_sessions.user_id = auth.uid()
    )
  );

-- Create indexes for performance
create index therapy_sessions_user_id_idx on public.therapy_sessions(user_id);
create index therapy_sessions_started_at_idx on public.therapy_sessions(started_at);
create index rep_data_session_id_idx on public.rep_data(session_id);

-- Function to automatically create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, new.raw_user_meta_data->>'name');
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to create profile on signup
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
