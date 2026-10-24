-- First-class odometer unit + normalised miles (Skylar's rule: store what the source said, then normalise
-- explicitly with a method, source and confidence; never silently convert).
-- Additive only. Revert: supabase/sql/revert_odometer_unit_v1.sql
alter table public.vehicles
  add column if not exists odometer_reading numeric,
  add column if not exists odometer_unit text,
  add column if not exists odometer_source_url text,
  add column if not exists mileage_normalized_miles integer,
  add column if not exists mileage_normalized_method text,
  add column if not exists mileage_normalized_confidence text,
  add column if not exists mileage_normalized_source text;

alter table public.vehicles drop constraint if exists vehicles_odometer_unit_chk;
alter table public.vehicles add constraint vehicles_odometer_unit_chk
  check (odometer_unit is null or odometer_unit in ('mi','km')) not valid;
alter table public.vehicles drop constraint if exists vehicles_mileage_normalized_confidence_chk;
alter table public.vehicles add constraint vehicles_mileage_normalized_confidence_chk
  check (mileage_normalized_confidence is null or mileage_normalized_confidence in ('high','medium','low')) not valid;

comment on column public.vehicles.odometer_reading is 'Odometer number exactly as the source showed it, in odometer_unit (not converted). Grain: one vehicle. Source: odometer_source_url.';
comment on column public.vehicles.odometer_unit is 'Unit of odometer_reading as stated by the source: mi or km. NULL = source did not state a unit.';
comment on column public.vehicles.odometer_source_url is 'Page the odometer_reading was read from (citation).';
comment on column public.vehicles.mileage_normalized_miles is 'odometer_reading expressed in miles. km -> round(km*0.621371). Method in mileage_normalized_method.';
comment on column public.vehicles.mileage_normalized_method is 'How mileage_normalized_miles was derived, e.g. as_stated_mi, km_to_mi_x0.621371, unit_unknown_assumed_mi.';
comment on column public.vehicles.mileage_normalized_confidence is 'high = unit stated on source page; medium = unit inferred; low = unit unknown.';
comment on column public.vehicles.mileage_normalized_source is 'Writer of the normalised value (extractor name or fix run id).';

-- Backup/audit table for reversible corrections of vehicles.mileage (one row per changed vehicle per run).
create table if not exists public.vehicle_mileage_unit_fixes (
  id bigserial primary key,
  run_id text not null,
  vehicle_id uuid not null references public.vehicles(id),
  old_mileage integer,
  new_mileage integer,
  odometer_reading numeric,
  odometer_unit text,
  source_url text,
  source_snapshot_id uuid,
  reason text not null,
  created_at timestamptz not null default now(),
  reverted_at timestamptz,
  unique (run_id, vehicle_id)
);
alter table public.vehicle_mileage_unit_fixes enable row level security;
comment on table public.vehicle_mileage_unit_fixes is 'Audit/backup of vehicles.mileage corrections where a source km odometer had been stored as miles. old_mileage restores the prior value (see supabase/sql/revert_odometer_unit_v1.sql). Grain: one vehicle per run.';
