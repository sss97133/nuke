-- Review fixes (20261123193000)
--  * Conflict scoring holds across runs: each reading keeps base_confidence; text_code_rescore_v1(vehicles) sets
--    confidence = base x 0.6 for every active reading of a kind whose active codes differ for that car (any run), else base.
--    The producer rescores the cars of each slice after inserting; revert rescores the cars whose rows it removed.
--  * data_set_label_backfill_v1 never re-stamps a set an earlier backfill already labelled, so each run's revert restores
--    that run's own snapshot.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';
ALTER TABLE public.vehicle_code_readings ADD COLUMN IF NOT EXISTS base_confidence numeric(4,3);
ALTER TABLE public.vehicle_code_readings_backup ADD COLUMN IF NOT EXISTS base_confidence numeric(4,3);
-- backfill: base = the pattern's confidence, x 0.6 for comments (exactly what the producer wrote before scoring conflicts)
UPDATE public.vehicle_code_readings r SET base_confidence = round(p.base_conf * CASE WHEN r.origin_table = 'auction_comments' THEN 0.6 ELSE 1 END, 3)
  FROM (VALUES ('block_casting_no', 0.60), ('engine_code_label', 0.60), ('engine_stamp_after_partial_vin', 0.60), ('code_suffix', 0.50),
               ('cid_code_block', 0.55), ('trans_case_casting_no', 0.50), ('main_case', 0.50), ('tail_housing_no', 0.55),
               ('paint_code', 0.55), ('paint_colon_named', 0.55), ('fisher_style', 0.60), ('tag_then_option', 0.50),
               ('option_then_tag', 0.50)) p(pattern_key, base_conf)
 WHERE p.pattern_key = r.pattern_key AND r.base_confidence IS NULL;
ALTER TABLE public.vehicle_code_readings ALTER COLUMN base_confidence SET NOT NULL;

