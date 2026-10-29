-- Typed, cited VIN evidence mined from already-stored listing pages (additive).
-- One row per (vehicle, mined value, run). Never rewrites a stored VIN: a fill only sets vehicles.vin where it was
-- null/blank, and prior_vin records what was there so a run can be reverted exactly.
-- Revert: drop table public.vehicle_vin_evidence;
create table if not exists public.vehicle_vin_evidence (
  id bigserial primary key,
  vehicle_id uuid not null references public.vehicles(id),
  vin_value text not null,
  vin_class text not null check (vin_class in ('labeled_vin17_cd','labeled_vin17_eu','unlabeled_vin17_cd','labeled_chassis_pre1981')),
  label_kind text not null check (label_kind in ('labeled','unlabeled')),
  source_snapshot_id uuid references public.listing_page_snapshots(id),
  source_url text,
  check_digit_valid boolean,
  year_code_ok boolean,
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  outcome text not null check (outcome in ('filled','class_not_validated','collision_existing','collision_mined','dup_guard_hold','conflict')),
  collides_with uuid[],
  prior_vin text,
  rule text not null,
  run_id text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_run_id text
);
create index if not exists vehicle_vin_evidence_vehicle_idx on public.vehicle_vin_evidence (vehicle_id);
create index if not exists vehicle_vin_evidence_run_idx on public.vehicle_vin_evidence (run_id);
create index if not exists vehicle_vin_evidence_value_idx on public.vehicle_vin_evidence (vin_value);
alter table public.vehicle_vin_evidence enable row level security;
comment on table public.vehicle_vin_evidence is
  'Cited VIN/chassis evidence mined from stored listing_page_snapshots. outcome=filled means vehicles.vin was set from null/blank (prior_vin kept for revert); collisions are duplicate-vehicle candidates, never fills or merges.';
