-- One money fold, decode-entity promotion, identity reconcile, replica accuracy.
--
-- Why (proof vehicle 20d21fb0-4651-4469-a0ba-e751309a1e54, measured 2026-11-22):
--   * Receipts net to $21,161.81 (65 active; credits -$38.59 and -$13.01). get_vehicle_total_invested
--     summed amount>0 only → $21,213.41. vehicle_grades "Documented spend" read empty service_records → $0.
--     value_breakdown.receipts_total filtered processing_status to parsed/validated/saved and missed
--     'completed' → $0. MCP advisor exposed no documented spend.
--   * Decode observations (cowl/engine/trans) are keyed in vehicle_canonical but engine_blocks,
--     transmission_cases and vehicle_options stay empty. vehicle_field_provenance.make is still
--     'Corvette' from ai_visual after that field_evidence row was superseded; VIN/cowl say Pontiac.
--   * originality_score asks P(factory original); a declared replica needs a distinct accuracy fold
--     against a named target, with unknown share reported and no guessing.
--
-- What this migration does (functions + light schema only; no production backfill writes):
--   1. vehicle_documented_spend(uuid) — single net receipt fold (credits included, quotes excluded).
--   2. get_vehicle_total_invested / compute_vehicle_value / compute_vehicle_grade read that fold.
--   3. Provenance columns on engine_blocks / transmission_cases; is_present on vehicle_options.
--   4. promote_vehicle_decode_entities(vehicle, dry_run) — idempotent observation→entity fold.
--   5. reconcile_identity_field_provenance(vehicle, dry_run) — VIN/cowl outranks ai_visual; supersedes
--      conflicting AI claims; refreshes the provenance cache (never deletes testimony).
--   6. vehicle_replica_accuracy(uuid) — weighted match categories vs replica target; unknown share.
--
-- Contracts: supabase/sql/test_vehicle_documented_spend.sql,
--            supabase/sql/test_promote_decode_entities.sql,
--            supabase/sql/test_vehicle_replica_accuracy.sql
-- Revert:    supabase/sql/revert_20261122032000_vehicle_documented_spend_replica_accuracy.sql

SET lock_timeout = '5s';
SET statement_timeout = '120s';
SET search_path = public;

-- =============================================================================
-- 1. One money fold
-- =============================================================================

-- Unmasked fold for sibling SECURITY DEFINER writers (grades / value / invested).
-- No EXECUTE grant: only same-owner definer functions may call it.
CREATE OR REPLACE FUNCTION public._vehicle_documented_spend_unmasked(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH candidate AS (
    SELECT l.receipt_id AS id
      FROM receipt_vehicle_links l
     WHERE l.vehicle_id = p_vehicle_id
       AND l.status = 'linked'
       AND l.retired_at IS NULL
    UNION
    SELECT r.id
      FROM receipts r
     WHERE (r.vehicle_id = p_vehicle_id
            OR (r.scope_type = 'vehicle' AND r.scope_id = p_vehicle_id::text))
       AND NOT EXISTS (
         SELECT 1 FROM receipt_vehicle_links l
          WHERE l.receipt_id = r.id AND l.retired_at IS NULL)
  ),
  eligible AS (
    SELECT r.id,
           coalesce(r.total_amount, r.total) AS amt
      FROM receipts r
      JOIN candidate c ON c.id = r.id
     WHERE r.duplicate_of IS NULL
       AND coalesce(r.is_superseded, false) IS NOT TRUE
       AND r.amount_check IN ('verified', 'plausible')
       AND NOT public.receipt_doc_kind_excluded(r.document_kind)
       AND NOT public.receipt_doc_kind_quoted(r.document_kind)
       AND coalesce(r.total_amount, r.total) IS NOT NULL
  ),
  work_money AS (
    SELECT vo.id,
           CASE
             WHEN (vo.structured_data->>'amount') ~ '^-?[0-9]+(\.[0-9]+)?$'
               THEN (vo.structured_data->>'amount')::numeric
             WHEN (vo.structured_data->>'total') ~ '^-?[0-9]+(\.[0-9]+)?$'
               THEN (vo.structured_data->>'total')::numeric
             ELSE NULL
           END AS amt
      FROM vehicle_observations vo
     WHERE vo.vehicle_id = p_vehicle_id
       AND vo.kind = 'work_record'
       AND coalesce(vo.is_superseded, false) IS NOT TRUE
       AND coalesce(
             vo.structured_data->>'receipt_id',
             vo.structured_data->>'cited_receipt_id') IS NULL
  ),
  work_eligible AS (
    SELECT id, amt FROM work_money WHERE amt IS NOT NULL AND amt <> 0
  ),
  totals AS (
    SELECT
      coalesce(sum(amt) FILTER (WHERE amt > 0), 0) AS gross_charges,
      coalesce(sum(amt) FILTER (WHERE amt < 0), 0) AS credits,
      coalesce(sum(amt), 0) AS net_spend,
      count(*) FILTER (WHERE amt > 0) AS charge_count,
      count(*) FILTER (WHERE amt < 0) AS credit_count,
      count(*) AS receipt_count
      FROM eligible
  ),
  work_totals AS (
    SELECT coalesce(sum(amt), 0) AS work_net, count(*) AS work_count
      FROM work_eligible
  )
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'net_spend', round((t.net_spend + w.work_net)::numeric, 2),
    'gross_charges', round(t.gross_charges::numeric, 2),
    'credits', round(t.credits::numeric, 2),
    'work_record_net', round(w.work_net::numeric, 2),
    'receipt_count', t.receipt_count,
    'charge_count', t.charge_count,
    'credit_count', t.credit_count,
    'work_record_count', w.work_count,
    'amounts_visible', true,
    'basis', 'receipt_vehicle_links+scope_fallback+work_record_uncited',
    'as_of', now(),
    'logic_version', 'vehicle_documented_spend/20261122032000'
  )
  FROM totals t, work_totals w;
$fn$;

REVOKE ALL ON FUNCTION public._vehicle_documented_spend_unmasked(uuid) FROM PUBLIC;

