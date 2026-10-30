-- Extend the existing job-list producer, not a second task or accounting ledger.
-- No testimony, assignments, grants or completion states are written here.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.work_order_list_row(p_work_order_id uuid, p_slots text[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $function$
  WITH x AS (SELECT public.job_reader_is_party(p_slots) AS party),
  y AS (SELECT x.party,
      public.work_order_job_path_for_viewer(public.read_work_order_job_path(p_work_order_id), x.party) AS p,
      public.work_order_open_header(p_work_order_id, x.party) AS h,
      public.work_order_retained_sources_for_viewer(p_work_order_id,auth.uid(),p_slots,NULL,3) AS retained
    FROM x),
  w AS (SELECT * FROM public.work_orders WHERE id = p_work_order_id),
  part_states AS (SELECT coalesce(status,'unstated') AS status, count(*) AS records
    FROM public.work_order_parts WHERE work_order_id=p_work_order_id GROUP BY 1),
  payments AS (SELECT count(*) AS records, sum(pm.amount) AS amount, max(pm.payment_date) AS last_on
    FROM public.work_order_payments pm, y
    WHERE pm.work_order_id=p_work_order_id AND y.party AND pm.status='completed')
  SELECT y.h || jsonb_build_object('work_order_id', p_work_order_id, 'vehicle_id', y.p->'vehicle_id',
    'title', y.h->'display_title', 'slots', to_jsonb(COALESCE(p_slots, '{}'::text[])), 'money_visible', y.party,
    'stage_states', (SELECT jsonb_object_agg(st.key, st.value->>'state') FROM jsonb_each(y.p->'stages') st),
    'first_gap', (SELECT jsonb_build_object('stage', o.stage, 'gap', y.p#>>ARRAY['stages', o.stage, 'gaps', '0'])
      FROM unnest(ARRAY['intake','inspection','plan','terms','execution','completion','accounting']) WITH ORDINALITY o(stage, n)
      WHERE jsonb_array_length(y.p#>ARRAY['stages', o.stage, 'gaps']) > 0 ORDER BY o.n LIMIT 1),
    'inconsistencies', (SELECT count(*) FROM jsonb_each(y.p->'stages') st, jsonb_array_elements(st.value->'inconsistencies')),
    'retained_work', y.retained,
    'workload', jsonb_build_object(
      'recorded_status', w.status,
      -- A paid/billed date is not physical completion. An outstanding current
      -- delivery report also remains visible when a legacy status disagrees.
      'disposition', CASE
        WHEN jsonb_array_length(coalesce(y.retained->'responsibility_reports','[]'::jsonb))>0 THEN 'current'
        WHEN w.status IN ('completed','cancelled') THEN 'history' ELSE 'current' END,
      'completed_at', CASE WHEN w.status='completed' THEN w.completed_at END,
      'updated_at', w.updated_at,
      'schedule', jsonb_build_object('start',w.scheduled_start,'end',w.scheduled_end),
      'client', CASE WHEN y.party THEN coalesce(nullif(btrim(w.customer_name),''),
        (SELECT coalesce(nullif(btrim(p.full_name),''),p.username) FROM public.profiles p WHERE p.id=w.customer_id)) END,
      'organization', (SELECT jsonb_build_object('id',o.id,'name',coalesce(o.business_name,o.name))
        FROM public.organizations o WHERE o.id=w.organization_id AND (o.is_public IS TRUE OR y.party)),
      'provider', public.platform_actor_label(w.lead_actor_id),
      'money', CASE WHEN y.party THEN jsonb_build_object(
        'visibility','party','currency',w.currency,
        'estimate',w.estimated_total,'estimate_at',w.quoted_at,
        'received',CASE WHEN payments.records>0 THEN payments.amount END,
        'payment_records',payments.records,'last_payment_on',payments.last_on,
        'payment_basis','completed work_order_payments records; not combined with invoice witnesses',
        'estimate_basis','work_orders.estimated_total; recorded estimate, not an accepted quote',
        'balance',NULL)
        ELSE jsonb_build_object('visibility','withheld') END,
      'time', jsonb_build_object('estimated_hours',w.estimated_hours,'recorded_hours',w.actual_hours,
        'remaining_hours',NULL,'basis','work_orders estimated_hours and actual_hours; not inferred from photo span or billing'),
      'parts',jsonb_build_object('records',(SELECT coalesce(sum(records),0) FROM part_states),
        'states',(SELECT coalesce(jsonb_object_agg(status,records),'{}'::jsonb) FROM part_states),
        'basis','work_order_parts recorded status; quoted does not establish availability or readiness'),
      'source',jsonb_build_object('table','work_orders','record_id',w.id,'as_of',w.updated_at)),
    'as_of', y.p->'as_of')
  FROM y CROSS JOIN w CROSS JOIN payments
$function$;

COMMENT ON FUNCTION public.work_order_list_row(uuid,text[]) IS
  'Internal job-list row: existing masked header and stages plus recorded workload, party-only estimate/payment records, time and part-status coverage. Paid is not delivered; an empty payment set is unknown, not zero. Called only by existing authorized readers.';
NOTIFY pgrst, 'reload schema';
COMMIT;
