begin;
set local statement_timeout='55s'; set local lock_timeout='5s';
-- Run agg_houselot_v16_20261024 (v9 rules unchanged): the 9 held events whose cited conceptcarz page names a B-J sale (B-J gap), lots matched by that cited sale's event slug; matched to a staged B-J results lot
-- (bj_results_stage_v1_20261024, read from https://www.barrett-jackson.com/api/previous-docket-results, run bj_results_v1_20261024) that is not yet an event.
-- Gates (v7 + engine rule): cand9 unique (year + every cc title word in the lot slug, same sale window); one cc event per lot; lot cited (lot number + URL);
-- staged lot sold with a price; the lot VIN (>=8 chars, normalized) matches exactly ONE live existing vehicle (created before 2026-10-24, not merged/deleted,
-- year = title year, no year_suspect, not rm_ingest_v1) = confirmed identity; cc event still flagged vehicle_id, not verified/contradicted; price within 20% USD;
-- engine words (hemi, 427 ci, 4.0l ...) agree on both sides; held if the cc price equals a different existing sale of the target (and not the lot price). Writes: one B-J house event per lot on that vehicle (price premium-inclusive, fee basis recorded),
-- the cc event attached to it (same_lot), copied price marked untrusted as v5. Creates/merges no vehicles. Unmatched lots stay in the staging table only.
create table if not exists public.backup_agg_houselot_v16_20261024 (
  event_id uuid primary key, from_vehicle_id uuid not null, to_vehicle_id uuid not null, item_id text not null, house_event_id uuid not null, lot_number text,
  old_source_suspect text[], old_source_suspect_reason text, old_source_suspect_run_id text, old_source_suspect_at timestamptz,
  old_metadata jsonb, final_price numeric, from_sale_price integer, from_marked boolean, run_id text not null, moved_at timestamptz not null default now());
alter table public.backup_agg_houselot_v16_20261024 enable row level security;
create temp table v16 on commit drop as
with c as materialized (
  select c.event_id, c.from_vehicle_id, c.cc_url, c.bj_slug, c.title, c.title_year, c.win_lo, c.win_hi, s.item_id, s.lot_number, s.lot_url, s.api_url, s.price_usd, s.hammer_price_derived,
    s.run_datetime, s.title bjt, s.vin, s.read_at, upper(regexp_replace(coalesce(s.vin,''),'[^A-Za-z0-9]','','g')) nv,
    (select count(*) from public.agg_houselot_v16_20261024_cand9 x where x.item_id=c.item_id and x.n9b=1) k
  from public.agg_houselot_v16_20261024_cand9 c join public.bj_results_stage_v1_20261024 s using(item_id)
  where c.n9b=1 and s.existing_event_id is null and s.is_sold and s.price_usd>0 and s.lot_number is not null and not coalesce(s.is_canceled,false)
), vm as (
  select c.event_id, count(*) n, (array_agg(v.id))[1] vid from c join public.vehicles v on upper(trim(both from v.vin))=c.nv
  where length(c.nv)>=8 and v.deleted_at is null and v.status is distinct from 'merged' and v.merged_into_vehicle_id is null group by 1
)
select c.*, vm.vid to_vehicle_id, e.final_price, e.source_suspect, e.source_suspect_reason, e.source_suspect_run_id, e.source_suspect_at, e.metadata, v.sale_price from_sale_price,
  gen_random_uuid() house_event_id
from c join vm using(event_id)
join public.vehicles tv on tv.id=vm.vid and tv.created_at<'2026-10-24' and tv.year=c.title_year and not coalesce(tv.data_quality_flags ? 'year_suspect',false)
join public.vehicle_events e on e.id=c.event_id and e.vehicle_id=c.from_vehicle_id
join public.vehicles v on v.id=c.from_vehicle_id
where vm.n=1 and c.k=1
  and 'vehicle_id'=any(coalesce(e.source_suspect,'{}'))
  and e.price_verification is distinct from 'contradicted' and (e.price_verification='verified' and e.event_status='sold') is not true
  and upper(coalesce(e.currency_code,'USD'))='USD' and e.final_price is not null
  and abs(e.final_price-c.price_usd)/c.price_usd <= 0.20
  and not exists (select 1 from public.vehicle_events r where r.vehicle_id=vm.vid and r.extraction_run_id='rm_ingest_v1_20261024')
  and not (e.final_price<>c.price_usd and exists (select 1 from public.vehicle_events o where o.vehicle_id=vm.vid and o.id<>e.id and o.final_price=e.final_price and o.source_url not like 'conceptcarz:%'))  -- cc price equals a different existing sale of that vehicle: cc likely copies that sale
  and (select coalesce(array_agg(distinct replace(m[1],' ','') order by replace(m[1],' ','')),'{}') from regexp_matches(regexp_replace(lower(c.title),'(\d)[ -](\d)\s*l\M','\1.\2l','g'),'\m(hemi|sohc|dohc|boss|supercharged|[0-9]{3}(?=[ -]*(?:ci|cid|cu|cubic)\M)|[0-9]\.[0-9] ?l)\M','g') m)
    = (select coalesce(array_agg(distinct replace(m[1],' ','') order by replace(m[1],' ','')),'{}') from regexp_matches(regexp_replace(lower(c.bjt),'(\d)[ -](\d)\s*l\M','\1.\2l','g'),'\m(hemi|sohc|dohc|boss|supercharged|[0-9]{3}(?=[ -]*(?:ci|cid|cu|cubic)\M)|[0-9]\.[0-9] ?l)\M','g') m);
insert into public.vehicle_events (id, vehicle_id, source_platform, source_url, source_listing_id, event_type, event_status, sold_at, sold_at_precision, final_price,
  gross_price, gross_price_source, gross_price_confidence, hammer_price, hammer_price_source, hammer_price_confidence, buyer_premium_rate, buyer_premium_amount,
  buyer_premium_source, buyer_premium_confidence, price_basis, price_basis_run_id, currency_code, currency_source, fx_to_usd, fx_to_usd_source, price_kind, price_kind_source,
  lot_number, lot_number_source_url, lot_number_run_id, lot_number_read_at, identity_check, identity_check_vehicle_vin, identity_check_source, identity_check_run_id, identity_check_at,
  extraction_run_id, extraction_method, extraction_source, extracted_at, metadata)
select house_event_id, to_vehicle_id, 'barrettjackson', lot_url, 'barrett-jackson.com/'||substring(lot_url from 'barrett-jackson\.com/(.*)$'), 'auction', 'sold', run_datetime, 'run_datetime',
  price_usd, price_usd, 'barrett-jackson.com results price (premium-inclusive) '||api_url, 'reported', hammer_price_derived, 'platform_fee_schedule:10 https://www.barrett-jackson.com/',
  'derived_from_gross_schedule_dated', 0.10, price_usd-hammer_price_derived, 'platform_fee_schedule:10 https://www.barrett-jackson.com/', 'derived_from_gross_schedule_dated',
  'gross_incl_premium', 'agg_houselot_v16_20261024', 'USD', 'barrett-jackson.com lists prices in USD', 1, 'identity: amount already in USD', 'sale', 'barrett-jackson.com results is_sold=true',
  lot_number, lot_url, 'bj_results_v1_20261024', read_at, 'match', nv, 'barrett-jackson.com results VIN '||nv||' = vehicles.vin (unique live vehicle)', 'agg_houselot_v16_20261024', now(),
  'agg_houselot_v16_20261024', 'bj_results_api', api_url, read_at,
  jsonb_build_object('bj_item_id', item_id, 'bj_title', bjt, 'fee_basis', 'gross_incl_premium', 'citation', 'B-J lot '||lot_number||' '||lot_url||' price $'||price_usd||' (premium-inclusive; hammer derived at 10%) read '||api_url, 'run_id','agg_houselot_v16_20261024')
from v16;
insert into public.backup_agg_houselot_v16_20261024 (event_id, from_vehicle_id, to_vehicle_id, item_id, house_event_id, lot_number, old_source_suspect, old_source_suspect_reason,
  old_source_suspect_run_id, old_source_suspect_at, old_metadata, final_price, from_sale_price, from_marked, run_id)
select event_id, from_vehicle_id, to_vehicle_id, item_id, house_event_id, lot_number, source_suspect, source_suspect_reason, source_suspect_run_id, source_suspect_at, metadata, final_price, from_sale_price,
  (final_price is not null and from_sale_price=final_price and to_vehicle_id<>from_vehicle_id and public.vehicle_sale_price_untrusted(from_vehicle_id, from_sale_price)), 'agg_houselot_v16_20261024' from v16;
insert into public.vehicle_sale_price_untrusted_marks (vehicle_id, sale_price, reason, source_event_id, run_id)
select b.from_vehicle_id, b.from_sale_price, 'sale price was copied from conceptcarz event '||b.event_id||', moved to vehicle '||b.to_vehicle_id||' of B-J lot '||b.lot_number||' (house event '||b.house_event_id||')', b.event_id, 'agg_houselot_v16_20261024'
from public.backup_agg_houselot_v16_20261024 b where b.from_marked on conflict do nothing;
update public.vehicle_events e set vehicle_id=v16.to_vehicle_id,
  source_suspect = nullif(array_remove(coalesce(e.source_suspect,'{}'),'vehicle_id'),'{}'),
  source_suspect_reason = concat_ws('; ', nullif(e.source_suspect_reason,''), 'attached to B-J lot '||v16.lot_number||' house event '||v16.house_event_id||' (run agg_houselot_v16_20261024)'),
  source_suspect_run_id='agg_houselot_v16_20261024', source_suspect_at=now(),
  metadata = coalesce(e.metadata,'{}'::jsonb) || jsonb_build_object('attach_basis', jsonb_build_object('kind','same_lot','cited_event_id', v16.house_event_id, 'lot_number', v16.lot_number,
    'citation', 'bj house lot '||v16.lot_number||' '||v16.lot_url||' price $'||v16.price_usd||' premium-inclusive (read '||v16.api_url||')',
    'match_rule', 'cited conceptcarz page '||v16.cc_url||' names B-J sale '||v16.bj_slug||' ['||v16.win_lo||','||v16.win_hi||'] + year + every title word in the B-J lot slug, unique among staged lots (cand9); lot VIN '||v16.nv||' = one live existing vehicle; price within 20% USD; engine words agree',
    'from_vehicle_id', v16.from_vehicle_id, 'run_id','agg_houselot_v16_20261024'))
from v16 where e.id=v16.event_id;
update public.bj_results_stage_v1_20261024 s set inserted_house_event_id=v16.house_event_id, attached_cc_event_id=v16.event_id, vin_vehicle_id=v16.to_vehicle_id, note='agg_houselot_v16_20261024 attached'
from v16 where s.item_id=v16.item_id;
select count(*) n, count(*) filter (where from_vehicle_id<>to_vehicle_id) moved, count(*) filter (where from_marked) marked,
  (select count(*) from public.vehicle_events e join public.backup_agg_houselot_v16_20261024 k on k.event_id=e.id where e.vehicle_id=k.to_vehicle_id and public.aggregator_event_attach_basis(e.id,e.vehicle_id,e.source_url,e.source_platform,e.metadata) in ('same_lot','vin_match')) guard_ok,
  (select count(*) from public.vehicle_events where extraction_run_id='agg_houselot_v16_20261024') house_events,
  (select jsonb_agg(left(event_id::text,8)||' '||lot_number||' '||final_price) from public.backup_agg_houselot_v16_20261024) rows
from public.backup_agg_houselot_v16_20261024;


create temp table t16 on commit drop as select count(*) n, count(*) filter (where from_vehicle_id<>to_vehicle_id) moved from public.backup_agg_houselot_v16_20261024;
set local statement_timeout='55s'; set local lock_timeout='5s';
-- Revert run agg_houselot_v16_20261024 without deleting anything:
-- 1) cc events back to their from-vehicle with original suspect fields/metadata (from backup); 2) untrusted marks retired;
-- 3) the inserted B-J house events are retracted in place (event_status 'cancelled', source_suspect vehicle_id, reason) - rows kept;
-- 4) staging rows unlinked. Staging table and backup are kept (rename to retired_* if wanted).
set local session_replication_role = replica;
update public.vehicle_events e set vehicle_id=b.from_vehicle_id, source_suspect=b.old_source_suspect, source_suspect_reason=b.old_source_suspect_reason,
  source_suspect_run_id=b.old_source_suspect_run_id, source_suspect_at=b.old_source_suspect_at, metadata=b.old_metadata
