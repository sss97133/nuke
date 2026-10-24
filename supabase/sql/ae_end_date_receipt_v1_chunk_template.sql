begin;
set statement_timeout='170s';
create temp table _c on commit drop as
with ae as (select id, vehicle_id, rtrim(source_url,'/') u from public.auction_events
  where auction_end_date is null and source_url is not null
    and vehicle_id between '00000000-0000-0000-0000-000000000000' and '03ffffff-ffff-ffff-ffff-ffffffffffff'),
r as (select ae.id, min(o.id::text)::uuid oid, min((o.structured_data->'source_sale_receipt'->>'event_day')::date) dd,
        count(distinct o.structured_data->'source_sale_receipt'->>'event_day') ndays,
        min(o.structured_data->'source_sale_receipt'->>'source_sha256') sha
  from ae join public.vehicle_observations o on o.vehicle_id=ae.vehicle_id and o.kind='sale_result'
   and o.extraction_method='protected_archived_sale_observation_v1' and coalesce(o.is_superseded,false)=false
   and rtrim(o.structured_data->'source_sale_receipt'->>'source_url','/')=ae.u
   and o.structured_data->'source_sale_receipt'->>'event_day' is not null
  group by ae.id)
select * from r where ndays=1;
insert into public.auction_event_end_date_provenance (auction_event_id, old_end_date, new_end_date, precision, source, evidence_observation_id, run_id)
select id, null, (dd::timestamp at time zone 'UTC'), 'day',
  'vehicle_observations/'||oid||' source_sale_receipt.event_day (protected archived page, sha256:'||coalesce(sha,'?')||')', oid, 'ae_end_date_receipt_v1_20261024'
from _c;
update public.auction_events e set auction_end_date = (c.dd::timestamp at time zone 'UTC')
from _c c where e.id=c.id and e.auction_end_date is null;
commit;
