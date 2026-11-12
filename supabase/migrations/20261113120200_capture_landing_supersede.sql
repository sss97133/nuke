-- Retire older still-waiting landing chunks once a newer plan of the same day covers the same photos.
--
-- Why (2026-11-09): before 20261113120000 the hourly re-plan made up to 8 chunks per day (e.g. 2026-11-03 x8, the R3500
-- 2017-18 days x2-3). Only the newest plan matters (capture_day_replan_state reads it), but the older ones stay
-- awaiting_gate forever: their samples were hand-viewed unclear, so the gate can neither pass nor fail them.
-- capture_landing_supersede_v1(user, run, dry, cap) moves such a chunk awaiting_gate -> superseded when a NEWER chunk of
-- the same user and window exists whose sets contain every photo of the old chunk's clear sets. A status change only:
-- nothing is filed, unfiled or deleted; sets, samples and gate rows stay. Dry run by default; cap 50 per run (above the cap
-- the run halts and writes nothing). Each row is logged with a sha256 signature under the run id; revert by run with
-- capture_landing_supersede_revert_v1(run), which only touches chunks the run still owns (state still superseded).
-- Revert the migration: supabase/sql/revert_20261113120200_capture_landing_supersede.sql.
-- Contract: supabase/sql/test_capture_landing_supersede.sql. Lane: photo/document/library (Codex reviews).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.capture_landing_supersede_log (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  by_chunk uuid NOT NULL,
  user_id uuid NOT NULL,
  t_from timestamptz NOT NULL,
  prior_state text NOT NULL,
  image_ids uuid[] NOT NULL,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);
CREATE INDEX IF NOT EXISTS capture_landing_supersede_log_run ON public.capture_landing_supersede_log (run_id);
ALTER TABLE public.capture_landing_supersede_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capture_landing_supersede_log FROM PUBLIC, anon, authenticated;

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

CREATE OR REPLACE FUNCTION public.capture_landing_supersede_revert_v1(p_run uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l record; n int := 0;
BEGIN
  FOR l IN SELECT * FROM capture_landing_supersede_log WHERE run_id = p_run AND reverted_at IS NULL LOOP
    UPDATE capture_landing_chunks SET state = l.prior_state, updated_at = now(), note = 'supersede run ' || p_run || ' reverted',
           stats = stats - 'superseded'
     WHERE id = l.chunk_id AND state = 'superseded' AND stats->'superseded'->>'run' = p_run::text;
    IF FOUND THEN n := n + 1; END IF;
    UPDATE capture_landing_supersede_log SET reverted_at = now() WHERE id = l.id;
  END LOOP;
  RETURN n;
END $function$;

REVOKE ALL ON FUNCTION public.capture_landing_supersede_v1(uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_landing_supersede_revert_v1(uuid) FROM PUBLIC, anon, authenticated;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.capture_landing_supersede_v1(uuid, uuid, boolean, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.capture_landing_supersede_revert_v1(uuid) TO service_role;
  END IF;
END $g$;
COMMENT ON FUNCTION public.capture_landing_supersede_v1(uuid, uuid, boolean, integer) IS
  'Retire older awaiting_gate chunks covered by a newer plan of the same day (status change only, signed, revert by run; 20261113120200).';
COMMIT;
