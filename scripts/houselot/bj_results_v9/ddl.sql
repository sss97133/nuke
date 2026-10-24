begin; set local statement_timeout='50s'; set local lock_timeout='5s';
-- run bj_results_v1_20261024: staged Barrett-Jackson past results read from the public results API
-- (https://www.barrett-jackson.com/api/previous-docket-results?slug=<event>&type=vehicles), 1999-2020 events. Staging only: no vehicles.
create table if not exists public.bj_results_stage_v1_20261024 (
  item_id text primary key, event_slug text not null, lot_number text, title text, year int, make text, model text, style text, vin text,
  price_usd numeric, is_sold boolean, is_charity boolean, is_canceled boolean, reserve_type text, run_datetime timestamp,
  lot_url text not null, api_url text not null,
  fee_basis text not null default 'gross_incl_premium', buyer_premium_rate numeric default 0.10,
  fee_basis_source text not null default 'barrett-jackson.com results prices are premium-inclusive (house fee schedule 10%, same basis as stored B-J events price_basis_v3_20261023); hammer derived = price/1.10',
  hammer_price_derived numeric, read_at timestamptz not null, run_id text not null default 'bj_results_v1_20261024',
  existing_event_id uuid, vin_vehicle_id uuid, vin_match_n int, attached_cc_event_id uuid, inserted_house_event_id uuid, note text);
alter table public.bj_results_stage_v1_20261024 enable row level security;
commit;
