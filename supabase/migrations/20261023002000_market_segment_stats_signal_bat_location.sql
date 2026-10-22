-- Additive only. Revert: drop table market_segment_stats, market_signal, bat_seller_locations.
create table if not exists public.market_segment_stats (
  id bigserial primary key, run_id text not null, segment text not null, make text not null, era text not null,
  n int not null, median_price numeric not null, p25 numeric, p75 numeric,
  make_3y_pct numeric, era_3y_pct numeric, era_vol_pct numeric,
  window_start date, as_of date not null, created_at timestamptz not null default now(), unique(run_id, segment));
create table if not exists public.market_signal (
  id bigserial primary key, run_id text not null unique, as_of date not null,
  label text not null check (label in ('heating','cooling','flat')),
  next6_pct numeric, band_low_pct numeric, band_high_pct numeric,
  gate_passed boolean not null default false,  -- false = label only; never a price forecast in product copy
  note text, created_at timestamptz not null default now());
create table if not exists public.bat_seller_locations (
  id bigserial primary key, snapshot_id uuid not null unique, listing_url text not null,
  location_raw text not null, city text, region text, country text, zip text,
  run_id text not null, extracted_at timestamptz not null default now());
create index if not exists bat_seller_locations_url on public.bat_seller_locations(listing_url);
alter table public.market_segment_stats enable row level security;
alter table public.market_signal enable row level security;
alter table public.bat_seller_locations enable row level security;