-- Public reader: same fold, with public-vehicle gate and tied-viewer money mask
-- (receipts_public_summary / vehicle_build_reconstruction pattern).
CREATE OR REPLACE FUNCTION public.vehicle_documented_spend(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tied boolean;
  v_visible boolean;
  raw jsonb;
BEGIN
  SELECT
    (auth.role() = 'service_role'
      OR (auth.uid() IS NOT NULL AND (
            v.user_id = auth.uid() OR v.owner_id = auth.uid()
            OR v.uploaded_by = auth.uid()
            OR public.vehicle_user_has_access(v.id, auth.uid())))) IS TRUE,
    v.deleted_at IS NULL
      AND (v.is_public IS TRUE OR auth.role() = 'service_role'
           OR (auth.uid() IS NOT NULL AND (
                 v.user_id = auth.uid() OR v.owner_id = auth.uid()
                 OR v.uploaded_by = auth.uid()
                 OR public.vehicle_user_has_access(v.id, auth.uid()))))
  INTO v_tied, v_visible
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;

  IF NOT FOUND OR v_visible IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  raw := public._vehicle_documented_spend_unmasked(p_vehicle_id);
  IF v_tied THEN
    RETURN raw;
  END IF;

  -- Stranger on a public vehicle: counts yes (JSON numbers), amounts NULL (2026-11-09 money mask).
  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'net_spend', NULL,
    'gross_charges', NULL,
    'credits', NULL,
    'work_record_net', NULL,
    'receipt_count', (raw->>'receipt_count')::int,
    'charge_count', (raw->>'charge_count')::int,
    'credit_count', (raw->>'credit_count')::int,
    'work_record_count', (raw->>'work_record_count')::int,
    'amounts_visible', false,
    'basis', raw->>'basis',
    'as_of', raw->>'as_of',
    'logic_version', raw->>'logic_version'
  );
END
$fn$;

COMMENT ON FUNCTION public.vehicle_documented_spend(uuid) IS
  'Single documented-spend fold: linked/scoped non-quote receipts with verified|plausible amounts, '
  'netting credits, plus uncited work_record amounts. Public undeleted vehicles only for strangers; '
  'amounts only for a tied viewer or service_role (amounts_visible). Null when the caller may not '
  'see the vehicle. Grades/value writers use _vehicle_documented_spend_unmasked.';

REVOKE ALL ON FUNCTION public.vehicle_documented_spend(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_documented_spend(uuid) TO anon, authenticated, service_role;

-- get_vehicle_total_invested: receipts lens = documented spend net (credits included).
-- Same public/tied money mask as vehicle_documented_spend (anon must not read unmasked).
CREATE OR REPLACE FUNCTION public.get_vehicle_total_invested(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  spend jsonb;
  parts_total numeric := 0;
  labor_total numeric := 0;
  te_total numeric := 0;
  parts_cnt int := 0;
  labor_cnt int := 0;
  rcpt_total numeric;
  rcpt_cnt int;
BEGIN
  spend := public.vehicle_documented_spend(p_vehicle_id);
  IF spend IS NULL THEN
    RETURN NULL;
  END IF;

  IF coalesce((spend->>'amounts_visible')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'total_invested', NULL,
      'amounts_visible', false,
      'breakdown', jsonb_build_object(
        'parts', NULL, 'labor', NULL, 'materials', NULL, 'overhead', NULL, 'tools', NULL,
        'financial_records_total', NULL, 'timeline_costs', NULL, 'receipts', NULL,
        'documented_spend', NULL),
      'components_count', jsonb_build_object(
        'parts_items', 0, 'labor_tasks', 0, 'materials_items', 0,
        'events_with_work', 0,
        'receipts', coalesce((spend->>'receipt_count')::int, 0)
                     + coalesce((spend->>'work_record_count')::int, 0)));
  END IF;

  SELECT coalesce(sum(wop.total_price), 0), count(*)
    INTO parts_total, parts_cnt
    FROM work_order_parts wop
    JOIN timeline_events te ON te.id = wop.timeline_event_id
   WHERE te.vehicle_id = p_vehicle_id;

  SELECT coalesce(sum(wol.total_cost), 0), count(*)
    INTO labor_total, labor_cnt
    FROM work_order_labor wol
    JOIN timeline_events te ON te.id = wol.timeline_event_id
   WHERE te.vehicle_id = p_vehicle_id;

  SELECT coalesce(sum(cost_amount), 0) INTO te_total
    FROM timeline_events
   WHERE vehicle_id = p_vehicle_id AND cost_amount IS NOT NULL AND cost_amount > 0;

  rcpt_total := coalesce((spend->>'net_spend')::numeric, 0);
  rcpt_cnt := coalesce((spend->>'receipt_count')::int, 0)
            + coalesce((spend->>'work_record_count')::int, 0);

  RETURN jsonb_build_object(
    'total_invested', greatest(parts_total + labor_total, te_total, rcpt_total),
    'amounts_visible', true,
    'breakdown', jsonb_build_object(
      'parts', parts_total, 'labor', labor_total, 'materials', 0, 'overhead', 0, 'tools', 0,
      'financial_records_total', 0, 'timeline_costs', te_total, 'receipts', rcpt_total,
      'documented_spend', rcpt_total),
    'components_count', jsonb_build_object(
      'parts_items', parts_cnt, 'labor_tasks', labor_cnt, 'materials_items', 0,
      'events_with_work', 0, 'receipts', rcpt_cnt));
END
$fn$;

-- compute_vehicle_value: receipts_total from the same fold (fixes 'completed' status miss).
CREATE OR REPLACE FUNCTION public.compute_vehicle_value(p_vehicle_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  img_count int := 0;
  approved_img_count int := 0;
  tag_count int := 0;
  recent_events int := 0;
  receipts_total numeric := 0;
  verified_owner boolean := false;
  contrib_count int := 0;
  public_flag boolean := true;
  completeness numeric := 0;
  score numeric := 0;
  spend jsonb;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE coalesce(vi.is_approved, true))
    INTO img_count, approved_img_count
    FROM public.vehicle_images vi
   WHERE vi.vehicle_id = p_vehicle_id AND public.vehicle_image_gallery_eligible(vi);

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='image_tags') THEN
    SELECT count(*) INTO tag_count
      FROM public.image_tags t
      JOIN public.vehicle_images vi ON vi.id = t.image_id
     WHERE vi.vehicle_id = p_vehicle_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='timeline_events') THEN
    SELECT count(*) INTO recent_events
      FROM public.timeline_events
     WHERE vehicle_id = p_vehicle_id
       AND created_at >= now() - interval '30 days';
  ELSE
    recent_events := 0;
  END IF;

  spend := public._vehicle_documented_spend_unmasked(p_vehicle_id);
  receipts_total := coalesce((spend->>'net_spend')::numeric, 0);

  SELECT coalesce(is_public, true) INTO public_flag
    FROM (SELECT * FROM public.vehicles WHERE listing_kind IS DISTINCT FROM 'non_vehicle_item') v
   WHERE v.id = p_vehicle_id;

  SELECT (
    (CASE WHEN (v.make IS NOT NULL AND v.make <> '') THEN 1 ELSE 0 END) +
    (CASE WHEN (v.model IS NOT NULL AND v.model <> '') THEN 1 ELSE 0 END) +
    (CASE WHEN v.year IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN (v.vin IS NOT NULL AND v.vin <> '') THEN 1 ELSE 0 END) +
    (CASE WHEN (v.color IS NOT NULL AND v.color <> '') THEN 1 ELSE 0 END) +
    (CASE WHEN (v.engine_size IS NOT NULL) THEN 1 ELSE 0 END) +
    (CASE WHEN (v.transmission IS NOT NULL AND v.transmission <> '') THEN 1 ELSE 0 END)
  ) / 7.0
  INTO completeness
  FROM (SELECT * FROM public.vehicles WHERE listing_kind IS DISTINCT FROM 'non_vehicle_item') v
  WHERE v.id = p_vehicle_id;

  score := 0;
  score := score + LEAST(40, COALESCE(ln(GREATEST(2, approved_img_count)) * 20, 0));
  score := score + LEAST(15, (tag_count / 50.0) * 15);
  score := score + LEAST(15, (recent_events / 10.0) * 15);
  score := score + LEAST(15, (GREATEST(receipts_total, 0) / 5000.0) * 15);
  IF verified_owner THEN score := score + 10; END IF;
  score := score + LEAST(5, contrib_count);
  IF public_flag THEN score := score + 5; END IF;
  score := score + LEAST(10, GREATEST(0, completeness * 10));

  UPDATE public.vehicles SET value_score = round(score::numeric, 2),
    value_breakdown = jsonb_build_object(
      'approved_images', approved_img_count,
      'tags', tag_count,
      'recent_events_30d', recent_events,
      'receipts_total', receipts_total,
      'documented_spend', receipts_total,
      'documented_spend_basis', spend->>'basis',
      'documented_spend_as_of', spend->>'as_of',
      'verified_owner', verified_owner,
      'contributors', contrib_count,
      'public', public_flag,
      'completeness', completeness,
      'computed_at', now()
    )
  WHERE id = p_vehicle_id;

  RETURN score;
