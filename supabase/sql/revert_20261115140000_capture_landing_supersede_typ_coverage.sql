-- Restore capture_landing_supersede_v1 to the pre-20261115140000 live body
-- (md5 89cd5b3a65f49e406ac00e4ee6091530). Refuses if the typ-coverage marker is absent.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

DO $do$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='capture_landing_supersede_v1' AND pronamespace='public'::regnamespace
     AND pg_get_function_identity_arguments(oid)='p_user uuid, p_run uuid, p_dry boolean, p_cap integer';
  IF position('(20261115140000)' in coalesce(v_def,'')) = 0 THEN
    RAISE EXCEPTION 'refusing revert: live capture_landing_supersede_v1 does not carry the 20261115140000 marker';
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.capture_landing_supersede_v1(p_user uuid, p_run uuid, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; n int := 0; v_items jsonb := '[]'; v_sig text;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN RAISE EXCEPTION 'capture_landing_supersede_v1: user and run required'; END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN RAISE EXCEPTION 'capture_landing_supersede_v1: cap must be 1..50'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_landing_supersede'));
  CREATE TEMP TABLE IF NOT EXISTS _sup (chunk_id uuid, by_chunk uuid, t_from timestamptz, prior_state text, image_ids uuid[]) ON COMMIT DROP;
  TRUNCATE _sup;
  INSERT INTO _sup
  SELECT o.id, nb.id, o.t_from, o.state, oi.imgs
  FROM capture_landing_chunks o
  CROSS JOIN LATERAL (SELECT array_agg(DISTINCT x ORDER BY x) imgs FROM capture_landing_sets s CROSS JOIN LATERAL unnest(s.image_ids) x
                      WHERE s.chunk_id = o.id AND s.decision = 'clear') oi
  CROSS JOIN LATERAL (
    SELECT n.id FROM capture_landing_chunks n
    WHERE n.user_id = o.user_id AND n.t_from = o.t_from AND n.t_to = o.t_to AND NOT n.dry AND n.id <> o.id
      AND n.created_at > o.created_at AND n.state <> 'superseded'
      AND oi.imgs <@ (SELECT coalesce(array_agg(DISTINCT x), '{}') FROM capture_landing_sets s2 CROSS JOIN LATERAL unnest(s2.image_ids) x WHERE s2.chunk_id = n.id)
    ORDER BY n.created_at DESC LIMIT 1) nb
  WHERE o.user_id = p_user AND NOT o.dry AND o.state = 'awaiting_gate' AND oi.imgs IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM filing_run_gate g WHERE g.run_id = o.run_id::text AND g.passed);
  SELECT count(*) INTO n FROM _sup;
  SELECT coalesce(jsonb_agg(jsonb_build_object('chunk', chunk_id, 'by', by_chunk, 'day', t_from, 'photos', cardinality(image_ids)) ORDER BY t_from), '[]')
    INTO v_items FROM _sup;
  IF p_dry THEN
    RETURN jsonb_build_object('run', p_run, 'dry_run', true, 'would_supersede', n, 'cap', p_cap, 'over_cap', n > p_cap, 'items', v_items);
  END IF;
  IF n > p_cap THEN
    RETURN jsonb_build_object('run', p_run, 'dry_run', false, 'halted_over_cap', true, 'candidates', n, 'cap', p_cap, 'written', 0);
  END IF;
  FOR r IN SELECT * FROM _sup ORDER BY t_from LOOP
    v_sig := encode(sha256(convert_to(concat_ws('|', 'capture_landing_supersede_v1', p_run, r.chunk_id, r.by_chunk, r.prior_state,
                                                 array_to_string(r.image_ids, ',')), 'UTF8')), 'hex');
    UPDATE capture_landing_chunks SET state = 'superseded', updated_at = now(),
           note = 'superseded by newer plan ' || r.by_chunk || ' (capture_landing_supersede_v1 run ' || p_run || ')',
           stats = coalesce(stats, '{}') || jsonb_build_object('superseded', jsonb_build_object('by', r.by_chunk, 'run', p_run,
                     'prior_state', r.prior_state, 'at', now(), 'signature', v_sig))
     WHERE id = r.chunk_id AND state = 'awaiting_gate';
    IF FOUND THEN
      INSERT INTO capture_landing_supersede_log (run_id, chunk_id, by_chunk, user_id, t_from, prior_state, image_ids, signature)
      VALUES (p_run, r.chunk_id, r.by_chunk, p_user, r.t_from, r.prior_state, r.image_ids, v_sig);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('run', p_run, 'dry_run', false, 'superseded', (SELECT count(*) FROM capture_landing_supersede_log WHERE run_id = p_run),
                            'items', v_items, 'revert', 'select capture_landing_supersede_revert_v1(''' || p_run || ''')');
END $function$;

REVOKE ALL ON FUNCTION public.capture_landing_supersede_v1(uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.capture_landing_supersede_v1(uuid, uuid, boolean, integer) TO service_role;
  END IF;
END $g$;
COMMENT ON FUNCTION public.capture_landing_supersede_v1(uuid, uuid, boolean, integer) IS
  'Retire older awaiting_gate chunks covered by a newer plan of the same day (status change only, signed, revert by run; 20261113120200).';
