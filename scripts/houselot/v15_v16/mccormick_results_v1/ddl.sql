create table if not exists public.mccormick_results_stage_v1_20261024(
 id bigserial primary key, run_id text not null default 'mccormick_results_v1_20261024', auction_nbr int not null, sale_month date not null,
 sale_dates_text text, sale_dates_source_url text, lot_number text not null, year text, make text, model text, price_usd numeric, status text not null,
 price_note text not null default 'McCormick results pages: sold prices include buyer fee (5-6%); no_sale price is high bid',
 source_url text not null, fetched_at timestamptz not null default now(), unique(auction_nbr,lot_number,make,model,price_usd));
comment on table public.mccormick_results_stage_v1_20261024 is 'Staging only (no vehicles): McCormick Palm Springs results, cited per row; revert = drop table.';
