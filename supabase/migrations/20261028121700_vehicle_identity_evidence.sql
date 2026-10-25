-- Cited make/model identity + vehicle category evidence. Additive: vehicles (make, model, vehicle_category,
-- canonical_vehicle_type, canonical_make_id) is never written here. Disagreements are flagged (conflict/conflict_with).
-- Revert: retire by run_id (supabase/sql/revert_vehicle_identity_evidence_v1.sql). No deletes.
create table if not exists public.make_alias_ref (
  id bigint generated always as identity primary key,
  alias_text text not null,
  canonical_make text not null,
  kind text not null check (kind in ('alias','case_punct','truncated_make','misspelled_make','coachbuilder_as_make')),
  evidence_count integer not null default 1,
  citation_url text not null,
  citation_vehicle_id uuid references public.vehicles(id),
  rule text not null default 'identity_lex_v1',
  run_id text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
create unique index if not exists make_alias_ref_active_uq on public.make_alias_ref(alias_text, canonical_make, kind) where retired_at is null;
alter table public.make_alias_ref enable row level security;
comment on table public.make_alias_ref is 'Observed make-text aliases (alias, case/punct, truncated two-word make, misspelling, coachbuilder-as-make) mapped to a canonical make; each row cites one listing (citation_url) and counts supporting rows. Builds on canonical_makes.aliases. Retire by run_id.';

create table if not exists public.vehicle_identity_evidence (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null references public.vehicles(id),
  canonical_make text not null,
  canonical_model text,
  model_text text,
  category text not null check (category in ('car','truck_utility','motorcycle','tractor','cart_utility','trailer_rv','boat','aircraft','memorabilia')),
  coachbuilder text,
  issues text[] not null default '{}',
  source_url text not null,
  source_text text not null,
  extractor text not null default 'identity_lex_v1',
  confidence integer not null check (confidence between 0 and 100),
  conflict boolean not null default false,
  conflict_with text,
  run_id text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
create unique index if not exists vehicle_identity_evidence_active_uq on public.vehicle_identity_evidence(vehicle_id, extractor) where retired_at is null;
create index if not exists vehicle_identity_evidence_run_idx on public.vehicle_identity_evidence(run_id);
create index if not exists vehicle_identity_evidence_cat_idx on public.vehicle_identity_evidence(category) where retired_at is null;
alter table public.vehicle_identity_evidence enable row level security;
comment on table public.vehicle_identity_evidence is 'Deterministic canonical make/base model/category from saved make, model and title (source_text, cited by source_url). conflict=true when it disagrees with vehicles.vehicle_category, canonical_vehicle_type or canonical_make_id (conflict_with); never overwrites. Retire by run_id.';
