-- PREPARED, NOT APPLIED. Run only after price_basis backfill (cron 667) unschedules itself
-- (price_basis_backfill_queue has no rows with done_at is null).
-- Swaps shadow_sale_prices to the first-class columns. Revert: re-apply the view def saved below.
begin;
create table if not exists public.shadow_view_defs_backup as
  select 'shadow_sale_prices'::text as view_name, pg_get_viewdef('public.shadow_sale_prices'::regclass) as def, now() as saved_at;
create or replace view public.shadow_sale_prices as
select ae.id as auction_event_id, ae.vehicle_id, ae.source as platform, ae.auction_end_date as sold_at,
       coalesce(ae.currency_code,'USD') as currency_code, ae.price_basis as price_basis_reported,
       'hammer'::text as price_basis, ae.hammer_price, ae.gross_price, ae.net_to_owner
from public.auction_events ae
where ae.outcome='sold' and ae.hammer_price >= 1000
  and not (coalesce(ae.raw_data,'{}'::jsonb) ? 'duplicate_of');
commit;
-- Revert: do $$ begin execute 'create or replace view public.shadow_sale_prices as '||(select def from public.shadow_view_defs_backup where view_name='shadow_sale_prices' order by saved_at limit 1); end $$;
