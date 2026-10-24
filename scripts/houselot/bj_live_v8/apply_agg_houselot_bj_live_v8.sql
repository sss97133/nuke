begin; set local statement_timeout='50s'; set local lock_timeout='5s';
-- Run agg_houselot_v8_20261024: flagged conceptcarz events with no B-J match in the 2026-10-24 snapshot, rematched against live B-J
-- sold events (cand8: year + make + first model word unique AND every title word in the lot slug unique, same house vehicle). Same gates as v7:
-- cited lot, one cc event per house event, not a verified/contradicted sale, price within 20% in USD, target created before 2026-10-24, live,
-- (a B-J source_listing_id that is a URL is not a lot; the cited lot_number is used) not rm_ingest_v1, no year_suspect, house event identity-confirmed. Creates/merges no vehicles.
create table if not exists public.backup_agg_houselot_v8_20261024 (
  event_id uuid primary key, from_vehicle_id uuid not null, to_vehicle_id uuid not null, cited_event_id uuid not null, lot_number text,
  old_source_suspect text[], old_source_suspect_reason text, old_source_suspect_run_id text, old_source_suspect_at timestamptz,
  old_attach_basis jsonb, final_price numeric, from_sale_price integer, from_marked boolean, fx jsonb, run_id text not null, moved_at timestamptz not null default now());
