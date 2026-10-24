begin; set local statement_timeout='50s'; set local lock_timeout='5s';
-- Run agg_houselot_v7_20261024: near-miss attach. Flagged conceptcarz events whose cand4a match (first model word / cited alias) is unique and whose
-- only title words missing from the house lot URL are body or spec words (body style, transmission, engine size, coachwork, filler).
-- Attach only when: house lot cited; one cc event per house event; cc event not a verified or contradicted sale; house sold price known
-- and within 20% in USD (fx_usd_rate: boe GBP, ecb EUR; CAD from fx_boc_cad_usd_v1_20261024; null cc currency = USD);
-- target vehicle existed before 2026-10-24, is live (not deleted/merged), not from rm_ingest_v1_20261024, no year_suspect flag, and
-- its house event is identity-confirmed; a cc body word that conflicts with a different body word in the house lot is held (identity_check not mismatch, source_suspect without vehicle_id). Creates/merges no vehicles.
create table if not exists public.backup_agg_houselot_v7_20261024 (
  event_id uuid primary key, from_vehicle_id uuid not null, to_vehicle_id uuid not null, cited_event_id uuid not null, lot_number text,
  old_source_suspect text[], old_source_suspect_reason text, old_source_suspect_run_id text, old_source_suspect_at timestamptz,
  old_attach_basis jsonb, final_price numeric, from_sale_price integer, from_marked boolean, fx jsonb, run_id text not null, moved_at timestamptz not null default now());