CREATE OR REPLACE FUNCTION public.text_code_rescore_v1(p_vehicles uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n int;
BEGIN
  WITH k AS (
    SELECT r.id, CASE WHEN r.kind <> 'cowl_option'
                       AND max(r.code) OVER (PARTITION BY r.vehicle_id, r.kind) <> min(r.code) OVER (PARTITION BY r.vehicle_id, r.kind)
                      THEN round(r.base_confidence * 0.6, 3) ELSE r.base_confidence END AS c
      FROM public.vehicle_code_readings r WHERE r.vehicle_id = ANY (p_vehicles) AND r.state = 'active'),
  u AS (UPDATE public.vehicle_code_readings r SET confidence = k.c FROM k WHERE r.id = k.id AND r.confidence IS DISTINCT FROM k.c
        RETURNING 1)
  SELECT count(*) INTO n FROM u;
  RETURN n;
END
$function$;

CREATE OR REPLACE FUNCTION public.text_code_decode_v1(p_run uuid, p_scope text DEFAULT 'pontiac_f_body', p_vehicle uuid DEFAULT NULL,
  p_batch integer DEFAULT 400, p_from integer DEFAULT 1, p_count integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '900s'
AS $function$
DECLARE v_ids uuid[]; v_chunk uuid[]; i int; v_end int; n int := 0; b int := 0;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'text_code_decode_v1: run required'; END IF;
  IF p_scope NOT IN ('vehicle','pontiac_f_body') THEN RAISE EXCEPTION 'text_code_decode_v1: unknown scope %', p_scope; END IF;
  IF p_from IS NULL OR p_from < 1 THEN RAISE EXCEPTION 'text_code_decode_v1: p_from starts at 1'; END IF;
  IF p_from = 1 AND EXISTS (SELECT 1 FROM public.vehicle_code_reading_runs r WHERE r.run_id = p_run::text) THEN
    RAISE EXCEPTION 'text_code_decode_v1: run % already exists', p_run;
  END IF;
  IF p_from > 1 AND NOT EXISTS (SELECT 1 FROM public.vehicle_code_reading_runs r WHERE r.run_id = p_run::text
                                   AND r.status = 'applying' AND r.scope = p_scope) THEN
    RAISE EXCEPTION 'text_code_decode_v1: run % is not open for scope %', p_run, p_scope;
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_ids FROM unnest(coalesce(public.data_set_scope_vehicles(p_scope, p_vehicle), '{}')) x
   WHERE x::text NOT LIKE '9cf5b7a4%';
  v_ids := coalesce(v_ids, '{}');
  IF p_from = 1 THEN
    INSERT INTO public.vehicle_code_reading_runs (run_id, producer, logic_version, scope, n_vehicles)
    VALUES (p_run::text, 'text_code_decode_v1', 'text_code_decode/20261123193000.1', p_scope, cardinality(v_ids));
  END IF;
  i := p_from;
  v_end := least(cardinality(v_ids), CASE WHEN p_count IS NULL THEN cardinality(v_ids) ELSE p_from + p_count - 1 END);
  WHILE i <= v_end LOOP
    v_chunk := v_ids[i : least(i + p_batch - 1, v_end)];
    WITH src AS (
      SELECT x.id AS vehicle_id, x.year, 'vehicles'::text AS ot, x.id AS oid, c.col, c.txt, true AS keep_text
        FROM public.vehicles x
       CROSS JOIN LATERAL (VALUES ('description', x.description), ('highlights', x.highlights), ('equipment', x.equipment),
                                  ('modifications', x.modifications), ('numbers_quote', x.numbers_quote)) c(col, txt)
       WHERE x.id = ANY (v_chunk) AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL AND c.txt IS NOT NULL
         AND c.txt ~* '(casting|code|stamp|paint|2f[suvwx]?87|tag|case|housing)'
      UNION ALL
      SELECT ac.vehicle_id, x.year, 'auction_comments', ac.id, 'comment_text', ac.comment_text, false
        FROM public.auction_comments ac JOIN public.vehicles x ON x.id = ac.vehicle_id
       WHERE ac.vehicle_id = ANY (v_chunk) AND ac.comment_type IS DISTINCT FROM 'bid' AND ac.comment_type IS DISTINCT FROM 'sold'
         AND ac.comment_text ~* '(casting|code|stamp|paint|2f[suvwx]?87|tag|case|housing)'),
    hits AS (
      SELECT s.*, t.kind, t.code, t.match_text, t.pattern_key,
             CASE WHEN s.ot = 'auction_comments' THEN round(t.base_conf * 0.6, 3) ELSE t.base_conf END AS conf
        FROM src s CROSS JOIN LATERAL public.text_code_matches_v1(s.txt) t),
    ok AS (
      SELECT h.* FROM hits h
       WHERE h.code ~ '^[A-Z0-9]{2,8}$'
         AND (h.kind <> 'engine_code' OR EXISTS (
               SELECT 1 FROM public.vehicle_decode_rules d WHERE d.rule_key = 'engine_stamp_code' AND d.superseded_at IS NULL
                  AND lower(d.make) = 'pontiac' AND upper(d.code) = h.code AND d.year_min <= h.year AND d.year_max >= h.year))
         AND (h.kind NOT IN ('paint_code','cowl_style','cowl_option') OR h.year IS NOT NULL)),
    one AS (
      SELECT DISTINCT ON (o.vehicle_id, o.kind, o.code, o.ot, o.oid, o.col) o.*
        FROM ok o ORDER BY o.vehicle_id, o.kind, o.code, o.ot, o.oid, o.col, o.conf DESC, o.pattern_key),
    scored AS (SELECT o.*, o.conf AS conf2 FROM one o)
    INSERT INTO public.vehicle_code_readings (vehicle_id, kind, code, model_year, origin_table, origin_id, origin_column, match_text,
      pattern_key, confidence, base_confidence, rule_version, run_id)
    SELECT s.vehicle_id, s.kind, s.code, s.year, s.ot, s.oid, s.col, CASE WHEN s.keep_text THEN s.match_text END, s.pattern_key,
           s.conf2, s.conf2, 'text_code_decode_v1', p_run::text
      FROM scored s
    ON CONFLICT (vehicle_id, kind, code, origin_table, origin_id, origin_column) WHERE state = 'active' DO NOTHING;
    GET DIAGNOSTICS b = ROW_COUNT;
    n := n + b;
    PERFORM public.text_code_rescore_v1(v_chunk);
    i := i + p_batch;
  END LOOP;
  IF v_end < cardinality(v_ids) THEN
    RETURN jsonb_build_object('run_id', p_run, 'vehicles', cardinality(v_ids), 'inserted_this_slice', n, 'next_from', v_end + 1, 'done', false);
  END IF;
  UPDATE public.vehicle_code_reading_runs SET status = 'applied', applied_at = now(),
         summary = jsonb_build_object('inserted', (SELECT count(*) FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text),
           'by_kind', (SELECT jsonb_object_agg(k, c) FROM (SELECT r.kind || ':' || r.origin_table AS k, count(*) AS c
                         FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text GROUP BY 1) z),
           'vehicles_with_readings', (SELECT count(DISTINCT r.vehicle_id) FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text))
   WHERE run_id = p_run::text;
  RETURN (SELECT jsonb_build_object('run_id', run_id, 'vehicles', n_vehicles, 'done', true, 'inserted_this_slice', n) || summary FROM public.vehicle_code_reading_runs
           WHERE run_id = p_run::text);
END
$function$;

CREATE OR REPLACE FUNCTION public.text_code_decode_revert_v1(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '600s'
AS $function$
DECLARE n_bk int; n_del int; v_veh uuid[];
BEGIN
  IF EXISTS (SELECT 1 FROM public.data_set_members m JOIN public.vehicle_code_readings r ON r.id = m.basis_id
              WHERE m.basis_type = 'code_reading' AND m.state = 'active' AND r.run_id = p_run::text) THEN
    RAISE EXCEPTION 'text_code_decode_revert_v1: active data_set_members cite run %; revert the membership run first', p_run;
  END IF;
  INSERT INTO public.vehicle_code_readings_backup (id, vehicle_id, kind, code, model_year, origin_table, origin_id, origin_column, match_text, match_offset, pattern_key, confidence, rule_version, run_id, state, created_at, reverted_at, base_confidence, backed_up_at)
  SELECT r.id, r.vehicle_id, r.kind, r.code, r.model_year, r.origin_table, r.origin_id, r.origin_column, r.match_text, r.match_offset, r.pattern_key, r.confidence, r.rule_version, r.run_id, r.state, r.created_at, r.reverted_at, r.base_confidence, now()
    FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text;
  GET DIAGNOSTICS n_bk = ROW_COUNT;
  SELECT array_agg(DISTINCT r.vehicle_id) INTO v_veh FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text;
  DELETE FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text;
  GET DIAGNOSTICS n_del = ROW_COUNT;
  PERFORM public.text_code_rescore_v1(coalesce(v_veh, '{}'));
  UPDATE public.vehicle_code_reading_runs SET status = 'reverted', reverted_at = now(),
         summary = summary || jsonb_build_object('reverted', jsonb_build_object('backed_up', n_bk, 'deleted', n_del))
   WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'backed_up', n_bk, 'deleted', n_del);
END
$function$;

CREATE OR REPLACE FUNCTION public.data_set_label_backfill_v1(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n_set int; n_fix int;
BEGIN
  -- engine_code sets labelled from one year's rule by run a006's text readings: re-derive from all years (NULL when they differ)
  WITH f AS (
    UPDATE public.data_sets s SET label = public.data_set_key_label_v1(s.set_kind, s.set_key),
           provenance = s.provenance || jsonb_build_object('label_backfill_run', p_run::text, 'label_before', s.label)
     WHERE s.set_kind = 'engine_code' AND s.rule_version = 'data_set_keys_v1' AND s.label IS NOT NULL
       AND s.created_run_id = '5d1a7c2e-0f3b-4c8e-9a61-20261123a006'
       -- a set already relabelled by an earlier backfill keeps that run's snapshot, so its revert still restores
       AND NOT (s.provenance ? 'label_backfill_run')
       AND s.label IS DISTINCT FROM public.data_set_key_label_v1(s.set_kind, s.set_key)
    RETURNING 1)
  SELECT count(*) INTO n_fix FROM f;
  WITH u AS (
    UPDATE public.data_sets s SET label = public.data_set_key_label_v1(s.set_kind, s.set_key),
           provenance = s.provenance || jsonb_build_object('label_backfill_run', p_run::text, 'label_before', NULL)
     WHERE s.set_kind IN ('vin_series','vin_engine','plant_year','vin_cohort','engine_code') AND s.rule_version = 'data_set_keys_v1'
       AND s.label IS NULL AND NOT (s.provenance ? 'label_backfill_run')
       AND public.data_set_key_label_v1(s.set_kind, s.set_key) IS NOT NULL
    RETURNING 1)
  SELECT count(*) INTO n_set FROM u;
  RETURN jsonb_build_object('run_id', p_run, 'labelled', n_set, 'relabelled_engine_code', n_fix);
END
$function$;

SELECT public.text_code_rescore_v1(coalesce((SELECT array_agg(DISTINCT vehicle_id) FROM public.vehicle_code_readings WHERE state = 'active'), '{}'));

REVOKE ALL ON FUNCTION public.text_code_rescore_v1(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.text_code_rescore_v1(uuid[]) TO service_role;
commit;
