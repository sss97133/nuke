begin;
create temp table bon_c on commit drop as
with u as (select ae.id, ae.vehicle_id, ae.source_url, ae.created_at, substring(ae.source_url from 'auction/(\d+)/lot/(\w+)') ak, (regexp_match(ae.source_url,'auction/(\d+)/lot/(\w+)')) km from auction_events ae join shadow_sale_prices s on s.auction_event_id=ae.id where ae.source='bonhams' and ae.auction_end_date is null and exists (select 1 from vehicles v where v.id=ae.vehicle_id)),
c as (select u.id ae_id, ve.id ve_id, ve.sold_at, ve.created_at ve_created, u.created_at ae_created,
   case when ve.source_url=u.source_url then 'url' else 'lot_key' end tier
   from u join vehicle_events ve on ve.vehicle_id=u.vehicle_id and ve.source_platform='bonhams' and ve.sold_at is not null
   where ve.source_url=u.source_url or (u.km is not null and (regexp_match(ve.source_url,'auction/(\d+)/lot/(\w+)')) = u.km))
select distinct on (ae_id) * , (select count(distinct c2.sold_at::date) from c c2 where c2.ae_id=c.ae_id) nd from c order by ae_id, (tier='url') desc, ve_id;
insert into auction_end_date_backfill_log (auction_event_id, run_id, old_value, new_value, source_table, source_column, source_row_id, created_at)
select ae_id, '7e1d0c24-2026-4a10-9e00-0000000a5018', null, sold_at, 'vehicle_events', case tier when 'url' then 'sold_at (same vehicle_id + source_url)' else 'sold_at (same vehicle_id + bonhams auction/lot key)' end, ve_id::text, now()
from bon_c where nd=1 and sold_at<now() and sold_at::date<>ae_created::date and sold_at::date<>ve_created::date;
update auction_events ae set auction_end_date=l.new_value from auction_end_date_backfill_log l where l.run_id='7e1d0c24-2026-4a10-9e00-0000000a5018' and l.auction_event_id=ae.id and ae.auction_end_date is null;
insert into price_basis_backfill_queue_v3 (tbl,id,run_id) select 'auction_events', auction_event_id, '7e1d0c24-2026-4a10-9e00-0000000a5018' from auction_end_date_backfill_log where run_id='7e1d0c24-2026-4a10-9e00-0000000a5018';
select backfill_price_basis_batch_v3('auction_events','7e1d0c24-2026-4a10-9e00-0000000a5018',2000);
commit;
