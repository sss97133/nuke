-- Run agg_reattach_v1_20261024: move a flagged conceptcarz event (run agg_attach_audit_v1_20261024) to its real vehicle only when
-- exactly one existing vehicle's VIN matches the chassis in the event title (aggregator_chassis_vin_match rule; candidates in
-- public.agg_reattach_v1_20261024_cand, computed over live, non-deleted, non-merged vehicles). Held back: title year <> vehicle
-- year, and verified sold events (would drive the sale-price sync). No vehicle is created or merged, no price is written.
-- The old vehicle's price, when it equals the moved event's price and is untrusted right now, gets a durable
-- vehicle_sale_price_untrusted_marks row so it stays untrusted after the event leaves. Corroborated (trusted) prices get no mark.
-- Batches: :'batch' in 0..f (first hex digit of event id). Revert: revert_agg_reattach_v1_20261024.sql
create table if not exists public.backup_agg_reattach_v1_20261024 (
  event_id uuid primary key, from_vehicle_id uuid not null, to_vehicle_id uuid not null, chassis text, to_vin text,
  old_source_suspect text[], old_source_suspect_reason text, old_source_suspect_run_id text, old_source_suspect_at timestamptz,
  old_attach_basis jsonb, final_price numeric, from_sale_price integer, from_marked boolean, run_id text not null,
  moved_at timestamptz not null default now());
alter table public.backup_agg_reattach_v1_20261024 enable row level security;

with c as (
  select c.*, e.source_suspect, e.source_suspect_reason, e.source_suspect_run_id, e.source_suspect_at, e.metadata, e.final_price,
         v.sale_price from_sale_price
  from public.agg_reattach_v1_20261024_cand c
  join public.vehicle_events e on e.id = c.event_id and e.vehicle_id = c.from_vehicle_id
  join public.vehicles v on v.id = c.from_vehicle_id
  where c.n_match = 1 and c.to_vehicle_id is not null and left(c.event_id::text, 1) = :'batch'
    and (c.title_year is not null and c.to_year is not null and c.title_year <> c.to_year) is not true
    and 'vehicle_id' = any(coalesce(e.source_suspect, '{}'))
    and (e.price_verification = 'verified' and e.event_status = 'sold') is not true
), mk as (
  select c.*, (c.final_price is not null and c.from_sale_price = c.final_price
               and public.vehicle_sale_price_untrusted(c.from_vehicle_id, c.from_sale_price)) do_mark
  from c
), b as (
  insert into public.backup_agg_reattach_v1_20261024 (event_id, from_vehicle_id, to_vehicle_id, chassis, to_vin, old_source_suspect,
    old_source_suspect_reason, old_source_suspect_run_id, old_source_suspect_at, old_attach_basis, final_price, from_sale_price, from_marked, run_id)
  select event_id, from_vehicle_id, to_vehicle_id, chassis, to_vin, source_suspect, source_suspect_reason, source_suspect_run_id,
         source_suspect_at, metadata -> 'attach_basis', final_price, from_sale_price, do_mark, 'agg_reattach_v1_20261024' from mk
  on conflict (event_id) do nothing
  returning event_id
), m as (
  insert into public.vehicle_sale_price_untrusted_marks (vehicle_id, sale_price, reason, source_event_id, run_id)
  select mk.from_vehicle_id, mk.from_sale_price,
         'sale price was copied from conceptcarz event ' || mk.event_id || ', moved to its chassis-matched vehicle ' || mk.to_vehicle_id,
         mk.event_id, 'agg_reattach_v1_20261024'
  from mk join b on b.event_id = mk.event_id where mk.do_mark
  on conflict do nothing
  returning 1
)
update public.vehicle_events e set
  vehicle_id = mk.to_vehicle_id,
  source_suspect = nullif(array_remove(coalesce(e.source_suspect, '{}'), 'vehicle_id'), '{}'),
  source_suspect_reason = concat_ws('; ', nullif(e.source_suspect_reason, ''),
    'moved to the only vehicle whose VIN matches the title chassis ' || mk.chassis || ' (run agg_reattach_v1_20261024)'),
  source_suspect_run_id = 'agg_reattach_v1_20261024',
  source_suspect_at = now(),
  metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object('attach_basis', jsonb_build_object('kind', 'vin_match',
    'chassis', mk.chassis, 'vin', mk.to_vin, 'from_vehicle_id', mk.from_vehicle_id, 'run_id', 'agg_reattach_v1_20261024'))
from mk join b on b.event_id = mk.event_id
where e.id = mk.event_id and (select count(*) from m) >= 0;
