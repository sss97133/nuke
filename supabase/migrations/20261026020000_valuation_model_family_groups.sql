-- Reference table: data-learned model-family groupings within a make (shadow valuation v13b).
-- Additive only. Revert: supabase/sql/revert_shadow_v13b.sql
create table if not exists public.valuation_model_family_groups (
  id bigserial primary key,
  run_id text not null,
  make text not null,
  model_canon text not null,
  family_key text not null,
  family_size integer not null,
  comps_n integer,
  median_log_price numeric,
  method jsonb not null,
  citation text not null,
  created_at timestamptz not null default now(),
  unique (run_id, make, model_canon)
);
alter table public.valuation_model_family_groups enable row level security;
comment on table public.valuation_model_family_groups is 'Model-family groups learned from data (char-trigram/prefix name similarity + half-year price co-movement + price level gap, union-find within make). One row per (run, make, canonical model). Built by scripts/shadow/v13b/fam.py from the shadow comps pool; used only by shadow valuation experiments, never by live estimates.';
