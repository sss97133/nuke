-- Additive + reversible: structured seller fees on platform_fee_schedules (current rows only).
-- Revert: supabase/sql/revert/20261022201000_seller_fees_revert.sql (restores from backup table, drops columns).
alter table public.platform_fee_schedules
  add column if not exists seller_commission_pct numeric,
  add column if not exists seller_commission_pct_no_reserve numeric,
  add column if not exists seller_commission_min numeric,
  add column if not exists seller_entry_fee_min numeric,
  add column if not exists seller_entry_fee_max numeric,
  add column if not exists seller_listing_fee numeric,
  add column if not exists seller_fee_basis text check (seller_fee_basis in ('published','negotiated_not_published','none')),
  add column if not exists seller_fee_source_url text,
  add column if not exists seller_fee_source_quote text,
  add column if not exists seller_fee_fetched_at date,
  add column if not exists seller_fee_run_id text;
create table if not exists public.platform_fee_schedules_backup_20261022 as
  select id, seller_fee_note from public.platform_fee_schedules;
alter table public.platform_fee_schedules_backup_20261022 enable row level security;
with v(k, pct, pct_nr, cmin, emin, emax, lfee, basis, url, quote) as (values
 ('mecum',10,6,1000,350,1000,null,'published','https://www.mecum.com/faq/','Consignment entry fees run from $350 - $1000 plus a 6% seller''s commission (no reserve) or 10% seller commission (reserve)... Seller''s commissions are only charged if the vehicle is sold. (Min commission $1,000 Wed-Sat per position request forms, e.g. https://cdn1.mecum.com/consignments/pdf_files/SC0520_rfp.pdf)'),
 ('barrettjackson',10,8,null,null,null,null,'published','https://www.barrett-jackson.com/media/articles/easy-steps-to-selling-your-collector-car-how-to-become-a-consignor-at-barrett-jackson','The consignor signs the contract agreeing to pay a seller''s commission of 8 percent of the hammer price on No Reserve vehicles and 10 percent on Reserve vehicles, pays the entry fee (based on the day and time of the Lot number). Entry fee not published.'),
 ('bat',0,0,null,null,null,99,'published','https://bringatrailer.com/how-bat-works/','$99 listing fee; no other seller fees'),
 ('carsandbids',0,0,null,null,null,0,'published','https://carsandbids.com/faq/','Listing is free; sellers receive 100% of sale price'),
 ('pcarmarket',0,0,null,null,null,99,'published','https://www.pcarmarket.com/faq','$99 listing fee for Vehicles (race cars: 5% seller fee, min $500, max $7,500)'),
 ('gooding',null,null,null,null,null,null,'negotiated_not_published','https://bringatrailer.com/bat-guide-how-classic-car-auction-fees-work/','Sellers pay a commission that is privately negotiated and typically between 0% and 15%'),
 ('rmsothebys',null,null,null,null,null,null,'negotiated_not_published','https://bringatrailer.com/bat-guide-how-classic-car-auction-fees-work/','Sellers pay a commission that is privately negotiated and typically between 0% and 15%'),
 ('bonhams',null,null,null,null,null,null,'negotiated_not_published','https://fullysorted.com/research/where-to-buy','Live-sale seller commission not published (Cars Online: 7% of hammer plus VAT, capped at GBP 7,000)'),
 ('broadarrow',null,null,null,null,null,null,'negotiated_not_published','https://fullysorted.com/research/where-to-buy','Seller commission not published as a percentage'))
update public.platform_fee_schedules f set
  seller_commission_pct=v.pct, seller_commission_pct_no_reserve=v.pct_nr, seller_commission_min=v.cmin,
  seller_entry_fee_min=v.emin, seller_entry_fee_max=v.emax, seller_listing_fee=v.lfee, seller_fee_basis=v.basis,
  seller_fee_source_url=v.url, seller_fee_source_quote=v.quote, seller_fee_fetched_at=date '2026-10-22', seller_fee_run_id='fees-20261022'
from v where f.platform_key=v.k and f.effective_to is null;
