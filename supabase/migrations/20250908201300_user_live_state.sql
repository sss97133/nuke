-- User Live State for Mux streaming
-- Non-destructive migration

create table if not exists public.user_live_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mux_stream_id text,
  mux_stream_key text,
  mux_playback_id text,
  live boolean default false,
  started_at timestamptz,
  last_event jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger user_live_state_set_updated_at
before update on public.user_live_state
for each row execute function public.set_updated_at();

alter table public.user_live_state enable row level security;
-- Owner RW
drop policy if exists user_live_state_owner_rw on public.user_live_state;
create policy user_live_state_owner_rw on public.user_live_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Admins can read all (optional; adjust to your admin role)
-- create policy user_live_state_admin_read on public.user_live_state for select using (exists (select 1));