from public.backup_agg_houselot_v16_20261024 b where e.id=b.event_id and e.source_suspect_run_id='agg_houselot_v16_20261024';
update public.vehicle_sale_price_untrusted_marks set retired_at=now() where run_id='agg_houselot_v16_20261024' and retired_at is null;
update public.vehicle_events e set event_status='cancelled', source_suspect=array['vehicle_id'], source_suspect_reason='retracted: revert of run agg_houselot_v16_20261024',
  source_suspect_run_id='revert_agg_houselot_v16_20261024', source_suspect_at=now()
from public.backup_agg_houselot_v16_20261024 b where e.id=b.house_event_id and e.extraction_run_id='agg_houselot_v16_20261024';
update public.bj_results_stage_v1_20261024 set inserted_house_event_id=null, attached_cc_event_id=null, note='reverted agg_houselot_v16_20261024' where note='agg_houselot_v16_20261024 attached';


select (select n from t16) attached_in_test, (select count(*) from public.backup_agg_houselot_v16_20261024 b join public.vehicle_events e on e.id=b.event_id where e.vehicle_id<>b.from_vehicle_id) left_after_revert, (select count(*) from public.vehicle_events where extraction_run_id='agg_houselot_v16_20261024' and event_status<>'cancelled') live_house_events;
rollback;
