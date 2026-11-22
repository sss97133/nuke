-- correct_work_order_vehicle: the sanctioned way to move a work order to a different vehicle, with a reason, evidence, an
-- actor and an undo. Before this, the only way was a raw UPDATE of work_orders.vehicle_id with hand-written metadata keys
-- (vehicle_id_old / vehicle_id_new / vehicle_id_corrected_at / correction_source), which left no journal row and no undo.
--
-- Journal: the existing append-only work_order_scalar_corrections (20261020000500) gains the columns a vehicle move needs.
--   old_ref / new_ref       the vehicle before and after (old_value / new_value stay numeric, for the totals rows)
--   evidence                the caller's cited evidence (jsonb object)
--   actor_user_id           the person the correction is made for
--   writer                  'correct_work_order_vehicle'
--   reverses_correction_id  set when this move is the exact reverse of the latest move (the undo)
--   metadata_before         the work order's vehicle_id_old / vehicle_id_new / vehicle_id_corrected_at /
--                           vehicle_id_correction_ref keys as they were (and correction_source, read only), since the
--                           writer rewrites the four vehicle keys to describe the new move
-- The 21 existing totals rows keep passing the widened checks; migration_version on a vehicle row is this migration's
-- version (the code that made the change). The table stays service-read-only and append-only.
--
-- Contract of correct_work_order_vehicle(p_work_order_id, p_to_vehicle_id, p_reason, p_evidence, p_actor):
--   - Callers: the service role, for an actor tied to both vehicles (vehicle_user_has_access); or a signed-in user who is
--     p_actor and can edit both the current and the target vehicle (user_can_edit_vehicle, the helper
--     approve_vehicle_merge_proposal uses). Every other role is refused in the body; PUBLIC and anon have no EXECUTE.
--   - Refuses: a reason under 10 characters, evidence that is not a non-empty object, no actor, a missing work order, a
--     work order with no vehicle, a no-op move, a target that is missing, merged or deleted, a requested job
--     (request_observation_id; work_order_link_guard makes its vehicle immutable), and a work order with a parent or child
--     work order (an inspection and its parent must share a vehicle).
--   - Refuses, with per-table counts, a work order that has rows carrying their own copy of the current vehicle or signed
--     history bound to it, because moving the work order would leave them on the old vehicle:
--       own vehicle copy: timeline_events, component_events, financial_vehicle_uses (vehicle_id = current), parts_transfers
--         (dest_vehicle_id = current), work_order_line_items pointing at a vehicle_build_manifest row of the current vehicle;
--       signed lifecycle: vehicle_observations on the current vehicle keyed 'work_order_<kind>:<work order id>', and any row
--         in work_order_quotes, work_order_quote_acceptances, work_order_invoices, work_order_payments,
--         work_order_payment_witnesses, work_order_processor_payments, work_order_work_starts,
--         work_order_completion_attestations, work_order_completion_acceptances, work_order_evidence_attachments,
--         work_order_resource_requirements, work_order_retained_testimony, work_order_retained_source_bindings.
--     Those rows are testimony; they are superseded through their own writers, never rewritten here.
--   - Read through the work order, so they follow the move with no write: work_order_parts, work_order_labor,
--     work_order_line_items (other components), work_order_status_history, work_order_assignments,
--     work_order_evidence_images, work_order_resource_specifications / _fulfillments / _attestations, project_economics,
--     purchase_orders, generated_invoices, supplier_invites, facility_reservations, actor_capability_basis, and the views
--     work_order_receipt_unified (wo.vehicle_id) and vehicle_timeline_events (timeline_events, refused above).
--   - Writes one journal row, then updates work_orders.vehicle_id and the four vehicle metadata keys
--     (vehicle_id_correction_ref = 'work_order_scalar_corrections:<id>'). It never writes correction_source, which hand
--     corrections used for other keys too. It raises if any other column changed in the update
--     (calculate_work_order_estimate runs on every UPDATE).
--   - Undo window: the undo is refused like any move once a quote, invoice, payment or other signed row lands on the
--     work order, so check the move before issuing any of those.
--   - Undo: call it again pointing back. When the latest vehicle move of the work order is the exact reverse, the new row's
--     reverses_correction_id names it.
-- Contract test: supabase/sql/test_correct_work_order_vehicle.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.work_order_scalar_corrections
  ADD COLUMN IF NOT EXISTS old_ref uuid,
  ADD COLUMN IF NOT EXISTS new_ref uuid,
  ADD COLUMN IF NOT EXISTS evidence jsonb,
  ADD COLUMN IF NOT EXISTS actor_user_id uuid,
  ADD COLUMN IF NOT EXISTS writer text,
  ADD COLUMN IF NOT EXISTS reverses_correction_id uuid REFERENCES public.work_order_scalar_corrections(id),
  ADD COLUMN IF NOT EXISTS metadata_before jsonb;

