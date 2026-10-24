set statement_timeout='55s';
with ex as (select (regexp_match(e.source_url,'-(\d+)/?$'))[1] item, min(e.id::text)::uuid id
  from public.vehicle_events e where e.source_platform='barrettjackson' and e.source_url ~ '/docket/vehicle/' group by 1)
update public.bj_results_stage_v1_20261024 s set existing_event_id=ex.id from ex where ex.item=s.item_id and s.existing_event_id is null;
select count(*) n, count(existing_event_id) existing, count(*) filter (where existing_event_id is null and is_sold and price_usd>0) new_sold from public.bj_results_stage_v1_20261024;
