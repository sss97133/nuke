-- v12: (a) cite stored page snapshots as an odometer source for auction_event_listing_mileage;
--      (b) first-class home for odometer-at-sale of sales that live in vehicle_events (e.g. Collecting Cars).
-- Additive only. Revert: supabase/sql/revert_shadow_v12.sql
alter table public.auction_event_listing_mileage
  add column if not exists source_snapshot_id uuid references public.listing_page_snapshots(id);
alter table public.auction_event_listing_mileage drop constraint if exists auction_event_listing_mileage_has_source;
alter table public.auction_event_listing_mileage
  add constraint auction_event_listing_mileage_has_source
  check (source_observation_id is not null or source_vehicle_id is not null or source_snapshot_id is not null);
comment on column public.auction_event_listing_mileage.source_snapshot_id is
  'listing_page_snapshots row whose stored page text states the odometer (v12 snapshot extraction)';

create table if not exists public.vehicle_event_listing_mileage (
  vehicle_event_id uuid primary key references public.vehicle_events(id),
  mileage_at_listing integer check (mileage_at_listing >= 0),
  mileage_unit text,
  mileage_claim text,
  mileage_tmu boolean not null default false,
  source_observation_id uuid references public.vehicle_observations(id),
  source_vehicle_id uuid references public.vehicles(id),
  source_snapshot_id uuid references public.listing_page_snapshots(id),
  source_url text,
  method text not null,
  run_id text not null,
  validation jsonb,
  created_at timestamptz not null default now(),
  constraint vehicle_event_listing_mileage_has_source
    check (source_observation_id is not null or source_vehicle_id is not null or source_snapshot_id is not null),
  constraint vehicle_event_listing_mileage_value_or_tmu
    check (mileage_at_listing is not null or (mileage_tmu and mileage_claim is not null))
);
comment on table public.vehicle_event_listing_mileage is
  'Point-in-time odometer at sale for sales recorded in vehicle_events (sibling of auction_event_listing_mileage). Every row cites its source.';
alter table public.vehicle_event_listing_mileage enable row level security;
revoke all on public.vehicle_event_listing_mileage from anon, authenticated;
