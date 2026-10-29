-- Duplicate-vehicle candidates as first-class rows (review queue only; nothing here merges vehicles).
-- One row per unordered vehicle pair per run. Evidence is a jsonb array of {kind, src, cited ids/urls}.
-- Confidence follows RULEMC v1 (pre-registered): 1 - prod(1 - w_kind), times penalties for year/make/VIN disagreement.
create table if not exists public.vehicle_merge_candidates (
  id bigserial primary key,
  vehicle_a uuid not null references public.vehicles(id),
  vehicle_b uuid not null references public.vehicles(id),
  evidence_kinds text[] not null,
  evidence jsonb not null,
  penalties text[] not null default '{}',
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  tier text check (tier in ('T1','T2','T3','T4')),
  cluster_id uuid,
  cluster_size int,
  status text not null default 'pending_review'
    check (status in ('pending_review','approved','rejected','merged','superseded')),
  rule text not null,
  run_id text not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text,
  constraint vehicle_merge_candidates_ordered check (vehicle_a < vehicle_b),
  constraint vehicle_merge_candidates_pair_run_uq unique (vehicle_a, vehicle_b, run_id)
);
create index if not exists vehicle_merge_candidates_b_idx on public.vehicle_merge_candidates (vehicle_b);
create index if not exists vehicle_merge_candidates_cluster_idx on public.vehicle_merge_candidates (cluster_id);
create index if not exists vehicle_merge_candidates_status_tier_idx on public.vehicle_merge_candidates (status, tier);
alter table public.vehicle_merge_candidates enable row level security;
comment on table public.vehicle_merge_candidates is
  'Duplicate-vehicle pair candidates for human review. Loading a row never merges anything; status changes are review decisions.';
