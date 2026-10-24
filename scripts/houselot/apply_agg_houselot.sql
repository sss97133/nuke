-- Run agg_houselot_v1_20261024: move a flagged conceptcarz event to the vehicle of a cited house event (same house, sale window,
-- year, make, model tokens all in the house lot title; unique under both cand2 and cand3 rules; one cc event per house event).
-- Held: no house lot number, verified sold cc events, and price-contradicted pairs (house sold price known and >20% apart).
-- Lot: house source_listing_id (Mecum only when catalog-shaped like F257; page ids such as 483533 are ignored), else vehicle_events.lot_number (cited page), else the Bonhams /lot/N/ in the URL.
-- Basis: metadata.attach_basis kind same_lot citing the house event and ITS lot number (the conceptcarz row carries none).
create table if not exists public.backup_agg_houselot_v1_20261024 (
  event_id uuid primary key, from_vehicle_id uuid not null, to_vehicle_id uuid not null, cited_event_id uuid not null, lot_number text,
  old_source_suspect text[], old_source_suspect_reason text, old_source_suspect_run_id text, old_source_suspect_at timestamptz,
  old_attach_basis jsonb, final_price numeric, from_sale_price integer, from_marked boolean, run_id text not null, moved_at timestamptz not null default now());
alter table public.backup_agg_houselot_v1_20261024 enable row level security;
with c as (
  select c3.event_id, c3.from_vehicle_id, c3.to_vehicle_id, c3.cited_event_id, c3.house, c3.title, c3.win_lo, c3.win_hi, he.source_url cited_url, case when (case when he.source_platform='mecum' and btrim(he.source_listing_id) !~ '^[A-Z]{1,3}[0-9]{1,4}(\.[0-9]{1,2})?$' then null else nullif(btrim(he.source_listing_id),'') end) is null then he.lot_number_source_url end lot_src,
    coalesce(case when he.source_platform='mecum' and btrim(he.source_listing_id) !~ '^[A-Z]{1,3}[0-9]{1,4}(\.[0-9]{1,2})?$' then null else nullif(btrim(he.source_listing_id),'') end, case when he.lot_number_source_url is not null then nullif(btrim(he.lot_number),'') end, substring(he.source_url from '(?i)bonhams\.com/auction/\d+/lot/([0-9A-Za-z]+)/')) lot,
    e.source_suspect, e.source_suspect_reason, e.source_suspect_run_id, e.source_suspect_at, e.metadata, e.final_price, v.sale_price from_sale_price,
    count(*) over (partition by c3.cited_event_id) k, he.final_price hp, he.event_status hs
  from public.agg_houselot_v1_20261024_cand3 c3
  join public.agg_houselot_v1_20261024_cand2 c2 on c2.event_id=c3.event_id and c2.n_cand=1 and c2.cited_event_id=c3.cited_event_id
  join public.vehicle_events he on he.id=c3.cited_event_id and he.vehicle_id=c3.to_vehicle_id
  join public.vehicle_events e on e.id=c3.event_id and e.vehicle_id=c3.from_vehicle_id
  join public.vehicles v on v.id=c3.from_vehicle_id
  join public.vehicles tv on tv.id=c3.to_vehicle_id and tv.deleted_at is null and tv.status is distinct from 'merged' and tv.merged_into_vehicle_id is null
  where c3.n_cand=1 and 'vehicle_id'=any(coalesce(e.source_suspect,'{}'))
    and (e.price_verification='verified' and e.event_status='sold') is not true
), mk as (
  select c.*, (c.final_price is not null and c.from_sale_price=c.final_price and c.to_vehicle_id<>c.from_vehicle_id
               and public.vehicle_sale_price_untrusted(c.from_vehicle_id, c.from_sale_price)) do_mark
  from c where k=1 and lot is not null and left(event_id::text,1)=:'batch'
    and not (hs='sold' and hp is not null and final_price is not null and abs(final_price-hp)/greatest(hp,1) > 0.20)
), b as (
  insert into public.backup_agg_houselot_v1_20261024 (event_id, from_vehicle_id, to_vehicle_id, cited_event_id, lot_number, old_source_suspect,
    old_source_suspect_reason, old_source_suspect_run_id, old_source_suspect_at, old_attach_basis, final_price, from_sale_price, from_marked, run_id)
  select event_id, from_vehicle_id, to_vehicle_id, cited_event_id, lot, source_suspect, source_suspect_reason, source_suspect_run_id,
         source_suspect_at, metadata->'attach_basis', final_price, from_sale_price, do_mark, 'agg_houselot_v1_20261024' from mk
  on conflict (event_id) do nothing returning event_id
), m as (
  insert into public.vehicle_sale_price_untrusted_marks (vehicle_id, sale_price, reason, source_event_id, run_id)
  select mk.from_vehicle_id, mk.from_sale_price, 'sale price was copied from conceptcarz event '||mk.event_id||', moved to vehicle '||mk.to_vehicle_id||' of cited house event '||mk.cited_event_id,
         mk.event_id, 'agg_houselot_v1_20261024'
  from mk join b on b.event_id=mk.event_id where mk.do_mark on conflict do nothing returning 1
)
update public.vehicle_events e set
  vehicle_id = mk.to_vehicle_id,
  source_suspect = nullif(array_remove(coalesce(e.source_suspect,'{}'),'vehicle_id'),'{}'),
  source_suspect_reason = concat_ws('; ', nullif(e.source_suspect_reason,''), 'attached to cited house event '||mk.cited_event_id||' lot '||mk.lot||' (run agg_houselot_v1_20261024)'),
  source_suspect_run_id = 'agg_houselot_v1_20261024', source_suspect_at = now(),
  metadata = coalesce(e.metadata,'{}'::jsonb) || jsonb_build_object('attach_basis', jsonb_build_object('kind','same_lot',
    'cited_event_id', mk.cited_event_id, 'lot_number', mk.lot,
    'citation', mk.house||' house lot '||mk.lot||' '||mk.cited_url||coalesce(' (lot read from '||mk.lot_src||')',''),
    'match_rule', 'same house + sale window ['||mk.win_lo||','||mk.win_hi||'] + year + make + all title tokens in house lot title; unique; lot number from the house event (conceptcarz row carries none)',
    'from_vehicle_id', mk.from_vehicle_id, 'run_id', 'agg_houselot_v1_20261024'))
from mk join b on b.event_id=mk.event_id
where e.id=mk.event_id and (select count(*) from m)>=0;
