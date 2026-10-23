-- Rollback of 20261025140000. First restore data runs: select revert_price_basis_run_v2('<run_id>') for each v3 run,
-- and the price_kind / lot_category / sale_type population reverts (nuke-strategy/*-revert.sql). Then:
-- restore derive_price_components_v2 from 20261024090000_price_basis_tiers_observations.sql (re-run that function block).
drop function if exists public.backfill_price_basis_batch_v3(text, text, int);
drop table if exists public.price_basis_backfill_queue_v3;
delete from public.platform_fee_schedule where sale_type <> 'any' or lot_class = 'non_car'
   or (platform = 'broad_arrow' and lot_class = 'car') or (platform in ('barrettjackson','barrett-jackson') and rate = 0.08);
alter table public.platform_fee_schedule drop constraint if exists platform_fee_schedule_lot_class_check;
alter table public.platform_fee_schedule add constraint platform_fee_schedule_lot_class_check check (lot_class in ('any','car','motorcycle'));
alter table public.platform_fee_schedule drop column if exists sale_type;
drop table if exists public.platform_lot_category_class;
update public.price_basis_observation set superseded_at = coalesce(superseded_at, now()) where kind in ('observed_page_status','pattern_resolution');
-- (kind constraint is left widened so the superseded rows stay readable)
-- the new event columns are left in place (nullable, unused once v3 is gone); drop them only after confirming no reader:
-- alter table public.vehicle_events drop column price_kind, drop column price_kind_source, drop column lot_category, drop column lot_category_source, drop column sale_type, drop column sale_type_source;
-- alter table public.auction_events  (same)
