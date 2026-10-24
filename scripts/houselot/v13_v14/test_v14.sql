begin;
-- Run agg_houselot_v14_20261024: attach v11 h02 events (>1 lot) whose tie is broken by cited evidence (title words only on one lot page URL / exact price), then full v11 gate. Gates = v7 (see gate11.sql) + engine rule v2:
-- engine words in the cc title (incl. NNN/HP form) are confirmed on the cited lot page (eng_ev). Creates/merges no vehicles.
set local statement_timeout='50s'; set local lock_timeout='5s';
create table if not exists public.backup_agg_houselot_v14_20261024 (
  event_id uuid primary key, from_vehicle_id uuid not null, to_vehicle_id uuid not null, cited_event_id uuid not null, lot_number text,
  old_source_suspect text[], old_source_suspect_reason text, old_source_suspect_run_id text, old_source_suspect_at timestamptz,
  old_attach_basis jsonb, final_price numeric, from_sale_price integer, from_marked boolean, run_id text not null, moved_at timestamptz not null default now());
alter table public.backup_agg_houselot_v14_20261024 enable row level security;
with ev(event8, eng_ev) as (select null::text, null::text where false), g as (
  select g.*, ev.eng_ev from public.agg_houselot_v14_20261024_gate g left join ev on left(g.event_id::text,8)=ev.event8
  where g.reason='ok' and (g.title !~ '\d{3}/\d{2,3} ?HP' or ev.eng_ev is not null)
), mk as (
  select g.*, e.source_suspect ss, e.source_suspect_reason ssr, e.source_suspect_run_id ssrun, e.source_suspect_at ssat, e.metadata md, v.sale_price fsp,
    (g.cc_price is not null and v.sale_price=g.cc_price and g.to_vehicle_id<>g.from_vehicle_id and public.vehicle_sale_price_untrusted(g.from_vehicle_id, v.sale_price)) do_mark
  from g join public.vehicle_events e on e.id=g.event_id and e.vehicle_id=g.from_vehicle_id join public.vehicles v on v.id=g.from_vehicle_id
), b as (
  insert into public.backup_agg_houselot_v14_20261024 (event_id, from_vehicle_id, to_vehicle_id, cited_event_id, lot_number, old_source_suspect,
    old_source_suspect_reason, old_source_suspect_run_id, old_source_suspect_at, old_attach_basis, final_price, from_sale_price, from_marked, run_id)
  select event_id, from_vehicle_id, to_vehicle_id, cited_event_id, lot, ss, ssr, ssrun, ssat, md->'attach_basis', cc_price, fsp, do_mark, 'agg_houselot_v14_20261024' from mk
  on conflict (event_id) do nothing returning event_id
), m as (
  insert into public.vehicle_sale_price_untrusted_marks (vehicle_id, sale_price, reason, source_event_id, run_id)
  select mk.from_vehicle_id, mk.fsp, 'sale price was copied from conceptcarz event '||mk.event_id||', moved to vehicle '||mk.to_vehicle_id||' of cited house event '||mk.cited_event_id,
         mk.event_id, 'agg_houselot_v14_20261024'
  from mk join b on b.event_id=mk.event_id where mk.do_mark on conflict do nothing returning 1
)
update public.vehicle_events e set
  vehicle_id = mk.to_vehicle_id,
  source_suspect = nullif(array_remove(coalesce(e.source_suspect,'{}'),'vehicle_id'),'{}'),
  source_suspect_reason = concat_ws('; ', nullif(e.source_suspect_reason,''), 'attached to cited house event '||mk.cited_event_id||' lot '||mk.lot||' (run agg_houselot_v14_20261024)'),
  source_suspect_run_id = 'agg_houselot_v14_20261024', source_suspect_at = now(),
  metadata = coalesce(e.metadata,'{}'::jsonb) || jsonb_build_object('attach_basis', jsonb_build_object('kind','same_lot',
    'cited_event_id', mk.cited_event_id, 'lot_number', mk.lot,
    'citation', mk.house||' house lot '||mk.lot||' '||mk.cited_url,
    'tiebreak', mk.tiebreak_basis||': '||array_to_string(mk.tiebreak_words,' ')||' ('||mk.cited_url||')', 'match_rule', 'house routed by agg_houseroute_v10_20261024; same house + sale window ['||mk.win_lo||','||mk.win_hi||'] + year + make + first model word; >1 lot, tie broken by cited evidence; missing title words body/spec only; price within 20% USD; no body conflict; engine rule v2',
    'engine_evidence', mk.eng_ev, 'from_vehicle_id', mk.from_vehicle_id, 'run_id', 'agg_houselot_v14_20261024'))
from mk join b on b.event_id=mk.event_id
where e.id=mk.event_id and (select count(*) from m)>=0;
select count(*) n, count(*) filter (where from_marked) marked,
  (select count(*) from public.vehicle_events e join public.backup_agg_houselot_v14_20261024 k on k.event_id=e.id where e.vehicle_id=k.to_vehicle_id and public.aggregator_event_attach_basis(e.id,e.vehicle_id,e.source_url,e.source_platform,e.metadata)='same_lot') guard_ok,
  (select count(*) from public.vehicle_sale_price_untrusted_marks where run_id='agg_houselot_v14_20261024') marks
from public.backup_agg_houselot_v14_20261024;

-- Revert run agg_houselot_v14_20261024 (owner-only; replica role skips the attach guard for the restore). Backup kept; marks retired, not deleted.
set local session_replication_role = replica;
update public.vehicle_events e set vehicle_id=b.from_vehicle_id, source_suspect=b.old_source_suspect, source_suspect_reason=b.old_source_suspect_reason,
  source_suspect_run_id=b.old_source_suspect_run_id, source_suspect_at=b.old_source_suspect_at,
  metadata = case when b.old_attach_basis is null then e.metadata - 'attach_basis' else e.metadata || jsonb_build_object('attach_basis', b.old_attach_basis) end
from public.backup_agg_houselot_v14_20261024 b
where e.id=b.event_id and e.vehicle_id=b.to_vehicle_id and e.source_suspect_run_id='agg_houselot_v14_20261024';
update public.vehicle_sale_price_untrusted_marks set retired_at=now() where run_id='agg_houselot_v14_20261024' and retired_at is null;

select count(*) left_after_revert, (select count(*) from public.vehicle_sale_price_untrusted_marks where run_id='agg_houselot_v14_20261024' and retired_at is null) live_marks from public.backup_agg_houselot_v14_20261024 k join public.vehicle_events e on e.id=k.event_id where e.vehicle_id<>k.from_vehicle_id;
rollback;
