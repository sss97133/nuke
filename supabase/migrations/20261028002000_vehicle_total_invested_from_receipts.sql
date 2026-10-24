-- get_vehicle_total_invested read work_order_materials, work_order_overhead,
-- event_tools_used and event_financial_records, none of which exist, so every
-- call failed. It now reads the tables that exist: work-order parts and labor,
-- timeline costs, and receipts. A receipt counts for a vehicle when its active
-- receipt_vehicle_links row is 'linked' to that vehicle; a receipt with no
-- active link row falls back to receipts.vehicle_id or a vehicle scope. Held
-- links, duplicates (duplicate_of) and superseded receipts never count, and each
-- receipt counts once. Response keys are unchanged; 'receipts' and
-- components_count.receipts are added.
create or replace function public.get_vehicle_total_invested(p_vehicle_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path = public
as $function$
  with
    vehicle_te as (select id from timeline_events where vehicle_id = p_vehicle_id),
    parts as (
      select coalesce(sum(wop.total_price), 0) as total, count(*) as cnt
      from work_order_parts wop where wop.timeline_event_id in (select id from vehicle_te)
    ),
    labor as (
      select coalesce(sum(wol.total_cost), 0) as total, count(*) as cnt
      from work_order_labor wol where wol.timeline_event_id in (select id from vehicle_te)
    ),
    te_costs as (
      select coalesce(sum(cost_amount), 0) as total from timeline_events
      where vehicle_id = p_vehicle_id and cost_amount is not null and cost_amount > 0
    ),
    candidate as (
      select l.receipt_id as id from receipt_vehicle_links l
      where l.vehicle_id = p_vehicle_id and l.status = 'linked' and l.retired_at is null
      union
      select r.id from receipts r
      where (r.vehicle_id = p_vehicle_id or (r.scope_type = 'vehicle' and r.scope_id = p_vehicle_id::text))
        and not exists (select 1 from receipt_vehicle_links l where l.receipt_id = r.id and l.retired_at is null)
    ),
    rcpts as (
      select coalesce(sum(coalesce(r.total_amount, r.total)), 0) as total, count(*) as cnt
      from receipts r join candidate c on c.id = r.id
      where r.duplicate_of is null and coalesce(r.is_superseded, false) = false
        and coalesce(r.total_amount, r.total) > 0
    )
  select jsonb_build_object(
    'total_invested', greatest(parts.total + labor.total, te_costs.total, rcpts.total),
    'breakdown', jsonb_build_object(
      'parts', parts.total, 'labor', labor.total, 'materials', 0, 'overhead', 0, 'tools', 0,
      'financial_records_total', 0, 'timeline_costs', te_costs.total, 'receipts', rcpts.total),
    'components_count', jsonb_build_object(
      'parts_items', parts.cnt, 'labor_tasks', labor.cnt, 'materials_items', 0,
      'events_with_work', 0, 'receipts', rcpts.cnt))
  from parts, labor, te_costs, rcpts;
$function$;
