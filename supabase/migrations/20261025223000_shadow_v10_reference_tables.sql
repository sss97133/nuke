-- Additive: first-class listing-time mileage per sale + learned reference tables for shadow v10.
-- Revert: supabase/sql/revert_shadow_v10.sql (drops only these three new tables; nothing existing is altered).
create table if not exists public.auction_event_listing_mileage (
  auction_event_id uuid primary key references public.auction_events(id),
  mileage_at_listing integer not null check (mileage_at_listing >= 0),
  mileage_unit text not null default 'mi',
  mileage_claim text,
  source_observation_id uuid not null references public.vehicle_observations(id),
  source_url text not null,
  method text not null,
  run_id text not null,
  created_at timestamptz not null default now()
);
comment on table public.auction_event_listing_mileage is
  'Odometer as stated on the listing page of this sale (point-in-time), not vehicles.mileage (current). One distinct value per sale; conflicting listing observations are excluded.';

create table if not exists public.model_name_normalization (
  id bigserial primary key,
  platform text not null,
  make_l text not null,
  model_raw text not null,
  model_canon text not null,
  method text not null,
  confidence numeric not null check (confidence between 0 and 1),
  provenance jsonb not null,
  run_id text not null,
  created_at timestamptz not null default now(),
  unique (platform, make_l, model_raw, run_id)
);
comment on table public.model_name_normalization is
  'Cross-platform model-string normalisation learned from sales data (token rules + co-pricing). provenance cites support counts and the rule used.';

create table if not exists public.model_segment_map (
  id bigserial primary key,
  make_l text not null,
  model_canon text not null,
  segment_slug text not null references public.vehicle_segments(slug),
  confidence numeric not null check (confidence between 0 and 1),
  method text not null,
  evidence jsonb not null,
  run_id text not null,
  created_at timestamptz not null default now(),
  unique (make_l, model_canon, run_id)
);
comment on table public.model_segment_map is
  'Learned make/model -> vehicle_segments map (labelled-vehicle votes, co-pricing, name similarity). evidence cites vote counts and neighbours.';

alter table public.auction_event_listing_mileage enable row level security;
alter table public.model_name_normalization enable row level security;
alter table public.model_segment_map enable row level security;
revoke all on public.auction_event_listing_mileage, public.model_name_normalization, public.model_segment_map from anon, authenticated;
