-- text_code_decode_v1 fixes:
--  * Postgres has no DISTINCT window aggregate; "two different codes of one kind for one car" is max <> min.
--  * A function's own statement_timeout does not extend the caller's, so the producer resumes: p_from / p_count take a slice
--    of the scope's sorted vehicle ids; the first slice opens the run, the slice that reaches the end closes it.
begin;
set local lock_timeout = '3s';
DROP FUNCTION IF EXISTS public.text_code_decode_v1(uuid, text, uuid, integer);
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
    VALUES (p_run::text, 'text_code_decode_v1', 'text_code_decode/20261123191000.1', p_scope, cardinality(v_ids));
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
    -- two different codes of one kind read for the same car lower every reading of that kind for it
    scored AS (
      SELECT o.*, CASE WHEN max(o.code) OVER (PARTITION BY o.vehicle_id, o.kind) <> min(o.code) OVER (PARTITION BY o.vehicle_id, o.kind) AND o.kind <> 'cowl_option'
                       THEN round(o.conf * 0.6, 3) ELSE o.conf END AS conf2
        FROM one o)
    INSERT INTO public.vehicle_code_readings (vehicle_id, kind, code, model_year, origin_table, origin_id, origin_column, match_text,
      pattern_key, confidence, rule_version, run_id)
    SELECT s.vehicle_id, s.kind, s.code, s.year, s.ot, s.oid, s.col, CASE WHEN s.keep_text THEN s.match_text END, s.pattern_key,
           s.conf2, 'text_code_decode_v1', p_run::text
      FROM scored s
    ON CONFLICT (vehicle_id, kind, code, origin_table, origin_id, origin_column) WHERE state = 'active' DO NOTHING;
    GET DIAGNOSTICS b = ROW_COUNT;
    n := n + b;
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
REVOKE ALL ON FUNCTION public.text_code_decode_v1(uuid, text, uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.text_code_decode_v1(uuid, text, uuid, integer, integer, integer) TO service_role;
commit;
