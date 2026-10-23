create table if not exists public.advisor_make_price_index (
  make text not null, month date not null, idx double precision not null,
  method text not null default 'cohort_demeaned_log_median_6mo_n5', fitted_at timestamptz not null default now(),
  primary key (make, month));
comment on table public.advisor_make_price_index is 'Monthly log price index per make (lower-cased), fitted 2026-10-22 from 353k sold events (bt4 backtest). Used by mcp-connector advisor to time-adjust comps.';
alter table public.advisor_make_price_index enable row level security;
drop policy if exists advisor_make_price_index_read on public.advisor_make_price_index;
create policy advisor_make_price_index_read on public.advisor_make_price_index for select using (true);
grant select on public.advisor_make_price_index to anon, authenticated, service_role;

-- data loaded separately from nuke-strategy/bt4/res/make_index.csv
