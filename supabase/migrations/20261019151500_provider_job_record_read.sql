-- Public provider job record: the jobs behind provider_profile_read's work_record counts, one row per job where
-- the subject is the shop owner or the evidenced performer (provider_job_ids). Open, with no money and no personal
-- information: display titles follow the non-party rule (a title naming the customer falls back), the accounting
-- stage is always withheld here, counterparties appear by public handle or as 'unnamed party'.
-- Private-vehicle jobs appear only to the subject themself or a viewer holding a slot on them.
-- Contract: supabase/sql/test_provider_job_record_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.provider_job_record_read(p_user_id uuid DEFAULT NULL, p_actor_id uuid DEFAULT NULL,
  p_after uuid DEFAULT NULL, p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  self boolean := false;
  subject jsonb;
  lim integer;
  total integer;
  rows_out jsonb;
  next_after uuid;
BEGIN
  IF num_nonnulls(p_user_id, p_actor_id) <> 1 THEN
    RAISE EXCEPTION 'Exactly one of user id or actor id is required' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NOT NULL THEN
    self := uid IS NOT NULL AND uid = p_user_id;
    SELECT jsonb_build_object('kind', 'user', 'profile_id', pr.id, 'handle', NULLIF(btrim(pr.username), ''),
        'label', CASE WHEN NULLIF(btrim(pr.username), '') IS NULL THEN 'unnamed party' END)
      INTO subject FROM public.profiles pr WHERE pr.id = p_user_id AND (pr.is_public IS TRUE OR self);
    IF subject IS NULL THEN RAISE EXCEPTION 'Profile unavailable'; END IF;
  ELSE
    SELECT jsonb_build_object('kind', 'actor', 'actor_id', x.id, 'actor_type', x.actor_type, 'display', public.platform_actor_label(x.id))
      INTO subject FROM public.actors x WHERE x.id = p_actor_id;
    IF subject IS NULL THEN RAISE EXCEPTION 'Provider unavailable'; END IF;
  END IF;
  lim := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);

  WITH visible AS MATERIALIZED (
    SELECT j.work_order_id, j.subject_roles FROM public.provider_job_ids(p_user_id, p_actor_id) j
    WHERE public.work_order_vehicle_open(j.vehicle_id) OR self
      OR cardinality(COALESCE((SELECT s.slots FROM public.work_order_viewer_slots(uid, j.work_order_id) s), '{}'::text[])) > 0
  ), page AS (
    SELECT v.* FROM visible v WHERE p_after IS NULL OR v.work_order_id > p_after ORDER BY v.work_order_id LIMIT lim + 1
  ), shown AS (SELECT * FROM page ORDER BY work_order_id LIMIT lim),
  built AS (
    SELECT s.work_order_id, s.subject_roles,
      public.work_order_job_path_for_viewer(public.read_work_order_job_path(s.work_order_id), false) AS jp,
      public.work_order_open_header(s.work_order_id, false) AS h,
      public.read_work_order_resources(s.work_order_id)->'attestations' AS att
    FROM shown s
  )
  SELECT COALESCE(jsonb_agg(b.h || jsonb_build_object(
      'work_order_id', b.work_order_id, 'vehicle_id', b.jp->'vehicle_id', 'subject_roles', to_jsonb(b.subject_roles),
      'stage_states', (SELECT jsonb_object_agg(st.key, st.value->>'state') FROM jsonb_each(b.jp->'stages') st),
      'operation_kinds', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT COALESCE(li.task_type, 'unstated') k, count(*) n
        FROM public.work_order_line_items li WHERE li.work_order_id = b.work_order_id GROUP BY 1) ok), '{}'::jsonb),
      'dates', jsonb_build_object('requested_at', b.jp#>'{stages,intake,created_at}', 'quote_clock', b.jp#>'{stages,terms,quote_clock}',
        'approval_clock', b.jp#>'{stages,terms,approval_clock}', 'start_clock', b.jp#>'{stages,execution,start_clock}',
        'completion_clock', b.jp#>'{stages,completion,completion_clock}'),
      'customer_acceptance', b.jp#>'{stages,terms,customer_acceptance}',
      'counterparty_attestations', COALESCE((SELECT jsonb_agg(jsonb_build_object('attestation_kind', a->>'attestation_kind',
          'verdict', a->>'verdict', 'scope', a->>'scope', 'observed_at', a->'observed_at',
          'attestor', COALESCE(public.platform_person_label((a->>'attestor_user_id')::uuid),
            public.platform_organization_label((a->>'attestor_organization_id')::uuid)),
          'attestor_basis', 'attributed_by_source_testimony') ORDER BY a->>'observed_at', a->>'id')
        FROM jsonb_array_elements(COALESCE(b.att, '[]'::jsonb)) a), '[]'::jsonb),
      'inconsistencies', (SELECT COALESCE(jsonb_agg(i ORDER BY i), '[]'::jsonb) FROM (SELECT DISTINCT st.key || ':' || (x#>>'{}') AS i
        FROM jsonb_each(b.jp->'stages') st, jsonb_array_elements(st.value->'inconsistencies') x) ii),
      'as_of', b.jp->'as_of') ORDER BY b.work_order_id), '[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page) > lim THEN (SELECT work_order_id FROM shown ORDER BY work_order_id DESC LIMIT 1) END,
    (SELECT count(*) FROM visible)
    INTO rows_out, next_after, total FROM built b;

  RETURN jsonb_build_object(
    'viewer', public.job_reader_viewer(CASE WHEN self THEN 'self' ELSE 'visitor' END, '{}', public.viewer_identity_bridge(uid), false),
    'as_of', statement_timestamp(), 'subject', subject, 'rows', rows_out, 'next_after', next_after,
    'coverage', jsonb_build_object('returned', jsonb_array_length(rows_out), 'total_for_subject', total,
      'population', 'provider jobs (shop owner or evidenced performer) on public vehicles, or where the viewer holds a slot',
      'withheld', jsonb_build_array('accounting: payments and balances', 'customer identity'),
      'state_basis', 'presence of existing owner records and clocks; not verified truth'),
    'money', 'not_reported');
END $$;
REVOKE ALL ON FUNCTION public.provider_job_record_read(uuid, uuid, uuid, integer) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.provider_job_record_read(uuid, uuid, uuid, integer) TO anon, authenticated;
COMMENT ON FUNCTION public.provider_job_record_read(uuid, uuid, uuid, integer) IS 'Open job record behind a provider profile: provider jobs with display title, vehicle label, seven stage states, operation kinds, dates, counterparty attestations by handle or unnamed party, inconsistencies. No money or personal information; private-vehicle jobs only to the subject or slot holders.';
NOTIFY pgrst, 'reload schema';
COMMIT;
