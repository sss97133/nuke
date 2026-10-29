-- Cited trim/submodel evidence. Additive: vehicles.trim is never written here.
-- One active row per (vehicle, rule); conflicts with an existing vehicles.trim are flagged, never overwritten.
-- Revert: retire by run_id (supabase/sql/revert_vehicle_trim_evidence_v1.sql). No deletes.
create table if not exists public.vehicle_trim_evidence (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null references public.vehicles(id),
  trim text,
  submodel text,
  source_url text not null,
  source_text text not null,
  source_field text not null default 'vehicles.title',
  description_snapshot_id uuid,
  extractor text not null default 'trim_title_lex_v1',
  confidence integer not null check (confidence between 0 and 100),
  conflict boolean not null default false,
  conflict_with text,
  run_id text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  check (trim is not null or submodel is not null)
);
create unique index if not exists vehicle_trim_evidence_active_uq
  on public.vehicle_trim_evidence(vehicle_id, extractor) where retired_at is null;
create index if not exists vehicle_trim_evidence_run_idx on public.vehicle_trim_evidence(run_id);
alter table public.vehicle_trim_evidence enable row level security;
comment on table public.vehicle_trim_evidence is
'Trim/submodel extracted deterministically from saved listing title (cited by source_url, source_text) and corroborated by vehicle_listing_description (description_snapshot_id). conflict=true when it disagrees with vehicles.trim (conflict_with); never overwrites. Retire by run_id.';
