-- Draft (not filed, not applied): sanctioned resample + all-unclear expiry for
-- awaiting_gate chunks. Status/sample changes only; never files.
--
-- 1. capture_landing_gate_extend_v1 — all-unclear chunks that still have unused
--    clear photos: enqueue those unused frames as pre_gate/pending. Never shrink
--    (or bump) required_n. Do not remake viewed rows. Do not change chunk state.
-- 2. capture_landing_gate_expire_all_unclear_v1 — fully sampled all-unclear
--    chunks (no unused frames): rewrite clear sets to review/gate_undecided,
--    write capture_set_review, set the chunk applied. Do not file.
--    Ledger effect: waiting -> held. Revert-by-run restores the clear sets,
--    the review rows we wrote, and awaiting_gate.
--
-- Signed, dry-default, cap 50. Do not call filing_gate_enqueue (it resets
-- required_n). Revert of this migration:
--   supabase/sql/revert_20261115170000_capture_landing_gate_extend_expire.sql

SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.capture_landing_gate_extend_log (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  user_id uuid NOT NULL,
  image_ids uuid[] NOT NULL,
  required_n_before int,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);
CREATE INDEX IF NOT EXISTS capture_landing_gate_extend_log_run ON public.capture_landing_gate_extend_log (run_id);

CREATE TABLE IF NOT EXISTS public.capture_landing_gate_expire_log (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  user_id uuid NOT NULL,
  prior_state text NOT NULL,
  prior_note text,
  prior_sets jsonb NOT NULL,
  review_set_keys text[] NOT NULL,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);
CREATE INDEX IF NOT EXISTS capture_landing_gate_expire_log_run ON public.capture_landing_gate_expire_log (run_id);

-- Eligible awaiting_gate all-unclear (error_rate null): every existing pre_gate
-- sample is unclear, none pending/correct/wrong, and unclear >= required_n.
-- unused_n = clear photos not already in the run's queue.

