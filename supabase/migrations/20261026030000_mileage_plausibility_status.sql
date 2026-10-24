-- First-class plausibility/verification status for mileage values (Skylar's rule: a number is only
-- mileage when the source says it is an odometer reading). Additive only; a side table so no DDL
-- lock is taken on vehicles. Revert: supabase/sql/revert_mileage_status_bonhams_v1.sql
create table if not exists public.mileage_value_status (
  id bigserial primary key,
  vehicle_id uuid not null, -- no FK: adding one locks hot vehicles against writes
  auction_event_id uuid,
  field text not null,
  value integer,
  status text not null,
  reason text not null,
  source_url text,
  evidence text,
  run_id text not null,
  old_vehicle_mileage integer,
  checked_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint mileage_value_status_field_chk check (field in ('vehicles.mileage','auction_event_listing_mileage')),
  constraint mileage_value_status_status_chk check (status in ('verified','plausible','unverified','suspect')),
  constraint mileage_value_status_aelm_chk check (field <> 'auction_event_listing_mileage' or auction_event_id is not null)
);
create unique index if not exists mileage_value_status_current_uq
  on public.mileage_value_status (field, vehicle_id, coalesce(auction_event_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where superseded_at is null;
create index if not exists mileage_value_status_run_idx on public.mileage_value_status (run_id);
create index if not exists mileage_value_status_aeid_idx on public.mileage_value_status (auction_event_id) where auction_event_id is not null;
alter table public.mileage_value_status enable row level security;
comment on table public.mileage_value_status is 'Plausibility/verification status of a stored mileage value. Grain: one (field, vehicle, auction_event) per check; current row has superseded_at null. status: verified = odometer context on the source page; unverified = number+unit on page but no odometer context; suspect = not an odometer reading (km/h or mph speed, mpg, per-hour/per-year distance, event distance, absent from page text). Suspect vehicles.mileage is set NULL (old value kept in old_vehicle_mileage and value) so valuation loaders never read it; suspect listing mileage is hidden by auction_event_listing_mileage_usable.';
comment on column public.mileage_value_status.reason is 'Machine reason: odometer_context, unit_no_odometer_context, since_event, speed, mpg, distance_per_hour, annual_rate, event_distance, not_on_page, not_on_page_as_mileage, page_unavailable.';
comment on column public.mileage_value_status.evidence is 'Page snippet around the number (or empty when the number is not on the page).';
comment on column public.mileage_value_status.old_vehicle_mileage is 'vehicles.mileage before this run touched it (restores on revert).';

create or replace view public.auction_event_listing_mileage_usable
with (security_invoker = true) as
select m.* from public.auction_event_listing_mileage m
where not exists (
  select 1 from public.mileage_value_status s
  where s.field = 'auction_event_listing_mileage' and s.auction_event_id = m.auction_event_id
    and s.superseded_at is null and s.status = 'suspect');
comment on view public.auction_event_listing_mileage_usable is 'Odometer-at-sale rows that valuation loaders may use: drops rows whose current mileage_value_status is suspect.';
