-- Applied 2026-10-23 after price_basis backfill crons 667/670 finished. Originally prepared, not applied. Run only after price_basis backfill (cron 667) unschedules itself
-- (price_basis_backfill_queue has no rows with done_at is null).
-- Swaps shadow_sale_prices to the first-class columns. Revert: re-apply the view def saved below.
begin;
create table if not exists public.shadow_view_defs_backup (view_name text not null, def text not null, saved_at timestamptz not null default now());
alter table public.shadow_view_defs_backup enable row level security;
revoke all on public.shadow_view_defs_backup from anon, authenticated;
insert into public.shadow_view_defs_backup (view_name, def, saved_at)
  select 'shadow_sale_prices', pg_get_viewdef('public.shadow_sale_prices'::regclass), now();
create or replace view public.shadow_sale_prices with (security_invoker = true) as
select ae.id as auction_event_id, ae.vehicle_id, ae.source as platform, ae.auction_end_date as sold_at,
       coalesce(ae.currency_code,'USD') as currency_code, ae.price_basis::text as price_basis_reported,
       'hammer'::text as price_basis, ae.hammer_price, ae.gross_price, ae.net_to_owner
from public.auction_events ae
where ae.outcome='sold' and ae.hammer_price >= 1000
  and not (coalesce(ae.raw_data,'{}'::jsonb) ? 'duplicate_of');
commit;
-- Revert: do $$ begin execute 'create or replace view public.shadow_sale_prices with (security_invoker = true) as '||(select def from public.shadow_view_defs_backup where view_name='shadow_sale_prices' order by saved_at desc limit 1); end $$;
