-- capture_archive_owner_attribution_v1: stamp vehicle_images.user_id on archive rows ONLY where the intake
-- producer itself recorded the owner. Signed, dry-default, cap 50, granted_by, revert-by-run.
--
-- Why: ~50K library-source rows carry user_id NULL, so the official ledger (keyed on user_id) never saw them
-- (2026-11-17 coverage audit). hd_archive rows were written by scripts/hd-vehicle-intake.mjs, which hard-codes the
-- photographer as documented_by_user_id. That is producer-recorded evidence, not a guess. ssd_blast / ssd_export
-- carry no owner marker at all, and iphoto is not yet enabled: their rules ship with apply disabled (dry-run only).
--
-- Never: deletes, files to or moves between vehicles, touches vision gate / taken_at / privacy, or stamps rows that are:
--   is_primary (ensure_single_primary_image would clear other heroes), superseded, sensitive, privacy-excluded,
--   empty image_url (the privacy-hold class), on someone else's vehicle, or carrying conflicting attribution
--   (imported_by / submitted_by / ghost_user_id pointing elsewhere).
-- Rules live in capture_archive_owner_rules, so they are tuned by data, not code.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.capture_archive_owner_rules (
  source         text PRIMARY KEY,
  evidence_rule  text NOT NULL CHECK (evidence_rule IN ('documented_by_user_id','none_recorded')),
  apply_enabled  boolean NOT NULL DEFAULT false,
  note           text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (apply_enabled AND evidence_rule = 'none_recorded'))
);
INSERT INTO public.capture_archive_owner_rules (source, evidence_rule, apply_enabled, note) VALUES
  ('hd_archive', 'documented_by_user_id', true,
   'scripts/hd-vehicle-intake.mjs writes documented_by_user_id = USER_ID for every row (photographer of record).'),
  ('iphoto', 'documented_by_user_id', false,
   'iphoto-intake rows sometimes carry documented_by_user_id; dry-run only until the album-stamp history is reviewed.'),
  ('ssd_blast', 'none_recorded', false,
   'No owner marker on any row and no producer script in the repo. Needs an archive inventory hash match before apply.'),
  ('ssd_export', 'none_recorded', false,
   'No owner marker, no hash, no capture time. Needs an archive inventory match before apply.')
ON CONFLICT (source) DO NOTHING;
REVOKE ALL ON public.capture_archive_owner_rules FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.capture_archive_owner_rules TO service_role;

