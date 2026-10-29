-- vehicle_vin_mismatch: cited flag where a VIN decode's model class contradicts the vehicle's own title.
-- Never auto-fixes the vehicle. Additive; revert = drop table (no data elsewhere depends on it).
create table if not exists public.vehicle_vin_mismatch (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null,
  vin text not null,
  source_table text not null check (source_table in ('vin_decoded_data','vin_vpic_decode')),
  decode_cite text not null check (length(decode_cite) > 0),
  title_cite text not null check (length(title_cite) > 0),
  decoded_category text not null,
  title_category text not null,
  confidence numeric not null check (confidence between 0 and 1),
  rule text not null,
  run_id text not null,
  wrong_vehicle_obs_ids bigint[],
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_reason text
);
create unique index if not exists vehicle_vin_mismatch_active_uq
  on public.vehicle_vin_mismatch (vehicle_id, vin, source_table) where retired_at is null;
create index if not exists vehicle_vin_mismatch_vehicle_idx on public.vehicle_vin_mismatch (vehicle_id);
comment on table public.vehicle_vin_mismatch is
  'Flag only, never auto-fix: decoded model class contradicts vehicles.make/model. Flagged decodes are excluded from category evidence (vin_decoded_v1/vin_body_v1 rows retired with tag excluded:vin_mismatch_v1). wrong_vehicle_obs_ids links photo_vehicle_mismatch_observation.';
alter table public.vehicle_vin_mismatch enable row level security;
