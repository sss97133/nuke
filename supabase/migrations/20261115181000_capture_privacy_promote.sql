-- 20261115181000 capture_privacy_promote
-- Signed producer: promote already-classified personal rows (is_sensitive = true)
-- to the ledger's private terminal state (vision_gate_status = rejected_personal).
-- Dry-default, cap 50, backup in the log, revert-by-run, granted_by recorded.
-- Never touches photo content (image_url, thumbnail, file, bytes).
-- Excludes: empty image_url (the live 276 privacy-hold class), the
-- capture_privacy_promote_exclude table (load the 449/452-id privacy-backup union
-- at run time; IDs are not committed here), already-rejected rows, filed rows,
-- and rows that are already waiting, held, or failed (so private and unsorted
-- move by the same amount).

CREATE TABLE IF NOT EXISTS public.capture_privacy_promote_exclude (
  image_id uuid PRIMARY KEY,
  reason text NOT NULL DEFAULT 'privacy_backup_union',
  granted_by uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.capture_privacy_promote_log (
  run_id uuid NOT NULL,
  image_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  prior_status text,
  prior_reasoning text,
  prior_processed_at timestamptz,
  reason text NOT NULL,
  signature text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  PRIMARY KEY (run_id, image_id)
);

CREATE INDEX IF NOT EXISTS capture_privacy_promote_log_image_idx
  ON public.capture_privacy_promote_log (image_id, applied_at DESC);

REVOKE ALL ON public.capture_privacy_promote_exclude FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.capture_privacy_promote_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.capture_privacy_promote_exclude TO service_role;
GRANT ALL ON public.capture_privacy_promote_log TO service_role;

CREATE OR REPLACE FUNCTION public.capture_privacy_promote_exclude_add_v1(
  p_ids uuid[], p_granted_by uuid, p_reason text DEFAULT 'privacy_backup_union')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int := 0;
BEGIN
  IF p_ids IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'capture_privacy_promote_exclude_add_v1: ids and granted_by required';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'capture_privacy_promote_exclude_add_v1: reason required';
  END IF;
  INSERT INTO public.capture_privacy_promote_exclude (image_id, reason, granted_by)
  SELECT DISTINCT x, p_reason, p_granted_by
  FROM unnest(p_ids) AS x
  WHERE x IS NOT NULL
  ON CONFLICT (image_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('added', n, 'submitted', coalesce(array_length(p_ids, 1), 0), 'granted_by', p_granted_by);
END
$function$;

CREATE OR REPLACE FUNCTION public.capture_privacy_promote_v1(
  p_user uuid, p_run uuid, p_granted_by uuid, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_elig int := 0;
  n_take int := 0;
  v_items jsonb := '[]';
  v_sig text;
BEGIN
  IF p_user IS NULL OR p_run IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'capture_privacy_promote_v1: user, run and granted_by required';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN
    RAISE EXCEPTION 'capture_privacy_promote_v1: cap must be 1..50';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_privacy_promote'));

  CREATE TEMP TABLE IF NOT EXISTS _priv_elig (
    image_id uuid PRIMARY KEY,
    prior_status text,
    prior_reasoning text,
    prior_processed_at timestamptz,
    reason text NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _priv_elig;

  INSERT INTO _priv_elig
  SELECT vi.id, vi.vision_gate_status::text, vi.vision_gate_agent_reasoning, vi.vision_gate_processed_at, 'is_sensitive'
  FROM public.vehicle_images vi
  WHERE vi.user_id = p_user
    AND vi.is_sensitive IS TRUE
    AND vi.vehicle_id IS NULL
    AND coalesce(vi.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed')
    AND nullif(btrim(vi.image_url), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = vi.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_set_review r
      CROSS JOIN LATERAL unnest(r.image_ids) x(image_id)
      WHERE r.user_id = p_user AND r.status = 'open' AND x.image_id = vi.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_landing_chunks c
      JOIN public.capture_landing_sets s ON s.chunk_id = c.id AND s.decision = 'clear'
      CROSS JOIN LATERAL unnest(s.image_ids) x(image_id)
      WHERE c.user_id = p_user AND c.state = 'awaiting_gate' AND x.image_id = vi.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_upload_status u
      WHERE u.user_id = p_user AND u.stage = 'failed' AND u.image_id = vi.id)
  ORDER BY vi.id
  LIMIT p_cap;

  GET DIAGNOSTICS n_take = ROW_COUNT;

  SELECT count(*) INTO n_elig
  FROM public.vehicle_images vi
  WHERE vi.user_id = p_user
    AND vi.is_sensitive IS TRUE
    AND vi.vehicle_id IS NULL
    AND coalesce(vi.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed')
    AND nullif(btrim(vi.image_url), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = vi.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_set_review r
      CROSS JOIN LATERAL unnest(r.image_ids) x(image_id)
      WHERE r.user_id = p_user AND r.status = 'open' AND x.image_id = vi.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_landing_chunks c
      JOIN public.capture_landing_sets s ON s.chunk_id = c.id AND s.decision = 'clear'
      CROSS JOIN LATERAL unnest(s.image_ids) x(image_id)
      WHERE c.user_id = p_user AND c.state = 'awaiting_gate' AND x.image_id = vi.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_upload_status u
      WHERE u.user_id = p_user AND u.stage = 'failed' AND u.image_id = vi.id);

  SELECT coalesce(jsonb_agg(jsonb_build_object('image_id', image_id, 'reason', reason, 'prior_status', prior_status)
                             ORDER BY image_id), '[]')
    INTO v_items FROM _priv_elig;

  v_sig := 'privacy_promote_v1 run=' || p_run::text || ' granted_by=' || p_granted_by::text || ' reason=is_sensitive';

  IF p_dry THEN
    RETURN jsonb_build_object(
      'run', p_run, 'dry_run', true, 'granted_by', p_granted_by,
      'eligible', n_elig, 'would_promote', n_take, 'cap', p_cap,
      'remaining_after', greatest(n_elig - n_take, 0), 'items', v_items);
  END IF;

  INSERT INTO public.capture_privacy_promote_log
    (run_id, image_id, user_id, granted_by, prior_status, prior_reasoning, prior_processed_at, reason, signature)
  SELECT p_run, e.image_id, p_user, p_granted_by, e.prior_status, e.prior_reasoning, e.prior_processed_at, e.reason, v_sig
  FROM _priv_elig e;

  UPDATE public.vehicle_images vi
     SET vision_gate_status = 'rejected_personal',
         vision_gate_agent_reasoning = v_sig,
         vision_gate_processed_at = now()
    FROM _priv_elig e
   WHERE vi.id = e.image_id
     AND vi.user_id = p_user;

  GET DIAGNOSTICS n_take = ROW_COUNT;

  RETURN jsonb_build_object(
    'run', p_run, 'dry_run', false, 'granted_by', p_granted_by, 'applied', true,
    'eligible', n_elig, 'promoted', n_take, 'cap', p_cap,
    'remaining_after', greatest(n_elig - n_take, 0), 'signature', v_sig, 'items', v_items);
END
$function$;

CREATE OR REPLACE FUNCTION public.capture_privacy_promote_revert_v1(p_user uuid, p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int := 0; n_skip int := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN
    RAISE EXCEPTION 'capture_privacy_promote_revert_v1: user and run required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_privacy_promote'));

  UPDATE public.vehicle_images vi
     SET vision_gate_status = CASE
           WHEN l.prior_status IS NULL THEN NULL
           ELSE l.prior_status::public.vision_gate_status
         END,
         vision_gate_agent_reasoning = l.prior_reasoning,
         vision_gate_processed_at = l.prior_processed_at
    FROM public.capture_privacy_promote_log l
   WHERE l.run_id = p_run AND l.image_id = vi.id AND l.reverted_at IS NULL
     AND vi.user_id = p_user
     AND vi.vision_gate_status::text = 'rejected_personal'
     AND vi.vision_gate_agent_reasoning = l.signature;
  GET DIAGNOSTICS n = ROW_COUNT;

  SELECT count(*) INTO n_skip
  FROM public.capture_privacy_promote_log l
  WHERE l.run_id = p_run AND l.reverted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.vehicle_images vi
      WHERE vi.id = l.image_id AND vi.user_id = p_user
        AND vi.vision_gate_status::text = 'rejected_personal'
        AND vi.vision_gate_agent_reasoning = l.signature);

  UPDATE public.capture_privacy_promote_log l
     SET reverted_at = now()
   WHERE l.run_id = p_run AND l.reverted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.vehicle_images vi
       WHERE vi.id = l.image_id AND vi.user_id = p_user
         AND (vi.vision_gate_agent_reasoning IS NOT DISTINCT FROM l.prior_reasoning)
         AND (vi.vision_gate_status::text IS NOT DISTINCT FROM l.prior_status));

  RETURN jsonb_build_object('run', p_run, 'reverted', n, 'skipped', n_skip);
END
$function$;

REVOKE ALL ON FUNCTION public.capture_privacy_promote_v1(uuid, uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_privacy_promote_revert_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_privacy_promote_exclude_add_v1(uuid[], uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_privacy_promote_v1(uuid, uuid, uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_privacy_promote_revert_v1(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_privacy_promote_exclude_add_v1(uuid[], uuid, text) TO service_role;