CREATE TABLE IF NOT EXISTS public.capture_archive_owner_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id         uuid NOT NULL,
  user_id        uuid NOT NULL,
  granted_by     uuid NOT NULL,
  source         text NOT NULL,
  image_id       uuid NOT NULL,
  prior_user_id  uuid,
  evidence       jsonb NOT NULL,
  signature      text NOT NULL,
  applied_at     timestamptz NOT NULL DEFAULT now(),
  reverted_at    timestamptz,
  UNIQUE (run_id, image_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS capture_archive_owner_log_live_image
  ON public.capture_archive_owner_log (image_id) WHERE reverted_at IS NULL;
CREATE INDEX IF NOT EXISTS capture_archive_owner_log_run
  ON public.capture_archive_owner_log (user_id, run_id);
REVOKE ALL ON public.capture_archive_owner_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.capture_archive_owner_log TO service_role;

CREATE OR REPLACE FUNCTION public.capture_archive_owner_attribution_v1(
  p_user uuid, p_run uuid, p_granted_by uuid, p_source text, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '120s'
AS $$
DECLARE
  v_rule public.capture_archive_owner_rules;
  v_sig text;
  v_ids uuid[];
  n_take int; n_upd int;
  v_counts jsonb;
BEGIN
  IF p_user IS NULL OR p_run IS NULL OR p_granted_by IS NULL OR p_source IS NULL THEN
    RAISE EXCEPTION 'capture_archive_owner_attribution_v1: user, run, granted_by and source required';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN
    RAISE EXCEPTION 'capture_archive_owner_attribution_v1: cap must be 1..50';
  END IF;
  SELECT * INTO v_rule FROM public.capture_archive_owner_rules WHERE source = p_source;
  IF NOT FOUND THEN RAISE EXCEPTION 'capture_archive_owner_attribution_v1: no rule for source %', p_source; END IF;
  IF NOT p_dry AND NOT v_rule.apply_enabled THEN
    RAISE EXCEPTION 'capture_archive_owner_attribution_v1: apply is disabled for source % (evidence %)', p_source, v_rule.evidence_rule;
  END IF;
  IF NOT p_dry AND EXISTS (SELECT 1 FROM public.capture_archive_owner_log WHERE run_id = p_run) THEN
    RAISE EXCEPTION 'capture_archive_owner_attribution_v1: run % already used', p_run;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _cao_cand (id uuid PRIMARY KEY, reason text NOT NULL, vehicle_id uuid) ON COMMIT DROP;
  TRUNCATE _cao_cand;
  INSERT INTO _cao_cand (id, reason, vehicle_id)
  SELECT vi.id,
    CASE
      WHEN v_rule.evidence_rule = 'none_recorded' THEN 'no_owner_evidence'
      WHEN vi.documented_by_user_id IS DISTINCT FROM p_user THEN 'no_owner_evidence'
      WHEN (vi.imported_by IS NOT NULL AND vi.imported_by <> p_user)
        OR (vi.submitted_by IS NOT NULL AND vi.submitted_by <> p_user)
        OR vi.ghost_user_id IS NOT NULL THEN 'conflicting_attribution'
      WHEN NULLIF(btrim(COALESCE(vi.image_url,'')), '') IS NULL THEN 'empty_url'
      WHEN COALESCE(vi.is_sensitive, false) THEN 'sensitive'
      WHEN EXISTS (SELECT 1 FROM public.capture_privacy_promote_exclude x WHERE x.image_id = vi.id) THEN 'privacy_exclude'
      WHEN COALESCE(vi.is_superseded, false) THEN 'superseded'
      WHEN COALESCE(vi.is_primary, false) THEN 'is_primary'
      WHEN vi.vehicle_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.vehicles v WHERE v.id = vi.vehicle_id
          AND (v.user_id = p_user OR v.owner_id = p_user OR v.uploaded_by = p_user)) THEN 'other_vehicle'
      WHEN EXISTS (SELECT 1 FROM public.capture_archive_owner_log l WHERE l.image_id = vi.id AND l.reverted_at IS NULL) THEN 'already_logged'
      ELSE 'eligible'
    END,
    vi.vehicle_id
  FROM public.vehicle_images vi
  WHERE vi.source = p_source AND vi.user_id IS NULL;

  SELECT jsonb_object_agg(reason, n) INTO v_counts FROM (SELECT reason, count(*) n FROM _cao_cand GROUP BY reason) s;
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM (SELECT id FROM _cao_cand WHERE reason = 'eligible' ORDER BY id LIMIT p_cap) s;
  n_take := COALESCE(array_length(v_ids, 1), 0);
  v_sig := 'capture_archive_owner_attribution_v1 run=' || p_run::text || ' granted_by=' || p_granted_by::text
           || ' source=' || p_source || ' rule=' || v_rule.evidence_rule;

  IF p_dry THEN
    RETURN jsonb_build_object('run', p_run, 'dry_run', true, 'granted_by', p_granted_by, 'signature', v_sig,
      'source', p_source, 'rule', v_rule.evidence_rule, 'apply_enabled', v_rule.apply_enabled,
      'scanned', (SELECT count(*) FROM _cao_cand), 'by_reason', COALESCE(v_counts, '{}'::jsonb),
      'would_stamp', n_take, 'cap', p_cap);
  END IF;

  IF n_take = 0 THEN
    RETURN jsonb_build_object('run', p_run, 'dry_run', false, 'stamped', 0, 'by_reason', COALESCE(v_counts, '{}'::jsonb));
  END IF;

  INSERT INTO public.capture_archive_owner_log (run_id, user_id, granted_by, source, image_id, prior_user_id, evidence, signature)
  SELECT p_run, p_user, p_granted_by, p_source, c.id, NULL,
         jsonb_build_object('rule', v_rule.evidence_rule, 'documented_by_user_id', p_user, 'vehicle_id', c.vehicle_id),
         v_sig
  FROM _cao_cand c WHERE c.id = ANY (v_ids);

  UPDATE public.vehicle_images vi SET user_id = p_user
  WHERE vi.id = ANY (v_ids) AND vi.user_id IS NULL AND vi.source = p_source AND vi.documented_by_user_id = p_user;
  GET DIAGNOSTICS n_upd = ROW_COUNT;
  IF n_upd <> n_take THEN
    RAISE EXCEPTION 'capture_archive_owner_attribution_v1: stamped % of % (concurrent change); rolled back', n_upd, n_take;
  END IF;

  RETURN jsonb_build_object('run', p_run, 'dry_run', false, 'granted_by', p_granted_by, 'signature', v_sig,
    'source', p_source, 'stamped', n_upd, 'by_reason_before', COALESCE(v_counts, '{}'::jsonb), 'cap', p_cap);
END $$;

CREATE OR REPLACE FUNCTION public.capture_archive_owner_revert_v1(p_user uuid, p_run uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n_img int; n_log int;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN RAISE EXCEPTION 'user and run required'; END IF;
  UPDATE public.vehicle_images vi SET user_id = l.prior_user_id
  FROM public.capture_archive_owner_log l
  WHERE l.run_id = p_run AND l.user_id = p_user AND l.reverted_at IS NULL
    AND vi.id = l.image_id AND vi.user_id = p_user;
  GET DIAGNOSTICS n_img = ROW_COUNT;
  UPDATE public.capture_archive_owner_log SET reverted_at = now()
  WHERE run_id = p_run AND user_id = p_user AND reverted_at IS NULL;
  GET DIAGNOSTICS n_log = ROW_COUNT;
  RETURN jsonb_build_object('run_id', p_run, 'restored_images', n_img, 'reverted_log', n_log);
END $$;

REVOKE ALL ON FUNCTION public.capture_archive_owner_attribution_v1(uuid, uuid, uuid, text, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_archive_owner_revert_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_archive_owner_attribution_v1(uuid, uuid, uuid, text, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_archive_owner_revert_v1(uuid, uuid) TO service_role;