ALTER TABLE public.work_order_scalar_corrections DROP CONSTRAINT IF EXISTS work_order_scalar_corrections_column_name_check;
ALTER TABLE public.work_order_scalar_corrections DROP CONSTRAINT IF EXISTS work_order_scalar_corrections_reason_check;
ALTER TABLE public.work_order_scalar_corrections DROP CONSTRAINT IF EXISTS work_order_scalar_corrections_shape_check;
ALTER TABLE public.work_order_scalar_corrections ADD CONSTRAINT work_order_scalar_corrections_column_name_check
  CHECK (column_name IN ('estimated_total', 'actual_total', 'vehicle_id'));
ALTER TABLE public.work_order_scalar_corrections ADD CONSTRAINT work_order_scalar_corrections_shape_check CHECK (
  (column_name IN ('estimated_total', 'actual_total') AND reason = 'invented_zero_no_priced_basis'
     AND old_ref IS NULL AND new_ref IS NULL AND reverses_correction_id IS NULL)
  OR (column_name = 'vehicle_id' AND writer = 'correct_work_order_vehicle'
     AND old_value IS NULL AND new_value IS NULL
     AND old_ref IS NOT NULL AND new_ref IS NOT NULL AND old_ref <> new_ref
     AND length(btrim(reason)) >= 10 AND actor_user_id IS NOT NULL
     AND jsonb_typeof(evidence) = 'object' AND evidence <> '{}'::jsonb));

COMMENT ON TABLE public.work_order_scalar_corrections IS
  'Append-only audit of corrections to work_orders scalars. Totals rows (estimated_total, actual_total: old_value/new_value, written by the reviewed migration 20261020000500). Vehicle moves (vehicle_id: old_ref/new_ref, reason, evidence, actor_user_id, reverses_correction_id for an undo, metadata_before) written only by correct_work_order_vehicle.';

