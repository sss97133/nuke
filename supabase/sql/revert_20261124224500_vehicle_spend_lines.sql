-- Revert 20261124224500_vehicle_spend_lines: get_vehicle_total_invested_unmasked goes back to summing receipts at read
-- time (definition copied from production 2026-11-25, before the migration), and the fold, its job, view and tables go.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vehicle-spend-fold';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.get_vehicle_total_invested_unmasked(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      where r.duplicate_of is null and r.amount_check in ('verified','plausible') and coalesce(r.is_superseded, false) = false
        and coalesce(r.total_amount, r.total) > 0
        and not public.receipt_doc_kind_excluded(r.document_kind) and not public.receipt_doc_kind_quoted(r.document_kind)
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
$function$
;
REVOKE ALL ON FUNCTION public.get_vehicle_total_invested_unmasked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vehicle_total_invested_unmasked(uuid) TO service_role;
DROP FUNCTION IF EXISTS public.vehicle_spend_fold(text);
DROP VIEW IF EXISTS public.vehicle_spend_lines_due;
DROP TABLE IF EXISTS public.vehicle_spend_lines;
DROP TABLE IF EXISTS public.vehicle_spend_bases;
COMMIT;
