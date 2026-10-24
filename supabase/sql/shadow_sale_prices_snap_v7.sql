-- v7 comp snapshot (run 7e1d0c24-2026-4a10-9e00-0000000a5014). New table; revert: drop table public.shadow_sale_prices_snap_v7;
begin;
create table public.shadow_sale_prices_snap_v7 (like public.shadow_sale_prices_snap_v6 including defaults);
alter table public.shadow_sale_prices_snap_v7 add column fx_to_usd numeric, add column hammer_price_usd numeric, add column fx_to_usd_source text;
alter table public.shadow_sale_prices_snap_v7 enable row level security;
revoke all on public.shadow_sale_prices_snap_v7 from anon, authenticated;
insert into public.shadow_sale_prices_snap_v7
select s.auction_event_id, s.vehicle_id, s.make_l, s.model_l, s.year, s.platform, s.sold_at, s.sold_at_source, s.currency_code, s.price_basis_reported, s.hammer_price, s.gross_price, s.net_to_owner, s.snap_v5_hammer,
 '7e1d0c24-2026-4a10-9e00-0000000a5014', now(), v.fx_to_usd, coalesce(v.hammer_price_usd, case when s.currency_code='USD' then s.hammer_price end), v.fx_to_usd_source
from public.shadow_sale_prices_snap_v6 s left join public.shadow_sale_prices v on v.auction_event_id=s.auction_event_id;
insert into public.shadow_sale_prices_snap_v7
select v.auction_event_id, v.vehicle_id, lower(trim(ve.make)), lower(trim(ve.model)), ve.year, v.platform, v.sold_at, case when v.sold_at is not null then 'auction_events.auction_end_date' end, v.currency_code, v.price_basis_reported, v.hammer_price, v.gross_price, v.net_to_owner, null,
 '7e1d0c24-2026-4a10-9e00-0000000a5014', now(), v.fx_to_usd, v.hammer_price_usd, v.fx_to_usd_source
from public.shadow_sale_prices v left join public.vehicles ve on ve.id=v.vehicle_id
where not exists (select 1 from public.shadow_sale_prices_snap_v6 s where s.auction_event_id=v.auction_event_id);
create index on public.shadow_sale_prices_snap_v7 (auction_event_id);
select platform, currency_code, count(*) n, count(hammer_price_usd) usd, count(*) filter (where hammer_price_usd is not null and sold_at is not null and year is not null) usable from public.shadow_sale_prices_snap_v7 where platform='bonhams' or currency_code<>'USD' group by 1,2
union all select 'ALL','', count(*), count(hammer_price_usd), count(*) filter (where hammer_price_usd is not null and sold_at is not null and year is not null) from public.shadow_sale_prices_snap_v7;
commit;
