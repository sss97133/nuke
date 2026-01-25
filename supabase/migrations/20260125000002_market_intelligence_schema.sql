-- ============================================================================
-- MARKET INTELLIGENCE & INVESTMENT ANALYTICS SCHEMA
-- ============================================================================
-- Implements the Market Intelligence Initiative for the Nuke vehicle platform.
-- Creates infrastructure for market indexes, projections, and investment packages.
--
-- Phase 1: Market Index Infrastructure
-- - market_indexes: Define indexes (SQBDY-50, CLSC-100, etc.)
-- - market_index_values: Time series data for index performance
-- - market_index_components: What vehicles/segments compose each index
-- - investment_packages: Investment-like product definitions
-- - package_holdings: Specific vehicles in each package
-- - projection_outcomes: Track projection accuracy (feedback loop)
-- - analysis_feedback: User feedback on AI insights
-- ============================================================================

begin;

-- ============================================================================
-- MARKET INDEXES TABLE
-- ============================================================================
-- Define market indexes similar to stock market indices
create table if not exists public.market_indexes (
  id uuid primary key default gen_random_uuid(),

  -- Index identity
  index_code text unique not null,
  index_name text not null,
  description text,

  -- Calculation configuration
  calculation_method jsonb default '{}'::jsonb,
  components_query text,

  -- Metadata
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_market_indexes_code on public.market_indexes(index_code);
create index if not exists idx_market_indexes_active on public.market_indexes(is_active);

comment on table public.market_indexes is 'Market index definitions (SQBDY-50, CLSC-100, etc.)';
comment on column public.market_indexes.calculation_method is 'JSON config: {"type": "price_weighted", "top_n": 50, "filters": {...}}';
comment on column public.market_indexes.components_query is 'Optional SQL query to dynamically select index components';

-- ============================================================================
-- MARKET INDEX VALUES (TIME SERIES)
-- ============================================================================
-- Track index values over time (OHLCV format like stock data)
create table if not exists public.market_index_values (
  id uuid primary key default gen_random_uuid(),

  -- Index reference
  index_id uuid not null references public.market_indexes(id) on delete cascade,

  -- Time series
  value_date date not null,

  -- OHLCV data
  open_value numeric,
  close_value numeric,
  high_value numeric,
  low_value numeric,
  volume integer default 0,

  -- Metadata
  components_snapshot jsonb default '{}'::jsonb,
  calculation_metadata jsonb default '{}'::jsonb,

  created_at timestamptz not null default now(),

  -- Ensure one value per index per day
  unique(index_id, value_date)
);

create index if not exists idx_market_index_values_index_date on public.market_index_values(index_id, value_date desc);
create index if not exists idx_market_index_values_date on public.market_index_values(value_date desc);

comment on table public.market_index_values is 'Time series data for market indexes (daily OHLCV)';
comment on column public.market_index_values.components_snapshot is 'Snapshot of what vehicles/segments were in the index on this date';
comment on column public.market_index_values.calculation_metadata is 'How the value was calculated: {"avg_price": 45000, "count": 50, "method": "..."}';

-- ============================================================================
-- MARKET INDEX COMPONENTS
-- ============================================================================
-- Define what makes up each index (can be vehicles, segments, filters)
create table if not exists public.market_index_components (
  id uuid primary key default gen_random_uuid(),

  -- Index reference
  index_id uuid not null references public.market_indexes(id) on delete cascade,

  -- Component definition
  component_type text not null check (component_type in ('vehicle', 'segment', 'make_model', 'filter', 'query')),
  component_filter jsonb not null default '{}'::jsonb,

  -- Weighting
  weight numeric default 1.0,

  -- Metadata
  added_at timestamptz not null default now(),
  is_active boolean default true
);

create index if not exists idx_market_index_components_index on public.market_index_components(index_id);
create index if not exists idx_market_index_components_type on public.market_index_components(component_type);
create index if not exists idx_market_index_components_active on public.market_index_components(index_id, is_active);

comment on table public.market_index_components is 'Components that make up each market index';
comment on column public.market_index_components.component_filter is 'Filter criteria: {"year_min": 1973, "year_max": 1991, "make": "Chevrolet", "model": "C10"}';

-- ============================================================================
-- INVESTMENT PACKAGES
-- ============================================================================
-- Investment-like products for tracking vehicle segments
create table if not exists public.investment_packages (
  id uuid primary key default gen_random_uuid(),

  -- Package identity
  package_type text not null check (package_type in ('single_vehicle', 'segment_bundle', 'regional_portfolio', 'momentum_picks', 'index_tracker', 'custom')),
  name text not null,
  description text,

  -- Selection criteria
  criteria jsonb not null default '{}'::jsonb,
  target_allocation jsonb default '{}'::jsonb,

  -- Risk & return projections
  risk_score numeric check (risk_score >= 0 and risk_score <= 10),
  projected_return jsonb default '{}'::jsonb,

  -- Ownership
  created_by uuid references auth.users(id) on delete set null,
  is_public boolean default false,

  -- Status
  is_active boolean default true,

  -- Metadata
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_investment_packages_type on public.investment_packages(package_type);
create index if not exists idx_investment_packages_creator on public.investment_packages(created_by);
create index if not exists idx_investment_packages_public on public.investment_packages(is_public) where is_public = true;
create index if not exists idx_investment_packages_active on public.investment_packages(is_active);

comment on table public.investment_packages is 'Investment-like products for tracking vehicle segments';
comment on column public.investment_packages.criteria is 'Selection criteria: filters, queries, rules';
comment on column public.investment_packages.projected_return is 'Projection data: {"1yr": 0.15, "3yr": 0.45, "5yr": 0.80}';

-- ============================================================================
-- PACKAGE HOLDINGS
-- ============================================================================
-- Specific vehicles included in each investment package
create table if not exists public.package_holdings (
  id uuid primary key default gen_random_uuid(),

  -- Package reference
  package_id uuid not null references public.investment_packages(id) on delete cascade,

  -- Vehicle reference
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,

  -- Value tracking
  entry_value numeric,
  current_value numeric,
  weight numeric default 1.0,

  -- Metadata
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  is_active boolean default true,

  -- Ensure vehicle only in package once
  unique(package_id, vehicle_id)
);

create index if not exists idx_package_holdings_package on public.package_holdings(package_id);
create index if not exists idx_package_holdings_vehicle on public.package_holdings(vehicle_id);
create index if not exists idx_package_holdings_active on public.package_holdings(package_id, is_active);

comment on table public.package_holdings is 'Vehicles included in investment packages';

-- ============================================================================
-- PROJECTION OUTCOMES
-- ============================================================================
-- Track projection accuracy for feedback loop (Ralph Wiggum RLM pattern)
create table if not exists public.projection_outcomes (
  id uuid primary key default gen_random_uuid(),

  -- What was projected
  vehicle_id uuid references public.vehicles(id) on delete set null,
  projection_type text not null,

  -- Projection data
  projected_value numeric not null,
  projected_at timestamptz not null,
  projection_horizon text, -- '30d', '90d', '1yr', etc.

  -- Actual outcome
  actual_value numeric,
  actual_at timestamptz,

  -- Accuracy metrics
  accuracy_score numeric, -- 1 - abs(projected - actual) / actual
  error_pct numeric,

  -- Model tracking
  model_version text,
  model_metadata jsonb default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_projection_outcomes_vehicle on public.projection_outcomes(vehicle_id);
create index if not exists idx_projection_outcomes_type on public.projection_outcomes(projection_type);
create index if not exists idx_projection_outcomes_model on public.projection_outcomes(model_version);
create index if not exists idx_projection_outcomes_accuracy on public.projection_outcomes(accuracy_score) where accuracy_score is not null;
create index if not exists idx_projection_outcomes_date on public.projection_outcomes(projected_at desc);

comment on table public.projection_outcomes is 'Track projection accuracy for ML feedback loop';
comment on column public.projection_outcomes.accuracy_score is 'Calculated: 1 - abs(projected - actual) / actual. Higher is better.';

-- ============================================================================
-- ANALYSIS FEEDBACK
-- ============================================================================
-- User feedback on analysis quality (RLM learning signal)
create table if not exists public.analysis_feedback (
  id uuid primary key default gen_random_uuid(),

  -- What was analyzed
  analysis_type text not null,
  analysis_id uuid,

  -- Who provided feedback
  user_id uuid references auth.users(id) on delete set null,

  -- Feedback data
  feedback_type text not null check (feedback_type in ('helpful', 'not_helpful', 'inaccurate', 'outdated', 'misleading', 'excellent')),
  feedback_data jsonb default '{}'::jsonb,
  feedback_text text,

  created_at timestamptz not null default now()
);

create index if not exists idx_analysis_feedback_type on public.analysis_feedback(analysis_type);
create index if not exists idx_analysis_feedback_analysis on public.analysis_feedback(analysis_id);
create index if not exists idx_analysis_feedback_user on public.analysis_feedback(user_id);
create index if not exists idx_analysis_feedback_date on public.analysis_feedback(created_at desc);

comment on table public.analysis_feedback is 'User feedback on analysis quality for ML improvement';

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
-- Ensure updated_at columns are maintained

do $$
begin
  if exists (select 1 from pg_proc where proname = 'update_updated_at_column') then
    -- market_indexes
    drop trigger if exists trg_market_indexes_updated_at on public.market_indexes;
    create trigger trg_market_indexes_updated_at
      before update on public.market_indexes
      for each row execute function update_updated_at_column();

    -- investment_packages
    drop trigger if exists trg_investment_packages_updated_at on public.investment_packages;
    create trigger trg_investment_packages_updated_at
      before update on public.investment_packages
      for each row execute function update_updated_at_column();
  end if;
end $$;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Market indexes are publicly readable
alter table public.market_indexes enable row level security;
drop policy if exists "market_indexes_select_public" on public.market_indexes;
create policy "market_indexes_select_public" on public.market_indexes
  for select using (true);

-- Market index values are publicly readable
alter table public.market_index_values enable row level security;
drop policy if exists "market_index_values_select_public" on public.market_index_values;
create policy "market_index_values_select_public" on public.market_index_values
  for select using (true);

-- Market index components are publicly readable
alter table public.market_index_components enable row level security;
drop policy if exists "market_index_components_select_public" on public.market_index_components;
create policy "market_index_components_select_public" on public.market_index_components
  for select using (true);

-- Investment packages: public ones are readable, private ones only by creator
alter table public.investment_packages enable row level security;
drop policy if exists "investment_packages_select" on public.investment_packages;
create policy "investment_packages_select" on public.investment_packages
  for select using (is_public = true or auth.uid() = created_by);

drop policy if exists "investment_packages_insert" on public.investment_packages;
create policy "investment_packages_insert" on public.investment_packages
  for insert with check (auth.uid() = created_by);

drop policy if exists "investment_packages_update" on public.investment_packages;
create policy "investment_packages_update" on public.investment_packages
  for update using (auth.uid() = created_by);

-- Package holdings: follow parent package visibility
alter table public.package_holdings enable row level security;
drop policy if exists "package_holdings_select" on public.package_holdings;
create policy "package_holdings_select" on public.package_holdings
  for select using (
    exists (
      select 1 from public.investment_packages ip
      where ip.id = package_holdings.package_id
        and (ip.is_public = true or auth.uid() = ip.created_by)
    )
  );

-- Projection outcomes are publicly readable (anonymized research data)
alter table public.projection_outcomes enable row level security;
drop policy if exists "projection_outcomes_select_public" on public.projection_outcomes;
create policy "projection_outcomes_select_public" on public.projection_outcomes
  for select using (true);

-- Analysis feedback: users can see their own feedback
alter table public.analysis_feedback enable row level security;
drop policy if exists "analysis_feedback_select" on public.analysis_feedback;
create policy "analysis_feedback_select" on public.analysis_feedback
  for select using (auth.uid() = user_id);

drop policy if exists "analysis_feedback_insert" on public.analysis_feedback;
create policy "analysis_feedback_insert" on public.analysis_feedback
  for insert with check (auth.uid() = user_id);

-- ============================================================================
-- SEED DATA: Create initial indexes
-- ============================================================================

-- SQBDY-50: Squarebody 50 Index (top 50 most-traded squarebodies by price)
insert into public.market_indexes (index_code, index_name, description, calculation_method)
values (
  'SQBDY-50',
  'Squarebody 50 Index',
  'Top 50 most actively traded squarebody trucks (1973-1991 Chevrolet/GMC C/K) based on recent pricing data',
  '{
    "type": "price_weighted",
    "top_n": 50,
    "filters": {
      "year_min": 1973,
      "year_max": 1991,
      "makes": ["Chevrolet", "GMC"],
      "models": ["C10", "C20", "C30", "K10", "K20", "K30"]
    },
    "criteria": "vehicles with recent sale prices, sorted by listing activity"
  }'::jsonb
)
on conflict (index_code) do nothing;

-- CLSC-100: Classic 100 (100 highest-value classic vehicles)
insert into public.market_indexes (index_code, index_name, description, calculation_method)
values (
  'CLSC-100',
  'Classic 100 Index',
  '100 highest-value classic vehicles tracked across all makes and models',
  '{
    "type": "value_weighted",
    "top_n": 100,
    "filters": {
      "year_max": 1995,
      "has_price": true
    },
    "criteria": "highest sale prices, minimum $25k"
  }'::jsonb
)
on conflict (index_code) do nothing;

-- PROJ-ACT: Project Activity Index (build momentum indicator)
insert into public.market_indexes (index_code, index_name, description, calculation_method)
values (
  'PROJ-ACT',
  'Project Activity Index',
  'Tracks market momentum for project vehicles and builds based on listing velocity',
  '{
    "type": "activity_score",
    "filters": {
      "keywords": ["project", "restore", "build", "custom"]
    },
    "criteria": "listing frequency and engagement metrics"
  }'::jsonb
)
on conflict (index_code) do nothing;

-- MKTV-USD: Market Velocity (transaction volume * avg price delta)
insert into public.market_indexes (index_code, index_name, description, calculation_method)
values (
  'MKTV-USD',
  'Market Velocity Index',
  'Overall market momentum measured by transaction volume and price movement',
  '{
    "type": "velocity_composite",
    "components": ["listing_count", "avg_price_change", "time_on_market"],
    "criteria": "composite index of market health"
  }'::jsonb
)
on conflict (index_code) do nothing;

commit;

-- ============================================================================
-- SUCCESS
-- ============================================================================
comment on schema public is 'Market Intelligence schema deployed successfully';
