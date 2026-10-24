-- Run agg_attach_audit_v1_20261024: flag every conceptcarz-attached event that fails the aggregator attach rule
-- (20261026081000_aggregator_event_attach_guard: chassis/VIN match or cited same-lot match) as attached to the wrong vehicle.
-- Writes only vehicle_events.source_suspect (+ 'vehicle_id'), source_suspect_reason/run_id/at. No price, vehicle or attachment moves.
-- A flagged event whose final_price equals its vehicle's sale_price makes that price untrusted through
-- vehicle_sale_price_untrusted / vehicle_sale_price_untrusted_ids (unless an unflagged event on the vehicle vouches for it).
-- Batches: run once per :'batch' in 0..f (first hex digit of the event id). Revert: revert_agg_attach_audit_v1_20261024.sql
create table if not exists public.backup_agg_attach_audit_v1_20261024 (
  event_id uuid primary key, vehicle_id uuid, old_source_suspect text[], old_source_suspect_reason text,
  old_source_suspect_run_id text, old_source_suspect_at timestamptz, final_price numeric, vehicle_sale_price integer,
  price_copied boolean, chassis text, vehicle_vin text, run_id text not null, flagged_at timestamptz not null default now());
alter table public.backup_agg_attach_audit_v1_20261024 enable row level security;

with f as (
  select e.id, e.vehicle_id, e.source_suspect, e.source_suspect_reason, e.source_suspect_run_id, e.source_suspect_at,
         e.final_price, v.sale_price, v.vin,
         public.aggregator_chassis_norm(substring(e.source_url from '(?i)chassis\s*#\s*:?\s*(.*)$')) ch
  from public.vehicle_events e join public.vehicles v on v.id = e.vehicle_id
  where public.aggregator_event_is_aggregator(e.source_url, e.source_platform)
    and left(e.id::text, 1) = :'batch'
    and not ('vehicle_id' = any(coalesce(e.source_suspect, '{}')))
    and public.aggregator_event_attach_basis(e.id, e.vehicle_id, e.source_url, e.source_platform, e.metadata) is null
), b as (
  insert into public.backup_agg_attach_audit_v1_20261024 (event_id, vehicle_id, old_source_suspect, old_source_suspect_reason,
    old_source_suspect_run_id, old_source_suspect_at, final_price, vehicle_sale_price, price_copied, chassis, vehicle_vin, run_id)
  select id, vehicle_id, source_suspect, source_suspect_reason, source_suspect_run_id, source_suspect_at, final_price, sale_price,
         final_price is not null and sale_price = final_price, ch, vin, 'agg_attach_audit_v1_20261024' from f
  on conflict (event_id) do nothing
  returning event_id
)
update public.vehicle_events e set
  source_suspect = (select array_agg(distinct x order by x) from unnest(coalesce(e.source_suspect, '{}') || array['vehicle_id']) x),
  source_suspect_reason = concat_ws('; ', nullif(e.source_suspect_reason, ''),
    'aggregator event attached without a chassis/VIN or cited same-lot match (orphan-backfill year+make+price binding); attached to the wrong vehicle until proven'),
  source_suspect_run_id = 'agg_attach_audit_v1_20261024',
  source_suspect_at = now()
from b where e.id = b.event_id;