alter table public.backup_agg_houselot_v7_20261024 enable row level security;
with c0 as (
  select a.event_id, a.from_vehicle_id, a.to_vehicle_id, a.cited_event_id, a.house, a.title, a.win_lo, a.win_hi, he.source_url cited_url,
    case when (case when he.source_platform='mecum' and btrim(he.source_listing_id) !~ '^[A-Z]{1,3}[0-9]{1,4}(\.[0-9]{1,2})?$' then null else nullif(btrim(he.source_listing_id),'') end) is null then he.lot_number_source_url end lot_src,
    coalesce(case when he.source_platform='mecum' and btrim(he.source_listing_id) !~ '^[A-Z]{1,3}[0-9]{1,4}(\.[0-9]{1,2})?$' then null else nullif(btrim(he.source_listing_id),'') end, case when he.lot_number_source_url is not null then nullif(btrim(he.lot_number),'') end, substring(he.source_url from '(?i)bonhams\.com/auction/\d+/lot/([0-9A-Za-z]+)/')) lot,
    e.source_suspect, e.source_suspect_reason, e.source_suspect_run_id, e.source_suspect_at, e.metadata, e.final_price, v.sale_price from_sale_price,
    (select count(*) from public.agg_houselot_v1_20261024_cand4a x where x.cited_event_id=a.cited_event_id) k,
    he.final_price hp, he.event_status hs,
    upper(coalesce(he.currency_code,'USD')) hc, upper(coalesce(e.currency_code,'USD')) ec, coalesce(he.sold_at,he.ended_at)::date hd, coalesce(e.sold_at,e.ended_at,he.sold_at,he.ended_at)::date ed
  from public.agg_houselot_v1_20261024_cand4a a
  join public.agg_houselot_v1_20261024_cand4b b4 on b4.event_id=a.event_id and b4.n_cand=0
  join public.vehicle_events he on he.id=a.cited_event_id and he.vehicle_id=a.to_vehicle_id
       and coalesce(he.identity_check,'') <> 'mismatch' and not ('vehicle_id'=any(coalesce(he.source_suspect,'{}')))
  join public.vehicle_events e on e.id=a.event_id and e.vehicle_id=a.from_vehicle_id
  join public.vehicles v on v.id=a.from_vehicle_id
  join public.vehicles tv on tv.id=a.to_vehicle_id and tv.deleted_at is null and tv.status is distinct from 'merged' and tv.merged_into_vehicle_id is null
       and tv.created_at < '2026-10-24' and not coalesce(tv.data_quality_flags ? 'year_suspect', false) and tv.year=a.title_year
  where a.n_cand=1 and a.event_id in ('02438677-3a35-4c23-95fd-15334be1047a','0ebe4445-3a99-4451-9347-f13279cfe265','0308747e-7e7a-452a-a3cd-9af2c422259d','1b01455a-2b5e-4b8c-a231-4ed572b42b7a','1ecf95fd-5fbd-4379-99ae-75bd1ff92871','11589435-dc44-4b21-8875-559e963aa799','1124b2df-6d6c-4e80-9c0b-90ceff4b4ff3','29c63748-5ee4-4060-9995-27ccf2592e57','20915641-bdde-4084-ada0-5263b2cea7b5','277dc50c-34b8-4322-a10f-29e943d0d0e3','3c8773c6-dbdd-4dcd-9e5b-1a1017b06cc3','3b484fc6-bb67-4d69-a9a3-925fd7752490','3cdff6e0-b23c-49ba-a2fb-8cc8c582e979','41583161-608b-4bef-a982-1afe1fd1f9be','491bbe13-5ce9-47f4-aff5-cdfd1fbb916b','4c9f056b-4c1f-4792-9266-c505852f19c5','40e23648-0a5c-40f7-9d16-b581c9670a05','4b9b4e8d-37aa-43e2-812f-722eb66d939d','571550b1-7be8-4bfc-8789-47fe25d0c440','5eb12ecd-b15c-4ca3-b4c8-82b7c63454aa','858ea93f-4bc9-4e15-acde-2e5c7d8926af','8ba7513b-4094-401a-b6cb-a4e79d03d92e','86f1ad49-f1f7-4823-8240-2e6810cbd7b3','7ce4d1c7-0f1c-4420-b3c1-a95f0053a0fd','7c8def9c-44b7-41c9-99c6-94b6c50d2a9c','96d16672-4eb0-41cf-bc9b-66f93b7fc4d8','9635c4c8-2fca-4767-bf6d-ee69a647239d','a07bf8fd-e7d3-4499-be91-eb12ba4c65e6','aaf765da-174b-49a8-a903-d892e0390c5e','bd18e6c2-7dd5-48c6-a1d2-8e4302fa3ad1','bb5e555e-9051-4a67-9b43-b8df502baeaf','d4bb6605-0610-46b3-9f70-b181cef9b30c','dae62022-ed2c-43d4-8e16-4a9d2f461039','d81b9612-4d89-4a8f-ba9f-813906e8ee62','f8f587d4-ee21-4fc5-be96-c59f918d8374','f48fb16f-173d-4123-b5aa-c86854726847')
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
  insert into public.backup_agg_houselot_v7_20261024 (event_id, from_vehicle_id, to_vehicle_id, cited_event_id, lot_number, old_source_suspect,
    old_source_suspect_reason, old_source_suspect_run_id, old_source_suspect_at, old_attach_basis, final_price, from_sale_price, from_marked, fx, run_id)
  select event_id, from_vehicle_id, to_vehicle_id, cited_event_id, lot, source_suspect, source_suspect_reason, source_suspect_run_id,
         source_suspect_at, metadata->'attach_basis', final_price, from_sale_price, do_mark, fx, 'agg_houselot_v7_20261024' from mk
  on conflict (event_id) do nothing returning event_id
), m as (
  insert into public.vehicle_sale_price_untrusted_marks (vehicle_id, sale_price, reason, source_event_id, run_id)
  select mk.from_vehicle_id, mk.from_sale_price, 'sale price was copied from conceptcarz event '||mk.event_id||', moved to vehicle '||mk.to_vehicle_id||' of cited house event '||mk.cited_event_id,
         mk.event_id, 'agg_houselot_v7_20261024'
  from mk join b on b.event_id=mk.event_id where mk.do_mark on conflict do nothing returning 1
)
update public.vehicle_events e set
  vehicle_id = mk.to_vehicle_id,
  source_suspect = nullif(array_remove(coalesce(e.source_suspect,'{}'),'vehicle_id'),'{}'),
  source_suspect_reason = concat_ws('; ', nullif(e.source_suspect_reason,''), 'attached to cited house event '||mk.cited_event_id||' lot '||mk.lot||' (run agg_houselot_v7_20261024)'),
  source_suspect_run_id = 'agg_houselot_v7_20261024', source_suspect_at = now(),
  metadata = coalesce(e.metadata,'{}'::jsonb) || jsonb_build_object('attach_basis', jsonb_build_object('kind','same_lot',
    'cited_event_id', mk.cited_event_id, 'lot_number', mk.lot,
    'citation', mk.house||' house lot '||mk.lot||' '||mk.cited_url||coalesce(' (lot read from '||mk.lot_src||')',''),
    'match_rule', 'same house + sale window ['||mk.win_lo||','||mk.win_hi||'] + year + make + first model word unique (cand4a); title words missing from the lot are body/spec words only; price within 20% in USD',
    'fx', mk.fx, 'from_vehicle_id', mk.from_vehicle_id, 'run_id', 'agg_houselot_v7_20261024'))
from mk join b on b.event_id=mk.event_id
where e.id=mk.event_id and (select count(*) from m)>=0;
commit;
select count(*) n, count(*) filter (where from_vehicle_id<>to_vehicle_id) moved, count(*) filter (where from_marked) marked, (select count(*) from public.vehicle_events e join public.backup_agg_houselot_v7_20261024 k on k.event_id=e.id where e.vehicle_id=k.to_vehicle_id and public.aggregator_event_attach_basis(e.id,e.vehicle_id,e.source_url,e.source_platform,e.metadata) in ('same_lot','vin_match')) guard_ok, (select count(*) from public.vehicle_sale_price_untrusted_marks where run_id='agg_houselot_v7_20261024') marks from public.backup_agg_houselot_v7_20261024;