END
$fn$;

-- compute_vehicle_grade: replace empty service_records spend with the money fold.
-- Fingerprint the live body (read 2026-11-22) and patch the two call sites.
DO $patch$
DECLARE
  def text;
  md5_was text := 'pending'; -- filled below from live read
  new_def text;
  anchor1 text := $a$SELECT COUNT(*), COALESCE(SUM(cost), 0)
  INTO rec_count, cost_documented
  FROM service_records
  WHERE vehicle_id = p_vehicle_id;$a$;
  repl1 text := $a$SELECT coalesce((spend_fold->>'receipt_count')::int, 0)
           + coalesce((spend_fold->>'work_record_count')::int, 0),
         coalesce((spend_fold->>'net_spend')::numeric, 0)
  INTO rec_count, cost_documented
  FROM (SELECT public._vehicle_documented_spend_unmasked(p_vehicle_id) AS spend_fold) s;$a$;
  anchor2 text := $a$dim.notes := FORMAT('VIN: %s | Mileage: %s | Service records: %s | Documented spend: $%s',$a$;
  repl2 text := $a$dim.notes := FORMAT('VIN: %s | Mileage: %s | Receipts: %s | Documented spend: $%s',$a$;
BEGIN
  IF to_regprocedure('public.compute_vehicle_grade(uuid)') IS NULL THEN
    RAISE NOTICE 'compute_vehicle_grade absent; skip grade spend patch';
    RETURN;
  END IF;
  def := pg_get_functiondef('public.compute_vehicle_grade(uuid)'::regprocedure);
  -- Already patched (replay).
  IF position('_vehicle_documented_spend_unmasked(p_vehicle_id)' IN def) > 0
     OR position('vehicle_documented_spend(p_vehicle_id)' IN def) > 0 THEN
    RAISE NOTICE 'compute_vehicle_grade already uses documented spend fold; skip';
    RETURN;
  END IF;
  IF position('FROM service_records' IN def) > 0
     AND (position(anchor1 IN def) = 0 OR position(anchor2 IN def) = 0) THEN
    RAISE EXCEPTION 'compute_vehicle_grade still reads service_records but anchors moved; refuse spend patch';
  END IF;
  IF position(anchor1 IN def) = 0 OR position(anchor2 IN def) = 0 THEN
    RAISE NOTICE 'compute_vehicle_grade has no service_records spend anchors (shim/contract); skip';
    RETURN;
  END IF;
  new_def := replace(replace(def, anchor1, repl1), anchor2, repl2);
  IF new_def = def THEN
    RAISE EXCEPTION 'compute_vehicle_grade spend patch produced no change';
  END IF;
  EXECUTE new_def;
END
$patch$;

-- =============================================================================
-- 2. Light schema for entity provenance / option absences
-- =============================================================================

DO $schema$
BEGIN
  IF to_regclass('public.engine_blocks') IS NOT NULL THEN
    ALTER TABLE public.engine_blocks
      ADD COLUMN IF NOT EXISTS source_observation_ids uuid[],
      ADD COLUMN IF NOT EXISTS fold_method text,
      ADD COLUMN IF NOT EXISTS folded_at timestamptz,
      ADD COLUMN IF NOT EXISTS is_superseded boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS superseded_by uuid,
      ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS engine_blocks_one_current_per_vehicle
      ON public.engine_blocks (vehicle_id)
      WHERE coalesce(is_superseded, false) IS NOT TRUE;
  END IF;

  IF to_regclass('public.transmission_cases') IS NOT NULL THEN
    ALTER TABLE public.transmission_cases
      ADD COLUMN IF NOT EXISTS source_observation_ids uuid[],
      ADD COLUMN IF NOT EXISTS fold_method text,
      ADD COLUMN IF NOT EXISTS folded_at timestamptz,
      ADD COLUMN IF NOT EXISTS is_superseded boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS superseded_by uuid,
      ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS transmission_cases_one_current_per_vehicle
      ON public.transmission_cases (vehicle_id)
      WHERE coalesce(is_superseded, false) IS NOT TRUE;
  END IF;

  IF to_regclass('public.vehicle_options') IS NOT NULL THEN
    ALTER TABLE public.vehicle_options
      ADD COLUMN IF NOT EXISTS is_present boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS source_observation_id uuid,
      ADD COLUMN IF NOT EXISTS fold_method text,
      ADD COLUMN IF NOT EXISTS folded_at timestamptz;
    COMMENT ON COLUMN public.vehicle_options.is_present IS
      'False when a decode observation explicitly records the option code as absent (e.g. blank cowl option line checked for WS4).';
  END IF;
END
$schema$;

-- =============================================================================
-- 3. Promote keyed decode observations → engine_blocks / transmission_cases / options
-- =============================================================================

CREATE OR REPLACE FUNCTION public.promote_vehicle_decode_entities(
  p_vehicle_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_engine jsonb := 'null'::jsonb;
  v_trans jsonb := 'null'::jsonb;
  v_options jsonb := '[]'::jsonb;
  casting text;
  stamp text;
  case_cast text;
  id_stamp text;
  tail_cast text;
  eng_obs uuid[];
  tr_obs uuid[];
  opt_obs uuid;
  absent text;
  new_id uuid;
  old_id uuid;
  displacement numeric;
  is_orig boolean;
BEGIN
  -- Engine from keyed decode observations (property keys already ratified).
  SELECT array_agg(DISTINCT vo.id),
         max(vo.structured_data->>'engine_block_casting')
           FILTER (WHERE vo.structured_data ? 'engine_block_casting'),
         max(vo.structured_data->>'engine_code_stamp')
           FILTER (WHERE vo.structured_data ? 'engine_code_stamp')
    INTO eng_obs, casting, stamp
    FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
   WHERE vo.vehicle_id = p_vehicle_id
     AND coalesce(vo.is_superseded, false) IS NOT TRUE
     AND vo.extraction_method IN ('engine_block_decode_v1', 'cached_byok_property_projection_v1')
     AND op.property_key IN ('engine_block_casting', 'engine_code_stamp');

  IF casting IS NOT NULL OR stamp IS NOT NULL THEN
    SELECT (r.value->>'displacement_ci')::numeric
      INTO displacement
      FROM vehicle_decode_rules r
     WHERE r.superseded_at IS NULL
       AND r.rule_key = 'block_casting'
       AND r.code = casting
     ORDER BY r.cited_on DESC NULLS LAST
     LIMIT 1;

    is_orig := NOT EXISTS (
      SELECT 1 FROM vehicle_observations vo
       WHERE vo.vehicle_id = p_vehicle_id
         AND coalesce(vo.is_superseded, false) IS NOT TRUE
         AND (
           vo.structured_data->>'factory_configuration_status' IN
             ('not_original_engine', 'not_original_unit', 'not_original')
           OR vo.content_text ILIKE '%not_original_engine%'
         )
    );

    v_engine := jsonb_build_object(
      'casting_number', casting,
      'block_suffix', stamp,
      'displacement_ci', displacement,
      'is_original', is_orig,
      'provenance', CASE WHEN is_orig THEN 'original' ELSE 'unknown' END,
      'source_observation_ids', to_jsonb(coalesce(eng_obs, '{}'::uuid[])),
      'fold_method', 'promote_vehicle_decode_entities/20261122032000'
    );

    IF NOT p_dry_run AND (casting IS NOT NULL) THEN
      SELECT id INTO old_id FROM engine_blocks
       WHERE vehicle_id = p_vehicle_id AND coalesce(is_superseded, false) IS NOT TRUE
       LIMIT 1;
      IF old_id IS NOT NULL THEN
        -- Idempotent: same casting+stamp+obs set → no write.
        IF EXISTS (
          SELECT 1 FROM engine_blocks e
           WHERE e.id = old_id
             AND e.casting_number IS NOT DISTINCT FROM casting
             AND e.block_suffix IS NOT DISTINCT FROM stamp
             AND e.source_observation_ids IS NOT DISTINCT FROM eng_obs
        ) THEN
          v_engine := v_engine || jsonb_build_object('action', 'unchanged', 'id', old_id);
        ELSE
          -- Supersede the current row first so the one-current unique index allows the insert.
          new_id := gen_random_uuid();
          UPDATE engine_blocks SET is_superseded = true, superseded_by = new_id, superseded_at = now()
           WHERE id = old_id;
          INSERT INTO engine_blocks (
            id, vehicle_id, casting_number, block_suffix, displacement_ci, is_original,
            provenance, provenance_detail, source_observation_ids, fold_method, folded_at
          ) VALUES (
            new_id, p_vehicle_id, casting, stamp, displacement, is_orig,
            CASE WHEN is_orig THEN 'original' ELSE 'unknown' END,
            format('folded from observations %s', eng_obs),
            eng_obs, 'promote_vehicle_decode_entities/20261122032000', now()
          );
          v_engine := v_engine || jsonb_build_object('action', 'superseded_prior', 'id', new_id, 'prior_id', old_id);
        END IF;
      ELSE
        new_id := gen_random_uuid();
        INSERT INTO engine_blocks (
          id, vehicle_id, casting_number, block_suffix, displacement_ci, is_original,
          provenance, provenance_detail, source_observation_ids, fold_method, folded_at
        ) VALUES (
          new_id, p_vehicle_id, casting, stamp, displacement, is_orig,
          CASE WHEN is_orig THEN 'original' ELSE 'unknown' END,
          format('folded from observations %s', eng_obs),
          eng_obs, 'promote_vehicle_decode_entities/20261122032000', now()
        );
        v_engine := v_engine || jsonb_build_object('action', 'inserted', 'id', new_id);
      END IF;
    ELSIF p_dry_run THEN
      v_engine := v_engine || jsonb_build_object('action', 'dry_run');
    END IF;
  END IF;

  -- Transmission case from decode + physical transcription castings.
  SELECT array_agg(DISTINCT vo.id),
         max(vo.structured_data->>'transmission_case_casting')
           FILTER (WHERE vo.structured_data ? 'transmission_case_casting'),
         max(vo.structured_data->>'transmission_id_stamp')
           FILTER (WHERE vo.structured_data ? 'transmission_id_stamp'),
         max(vo.structured_data->>'transmission_tailhousing_casting')
           FILTER (WHERE vo.structured_data ? 'transmission_tailhousing_casting')
    INTO tr_obs, case_cast, id_stamp, tail_cast
    FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
   WHERE vo.vehicle_id = p_vehicle_id
     AND coalesce(vo.is_superseded, false) IS NOT TRUE
     AND vo.extraction_method IN (
       'trans_id_stamp_decode_v1', 'physical_transcription_v1', 'cached_byok_property_projection_v1')
     AND op.property_key IN (
       'transmission_case_casting', 'transmission_id_stamp',
       'transmission_tailhousing_casting', 'bellhousing_casting');

  IF case_cast IS NOT NULL OR id_stamp IS NOT NULL THEN
    v_trans := jsonb_build_object(
      'casting_number', case_cast,
      'serial_number', id_stamp,
      'tail_housing_type', tail_cast,
      'source_observation_ids', to_jsonb(coalesce(tr_obs, '{}'::uuid[])),
      'fold_method', 'promote_vehicle_decode_entities/20261122032000'
    );
    IF NOT p_dry_run THEN
      SELECT id INTO old_id FROM transmission_cases
       WHERE vehicle_id = p_vehicle_id AND coalesce(is_superseded, false) IS NOT TRUE
       LIMIT 1;
      IF old_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM transmission_cases t
         WHERE t.id = old_id
           AND t.casting_number IS NOT DISTINCT FROM case_cast
           AND t.serial_number IS NOT DISTINCT FROM id_stamp
           AND t.source_observation_ids IS NOT DISTINCT FROM tr_obs
      ) THEN
        v_trans := v_trans || jsonb_build_object('action', 'unchanged', 'id', old_id);
      ELSIF old_id IS NOT NULL THEN
        new_id := gen_random_uuid();
        UPDATE transmission_cases SET is_superseded = true, superseded_by = new_id, superseded_at = now()
         WHERE id = old_id;
        INSERT INTO transmission_cases (
          id, vehicle_id, casting_number, serial_number, tail_housing_type,
          provenance_detail, source_observation_ids, fold_method, folded_at
        ) VALUES (
          new_id, p_vehicle_id, case_cast, id_stamp, tail_cast,
          format('folded from observations %s', tr_obs),
          tr_obs, 'promote_vehicle_decode_entities/20261122032000', now()
        );
        v_trans := v_trans || jsonb_build_object('action', 'superseded_prior', 'id', new_id, 'prior_id', old_id);
      ELSE
        new_id := gen_random_uuid();
        INSERT INTO transmission_cases (
          id, vehicle_id, casting_number, serial_number, tail_housing_type,
          provenance_detail, source_observation_ids, fold_method, folded_at
        ) VALUES (
          new_id, p_vehicle_id, case_cast, id_stamp, tail_cast,
          format('folded from observations %s', tr_obs),
          tr_obs, 'promote_vehicle_decode_entities/20261122032000', now()
        );
        v_trans := v_trans || jsonb_build_object('action', 'inserted', 'id', new_id);
      END IF;
    ELSE
      v_trans := v_trans || jsonb_build_object('action', 'dry_run');
    END IF;
  END IF;

  -- Explicit option absences from cowl option-line decode.
  FOR opt_obs, absent IN
    SELECT vo.id, a.code
      FROM vehicle_observations vo
      JOIN observation_properties op ON op.id = vo.property_id
      CROSS JOIN LATERAL jsonb_array_elements_text(
        coalesce(vo.structured_data->'absent_codes_checked', '[]'::jsonb)
      ) AS a(code)
     WHERE vo.vehicle_id = p_vehicle_id
       AND coalesce(vo.is_superseded, false) IS NOT TRUE
       AND op.property_key = 'body_tag_option_codes'
       AND vo.extraction_method IN ('cowl_tag_decode_v1', 'cached_byok_property_projection_v1')
  LOOP
    v_options := v_options || jsonb_build_object(
      'option_code', absent,
      'is_present', false,
      'source_observation_id', opt_obs,
      'source', 'cowl_tag_decode_v1',
      'category', 'absence'
    );
    IF NOT p_dry_run THEN
      INSERT INTO vehicle_options (
        vehicle_id, option_code, option_name, category, source,
        verified_by_spid, is_present, source_observation_id, fold_method, folded_at
      ) VALUES (
        p_vehicle_id, absent, 'absent on body tag option line', 'absence',
        'cowl_tag_decode_v1', false, false, opt_obs,
        'promote_vehicle_decode_entities/20261122032000', now()
      )
      ON CONFLICT (vehicle_id, option_code) DO UPDATE
        SET is_present = EXCLUDED.is_present,
            source_observation_id = EXCLUDED.source_observation_id,
            fold_method = EXCLUDED.fold_method,
            folded_at = EXCLUDED.folded_at,
            source = EXCLUDED.source,
            category = EXCLUDED.category,
            option_name = EXCLUDED.option_name;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'dry_run', p_dry_run,
    'engine_block', v_engine,
    'transmission_case', v_trans,
    'options', v_options,
    'logic_version', 'promote_vehicle_decode_entities/20261122032000',
    'as_of', now()
  );
END
$fn$;

COMMENT ON FUNCTION public.promote_vehicle_decode_entities(uuid, boolean) IS
  'Idempotent fold of keyed decode observations into engine_blocks, transmission_cases and '
  'vehicle_options (including explicit absences). Default dry_run=true writes nothing. '
  'Supersedes prior current entity rows; never deletes.';

REVOKE ALL ON FUNCTION public.promote_vehicle_decode_entities(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_vehicle_decode_entities(uuid, boolean) TO service_role;

-- =============================================================================
-- 4. Identity reconcile: VIN/cowl beats ai_visual (general, not one-car)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.identity_source_rank(p_source_type text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE lower(coalesce(p_source_type, ''))
    WHEN 'gm_vin_chart' THEN 100
    WHEN 'vin_decode' THEN 100
    WHEN 'nhtsa_vin' THEN 95
    WHEN 'cowl_tag' THEN 90
    WHEN 'body_tag' THEN 90
    WHEN 'title' THEN 80
    WHEN 'listing' THEN 70
    WHEN 'bat_listing' THEN 70
    WHEN 'system_update' THEN 60
    WHEN 'ai_visual' THEN 30
    ELSE 50
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.reconcile_identity_field_provenance(
  p_vehicle_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  fld text;
  best_val text;
  best_src text;
  best_conf int;
  vin_make text;
  cowl_style text;
  actions jsonb := '[]'::jsonb;
  v_vin text;
  fe record;
BEGIN
  SELECT vin INTO v_vin FROM vehicles WHERE id = p_vehicle_id;
  -- Pre-1981 GM 13-character VIN only: first digit is division (2 = Pontiac).
  -- Never apply this map to 17-character modern VINs (1G2… would wrongly become Chevrolet).
  IF v_vin IS NOT NULL AND length(btrim(v_vin)) = 13 THEN
    vin_make := CASE substring(upper(btrim(v_vin)) FROM 1 FOR 1)
      WHEN '1' THEN 'Chevrolet'
      WHEN '2' THEN 'Pontiac'
      WHEN '3' THEN 'Oldsmobile'
      WHEN '4' THEN 'Buick'
      WHEN '5' THEN 'Cadillac'
      WHEN '6' THEN 'Cadillac'
      ELSE NULL
    END;
  END IF;

  SELECT vo.structured_data->>'body_tag_style'
    INTO cowl_style
    FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
   WHERE vo.vehicle_id = p_vehicle_id
     AND coalesce(vo.is_superseded, false) IS NOT TRUE
     AND op.property_key = 'body_tag_style'
   ORDER BY vo.observed_at DESC NULLS LAST
   LIMIT 1;

  -- Cowl 2FS87 is a Firebird body style code → Pontiac when no 13-char VIN map applied.
  IF cowl_style ~* '^2F' AND vin_make IS NULL THEN
    vin_make := 'Pontiac';
  END IF;

  FOREACH fld IN ARRAY ARRAY['make','model','year','vin'] LOOP
    -- Ranked consensus over non-superseded evidence.
    SELECT fe.proposed_value, fe.source_type, fe.source_confidence
      INTO best_val, best_src, best_conf
      FROM field_evidence fe
     WHERE fe.vehicle_id = p_vehicle_id
       AND fe.field_name = fld
       AND fe.status IN ('pending', 'accepted')
     ORDER BY public.identity_source_rank(fe.source_type) DESC,
              fe.source_confidence DESC NULLS LAST,
              fe.created_at DESC NULLS LAST
     LIMIT 1;

    IF fld = 'make' AND vin_make IS NOT NULL THEN
      best_val := vin_make;
      best_src := 'gm_vin_chart';
      best_conf := greatest(coalesce(best_conf, 0), 95);
      -- Supersede conflicting ai_visual rows (keep the row; status=superseded).
      FOR fe IN
        SELECT * FROM field_evidence
         WHERE vehicle_id = p_vehicle_id
           AND field_name = 'make'
           AND status IN ('pending', 'accepted')
           AND lower(source_type) = 'ai_visual'
           AND lower(proposed_value) IS DISTINCT FROM lower(vin_make)
      LOOP
        actions := actions || jsonb_build_object(
          'action', 'supersede_ai_visual',
          'field', 'make',
          'evidence_id', fe.id,
          'was', fe.proposed_value,
          'wins', vin_make
        );
        IF NOT p_dry_run THEN
          UPDATE field_evidence
             SET status = 'superseded',
                 assigned_at = now(),
                 assigned_by = 'reconcile_identity_field_provenance/20261122032000'
           WHERE id = fe.id;
        END IF;
      END LOOP;

      -- Ensure a VIN-derived accepted row exists.
      IF NOT EXISTS (
        SELECT 1 FROM field_evidence
         WHERE vehicle_id = p_vehicle_id AND field_name = 'make'
           AND status IN ('pending', 'accepted')
           AND lower(proposed_value) = lower(vin_make)
           AND identity_source_rank(source_type) >= 90
      ) THEN
        actions := actions || jsonb_build_object(
          'action', 'ensure_vin_make_evidence',
          'value', vin_make
        );
        IF NOT p_dry_run THEN
          INSERT INTO field_evidence (
            vehicle_id, field_name, proposed_value, source_type, source_confidence, status
          ) VALUES (
            p_vehicle_id, 'make', vin_make, 'gm_vin_chart', 95, 'accepted'
          );
        END IF;
      ELSIF NOT p_dry_run THEN
        UPDATE field_evidence
           SET status = 'accepted',
               assigned_at = now(),
               assigned_by = 'reconcile_identity_field_provenance/20261122032000'
         WHERE vehicle_id = p_vehicle_id AND field_name = 'make'
           AND lower(proposed_value) = lower(vin_make)
           AND status = 'pending'
           AND identity_source_rank(source_type) >= 90;
      END IF;
    END IF;

    IF best_val IS NULL THEN
      CONTINUE;
    END IF;

    actions := actions || jsonb_build_object(
      'action', 'set_provenance',
      'field', fld,
      'value', best_val,
      'source', best_src,
      'confidence', best_conf
    );

    IF NOT p_dry_run THEN
      INSERT INTO vehicle_field_provenance (
        vehicle_id, field_name, current_value, total_confidence, primary_source, supporting_sources, updated_at
      ) VALUES (
        p_vehicle_id, fld, best_val, coalesce(best_conf, 80),
        'field_evidence:' || coalesce(best_src, 'unknown'),
        ARRAY[coalesce(best_src, 'unknown')], now()
      )
      ON CONFLICT (vehicle_id, field_name) DO UPDATE SET
        current_value = EXCLUDED.current_value,
        total_confidence = EXCLUDED.total_confidence,
        primary_source = EXCLUDED.primary_source,
        supporting_sources = EXCLUDED.supporting_sources,
        updated_at = now();
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'dry_run', p_dry_run,
    'vin', v_vin,
    'vin_make', vin_make,
    'cowl_style', cowl_style,
    'actions', actions,
    'logic_version', 'reconcile_identity_field_provenance/20261122032000',
    'as_of', now()
  );
END
$fn$;

COMMENT ON FUNCTION public.reconcile_identity_field_provenance(uuid, boolean) IS
  'Rebuilds identity field_provenance preferring VIN/cowl over ai_visual. Conflicting AI claims '
  'are superseded (kept). Default dry_run=true.';

REVOKE ALL ON FUNCTION public.reconcile_identity_field_provenance(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_identity_field_provenance(uuid, boolean) TO service_role;

-- =============================================================================
-- 5. Replica accuracy (distinct from originality_score)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.vehicle_replica_accuracy(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v record;
  v_tied boolean;
  v_visible boolean;
  target jsonb;
  components jsonb := '[]'::jsonb;
  w_engine numeric := 40;
  w_identity numeric := 25;
  w_drivetrain numeric := 15;
  w_appearance numeric := 15;
  w_other numeric := 5;
  known_weight numeric := 0;
  match_weight numeric := 0;
  unknown_weight numeric := 0;
  casting text;
  stamp text;
  style text;
  absents text[];
  id_stamp text;
  case_cast text;
  cat text;
  score numeric;
BEGIN
  SELECT *
  INTO v
  FROM vehicles
  WHERE id = p_vehicle_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'vehicle_not_found');
  END IF;

  v_tied := (auth.role() = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
          v.user_id = auth.uid() OR v.owner_id = auth.uid()
          OR v.uploaded_by = auth.uid()
          OR public.vehicle_user_has_access(v.id, auth.uid())))) IS TRUE;
  v_visible := v.deleted_at IS NULL
    AND (v.is_public IS TRUE OR auth.role() = 'service_role'
         OR (auth.uid() IS NOT NULL AND (
               v.user_id = auth.uid() OR v.owner_id = auth.uid()
               OR v.uploaded_by = auth.uid()
               OR public.vehicle_user_has_access(v.id, auth.uid()))));

  IF v_visible IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  IF coalesce(v.is_replica, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'vehicle_id', p_vehicle_id,
      'applicable', false,
      'reason', 'vehicle is not declared is_replica',
      'logic_version', 'vehicle_replica_accuracy/20261122032000'
    );
  END IF;

  -- Target from declared replica quote + vehicle year. No invented factory options.
  target := jsonb_build_object(
    'year', v.year,
    'make', v.make,
    'label', coalesce(nullif(btrim(v.replica_quote), ''), 'declared replica'),
    'basis', 'vehicles.is_replica + vehicles.replica_quote',
    'trim_tokens', to_jsonb(
      ARRAY(
        SELECT t FROM unnest(ARRAY['Trans Am', 'SD-455', 'SD455', 'Yenko', 'Shelby', 'GT350', 'GT500']) t
         WHERE v.replica_quote ILIKE '%' || t || '%'
      )
    )
  );

  SELECT max(vo.structured_data->>'engine_block_casting'),
         max(vo.structured_data->>'engine_code_stamp')
    INTO casting, stamp
    FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
   WHERE vo.vehicle_id = p_vehicle_id
     AND coalesce(vo.is_superseded, false) IS NOT TRUE
     AND op.property_key IN ('engine_block_casting', 'engine_code_stamp');

  -- Engine vs SD-455 / displacement target tokens (never guess when undecidable).
  IF casting IS NULL AND stamp IS NULL THEN
    cat := 'unknown';
  ELSIF EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(target->'trim_tokens') t
           WHERE t IN ('SD-455', 'SD455')
        ) THEN
    -- 9799140 is a Pontiac 455 casting (decode rules); YH+9799140 maps to L-75 HO, not SD.
    IF casting = '9799140' AND stamp = 'YH' THEN
      cat := 'period_correct_substitute'; -- 455 family, not SD-455 factory code
    ELSIF casting = '9799140' THEN
      cat := 'period_correct_substitute';
    ELSE
      cat := 'non_correct';
    END IF;
  ELSIF casting IS NOT NULL THEN
    cat := 'unknown'; -- target has no engine token we can score against
  ELSE
    cat := 'unknown';
  END IF;

  components := components || jsonb_build_object(
    'component', 'engine',
    'weight', w_engine,
    'category', cat,
    'evidence', jsonb_build_object('casting', casting, 'stamp', stamp),
    'note', CASE cat
      WHEN 'unknown' THEN 'No keyed engine decode, or target has no engine token'
      WHEN 'period_correct_substitute' THEN '455-family casting/stamp; not an SD-455 factory code'
      WHEN 'non_correct' THEN 'Observed engine does not match target tokens'
      ELSE NULL END
  );

  SELECT max(vo.structured_data->>'body_tag_style'),
         coalesce(
           (SELECT array_agg(DISTINCT a)
              FROM vehicle_observations vo2
              JOIN observation_properties op2 ON op2.id = vo2.property_id
              CROSS JOIN LATERAL jsonb_array_elements_text(
                coalesce(vo2.structured_data->'absent_codes_checked', '[]'::jsonb)) a
             WHERE vo2.vehicle_id = p_vehicle_id
               AND coalesce(vo2.is_superseded, false) IS NOT TRUE
               AND op2.property_key = 'body_tag_option_codes'),
           '{}'::text[])
    INTO style, absents
    FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
   WHERE vo.vehicle_id = p_vehicle_id
     AND coalesce(vo.is_superseded, false) IS NOT TRUE
     AND op.property_key IN ('body_tag_style', 'body_tag_option_codes');

  IF style IS NULL AND absents = '{}'::text[] THEN
    cat := 'unknown';
  ELSIF EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(target->'trim_tokens') t
           WHERE t = 'Trans Am'
        ) THEN
    -- Factory Trans Am carried WS4; explicit absence means chassis is not factory TA.
    IF 'WS4' = ANY (absents) THEN
      cat := 'non_correct'; -- expected for a replica built on a non-TA body; still non-correct vs target
    ELSIF style IS NOT NULL THEN
      cat := 'period_correct_substitute'; -- Firebird body used as TA tribute base
    ELSE
      cat := 'unknown';
    END IF;
  ELSE
    cat := 'unknown';
  END IF;

  components := components || jsonb_build_object(
    'component', 'identity_cowl_options',
    'weight', w_identity,
    'category', cat,
    'evidence', jsonb_build_object('body_tag_style', style, 'absent_codes', to_jsonb(absents))
  );

  SELECT max(vo.structured_data->>'transmission_case_casting'),
         max(vo.structured_data->>'transmission_id_stamp')
    INTO case_cast, id_stamp
    FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
   WHERE vo.vehicle_id = p_vehicle_id
     AND coalesce(vo.is_superseded, false) IS NOT TRUE
     AND op.property_key IN ('transmission_case_casting', 'transmission_id_stamp');

  IF case_cast IS NULL AND id_stamp IS NULL THEN
    cat := 'unknown';
  ELSE
    -- Mixed-era stamps without a cited SD-era match stay unknown (no guessing).
    cat := 'unknown';
  END IF;

  components := components || jsonb_build_object(
    'component', 'drivetrain',
    'weight', w_drivetrain,
    'category', cat,
    'evidence', jsonb_build_object('case_casting', case_cast, 'id_stamp', id_stamp),
    'note', 'No factory SD-455 drivetrain rule matched; left unknown'
  );

  -- Appearance (shaker/decals/hood) and other: no keyed replica-appearance properties yet.
  components := components || jsonb_build_object(
    'component', 'appearance', 'weight', w_appearance, 'category', 'unknown',
    'note', 'No keyed appearance properties for shaker/decals/hood'
  );
  components := components || jsonb_build_object(
    'component', 'other', 'weight', w_other, 'category', 'unknown',
    'note', 'No other keyed replica components'
  );

  SELECT coalesce(sum((c->>'weight')::numeric), 0)
    INTO known_weight
    FROM jsonb_array_elements(components) c
   WHERE c->>'category' <> 'unknown';

  SELECT coalesce(sum((c->>'weight')::numeric), 0)
    INTO unknown_weight
    FROM jsonb_array_elements(components) c
   WHERE c->>'category' = 'unknown';

  -- Match weight: factory_correct=1.0, correct_reproduction=0.85,
  -- period_correct_substitute=0.55, non_correct=0.0; unknown excluded from score numerator.
  SELECT coalesce(sum(
      (c->>'weight')::numeric * CASE c->>'category'
        WHEN 'factory_correct' THEN 1.0
        WHEN 'correct_reproduction' THEN 0.85
        WHEN 'period_correct_substitute' THEN 0.55
        WHEN 'non_correct' THEN 0.0
        ELSE 0 END
    ), 0)
    INTO match_weight
    FROM jsonb_array_elements(components) c
   WHERE c->>'category' <> 'unknown';

  IF known_weight > 0 THEN
    score := round((match_weight / known_weight) * 100, 1);
  ELSE
    score := NULL;
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'applicable', true,
    'target', target,
    'components', components,
    'weights', jsonb_build_object(
      'engine', w_engine, 'identity_cowl_options', w_identity,
      'drivetrain', w_drivetrain, 'appearance', w_appearance, 'other', w_other
    ),
    'known_weight', known_weight,
    'unknown_weight', unknown_weight,
    'unknown_share', round(unknown_weight / (w_engine + w_identity + w_drivetrain + w_appearance + w_other), 4),
    'accuracy_score_known_only', score,
    'distinct_from', 'originality_score',
    'logic_version', 'vehicle_replica_accuracy/20261122032000',
    'as_of', now()
  );
END
$fn$;

COMMENT ON FUNCTION public.vehicle_replica_accuracy(uuid) IS
  'Replica-accuracy fold for vehicles with is_replica. Scores components against the declared '
  'target (replica_quote tokens). Categories: factory_correct, correct_reproduction, '
  'period_correct_substitute, non_correct, unknown. Unknown share is always reported; never guesses. '
  'Distinct from originality_score (P factory-original). Public undeleted vehicles (or tied / '
  'service_role) only; null when the caller may not see the vehicle.';

REVOKE ALL ON FUNCTION public.vehicle_replica_accuracy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_replica_accuracy(uuid) TO anon, authenticated, service_role;