CREATE OR REPLACE FUNCTION public.capture_landing_gate_extend_v1(p_user uuid, p_run uuid, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; n int := 0; n_samp int := 0; v_items jsonb := '[]'; v_sig text; v_new uuid[]; v_budget int; v_left int;
BEGIN
  -- (20261115170000) extend unused clear frames; never shrink required_n
  IF p_user IS NULL OR p_run IS NULL THEN RAISE EXCEPTION 'capture_landing_gate_extend_v1: user and run required'; END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN RAISE EXCEPTION 'capture_landing_gate_extend_v1: cap must be 1..50'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_landing_gate_extend'));
  CREATE TEMP TABLE IF NOT EXISTS _ext (
    chunk_id uuid, run_txt text, t_from timestamptz, required_n int, unused_n int, image_ids uuid[]
  ) ON COMMIT DROP;
  TRUNCATE _ext;
  INSERT INTO _ext
  SELECT c.id, c.run_id::text, c.t_from, g.required_n,
         (SELECT count(*) FROM capture_landing_sets s CROSS JOIN LATERAL unnest(s.image_ids) i(img)
           WHERE s.chunk_id = c.id AND s.decision = 'clear'
             AND NOT EXISTS (
               SELECT 1 FROM auto_filing_audit_queue q
                WHERE q.run_id = c.run_id::text AND q.image_id = i.img AND q.source = 'pre_gate')),
         ARRAY[]::uuid[]
  FROM capture_landing_chunks c
  JOIN filing_run_gate g ON g.run_id = c.run_id::text
  WHERE c.user_id = p_user AND NOT c.dry AND c.state = 'awaiting_gate'
    AND coalesce(g.passed, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM auto_filing_audit_queue q
       WHERE q.run_id = c.run_id::text AND q.source = 'pre_gate'
         AND q.status IN ('pending','correct','wrong'))
    AND (SELECT count(*) FROM auto_filing_audit_queue q
          WHERE q.run_id = c.run_id::text AND q.source = 'pre_gate' AND q.status = 'unclear')
        >= coalesce(g.required_n, 0)
    AND EXISTS (
      SELECT 1 FROM capture_landing_sets s CROSS JOIN LATERAL unnest(s.image_ids) i(img)
       WHERE s.chunk_id = c.id AND s.decision = 'clear'
         AND NOT EXISTS (
           SELECT 1 FROM auto_filing_audit_queue q
            WHERE q.run_id = c.run_id::text AND q.image_id = i.img AND q.source = 'pre_gate'));
  SELECT count(*), coalesce(sum(unused_n),0) INTO n, n_samp FROM _ext;
  SELECT coalesce(jsonb_agg(jsonb_build_object('chunk', chunk_id, 'day', t_from, 'unused', unused_n, 'required_n', required_n) ORDER BY t_from), '[]')
    INTO v_items FROM _ext;
  IF p_dry THEN
    RETURN jsonb_build_object('run', p_run, 'dry_run', true, 'would_extend', n, 'unused_photos', n_samp, 'cap', p_cap, 'over_cap', n > p_cap, 'items', v_items);
  END IF;
  IF n > p_cap THEN
    RETURN jsonb_build_object('run', p_run, 'dry_run', false, 'halted_over_cap', true, 'candidates', n, 'cap', p_cap, 'written', 0);
  END IF;
  v_budget := p_cap;
  FOR r IN SELECT * FROM _ext ORDER BY t_from LOOP
    EXIT WHEN v_budget < 1;
    v_left := v_budget;
    SELECT coalesce(array_agg(z.img ORDER BY z.ord), ARRAY[]::uuid[]) INTO v_new
    FROM (
      SELECT z.img, row_number() OVER () AS ord
      FROM (
        SELECT i.img, s.set_key, row_number() OVER (PARTITION BY s.set_key ORDER BY random()) AS rn
        FROM capture_landing_sets s
        CROSS JOIN LATERAL unnest(s.image_ids) i(img)
        WHERE s.chunk_id = r.chunk_id AND s.decision = 'clear'
          AND NOT EXISTS (
            SELECT 1 FROM auto_filing_audit_queue q
             WHERE q.run_id = r.run_txt AND q.image_id = i.img AND q.source = 'pre_gate')
      ) z
      ORDER BY z.rn, random()
      LIMIT v_left
    ) z;
    IF v_new IS NULL OR cardinality(v_new) = 0 THEN CONTINUE; END IF;
    INSERT INTO auto_filing_audit_queue (image_id, vehicle_id, source, run_id, status, reason)
    SELECT i.img, s.vehicle_id, 'pre_gate', r.run_txt, 'pending', s.set_key || ' extend=' || p_run::text
    FROM capture_landing_sets s
    CROSS JOIN LATERAL unnest(s.image_ids) i(img)
    WHERE s.chunk_id = r.chunk_id AND s.decision = 'clear' AND i.img = ANY (v_new)
    ON CONFLICT (image_id, run_id) DO NOTHING;
    -- required_n is intentionally not updated
    v_sig := encode(sha256(convert_to(concat_ws('|', 'capture_landing_gate_extend_v1', p_run, r.chunk_id, array_to_string(v_new, ',')), 'UTF8')), 'hex');
    INSERT INTO capture_landing_gate_extend_log (run_id, chunk_id, user_id, image_ids, required_n_before, signature)
    VALUES (p_run, r.chunk_id, p_user, v_new, r.required_n, v_sig);
    v_budget := v_budget - cardinality(v_new);
  END LOOP;
  RETURN jsonb_build_object('run', p_run, 'dry_run', false,
    'extended', (SELECT count(*) FROM capture_landing_gate_extend_log WHERE run_id = p_run AND reverted_at IS NULL),
    'queued', (SELECT coalesce(sum(cardinality(image_ids)),0) FROM capture_landing_gate_extend_log WHERE run_id = p_run AND reverted_at IS NULL),
    'items', v_items,
    'revert', 'select capture_landing_gate_extend_revert_v1(''' || p_run || ''')');
END $function$;

CREATE OR REPLACE FUNCTION public.capture_landing_gate_extend_revert_v1(p_run uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l record; n int := 0; c_run text;
BEGIN
  -- (20261115170000)
  IF p_run IS NULL THEN RAISE EXCEPTION 'capture_landing_gate_extend_revert_v1: run required'; END IF;
  FOR l IN SELECT * FROM capture_landing_gate_extend_log WHERE run_id = p_run AND reverted_at IS NULL LOOP
    SELECT run_id::text INTO c_run FROM capture_landing_chunks WHERE id = l.chunk_id;
    DELETE FROM auto_filing_audit_queue q
     WHERE q.run_id = c_run AND q.source = 'pre_gate' AND q.status = 'pending'
       AND q.image_id = ANY (l.image_ids)
       AND q.reason LIKE '%extend=' || p_run::text || '%';
    UPDATE capture_landing_gate_extend_log SET reverted_at = now() WHERE id = l.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.capture_landing_gate_expire_all_unclear_v1(p_user uuid, p_run uuid, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; n int := 0; v_items jsonb := '[]'; v_sig text; v_sets jsonb; v_keys text[]; v_note text;
BEGIN
  -- (20261115170000) fully sampled all-unclear -> review / gate_undecided, not file
  IF p_user IS NULL OR p_run IS NULL THEN RAISE EXCEPTION 'capture_landing_gate_expire_all_unclear_v1: user and run required'; END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN RAISE EXCEPTION 'capture_landing_gate_expire_all_unclear_v1: cap must be 1..50'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_landing_gate_expire'));
  CREATE TEMP TABLE IF NOT EXISTS _exp (
    chunk_id uuid, run_uuid uuid, t_from timestamptz, prior_state text, prior_note text, n_clear int
  ) ON COMMIT DROP;
  TRUNCATE _exp;
  INSERT INTO _exp
  SELECT c.id, c.run_id, c.t_from, c.state, c.note,
         (SELECT count(*) FROM capture_landing_sets s WHERE s.chunk_id = c.id AND s.decision = 'clear')
  FROM capture_landing_chunks c
  JOIN filing_run_gate g ON g.run_id = c.run_id::text
  WHERE c.user_id = p_user AND NOT c.dry AND c.state = 'awaiting_gate'
    AND coalesce(g.passed, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM auto_filing_audit_queue q
       WHERE q.run_id = c.run_id::text AND q.source = 'pre_gate'
         AND q.status IN ('pending','correct','wrong'))
    AND (SELECT count(*) FROM auto_filing_audit_queue q
          WHERE q.run_id = c.run_id::text AND q.source = 'pre_gate' AND q.status = 'unclear')
        >= coalesce(g.required_n, 0)
    AND NOT EXISTS (
      SELECT 1 FROM capture_landing_sets s CROSS JOIN LATERAL unnest(s.image_ids) i(img)
       WHERE s.chunk_id = c.id AND s.decision = 'clear'
         AND NOT EXISTS (
           SELECT 1 FROM auto_filing_audit_queue q
            WHERE q.run_id = c.run_id::text AND q.image_id = i.img AND q.source = 'pre_gate'));
  SELECT count(*) INTO n FROM _exp;
  SELECT coalesce(jsonb_agg(jsonb_build_object('chunk', chunk_id, 'day', t_from, 'clear_sets', n_clear) ORDER BY t_from), '[]')
    INTO v_items FROM _exp;
  IF p_dry THEN
    RETURN jsonb_build_object('run', p_run, 'dry_run', true, 'would_expire', n, 'cap', p_cap, 'over_cap', n > p_cap, 'items', v_items);
  END IF;
  IF n > p_cap THEN
    RETURN jsonb_build_object('run', p_run, 'dry_run', false, 'halted_over_cap', true, 'candidates', n, 'cap', p_cap, 'written', 0);
  END IF;
  FOR r IN SELECT * FROM _exp ORDER BY t_from LOOP
    SELECT coalesce(jsonb_agg(jsonb_build_object('set_key', s.set_key, 'decision', s.decision, 'reason', s.reason) ORDER BY s.set_key), '[]')
      INTO v_sets
      FROM capture_landing_sets s WHERE s.chunk_id = r.chunk_id AND s.decision = 'clear';
    UPDATE capture_landing_sets
       SET decision = 'review', reason = 'gate_undecided'
     WHERE chunk_id = r.chunk_id AND decision = 'clear';
    INSERT INTO capture_set_review (run_id, user_id, set_key, image_ids, to_vehicle_id, confidence, basis, evidence, reason, status)
    SELECT r.run_uuid, p_user, s.set_key, s.image_ids, s.vehicle_id,
           round(1/(1+exp(-coalesce(s.score,0)+2)),3), 'scored_session',
           jsonb_build_object('expire_run', p_run, 'prior_decision', 'clear', 'scorer', 'v3', 'top3', s.top3),
           'gate_undecided', 'open'
    FROM capture_landing_sets s
    WHERE s.chunk_id = r.chunk_id AND s.decision = 'review' AND s.reason = 'gate_undecided'
    ON CONFLICT (run_id, set_key) DO NOTHING;
    SELECT coalesce(array_agg(s.set_key ORDER BY s.set_key), ARRAY[]::text[]) INTO v_keys
      FROM capture_landing_sets s WHERE s.chunk_id = r.chunk_id AND s.reason = 'gate_undecided';
    v_sig := encode(sha256(convert_to(concat_ws('|', 'capture_landing_gate_expire_all_unclear_v1', p_run, r.chunk_id, r.prior_state), 'UTF8')), 'hex');
    v_note := 'all-unclear gate expired to review (capture_landing_gate_expire_all_unclear_v1 run ' || p_run || ')';
    UPDATE capture_landing_chunks
       SET state = 'applied', note = v_note, updated_at = now(),
           stats = coalesce(stats, '{}') || jsonb_build_object('gate_expire', jsonb_build_object('run', p_run, 'at', now(), 'signature', v_sig))
     WHERE id = r.chunk_id AND state = 'awaiting_gate';
    IF FOUND THEN
      INSERT INTO capture_landing_gate_expire_log (run_id, chunk_id, user_id, prior_state, prior_note, prior_sets, review_set_keys, signature)
      VALUES (p_run, r.chunk_id, p_user, r.prior_state, r.prior_note, v_sets, v_keys, v_sig);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('run', p_run, 'dry_run', false,
    'expired', (SELECT count(*) FROM capture_landing_gate_expire_log WHERE run_id = p_run AND reverted_at IS NULL),
    'items', v_items,
    'revert', 'select capture_landing_gate_expire_all_unclear_revert_v1(''' || p_run || ''')');
END $function$;

CREATE OR REPLACE FUNCTION public.capture_landing_gate_expire_all_unclear_revert_v1(p_run uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l record; n int := 0; rec jsonb; c_run uuid;
BEGIN
  -- (20261115170000)
  IF p_run IS NULL THEN RAISE EXCEPTION 'capture_landing_gate_expire_all_unclear_revert_v1: run required'; END IF;
  FOR l IN SELECT * FROM capture_landing_gate_expire_log WHERE run_id = p_run AND reverted_at IS NULL LOOP
    SELECT run_id INTO c_run FROM capture_landing_chunks WHERE id = l.chunk_id;
    DELETE FROM capture_set_review r
     WHERE r.run_id = c_run AND r.set_key = ANY (l.review_set_keys)
       AND r.reason = 'gate_undecided' AND r.evidence->>'expire_run' = p_run::text;
    FOR rec IN SELECT * FROM jsonb_array_elements(l.prior_sets) LOOP
      UPDATE capture_landing_sets
         SET decision = rec->>'decision', reason = rec->>'reason'
       WHERE chunk_id = l.chunk_id AND set_key = rec->>'set_key';
    END LOOP;
    UPDATE capture_landing_chunks
       SET state = l.prior_state, note = l.prior_note, updated_at = now(),
           stats = stats - 'gate_expire'
     WHERE id = l.chunk_id AND state = 'applied'
       AND stats->'gate_expire'->>'run' = p_run::text;
    IF FOUND THEN n := n + 1; END IF;
    UPDATE capture_landing_gate_expire_log SET reverted_at = now() WHERE id = l.id;
  END LOOP;
  RETURN n;
END $function$;

REVOKE ALL ON FUNCTION public.capture_landing_gate_extend_v1(uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_landing_gate_extend_revert_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_landing_gate_expire_all_unclear_v1(uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_landing_gate_expire_all_unclear_revert_v1(uuid) FROM PUBLIC, anon, authenticated;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.capture_landing_gate_extend_v1(uuid, uuid, boolean, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.capture_landing_gate_extend_revert_v1(uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.capture_landing_gate_expire_all_unclear_v1(uuid, uuid, boolean, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.capture_landing_gate_expire_all_unclear_revert_v1(uuid) TO service_role;
  END IF;
END $g$;
COMMENT ON FUNCTION public.capture_landing_gate_extend_v1(uuid, uuid, boolean, integer) IS
  'Enqueue unused clear photos as pre_gate/pending on all-unclear awaiting_gate chunks; never shrink required_n, never remake viewed rows, never change chunk state (signed, dry default, cap 50; 20261115170000).';
COMMENT ON FUNCTION public.capture_landing_gate_expire_all_unclear_v1(uuid, uuid, boolean, integer) IS
  'Expire fully sampled all-unclear awaiting_gate chunks to review/gate_undecided and applied; does not file (signed, dry default, cap 50; 20261115170000).';