alter table public.backup_agg_houselot_v8_20261024 enable row level security;
with c0 as (
  select a.event_id, a.from_vehicle_id, a.to_vehicle_id, a.cited_event_id, a.house, a.title, a.win_lo, a.win_hi, he.source_url cited_url,
    case when (case when he.source_platform='mecum' and btrim(he.source_listing_id) !~ '^[A-Z]{1,3}[0-9]{1,4}(\.[0-9]{1,2})?$' then null when btrim(he.source_listing_id) ~ '[/.]' and he.source_listing_id !~ '^[0-9]+\.[0-9]{1,2}$' then null else nullif(btrim(he.source_listing_id),'') end) is null then he.lot_number_source_url end lot_src,
    coalesce(case when he.source_platform='mecum' and btrim(he.source_listing_id) !~ '^[A-Z]{1,3}[0-9]{1,4}(\.[0-9]{1,2})?$' then null when btrim(he.source_listing_id) ~ '[/.]' and he.source_listing_id !~ '^[0-9]+\.[0-9]{1,2}$' then null else nullif(btrim(he.source_listing_id),'') end, case when he.lot_number_source_url is not null then nullif(btrim(he.lot_number),'') end, substring(he.source_url from '(?i)bonhams\.com/auction/\d+/lot/([0-9A-Za-z]+)/')) lot,
    e.source_suspect, e.source_suspect_reason, e.source_suspect_run_id, e.source_suspect_at, e.metadata, e.final_price, v.sale_price from_sale_price,
    (select count(*) from public.agg_houselot_v1_20261024_cand8 x where x.cited_event_id=a.cited_event_id) k,
    he.final_price hp, he.event_status hs,
    upper(coalesce(he.currency_code,'USD')) hc, upper(coalesce(e.currency_code,'USD')) ec, coalesce(he.sold_at,he.ended_at)::date hd, coalesce(e.sold_at,e.ended_at,he.sold_at,he.ended_at)::date ed
  from (select event_id, from_vehicle_id, to_vehicle_id, cited_event_id, 'bj'::text house, title, title_year, win_lo, win_hi, 1 n_cand from public.agg_houselot_v1_20261024_cand8 where n8a=1 and n8b=1) a
  join public.vehicle_events he on he.id=a.cited_event_id and he.vehicle_id=a.to_vehicle_id
       and coalesce(he.identity_check,'') <> 'mismatch' and not ('vehicle_id'=any(coalesce(he.source_suspect,'{}')))
  join public.vehicle_events e on e.id=a.event_id and e.vehicle_id=a.from_vehicle_id
  join public.vehicles v on v.id=a.from_vehicle_id
  join public.vehicles tv on tv.id=a.to_vehicle_id and tv.deleted_at is null and tv.status is distinct from 'merged' and tv.merged_into_vehicle_id is null
       and tv.created_at < '2026-10-24' and not coalesce(tv.data_quality_flags ? 'year_suspect', false) and tv.year=a.title_year
  where (select coalesce(array_agg(distinct replace(m[1],' ','') order by replace(m[1],' ','')),'{}') from regexp_matches(regexp_replace(lower(a.title),'(\d)[ -](\d)\s*l\M','\1.\2l','g'),'\m(hemi|sohc|dohc|boss|supercharged|[0-9]{3}(?=[ -]*(?:ci|cid|cu|cubic)\M)|[0-9]\.[0-9] ?l)\M','g') m) = (select coalesce(array_agg(distinct replace(m[1],' ','') order by replace(m[1],' ','')),'{}') from regexp_matches(regexp_replace(lower(substring(he.source_url from '(?i)/vehicle/([^/?#]+)')),'(\d)[ -](\d)\s*l\M','\1.\2l','g'),'\m(hemi|sohc|dohc|boss|supercharged|[0-9]{3}(?=[ -]*(?:ci|cid|cu|cubic)\M)|[0-9]\.[0-9] ?l)\M','g') m)  -- engine words (hemi, 427 ci, 4.0l ...) must agree; one-sided = conflict
    and a.n_cand=1
    and 'vehicle_id'=any(coalesce(e.source_suspect,'{}'))
    and e.price_verification is distinct from 'contradicted' and (e.price_verification='verified' and e.event_status='sold') is not true
    and not exists (select 1 from public.vehicle_events r where r.vehicle_id=a.to_vehicle_id and r.extraction_run_id='rm_ingest_v1_20261024')
), r as (
  select c0.*,
    case when c0.hc='CAD' then (select jsonb_build_object('rate',f.usd_per_cad,'date',f.rate_date,'source','Bank of Canada '||f.series||' '||f.source_url) from public.fx_boc_cad_usd_v1_20261024 f where f.rate_date<=c0.hd and f.rate_date>=c0.hd-7 order by f.rate_date desc limit 1)
         else (select jsonb_build_object('rate',x.rate,'date',x.rate_date,'source',x.source||coalesce(' ('||x.source_url||')','')) from public.fx_usd_rate(c0.hc,c0.hd) x) end hfx,
    case when c0.ec='CAD' then (select jsonb_build_object('rate',f.usd_per_cad,'date',f.rate_date,'source','Bank of Canada '||f.series||' '||f.source_url) from public.fx_boc_cad_usd_v1_20261024 f where f.rate_date<=c0.ed and f.rate_date>=c0.ed-7 order by f.rate_date desc limit 1)
         else (select jsonb_build_object('rate',x.rate,'date',x.rate_date,'source',x.source||coalesce(' ('||x.source_url||')','')) from public.fx_usd_rate(c0.ec,c0.ed) x) end efx
  from c0
), mk as (
  select r.*, jsonb_build_object('house_currency',hc,'house',hfx,'event_currency',ec,'event',efx,
     'house_usd',round(hp*(hfx->>'rate')::numeric),'event_usd',round(final_price*(efx->>'rate')::numeric)) fx,
    (final_price is not null and from_sale_price=final_price and to_vehicle_id<>from_vehicle_id
     and public.vehicle_sale_price_untrusted(from_vehicle_id, from_sale_price)) do_mark
  from r where k=1 and lot is not null and hs='sold' and hp is not null and final_price is not null and hfx is not null and efx is not null
    and abs(final_price*(efx->>'rate')::numeric - hp*(hfx->>'rate')::numeric)/greatest(hp*(hfx->>'rate')::numeric,1) <= 0.20
), b as (
  insert into public.backup_agg_houselot_v8_20261024 (event_id, from_vehicle_id, to_vehicle_id, cited_event_id, lot_number, old_source_suspect,
    old_source_suspect_reason, old_source_suspect_run_id, old_source_suspect_at, old_attach_basis, final_price, from_sale_price, from_marked, fx, run_id)
  select event_id, from_vehicle_id, to_vehicle_id, cited_event_id, lot, source_suspect, source_suspect_reason, source_suspect_run_id,
         source_suspect_at, metadata->'attach_basis', final_price, from_sale_price, do_mark, fx, 'agg_houselot_v8_20261024' from mk
  on conflict (event_id) do nothing returning event_id
), m as (
  insert into public.vehicle_sale_price_untrusted_marks (vehicle_id, sale_price, reason, source_event_id, run_id)
  select mk.from_vehicle_id, mk.from_sale_price, 'sale price was copied from conceptcarz event '||mk.event_id||', moved to vehicle '||mk.to_vehicle_id||' of cited house event '||mk.cited_event_id,
         mk.event_id, 'agg_houselot_v8_20261024'
  from mk join b on b.event_id=mk.event_id where mk.do_mark on conflict do nothing returning 1
)
update public.vehicle_events e set
  vehicle_id = mk.to_vehicle_id,
  source_suspect = nullif(array_remove(coalesce(e.source_suspect,'{}'),'vehicle_id'),'{}'),
  source_suspect_reason = concat_ws('; ', nullif(e.source_suspect_reason,''), 'attached to cited house event '||mk.cited_event_id||' lot '||mk.lot||' (run agg_houselot_v8_20261024)'),
  source_suspect_run_id = 'agg_houselot_v8_20261024', source_suspect_at = now(),
  metadata = coalesce(e.metadata,'{}'::jsonb) || jsonb_build_object('attach_basis', jsonb_build_object('kind','same_lot',
    'cited_event_id', mk.cited_event_id, 'lot_number', mk.lot,
    'citation', mk.house||' house lot '||mk.lot||' '||mk.cited_url||coalesce(' (lot read from '||mk.lot_src||')',''),
    'match_rule', 'same house + sale window ['||mk.win_lo||','||mk.win_hi||'] + year + make + first model word + every title word in the live B-J lot slug, unique (cand8); price within 20% in USD',
    'fx', mk.fx, 'from_vehicle_id', mk.from_vehicle_id, 'run_id', 'agg_houselot_v8_20261024'))
from mk join b on b.event_id=mk.event_id
where e.id=mk.event_id and (select count(*) from m)>=0;
commit;
select count(*) n, count(*) filter (where from_vehicle_id<>to_vehicle_id) moved, count(*) filter (where from_marked) marked, (select count(*) from public.vehicle_events e join public.backup_agg_houselot_v8_20261024 k on k.event_id=e.id where e.vehicle_id=k.to_vehicle_id and public.aggregator_event_attach_basis(e.id,e.vehicle_id,e.source_url,e.source_platform,e.metadata) in ('same_lot','vin_match')) guard_ok, (select count(*) from public.vehicle_sale_price_untrusted_marks where run_id='agg_houselot_v8_20261024') marks from public.backup_agg_houselot_v8_20261024;
