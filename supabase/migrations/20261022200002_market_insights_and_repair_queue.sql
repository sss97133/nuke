-- Additive: hypothesis-engine results and data-repair queue. No existing objects touched.
create table if not exists public.market_insights (
  id bigserial primary key,
  run_id text not null,
  hypothesis text not null,            -- dimension = level, e.g. 'auction venue = Mecum Kissimmee'
  dimension text not null, level text not null, segment text not null,
  effect_pct numeric, ci_low_pct numeric, ci_high_pct numeric, n int, n_rest int,
  p_value double precision, q_value double precision,  -- Benjamini-Hochberg across all hypotheses in the run
  holdout_effect_pct numeric, holdout_ci_low_pct numeric, holdout_ci_high_pct numeric, holdout_n int, replicated boolean,
  field_coverage numeric, readiness text,               -- ready | partial | blocked
  method text not null default 'residual of log hammer ~ cohort(make,model key,year)+month+channel+mileage band; train<2024-01, holdout>=2024-01',
  citation_query text, score numeric, headline_draft text,
  status text not null default 'candidate' check (status in ('candidate','approved','stale','rejected','not_replicated','no_effect')),
  created_at timestamptz not null default now()
);
create index if not exists market_insights_run on public.market_insights(run_id, status, score desc);
create table if not exists public.data_repair_queue (
  id bigserial primary key,
  field text not null, defect text not null, affected_rows int, coverage numeric,
  hypotheses_blocked int, value_weighted_priority numeric,
  fix_type text check (fix_type in ('schema','extractor','backfill','transform')),
  proposal text, status text not null default 'open' check (status in ('open','in_progress','done','wontfix')),
  run_id text, created_at timestamptz not null default now(), unique(field, defect)
);
alter table public.market_insights enable row level security;
alter table public.data_repair_queue enable row level security;
