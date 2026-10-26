-- flag only; final_price/event_status untouched. Citation = existing sale_truth_role='ask' (PR #2454 contract).
update public.vehicle_events set price_kind='asking',
  price_kind_source='mecum_ask_price_kind_v1_20261025: sale_truth_role=ask (PR #2454 contract) on event_status=sold; asking price, not a sale'
where source_platform='mecum' and sale_truth_role='ask' and event_status='sold' and price_kind is null;
insert into public.vehicle_sale_price_untrusted_marks(vehicle_id, sale_price, reason, source_event_id, run_id)
select distinct on (v.id) v.id, v.sale_price, 'sale_price equals a Mecum asking price (price_kind=asking), no other sold event supports it', e.id, 'mecum_ask_price_kind_v1_20261025'
from public.vehicle_events e join public.vehicles v on v.id=e.vehicle_id
where e.price_kind='asking' and e.price_kind_source like 'mecum_ask_price_kind_v1_20261025%' and v.sale_price::numeric=e.final_price
  and not exists (select 1 from public.vehicle_events o where o.vehicle_id=v.id and o.final_price=e.final_price
                  and o.event_status='sold' and coalesce(o.sale_truth_role,'') not in ('ask','duplicate'))
  and not exists (select 1 from public.vehicle_sale_price_untrusted_ids u where u.vehicle_id=v.id)
order by v.id, e.id;