CREATE OR REPLACE FUNCTION public.correct_work_order_vehicle(
  p_work_order_id uuid,
  p_to_vehicle_id uuid,
  p_reason text,
  p_evidence jsonb,
  p_actor uuid
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer CONSTANT text := 'correct_work_order_vehicle';
  c_version CONSTANT text := '20261121231500';
  c_meta_keys CONSTANT text[] := ARRAY['vehicle_id_old', 'vehicle_id_new', 'vehicle_id_corrected_at', 'vehicle_id_correction_ref',
    'correction_source'];
  -- Lifecycle writers key their Sign observations '<kind>:' || work order id (live pg_proc, 2026-11-21).
  c_sign_kinds CONSTANT text[] := ARRAY['work_order_quote', 'work_order_quote_issue', 'work_order_change_order',
    'work_order_invoice', 'work_order_lifecycle', 'work_order_part_approval', 'work_order_evidence',
    'work_order_completion_attestation', 'work_order_publication', 'work_order_publication_operation',
    'work_order_publication_requirement', 'work_order_start'];
  c_lifecycle CONSTANT text[] := ARRAY['work_order_quotes', 'work_order_quote_acceptances', 'work_order_invoices',
    'work_order_payments', 'work_order_payment_witnesses', 'work_order_processor_payments', 'work_order_work_starts',
    'work_order_completion_attestations', 'work_order_completion_acceptances', 'work_order_evidence_attachments',
    'work_order_resource_requirements', 'work_order_retained_testimony', 'work_order_retained_source_bindings'];
  v_role text := coalesce(auth.role(), '');
  v_uid uuid := auth.uid();
  v_old public.work_orders%ROWTYPE;
  v_new public.work_orders%ROWTYPE;
  v_from uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_holds jsonb := '{}'::jsonb;
  v_n bigint;
  v_t text;
  v_prev public.work_order_scalar_corrections%ROWTYPE;
  v_reverses uuid;
  v_meta_before jsonb;
  v_id uuid;
  v_ignore CONSTANT text[] := ARRAY['vehicle_id', 'metadata', 'updated_at'];
BEGIN
  IF v_role NOT IN ('service_role', 'authenticated') THEN
    RAISE EXCEPTION '%: only the service role or a signed-in editor of both vehicles may move a work order', c_writer
      USING ERRCODE = '42501';
  END IF;
  IF p_work_order_id IS NULL OR p_to_vehicle_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION '%: a work order, a target vehicle and an actor are required', c_writer USING ERRCODE = '22023';
  END IF;
  IF length(v_reason) < 10 THEN
    RAISE EXCEPTION '%: a reason of at least 10 characters is required', c_writer USING ERRCODE = '22023';
  END IF;
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' OR p_evidence = '{}'::jsonb THEN
    RAISE EXCEPTION '%: evidence must be a non-empty object citing the sources', c_writer USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    IF v_role = 'authenticated' THEN
      RAISE EXCEPTION '%: you must be the actor and able to edit both vehicles', c_writer USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION '%: work order % not found', c_writer, p_work_order_id USING ERRCODE = 'P0002';
  END IF;
  v_from := v_old.vehicle_id;
  -- The caller check comes before any answer that would reveal the work order's vehicle or the target's state.
  IF v_role = 'authenticated' THEN
    IF v_uid IS NULL OR p_actor IS DISTINCT FROM v_uid OR v_from IS NULL
       OR NOT public.user_can_edit_vehicle(v_from, v_uid) OR NOT public.user_can_edit_vehicle(p_to_vehicle_id, v_uid) THEN
      RAISE EXCEPTION '%: you must be the actor and able to edit both vehicles', c_writer USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_from IS NULL THEN
    RAISE EXCEPTION '%: work order % has no vehicle; this writer moves, it does not attach', c_writer, p_work_order_id
      USING ERRCODE = '22023';
  END IF;
  IF v_from = p_to_vehicle_id THEN
    RAISE EXCEPTION '%: work order % is already on vehicle %', c_writer, p_work_order_id, p_to_vehicle_id USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.vehicles v WHERE v.id = p_to_vehicle_id
    AND v.status IS DISTINCT FROM 'merged' AND v.merged_into_vehicle_id IS NULL AND v.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: target vehicle % is missing, merged or deleted', c_writer, p_to_vehicle_id USING ERRCODE = '22023';
  END IF;
  IF v_role = 'service_role' AND (NOT public.vehicle_user_has_access(v_from, p_actor)
      OR NOT public.vehicle_user_has_access(p_to_vehicle_id, p_actor)) THEN
    RAISE EXCEPTION '%: actor % is not tied to both vehicles', c_writer, p_actor USING ERRCODE = '42501';
  END IF;

  IF v_old.request_observation_id IS NOT NULL THEN
    RAISE EXCEPTION '%: work order % is a requested job; its vehicle is fixed by the request Sign', c_writer, p_work_order_id
      USING ERRCODE = '22023';
  END IF;
  IF v_old.parent_work_order_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.work_orders c WHERE c.parent_work_order_id = p_work_order_id) THEN
    RAISE EXCEPTION '%: work order % has a parent or child work order on the same vehicle', c_writer, p_work_order_id
      USING ERRCODE = '22023';
  END IF;

  -- Rows that carry their own copy of the current vehicle, or signed history bound to it.
  SELECT count(*) INTO v_n FROM public.timeline_events WHERE work_order_id = p_work_order_id AND vehicle_id = v_from;
  IF v_n > 0 THEN v_holds := v_holds || jsonb_build_object('timeline_events', v_n); END IF;
  SELECT count(*) INTO v_n FROM public.component_events WHERE work_order_id = p_work_order_id AND vehicle_id = v_from;
  IF v_n > 0 THEN v_holds := v_holds || jsonb_build_object('component_events', v_n); END IF;
  SELECT count(*) INTO v_n FROM public.financial_vehicle_uses WHERE work_order_id = p_work_order_id AND vehicle_id = v_from;
  IF v_n > 0 THEN v_holds := v_holds || jsonb_build_object('financial_vehicle_uses', v_n); END IF;
  SELECT count(*) INTO v_n FROM public.parts_transfers WHERE dest_work_order_id = p_work_order_id AND dest_vehicle_id = v_from;
  IF v_n > 0 THEN v_holds := v_holds || jsonb_build_object('parts_transfers', v_n); END IF;
  SELECT count(*) INTO v_n FROM public.work_order_line_items li JOIN public.vehicle_build_manifest m
      ON li.component_table = 'vehicle_build_manifest' AND m.id = li.component_id
    WHERE li.work_order_id = p_work_order_id AND m.vehicle_id = v_from;
  IF v_n > 0 THEN v_holds := v_holds || jsonb_build_object('work_order_line_items_on_build_manifest', v_n); END IF;
  SELECT count(*) INTO v_n FROM public.vehicle_observations o
    WHERE o.vehicle_id = v_from
      AND o.source_identifier = ANY (ARRAY(SELECT k || ':' || p_work_order_id::text FROM unnest(c_sign_kinds) k));
  IF v_n > 0 THEN v_holds := v_holds || jsonb_build_object('vehicle_observations_signed', v_n); END IF;
  FOREACH v_t IN ARRAY c_lifecycle LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE work_order_id = $1', v_t) INTO v_n USING p_work_order_id;
    IF v_n > 0 THEN v_holds := v_holds || jsonb_build_object(v_t, v_n); END IF;
  END LOOP;
  IF v_holds <> '{}'::jsonb THEN
    RAISE EXCEPTION '%: work order % has rows bound to vehicle %: %', c_writer, p_work_order_id, v_from, v_holds
      USING ERRCODE = '22023', HINT = 'Supersede those rows through their own writers first; this writer never rewrites them.';
  END IF;

  -- The undo: the latest vehicle move of this work order, when this move is its exact reverse.
  SELECT * INTO v_prev FROM public.work_order_scalar_corrections
    WHERE work_order_id = p_work_order_id AND column_name = 'vehicle_id'
    ORDER BY applied_at DESC, id DESC LIMIT 1;
  IF FOUND AND v_prev.new_ref = v_from AND v_prev.old_ref = p_to_vehicle_id THEN
    v_reverses := v_prev.id;
  END IF;

  SELECT jsonb_object_agg(e.key, e.value) INTO v_meta_before
    FROM jsonb_each(coalesce(v_old.metadata, '{}'::jsonb)) e WHERE e.key = ANY (c_meta_keys);

  INSERT INTO public.work_order_scalar_corrections (work_order_id, column_name, old_value, new_value, reason, migration_version,
      old_ref, new_ref, evidence, actor_user_id, writer, reverses_correction_id, metadata_before)
    VALUES (p_work_order_id, 'vehicle_id', NULL, NULL, v_reason, c_version,
      v_from, p_to_vehicle_id, p_evidence, p_actor, c_writer, v_reverses, coalesce(v_meta_before, '{}'::jsonb))
    RETURNING id INTO v_id;

  PERFORM set_config('app.writer', c_writer, true);
  UPDATE public.work_orders
     SET vehicle_id = p_to_vehicle_id,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'vehicle_id_old', v_from, 'vehicle_id_new', p_to_vehicle_id,
           'vehicle_id_corrected_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'vehicle_id_correction_ref', 'work_order_scalar_corrections:' || v_id::text)
   WHERE id = p_work_order_id
  RETURNING * INTO v_new;

  IF (to_jsonb(v_new) - v_ignore) IS DISTINCT FROM (to_jsonb(v_old) - v_ignore) THEN
    RAISE EXCEPTION '%: the update changed more than the vehicle and its metadata keys', c_writer;
  END IF;

  RETURN jsonb_build_object('status', 'moved', 'correction_id', v_id, 'work_order_id', p_work_order_id,
    'from_vehicle_id', v_from, 'to_vehicle_id', p_to_vehicle_id, 'reverses_correction_id', v_reverses,
    'actor_user_id', p_actor);
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_work_order_vehicle(uuid, uuid, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correct_work_order_vehicle(uuid, uuid, text, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.correct_work_order_vehicle(uuid, uuid, text, jsonb, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.correct_work_order_vehicle(uuid, uuid, text, jsonb, uuid) IS
  'Moves a work order to another live vehicle with a reason, cited evidence and an actor; journals old/new vehicle in work_order_scalar_corrections (append-only) and rewrites the metadata vehicle_id_old/new/corrected_at/correction_ref keys (never correction_source). Undo = call it again pointing back (reverses_correction_id). Refuses requested jobs, parent/child work orders and work orders with rows carrying their own vehicle copy or signed history. Service role for an actor tied to both vehicles, or the signed-in actor who can edit both.';

UPDATE public.pipeline_registry
   SET description = 'Audit rows of scalar corrections to work_orders: totals by the reviewed migration 20261020000500; vehicle moves by correct_work_order_vehicle (20261121231500).',
       write_via = 'reviewed migration (totals); correct_work_order_vehicle (vehicle_id)'
 WHERE table_name = 'work_order_scalar_corrections' AND column_name = 'id';

COMMIT;
