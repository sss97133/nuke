-- Vehicle streaming provider selection + OAuth state tracking
-- Adds provider metadata for live streams and creates oauth_state_tracker + token storage

begin;

-- OAuth state tracker (used by edge OAuth functions)
create table if not exists public.oauth_state_tracker (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references businesses(id) on delete set null,
  state text not null unique,
  platform text not null,
  metadata jsonb default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

create index if not exists idx_oauth_state_tracker_state on public.oauth_state_tracker(state);
create index if not exists idx_oauth_state_tracker_user on public.oauth_state_tracker(user_id);
create index if not exists idx_oauth_state_tracker_platform on public.oauth_state_tracker(platform);

-- Token storage for external identities (service-role only)
create table if not exists public.external_identity_tokens (
  external_identity_id uuid primary key references public.external_identities(id) on delete cascade,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scope text[],
  token_type text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.external_identity_tokens enable row level security;
drop policy if exists "Service role manages external identity tokens" on public.external_identity_tokens;
create policy "Service role manages external identity tokens"
  on public.external_identity_tokens
  for all
  using (auth.jwt() ->> 'role' = 'service_role')
  with check (auth.jwt() ->> 'role' = 'service_role');

-- Provider metadata for live_streaming_sessions
alter table public.live_streaming_sessions
  add column if not exists stream_provider text,
  add column if not exists external_identity_id uuid references public.external_identities(id);

create index if not exists idx_live_streaming_provider on public.live_streaming_sessions(stream_provider);
create index if not exists idx_live_streaming_external_identity on public.live_streaming_sessions(external_identity_id);

-- Expand stream creation/update permissions to vehicle collaborators
drop policy if exists "Vehicle owners can create streams" on public.live_streaming_sessions;
create policy "Vehicle collaborators can create streams" on public.live_streaming_sessions
  for insert
  with check (public.vehicle_user_has_access(vehicle_id, auth.uid()));

drop policy if exists "Stream owners can update their streams" on public.live_streaming_sessions;
create policy "Vehicle collaborators can update streams" on public.live_streaming_sessions
  for update
  using (public.vehicle_user_has_access(vehicle_id, auth.uid()));

drop policy if exists "Stream owners can delete their streams" on public.live_streaming_sessions;
create policy "Vehicle collaborators can delete streams" on public.live_streaming_sessions
  for delete
  using (public.vehicle_user_has_access(vehicle_id, auth.uid()));

commit;
