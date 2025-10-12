-- Materialized view to cache price signals for PUBLIC vehicles only
-- Safe to expose to anon/auth roles because it only contains rows for public vehicles

create materialized view if not exists public.vehicle_price_signal_mv as
with v as (
  select id as vehicle_id,
         msrp,
         current_value,
         purchase_price,
         asking_price,
         sale_price,
         is_for_sale,
         updated_at
  from public.vehicles
  where coalesce(is_public, true) = true
),
-- Latest sale from vehicle_timeline_events (metadata.what.sold_price)
sale as (
  select distinct on (vehicle_id)
    vehicle_id,
    coalesce(
      nullif((metadata->'what'->>'sold_price')::numeric, null),
      nullif((metadata->'what'->>'sale_price')::numeric, null)
    ) as sold_price,
    event_date::timestamptz as sold_date
  from public.vehicle_timeline_events
  where vehicle_id in (select vehicle_id from v)
    and (event_type in ('ownership_transfer','auction_sale','sold') or title ilike 'Sold%')
    and ((metadata->'what' ? 'sold_price') or (metadata->'what' ? 'sale_price'))
  order by vehicle_id, event_date desc
),
base as (
  select
    v.vehicle_id,
    v.msrp,
    v.current_value,
    v.purchase_price,
    v.asking_price,
    coalesce(v.sale_price, sale.sold_price) as sale_price,
    v.is_for_sale,
    sale.sold_date,
    (v.sale_price is not null) as vehicle_sale_exists,
    (sale.sold_price is not null) as event_sale_exists,
    false as archive_sale_exists,
    v.updated_at
  from v
  left join sale on sale.vehicle_id = v.vehicle_id
),
picked as (
  select
    b.*,
    case
      when b.sale_price is not null then 'SOLD'
      when b.is_for_sale is true and b.asking_price is not null then 'ASK'
      when b.current_value is not null then 'EST'
      when b.purchase_price is not null then 'PAID'
      when b.msrp is not null then 'MSRP'
      else null
    end as primary_label,
    case
      when b.sale_price is not null then b.sale_price
      when b.is_for_sale is true and b.asking_price is not null then b.asking_price
      when b.current_value is not null then b.current_value
      when b.purchase_price is not null then b.purchase_price
      when b.msrp is not null then b.msrp
      else null
    end as primary_value,
    case
      when b.purchase_price is not null then 'PURCHASE'
      when b.msrp is not null then 'MSRP'
      else null
    end as anchor_label,
    case
      when b.purchase_price is not null then b.purchase_price
      when b.msrp is not null then b.msrp
      else null
    end as anchor_value
  from base b
)
select
  p.vehicle_id,
  p.primary_label,
  p.primary_value,
  p.anchor_label,
  p.anchor_value,
  case when p.primary_value is not null and p.anchor_value is not null then p.primary_value - p.anchor_value end as delta_amount,
  case when p.primary_value is not null and p.anchor_value is not null and p.anchor_value <> 0 then ((p.primary_value - p.anchor_value)/p.anchor_value)*100 end as delta_pct,
  greatest(
    0,
    (case when p.primary_label = 'SOLD' then 40 when p.primary_label in ('ASK','EST') then 25 else 0 end)
    + (case when p.purchase_price is not null then 10 else 0 end)
    + (case when p.msrp is not null then 5 else 0 end)
    + (case when p.sold_date is not null and p.sold_date > now() - interval '365 days' then 10 else 0 end)
  ) as confidence,
  array_remove(array[
    case when p.vehicle_sale_exists then 'vehicles.sale_price'::text end,
    case when p.event_sale_exists then 'vehicle_timeline_events.sale'::text end,
    case when p.archive_sale_exists then 'listing_archive.sale'::text end,
    case when p.is_for_sale is true and p.asking_price is not null then 'vehicles.asking_price'::text end,
    case when p.current_value is not null then 'vehicles.current_value'::text end,
    case when p.purchase_price is not null then 'vehicles.purchase_price'::text end,
    case when p.msrp is not null then 'vehicles.msrp'::text end
  ], null) as sources,
  array_remove(array[
    case when p.purchase_price is null then 'purchase_price'::text end,
    case when p.msrp is null then 'msrp'::text end,
    case when p.is_for_sale is true and p.asking_price is null then 'asking_price'::text end,
    case when p.current_value is null then 'current_value'::text end
  ], null) as missing_fields,
  coalesce(p.updated_at, now()) as updated_at
from picked p;

-- Unique index to allow CONCURRENT refresh
create unique index if not exists vehicle_price_signal_mv_vehicle_id_idx
  on public.vehicle_price_signal_mv (vehicle_id);

-- Convenience view (optional) if you prefer a stable name without _mv suffix
create or replace view public.vehicle_price_signal_view as
  select * from public.vehicle_price_signal_mv;

-- Grants for client access
grant select on public.vehicle_price_signal_mv to anon, authenticated;
grant select on public.vehicle_price_signal_view to anon, authenticated;
