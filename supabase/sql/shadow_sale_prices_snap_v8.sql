-- v8 comp snapshot (run 7e1d0c24-2026-4a10-9e00-0000000a5019) = snap_v7 refreshed from view (Bonhams dates run a5018, fx) + Collecting Cars ve rows (run a5017). Revert: drop table public.shadow_sale_prices_snap_v8;
begin;
create table public.shadow_sale_prices_snap_v8 (like public.shadow_sale_prices_snap_v7 including defaults);
alter table public.shadow_sale_prices_snap_v8 add column source_tbl text;
alter table public.shadow_sale_prices_snap_v8 enable row level security;
revoke all on public.shadow_sale_prices_snap_v8 from anon, authenticated;
insert into public.shadow_sale_prices_snap_v8
select s.auction_event_id, s.vehicle_id, s.make_l, s.model_l, s.year, s.platform, coalesce(s.sold_at, v.sold_at),
 case when s.sold_at is null and v.sold_at is not null then 'auction_end_date_backfill_log:7e1d0c24-2026-4a10-9e00-0000000a5018' else s.sold_at_source end,
 s.currency_code, s.price_basis_reported, s.hammer_price, s.gross_price, s.net_to_owner, s.snap_v5_hammer,
 '7e1d0c24-2026-4a10-9e00-0000000a5019', now(), coalesce(v.fx_to_usd, s.fx_to_usd), coalesce(v.hammer_price_usd, s.hammer_price_usd), coalesce(v.fx_to_usd_source, s.fx_to_usd_source), 'auction_events'
from public.shadow_sale_prices_snap_v7 s left join public.shadow_sale_prices v on v.auction_event_id=s.auction_event_id and v.source_tbl='auction_events';
insert into public.shadow_sale_prices_snap_v8
select v.auction_event_id, v.vehicle_id, lower(trim(ve.make)), lower(trim(ve.model)), ve.year, v.platform, v.sold_at, case when v.source_tbl='vehicle_events' then 'vehicle_events.sold_at' else 'auction_events.auction_end_date' end, v.currency_code, v.price_basis_reported, v.hammer_price, v.gross_price, v.net_to_owner, null,
 '7e1d0c24-2026-4a10-9e00-0000000a5019', now(), v.fx_to_usd, v.hammer_price_usd, v.fx_to_usd_source, v.source_tbl
from public.shadow_sale_prices v left join public.vehicles ve on ve.id=v.vehicle_id
where not exists (select 1 from public.shadow_sale_prices_snap_v7 s where s.auction_event_id=v.auction_event_id);
create index on public.shadow_sale_prices_snap_v8 (auction_event_id);
select platform, count(*) n, count(sold_at) dated, count(hammer_price_usd) usd, count(*) filter (where hammer_price_usd is not null and sold_at is not null and year is not null) usable from public.shadow_sale_prices_snap_v8 where platform in ('bonhams','collecting-cars') group by 1
union all select 'ALL', count(*), count(sold_at), count(hammer_price_usd), count(*) filter (where hammer_price_usd is not null and sold_at is not null and year is not null) from public.shadow_sale_prices_snap_v8;
commit;
