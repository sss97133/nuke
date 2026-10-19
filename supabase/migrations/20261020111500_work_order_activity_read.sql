-- Live activity feed of one job, so a client can show what just happened and poll cheaply for changes.
--   work_order_activity_read(p_work_order_id, p_since, p_limit): the job's events newest first, from the tables that hold
--     them: request (work_orders.created_at), offers (resource fulfillments), quote and change-order versions, quote
--     acceptances, provider bookings (assignments.accepted_at), work starts, evidence photos (visible thumbnails only),
--     completion attestations and acceptances, invoice versions, processor payments and payment witnesses, recorded status
--     changes, and retained message testimony (one event per message and side, at the message's own clock).
--     Each event: kind, at (when it happened), recorded_at (when Nuke learned it), basis (authenticated_sign | record |
--     processor_record | message_testimony), role or side (never a user id), a plain title, refs for tap-through.
--     No amounts and no message text. p_since keeps events recorded after that clock. live: latest clocks, a version that
--     changes when any event is added, and a suggested poll interval from the job's current phase.
--   Gate and party rule as work_order_evidence_read.
-- Contract: supabase/sql/test_work_order_activity_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.work_order_activity_read(p_work_order_id uuid, p_since timestamptz DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  viewer uuid := auth.uid();
  w public.work_orders%ROWTYPE;
  my_slots text[];
  party boolean;
  lim integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  all_events jsonb;
  shown jsonb;
  phase text;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(viewer, w.id) s;
  my_slots := COALESCE(my_slots, '{}'::text[]);
  IF cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(w.vehicle_id) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  party := public.job_reader_is_party(my_slots) OR public.work_order_evidence_role(w.id, viewer) IS NOT NULL;

  WITH ev AS (
    SELECT 'requested' kind, w.id ref_id, w.created_at at, w.created_at recorded_at, 'record' basis, 'customer' role, 'Job requested' title,
      NULL::jsonb media
    WHERE w.created_at IS NOT NULL
    UNION ALL
    SELECT 'offer', f.id, f.recorded_at, f.recorded_at, 'authenticated_sign', 'provider',
      CASE f.offer_kind WHEN 'tool' THEN 'Tool offered' WHEN 'facility' THEN 'Space offered' ELSE 'Offer to do the work' END, NULL
    FROM public.work_order_resource_fulfillments f WHERE f.work_order_id = w.id
    UNION ALL
    SELECT 'quote', q.id, q.recorded_at, q.recorded_at, 'authenticated_sign', COALESCE(q.quoting_party_kind, 'provider'),
      format(CASE WHEN q.change_order IS NOT NULL THEN 'Change order v%s issued' ELSE 'Quote v%s issued' END, q.version), NULL
    FROM public.work_order_quotes q WHERE q.work_order_id = w.id
    UNION ALL
    SELECT 'quote_accepted', a.id, a.signed_at, a.recorded_at, 'authenticated_sign', a.signer_role,
      CASE WHEN q.change_order IS NOT NULL THEN 'Change order accepted' ELSE 'Quote accepted' END, NULL
    FROM public.work_order_quote_acceptances a LEFT JOIN public.work_order_quotes q ON q.id = a.quote_id WHERE a.work_order_id = w.id
    UNION ALL
    SELECT 'provider_booked', s.id, s.accepted_at, s.accepted_at, CASE WHEN s.acceptance_observation_id IS NOT NULL THEN 'authenticated_sign' ELSE 'record' END,
      'customer', 'Provider booked', NULL
    FROM public.work_order_assignments s WHERE s.work_order_id = w.id AND s.accepted_at IS NOT NULL
    UNION ALL
    SELECT 'work_started', s.id, s.started_at, s.recorded_at, 'authenticated_sign', s.signer_role, 'Work started', NULL
    FROM public.work_order_work_starts s WHERE s.work_order_id = w.id
    UNION ALL
    SELECT 'evidence', a.id, a.attached_at, a.recorded_at, 'authenticated_sign', a.attacher_role,
      format('%s photo%s added', a.image_count, CASE WHEN a.image_count = 1 THEN '' ELSE 's' END),
      (SELECT jsonb_build_object('thumbnails', COALESCE(jsonb_agg(t.u) FILTER (WHERE t.rn <= 3), '[]'::jsonb),
          'withheld', count(*) FILTER (WHERE t.u IS NULL))
        FROM (SELECT CASE WHEN public.work_order_evidence_image_visible(vi.id, viewer) THEN COALESCE(vi.thumbnail_url, vi.medium_url, vi.image_url) END u,
            row_number() OVER (ORDER BY public.work_order_evidence_image_visible(vi.id, viewer) DESC, COALESCE(vi.taken_at, vi.created_at), vi.id) rn
          FROM public.work_order_evidence_images ei JOIN public.vehicle_images vi ON vi.id = ei.image_id WHERE ei.attachment_id = a.id) t)
    FROM public.work_order_evidence_attachments a JOIN public.vehicle_observations o ON o.id = a.id AND o.is_superseded IS FALSE
    WHERE a.work_order_id = w.id
    UNION ALL
    SELECT 'completion_attested', c.id, c.signed_at, c.recorded_at, 'authenticated_sign', c.signer_role, 'Work marked complete', NULL
    FROM public.work_order_completion_attestations c WHERE c.work_order_id = w.id
    UNION ALL
    SELECT 'completion_accepted', c.id, c.signed_at, c.recorded_at, 'authenticated_sign', c.signer_role, 'Completion accepted', NULL
    FROM public.work_order_completion_acceptances c WHERE c.work_order_id = w.id
    UNION ALL
    SELECT 'invoice_issued', i.id, i.issued_at, i.recorded_at, 'authenticated_sign', i.issuer_role, format('Invoice v%s issued', i.version), NULL
    FROM public.work_order_invoices i WHERE i.work_order_id = w.id
    UNION ALL
    SELECT 'paid', p.id, p.paid_at, p.recorded_at, 'processor_record', 'customer',
      CASE WHEN p.livemode IS FALSE THEN 'Test card payment recorded' ELSE 'Paid by card' END, NULL
    FROM public.work_order_processor_payments p WHERE p.work_order_id = w.id
    UNION ALL
    SELECT 'payment_witnessed', p.id, p.paid_at, p.recorded_at, 'authenticated_sign', p.witness_side,
      CASE p.witness_side WHEN 'payee' THEN 'Payment received, confirmed by the provider' ELSE 'Payment sent, recorded by the customer' END, NULL
    FROM public.work_order_payment_witnesses p WHERE p.work_order_id = w.id
    UNION ALL
    SELECT 'status_changed', h.id, h.created_at, h.created_at, 'record', NULL,
      'Status recorded as ' || replace(COALESCE(h.new_status, 'unknown'), '_', ' '), NULL
    FROM public.work_order_status_history h WHERE h.work_order_id = w.id
    UNION ALL
    SELECT 'message', min(t.id::text)::uuid, o.observed_at, max(t.recorded_at), 'message_testimony', t.speaker_side,
      format('Message from the %s: %s', CASE t.speaker_side WHEN 'client' THEN 'customer' WHEN 'provider' THEN 'shop' ELSE t.speaker_side END,
        string_agg(DISTINCT CASE t.lifecycle_stage WHEN 'terms_accepted' THEN 'terms accepted' WHEN 'work_paused' THEN 'work paused'
          WHEN 'operation_completed' THEN 'work finished' WHEN 'invoice_issued' THEN 'invoice sent' ELSE replace(t.lifecycle_stage, '_', ' ') END, ', ')),
      NULL
    FROM public.work_order_retained_testimony t JOIN public.vehicle_observations o ON o.id = t.basis_observation_id
    WHERE t.work_order_id = w.id GROUP BY t.basis_observation_id, o.observed_at, t.speaker_side
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', e.kind, 'ref_id', e.ref_id, 'at', e.at, 'recorded_at', e.recorded_at, 'basis', e.basis,
      'role', e.role, 'title', e.title, 'media', e.media) ORDER BY e.at DESC NULLS LAST, e.recorded_at DESC, e.ref_id), '[]'::jsonb)
  INTO all_events FROM ev e WHERE e.at IS NOT NULL;

  SELECT COALESCE(jsonb_agg(x ORDER BY ord), '[]'::jsonb) INTO shown FROM (
    SELECT x, ord FROM jsonb_array_elements(all_events) WITH ORDINALITY a(x, ord)
    WHERE p_since IS NULL OR (x->>'recorded_at')::timestamptz > p_since
    ORDER BY ord LIMIT lim) s;

  phase := CASE
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(all_events) x WHERE x->>'kind' IN ('paid', 'payment_witnessed')) THEN 'settled'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(all_events) x WHERE x->>'kind' IN ('completion_attested', 'completion_accepted', 'invoice_issued')) THEN 'closing'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(all_events) x WHERE x->>'kind' IN ('work_started', 'evidence')) THEN 'in_progress'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(all_events) x WHERE x->>'kind' IN ('offer', 'quote', 'quote_accepted', 'provider_booked')) THEN 'booking'
    ELSE 'requested' END;

  RETURN jsonb_build_object('work_order_id', w.id, 'as_of', statement_timestamp(), 'since', p_since,
    'events', shown,
    'live', jsonb_build_object(
      'latest_at', (SELECT max((x->>'at')::timestamptz) FROM jsonb_array_elements(all_events) x),
      'latest_recorded_at', (SELECT max((x->>'recorded_at')::timestamptz) FROM jsonb_array_elements(all_events) x),
      'events_total', jsonb_array_length(all_events),
      'version', md5(COALESCE((SELECT string_agg((x->>'kind') || (x->>'ref_id') || (x->>'recorded_at'), '|' ORDER BY x->>'ref_id', x->>'kind')
        FROM jsonb_array_elements(all_events) x), '')),
      'phase', phase, 'phase_basis', 'latest kind of event on record; not a stage verdict (see work_order_job_path_read)',
      'poll_after_seconds', CASE phase WHEN 'in_progress' THEN 15 WHEN 'booking' THEN 30 WHEN 'closing' THEN 30 WHEN 'requested' THEN 60 ELSE 300 END),
    'viewer', jsonb_build_object('party', party),
    'basis', jsonb_build_object(
      'authenticated_sign', 'a signed-in party signed it through Nuke',
      'record', 'recorded on the work order without a Sign',
      'processor_record', 'the payment processor reported it',
      'message_testimony', 'quoted from retained messages; not a Sign and not verified; message text is not shown',
      'privacy', 'roles only, no user ids, no amounts; photo thumbnails only where the viewer may see them'));
END $$;
REVOKE ALL ON FUNCTION public.work_order_activity_read(uuid,timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_order_activity_read(uuid,timestamptz,integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.work_order_activity_read(uuid,timestamptz,integer) IS 'Live activity feed of a job (events newest first, live version and poll interval); same gate as the open job readers; roles only, no amounts.';

NOTIFY pgrst, 'reload schema';
COMMIT;
