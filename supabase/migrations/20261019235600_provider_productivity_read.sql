-- Day-rate productivity (owner: "sometimes it's easier just to pay $200 a day and then measure the productivity").
--
--   provider_productivity_read(p_user_id, p_actor_id, p_from, p_to): open (anon and authenticated). A subject is a user
--   (public profile, or the viewer themself; actors through the evidenced identity bridge) or an actor. Per day in the
--   range (default the last 90 days, at most 366):
--     * signed: self_confirmed (the subject confirmed that work day: work_sessions.owner_confirmed_at) and
--       customer_accepted (a session that day inside the job window of a work order whose provider completion by the
--       subject the customer accepted), shown separately;
--     * capture_span_minutes: the photo capture span of work sessions, labelled as such; never labor time;
--     * operations_completed (component events attributed to the subject's actors), specs_reported_performed,
--       image_evidence (the subject's own photos), completions_accepted.
--   Day-rate jobs: accepted day-rate terms (accepted offers by the subject, accepted quotes issued by the subject: rate,
--   currency, quantity in days; rates are open) against signed days in the job window. No totals, payouts or payments.
--   Non-self viewers see only activity on public vehicles and gate-cleared photos; no vehicle ids. Inferred minutes are
--   never adopted (equipment_usage_evidence, technician_work_evidence are not read).
-- Contract: supabase/sql/test_provider_productivity_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.provider_productivity_read(p_user_id uuid DEFAULT NULL, p_actor_id uuid DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  viewer uuid := auth.uid();
  subject_user uuid := p_user_id;
  actor_ids uuid[];
  self boolean;
  d_from date := COALESCE(p_from, current_date - 90);
  d_to date := COALESCE(p_to, current_date);
  days jsonb;
  jobs jsonb;
BEGIN
  IF num_nonnulls(p_user_id, p_actor_id) <> 1 THEN RAISE EXCEPTION 'Name one subject: p_user_id or p_actor_id' USING ERRCODE = '22023'; END IF;
  IF d_from > d_to OR d_to - d_from > 366 THEN RAISE EXCEPTION 'Range must run forward and cover at most 366 days' USING ERRCODE = '22023'; END IF;
  IF p_actor_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.actors WHERE id = p_actor_id) THEN RAISE EXCEPTION 'Provider unavailable' USING ERRCODE = '42501'; END IF;
    actor_ids := ARRAY[p_actor_id];
  ELSE
    IF NOT (viewer = p_user_id OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p_user_id AND pr.is_public IS TRUE)) THEN
      RAISE EXCEPTION 'Provider unavailable' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(array_agg(x::uuid), '{}') INTO actor_ids FROM jsonb_array_elements_text(public.viewer_identity_bridge(p_user_id)->'evidenced_actor_ids') x;
  END IF;
  self := viewer IS NOT NULL AND viewer = subject_user;

  WITH accepted AS (
    SELECT acc.id, acc.work_order_id, acc.signed_at, w.vehicle_id, public.work_order_evidence_window(acc.work_order_id) AS win
    FROM public.work_order_completion_acceptances acc
    JOIN public.vehicle_observations sa ON sa.id = acc.id AND sa.is_superseded IS FALSE
    JOIN public.work_order_completion_attestations att ON att.id = acc.completion_id
    JOIN public.work_orders w ON w.id = acc.work_order_id
    WHERE subject_user IS NOT NULL AND att.signer_user_id = subject_user
      AND public.work_order_completion_overlay(acc.work_order_id, '{}'::jsonb)#>>'{customer_acceptance_sign,acceptance_id}' = acc.id::text
  ), sessions AS (
    SELECT s.session_date AS day, s.duration_minutes, s.owner_confirmed_at IS NOT NULL AS confirmed,
      EXISTS (SELECT 1 FROM accepted a WHERE a.vehicle_id = s.vehicle_id
        AND s.session_date BETWEEN (a.win->>'from')::date AND (a.win->>'until')::date) AS in_accepted_job
    FROM public.work_sessions s LEFT JOIN public.vehicles v ON v.id = s.vehicle_id
    WHERE subject_user IS NOT NULL AND s.user_id = subject_user AND s.session_date BETWEEN d_from AND d_to AND (self OR v.is_public IS TRUE)
  ), ops AS (
    SELECT ce.event_date AS day, count(*) AS n FROM public.component_events ce LEFT JOIN public.vehicles v ON v.id = ce.vehicle_id
    WHERE ce.actor_id = ANY (actor_ids) AND ce.event_date BETWEEN d_from AND d_to AND (self OR v.is_public IS TRUE) GROUP BY 1
  ), specs AS (
    SELECT COALESCE(ce.event_date, s.observed_at::date) AS day, count(*) AS n
    FROM public.work_order_resource_specifications sp JOIN public.vehicle_observations s ON s.id = sp.id AND s.is_superseded IS FALSE
    LEFT JOIN public.work_order_line_items li ON li.id = sp.line_item_id
    LEFT JOIN public.component_events ce ON ce.id = sp.basis_component_event_id
    LEFT JOIN public.vehicles v ON v.id = s.vehicle_id
    WHERE sp.specification_stage = 'reported_performed' AND COALESCE(li.actor_id, ce.actor_id) = ANY (actor_ids) AND (self OR v.is_public IS TRUE)
      AND COALESCE(ce.event_date, s.observed_at::date) BETWEEN d_from AND d_to GROUP BY 1
  ), imgs AS (
    SELECT vi.taken_at::date AS day, count(*) AS n FROM public.vehicle_images vi LEFT JOIN public.vehicles v ON v.id = vi.vehicle_id
    WHERE subject_user IS NOT NULL AND vi.user_id = subject_user AND vi.taken_at >= d_from::timestamptz AND vi.taken_at < (d_to + 1)::timestamptz
      AND (self OR (v.is_public IS TRUE AND COALESCE(vi.is_sensitive, false) = false AND COALESCE(vi.is_superseded, false) = false
        AND (vi.vision_gate_status IS NULL OR vi.vision_gate_status::text NOT IN ('rejected_personal','rejected_misattributed','review_needed'))))
    GROUP BY 1
  ), comps AS (
    SELECT a.signed_at::date AS day, count(*) AS n FROM accepted a LEFT JOIN public.vehicles v ON v.id = a.vehicle_id
    WHERE a.signed_at::date BETWEEN d_from AND d_to AND (self OR v.is_public IS TRUE) GROUP BY 1
  ), all_days AS (
    SELECT day FROM sessions UNION SELECT day FROM ops UNION SELECT day FROM specs UNION SELECT day FROM imgs UNION SELECT day FROM comps
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d.day,
      'signed', jsonb_build_object('self_confirmed', COALESCE((SELECT bool_or(s.confirmed) FROM sessions s WHERE s.day = d.day), false),
        'customer_accepted', COALESCE((SELECT bool_or(s.in_accepted_job) FROM sessions s WHERE s.day = d.day), false)),
      'capture_span_minutes', (SELECT sum(s.duration_minutes) FROM sessions s WHERE s.day = d.day),
      'operations_completed', COALESCE((SELECT n FROM ops o WHERE o.day = d.day), 0),
      'specs_reported_performed', COALESCE((SELECT n FROM specs x WHERE x.day = d.day), 0),
      'image_evidence', CASE WHEN subject_user IS NULL THEN NULL ELSE COALESCE((SELECT n FROM imgs i WHERE i.day = d.day), 0) END,
      'completions_accepted', COALESCE((SELECT n FROM comps c WHERE c.day = d.day), 0)) ORDER BY d.day DESC), '[]'::jsonb)
  INTO days FROM all_days d;

  WITH terms AS (
    SELECT ap.offer_id AS ref_id, w.id AS work_order_id, w.vehicle_id, 'accepted_offer' AS source, ln AS line
    FROM public.work_orders w CROSS JOIN LATERAL public.work_order_accepted_providers(w.id) ap
    JOIN public.work_order_resource_fulfillments f ON f.id = ap.offer_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f.offer_terms->'lines', '[]'::jsonb)) ln
    WHERE subject_user IS NOT NULL AND ap.account_id = subject_user AND ln->>'pricing_basis' = 'day_rate'
      AND w.id IN (SELECT a.work_order_id FROM public.work_order_assignments a WHERE a.accepted_by_user_id IS NOT NULL)
    UNION ALL
    SELECT q.id, w.id, w.vehicle_id, 'accepted_quote', ln
    FROM public.work_order_quotes q JOIN public.work_orders w ON w.id = q.work_order_id
    CROSS JOIN LATERAL jsonb_array_elements(q.lines) ln
    WHERE subject_user IS NOT NULL AND q.quoting_user_id = subject_user AND ln->>'pricing_basis' = 'day_rate'
      AND public.work_order_quote_state(w.id)#>>'{acceptance,quote_id}' = q.id::text
      AND public.work_order_quote_state(w.id)#>>'{acceptance,state}' = 'accepted'
  ), per_job AS (
    SELECT t.work_order_id, t.vehicle_id, jsonb_agg(DISTINCT jsonb_build_object('source', t.source, 'ref_id', t.ref_id, 'description', t.line->'description',
        'rate', t.line->'amount', 'currency', t.line->'currency', 'quantity_days', t.line->'quantity')) AS lines,
      sum((t.line->>'quantity')::numeric) AS days_agreed
    FROM terms t LEFT JOIN public.vehicles v ON v.id = t.vehicle_id
    WHERE self OR v.is_public IS TRUE OR (viewer IS NOT NULL AND cardinality(COALESCE((SELECT sl.slots FROM public.work_order_viewer_slots(viewer, t.work_order_id) sl), '{}'::text[])) > 0)
    GROUP BY t.work_order_id, t.vehicle_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('work_order_id', j.work_order_id,
      'display_title', public.work_order_open_header(j.work_order_id, false)->'display_title',
      'day_rate_terms', j.lines, 'days_agreed', j.days_agreed,
      'signed_days', (SELECT jsonb_build_object(
          'self_confirmed', count(DISTINCT s.session_date) FILTER (WHERE s.owner_confirmed_at IS NOT NULL),
          'customer_accepted', count(DISTINCT s.session_date) FILTER (WHERE EXISTS (SELECT 1 FROM public.work_order_completion_acceptances acc
              JOIN public.work_order_completion_attestations att ON att.id = acc.completion_id
              WHERE acc.work_order_id = j.work_order_id AND att.signer_user_id = subject_user
                AND public.work_order_completion_overlay(j.work_order_id, '{}'::jsonb)#>>'{customer_acceptance_sign,acceptance_id}' = acc.id::text)),
          'window', public.work_order_evidence_window(j.work_order_id))
        FROM public.work_sessions s WHERE s.user_id = subject_user AND s.vehicle_id = j.vehicle_id
          AND s.session_date BETWEEN (public.work_order_evidence_window(j.work_order_id)->>'from')::date
            AND (public.work_order_evidence_window(j.work_order_id)->>'until')::date),
      'basis', 'accepted day-rate terms (rates open) against days the subject signed inside the job window; no totals or payments')
    ORDER BY j.work_order_id), '[]'::jsonb)
  INTO jobs FROM per_job j;

  RETURN jsonb_build_object('subject', CASE WHEN p_actor_id IS NOT NULL THEN public.platform_actor_label(p_actor_id)
      ELSE public.platform_person_label(p_user_id) END,
    'range', jsonb_build_object('from', d_from, 'to', d_to), 'as_of', statement_timestamp(), 'days', days, 'day_rate_jobs', jobs,
    'totals', jsonb_build_object('days_with_activity', jsonb_array_length(days),
      'self_confirmed_days', (SELECT count(*) FROM jsonb_array_elements(days) x WHERE (x#>>'{signed,self_confirmed}')::boolean),
      'customer_accepted_days', (SELECT count(*) FROM jsonb_array_elements(days) x WHERE (x#>>'{signed,customer_accepted}')::boolean),
      'operations_completed', (SELECT COALESCE(sum((x->>'operations_completed')::int), 0) FROM jsonb_array_elements(days) x),
      'completions_accepted', (SELECT COALESCE(sum((x->>'completions_accepted')::int), 0) FROM jsonb_array_elements(days) x)),
    'basis', jsonb_build_object(
      'capture_span_minutes', 'span between the first and last photo of a work session; not labor time',
      'customer_accepted', 'a work-session day inside the window of a job whose provider completion by the subject the customer accepted',
      'self_confirmed', 'the subject confirmed the work day (confirm_work_session)',
      'not_adopted', jsonb_build_array('equipment_usage_evidence minutes', 'technician_work_evidence durations', 'any inferred minutes'),
      'visibility', CASE WHEN self THEN 'self: all own activity' ELSE 'public vehicles and gate-cleared photos only; no vehicle ids' END,
      'money', 'day rates are open terms; totals, payouts and payments are never shown'),
    'viewer', jsonb_build_object('self', self, 'decided_from', 'auth.uid()'),
    'payment_authorized', false);
END $$;
REVOKE ALL ON FUNCTION public.provider_productivity_read(uuid,uuid,date,date) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.provider_productivity_read(uuid,uuid,date,date) TO anon, authenticated;
COMMENT ON FUNCTION public.provider_productivity_read(uuid,uuid,date,date) IS 'Open per-day productivity of a provider (user via evidenced links, or actor): signed days by rung (self-confirmed, customer-accepted), labelled capture span, operations, performed specs, photo evidence, accepted completions; accepted day-rate terms vs signed days (rates open; no totals or payments). Public vehicles only for others; inferred minutes never adopted.';
NOTIFY pgrst, 'reload schema';
COMMIT;
