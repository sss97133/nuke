-- 20261116245000 capture_privacy_from_document_ocr
-- Signed producer privacy_from_document_ocr_v1 (public name:
-- capture_privacy_from_document_ocr_v1). Identity-document classes found
-- in OCR worker structured output go private through set_image_sensitivity
-- and the same vision_gate write as capture_privacy_promote_v1. Personal
-- non-vehicle papers (invitations) go to the #3302 non_vehicle log.
-- OCR structured output is analysis, not operator judgment. The preset
-- list below is the only matcher; include a frame only when it matches.
--
-- Preset rules, first match wins, compared to lower(haystack) where
-- haystack is doc_type, extraction.document_type, extraction.landed_type,
-- date_text, and extraction.notes. Vendor, customer, line items, paths
-- and other extraction values are not read. The matcher never returns
-- notes or identifiers.
--
--   identity_passport        \y(passport|passeport)\y
--   identity_driver_license  driver's/driving licence/license, permis de conduire,
--                            class [a-d] driver
--   identity_residence_card  permanent resident card, residence/resident card,
--                            green card, carte de sejour
--   identity_ssn             social security, ssn card, social-security, itin card
--   identity_id_card         national/identity/identification card,
--                            carte (nationale) d'identite, or \yid cards?\y
--                            excluding credit/gift/debit/sd/sim/title/label/
--                            warranty/insurance/library/punch/score/greeting card
--   identity_similar         birth certificate, naturalization,
--                            citizenship certificate, military id,
--                            common access card
--   personal_invitation      \yinvitation\y, baby shower, wedding invite,
--                            birthday invitation, \yrsvp\y
--
-- Identity rules (identity_*) -> private: set_image_sensitivity(..., true,
-- 'document', signature, granted_by) then vision_gate_status =
-- rejected_personal. Invitation -> insert capture_non_vehicle_log
-- (verdict=non_vehicle, reason=rule_id). taken_at, image_url, file bytes
-- and document_pages rows are never written or deleted.
--
-- Eligibility: owner, live capture_document_pages, a preset match,
-- vehicle_id is null, real image_url (excludes the empty_url / 276 class),
-- not on capture_privacy_promote_exclude, not already rejected_personal or
-- rejected_misattributed, not a failed upload, not in an awaiting_gate
-- clear set. Open reviews / held frames that match are included (private
-- precedes held in the official CASE). Invitations already on an
-- unreverted non_vehicle log, or already is_sensitive, are skipped.
-- This producer does not call capture_privacy_promote_v1, which would
-- also promote every other is_sensitive unfiled row and would skip
-- open reviews.
--
-- Dry-default, cap 50, granted_by required, revert-by-run. Private
-- backups use capture_privacy_promote_log (added prior sensitivity
-- columns plus rule_id). Invitations use capture_non_vehicle_log.
-- Revert: capture_privacy_from_document_ocr_revert_v1.
-- Parent revert: supabase/sql/revert_20261116245000_capture_privacy_from_document_ocr.sql

SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.capture_privacy_promote_exclude (
  image_id uuid PRIMARY KEY,
  reason text NOT NULL DEFAULT 'privacy_backup_union',
  granted_by uuid,
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

CREATE TABLE IF NOT EXISTS public.capture_non_vehicle_log (
  run_id uuid NOT NULL,
  image_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  typ text,
  verdict text NOT NULL,
  reason text NOT NULL,
  day date,
  signature text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  PRIMARY KEY (run_id, image_id)
);

ALTER TABLE public.capture_privacy_promote_log
  ADD COLUMN IF NOT EXISTS rule_id text,
  ADD COLUMN IF NOT EXISTS prior_is_sensitive boolean,
  ADD COLUMN IF NOT EXISTS prior_sensitive_type text,
  ADD COLUMN IF NOT EXISTS prior_redacted_by uuid,
  ADD COLUMN IF NOT EXISTS prior_redacted_at timestamptz,
  ADD COLUMN IF NOT EXISTS prior_redaction_reason text;

CREATE OR REPLACE FUNCTION public.capture_privacy_from_document_ocr_match_v1(
  p_doc_type text,
  p_document_type text,
  p_landed_type text,
  p_date_text text,
  p_notes text
) RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN hay ~ '\y(passport|passeport)\y'
      THEN 'identity_passport'
    WHEN hay ~ 'driver''?s? licences?|driving licences?|driver''?s? licenses?|driving licenses?|permis de conduire|class [a-d] driver'
      THEN 'identity_driver_license'
    WHEN hay ~ 'permanent resident card|residence card|resident cards?|green card|carte de s[eé]jour'
      THEN 'identity_residence_card'
    WHEN hay ~ 'social security|ssn card|social-security|\yitin card\y'
      THEN 'identity_ssn'
    WHEN hay ~ 'national identity card|identity card|national id card|identification card|carte nationale d.identit|carte d.identit'
      OR (
        hay ~ '\yid cards?\y'
        AND hay !~ 'credit card|gift card|debit card|sd card|sim card|title card|label card|warranty card|insurance card|library card|punch card|score card|greeting card'
      )
      THEN 'identity_id_card'
    WHEN hay ~ 'birth certificate|naturalization|citizenship certificate|military id|common access card'
      THEN 'identity_similar'
    WHEN hay ~ '\yinvitation\y|baby shower|wedding invite|birthday invitation|\yrsvp\y'
      THEN 'personal_invitation'
    ELSE NULL
  END
  FROM (
    SELECT lower(concat_ws(' ',
      nullif(btrim(coalesce(p_doc_type, '')), ''),
      nullif(btrim(coalesce(p_document_type, '')), ''),
      nullif(btrim(coalesce(p_landed_type, '')), ''),
      nullif(btrim(coalesce(p_date_text, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), '')
    )) AS hay
  ) s;
$fn$;

COMMENT ON FUNCTION public.capture_privacy_from_document_ocr_match_v1(text, text, text, text, text) IS
  'Fixed preset matcher for privacy_from_document_ocr_v1. Returns a rule_id or null. Does not echo notes.';

CREATE OR REPLACE FUNCTION public.capture_privacy_from_document_ocr_v1(
  p_user uuid, p_run uuid, p_granted_by uuid, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_elig int := 0;
  n_take int := 0;
  n_priv int := 0;
  n_nv int := 0;
  v_items jsonb := '[]'::jsonb;
  v_sig text;
  v_priv_ids uuid[];
BEGIN
  IF p_user IS NULL OR p_run IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'capture_privacy_from_document_ocr_v1: user, run and granted_by required';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN
    RAISE EXCEPTION 'capture_privacy_from_document_ocr_v1: cap must be 1..50';
  END IF;
  IF to_regprocedure('public.set_image_sensitivity(uuid[],boolean,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'capture_privacy_from_document_ocr_v1: set_image_sensitivity is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_privacy_from_document_ocr'));

  CREATE TEMP TABLE IF NOT EXISTS _ocr_priv_elig (
    image_id uuid PRIMARY KEY,
    rule_id text NOT NULL,
    action text NOT NULL,
    typ text,
    day date,
    prior_status text,
    prior_reasoning text,
    prior_processed_at timestamptz,
    prior_is_sensitive boolean,
    prior_sensitive_type text,
    prior_redacted_by uuid,
    prior_redacted_at timestamptz,
    prior_redaction_reason text
  ) ON COMMIT DROP;
  TRUNCATE _ocr_priv_elig;

  INSERT INTO _ocr_priv_elig
  SELECT vi.id,
         m.rule_id,
         CASE WHEN m.rule_id = 'personal_invitation' THEN 'non_vehicle' ELSE 'private' END,
         vi.ai_scan_metadata#>>'{classification,image_type}',
         (COALESCE(vi.taken_at, vi.created_at) AT TIME ZONE 'America/Los_Angeles')::date,
         vi.vision_gate_status::text,
         vi.vision_gate_agent_reasoning,
         vi.vision_gate_processed_at,
         vi.is_sensitive,
         vi.sensitive_type,
         vi.redacted_by,
         vi.redacted_at,
         vi.redaction_reason
  FROM public.vehicle_images vi
  JOIN public.capture_document_pages dp
    ON dp.image_id = vi.id AND dp.user_id = p_user AND dp.revoked_at IS NULL
  CROSS JOIN LATERAL (
    SELECT public.capture_privacy_from_document_ocr_match_v1(
      dp.doc_type,
      dp.extraction->>'document_type',
      dp.extraction->>'landed_type',
      dp.date_text,
      dp.extraction->>'notes'
    ) AS rule_id
  ) m
  WHERE vi.user_id = p_user
    AND m.rule_id IS NOT NULL
    AND vi.vehicle_id IS NULL
    AND nullif(btrim(vi.image_url), '') IS NOT NULL
    AND coalesce(vi.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed')
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = vi.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_upload_status u
      WHERE u.user_id = p_user AND u.stage = 'failed' AND u.image_id = vi.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_landing_chunks c
      JOIN public.capture_landing_sets s ON s.chunk_id = c.id AND s.decision = 'clear'
      CROSS JOIN LATERAL unnest(s.image_ids) x(image_id)
      WHERE c.user_id = p_user AND c.state = 'awaiting_gate' AND x.image_id = vi.id)
    AND NOT (
      m.rule_id = 'personal_invitation'
      AND (
        coalesce(vi.is_sensitive, false) IS TRUE
        OR EXISTS (
          SELECT 1 FROM public.capture_non_vehicle_log l
          WHERE l.image_id = vi.id AND l.reverted_at IS NULL AND l.verdict = 'non_vehicle')
      )
    )
  ORDER BY vi.id
  LIMIT p_cap;

  GET DIAGNOSTICS n_take = ROW_COUNT;

  SELECT count(*) INTO n_elig
  FROM public.vehicle_images vi
  JOIN public.capture_document_pages dp
    ON dp.image_id = vi.id AND dp.user_id = p_user AND dp.revoked_at IS NULL
  CROSS JOIN LATERAL (
    SELECT public.capture_privacy_from_document_ocr_match_v1(
      dp.doc_type,
      dp.extraction->>'document_type',
      dp.extraction->>'landed_type',
      dp.date_text,
      dp.extraction->>'notes'
    ) AS rule_id
  ) m
  WHERE vi.user_id = p_user
    AND m.rule_id IS NOT NULL
    AND vi.vehicle_id IS NULL
    AND nullif(btrim(vi.image_url), '') IS NOT NULL
    AND coalesce(vi.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed')
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = vi.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_upload_status u
      WHERE u.user_id = p_user AND u.stage = 'failed' AND u.image_id = vi.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_landing_chunks c
      JOIN public.capture_landing_sets s ON s.chunk_id = c.id AND s.decision = 'clear'
      CROSS JOIN LATERAL unnest(s.image_ids) x(image_id)
      WHERE c.user_id = p_user AND c.state = 'awaiting_gate' AND x.image_id = vi.id)
    AND NOT (
      m.rule_id = 'personal_invitation'
      AND (
        coalesce(vi.is_sensitive, false) IS TRUE
        OR EXISTS (
          SELECT 1 FROM public.capture_non_vehicle_log l
          WHERE l.image_id = vi.id AND l.reverted_at IS NULL AND l.verdict = 'non_vehicle')
      )
    );

  SELECT count(*) FILTER (WHERE action = 'private'),
         count(*) FILTER (WHERE action = 'non_vehicle')
    INTO n_priv, n_nv
  FROM _ocr_priv_elig;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'image_id', image_id, 'rule_id', rule_id, 'action', action, 'prior_status', prior_status
         ) ORDER BY image_id), '[]'::jsonb)
    INTO v_items FROM _ocr_priv_elig;

  v_sig := 'privacy_from_document_ocr_v1 run=' || p_run::text || ' granted_by=' || p_granted_by::text;

  IF p_dry THEN
    RETURN jsonb_build_object(
      'run', p_run, 'dry_run', true, 'granted_by', p_granted_by,
      'eligible', n_elig, 'would_apply', n_take, 'would_private', n_priv,
      'would_non_vehicle', n_nv, 'cap', p_cap,
      'remaining_after', greatest(n_elig - n_take, 0), 'items', v_items);
  END IF;

  INSERT INTO public.capture_privacy_promote_log (
    run_id, image_id, user_id, granted_by, prior_status, prior_reasoning, prior_processed_at,
    reason, signature, rule_id, prior_is_sensitive, prior_sensitive_type,
    prior_redacted_by, prior_redacted_at, prior_redaction_reason)
  SELECT p_run, e.image_id, p_user, p_granted_by, e.prior_status, e.prior_reasoning, e.prior_processed_at,
         e.rule_id, v_sig, e.rule_id, e.prior_is_sensitive, e.prior_sensitive_type,
         e.prior_redacted_by, e.prior_redacted_at, e.prior_redaction_reason
  FROM _ocr_priv_elig e
  WHERE e.action = 'private';

  INSERT INTO public.capture_non_vehicle_log (
    run_id, image_id, user_id, granted_by, typ, verdict, reason, day, signature)
  SELECT p_run, e.image_id, p_user, p_granted_by, e.typ, 'non_vehicle', e.rule_id, e.day, v_sig
  FROM _ocr_priv_elig e
  WHERE e.action = 'non_vehicle';

  SELECT array_agg(image_id ORDER BY image_id) INTO v_priv_ids
  FROM _ocr_priv_elig WHERE action = 'private';

  IF v_priv_ids IS NOT NULL AND cardinality(v_priv_ids) > 0 THEN
    PERFORM public.set_image_sensitivity(v_priv_ids, true, 'document', v_sig, p_granted_by);
    UPDATE public.vehicle_images vi
       SET vision_gate_status = 'rejected_personal',
           vision_gate_agent_reasoning = v_sig,
           vision_gate_processed_at = now()
      FROM _ocr_priv_elig e
     WHERE vi.id = e.image_id
       AND vi.user_id = p_user
       AND e.action = 'private';
    GET DIAGNOSTICS n_priv = ROW_COUNT;
  ELSE
    n_priv := 0;
  END IF;

  n_take := n_priv + n_nv;

  RETURN jsonb_build_object(
    'run', p_run, 'dry_run', false, 'granted_by', p_granted_by, 'applied', true,
    'eligible', n_elig, 'applied_n', n_priv + n_nv, 'promoted_private', n_priv,
    'routed_non_vehicle', n_nv, 'cap', p_cap,
    'remaining_after', greatest(n_elig - (n_priv + n_nv), 0),
    'signature', v_sig, 'items', v_items);
END
$function$;

CREATE OR REPLACE FUNCTION public.capture_privacy_from_document_ocr_revert_v1(p_user uuid, p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_priv int := 0;
  n_nv int := 0;
  n_skip int := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN
    RAISE EXCEPTION 'capture_privacy_from_document_ocr_revert_v1: user and run required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_privacy_from_document_ocr'));

  UPDATE public.vehicle_images vi
     SET vision_gate_status = CASE
           WHEN l.prior_status IS NULL THEN NULL
           ELSE l.prior_status::public.vision_gate_status
         END,
         vision_gate_agent_reasoning = l.prior_reasoning,
         vision_gate_processed_at = l.prior_processed_at,
         is_sensitive = coalesce(l.prior_is_sensitive, false),
         sensitive_type = l.prior_sensitive_type,
         redacted_by = l.prior_redacted_by,
         redacted_at = l.prior_redacted_at,
         redaction_reason = l.prior_redaction_reason
    FROM public.capture_privacy_promote_log l
   WHERE l.run_id = p_run AND l.image_id = vi.id AND l.reverted_at IS NULL
     AND l.signature LIKE 'privacy_from_document_ocr_v1 run=' || p_run::text || '%'
     AND vi.user_id = p_user
     AND vi.vision_gate_status::text = 'rejected_personal'
     AND vi.vision_gate_agent_reasoning = l.signature;
  GET DIAGNOSTICS n_priv = ROW_COUNT;

  SELECT count(*) INTO n_skip
  FROM public.capture_privacy_promote_log l
  WHERE l.run_id = p_run AND l.reverted_at IS NULL
    AND l.signature LIKE 'privacy_from_document_ocr_v1 run=' || p_run::text || '%'
    AND NOT EXISTS (
      SELECT 1 FROM public.vehicle_images vi
      WHERE vi.id = l.image_id AND vi.user_id = p_user
        AND (
          (vi.vision_gate_status::text IS NOT DISTINCT FROM l.prior_status)
          AND (vi.vision_gate_agent_reasoning IS NOT DISTINCT FROM l.prior_reasoning)
        ));

  UPDATE public.capture_privacy_promote_log l
     SET reverted_at = now()
   WHERE l.run_id = p_run AND l.reverted_at IS NULL
     AND l.signature LIKE 'privacy_from_document_ocr_v1 run=' || p_run::text || '%'
     AND EXISTS (
       SELECT 1 FROM public.vehicle_images vi
       WHERE vi.id = l.image_id AND vi.user_id = p_user
         AND (vi.vision_gate_agent_reasoning IS NOT DISTINCT FROM l.prior_reasoning)
         AND (vi.vision_gate_status::text IS NOT DISTINCT FROM l.prior_status)
         AND (coalesce(vi.is_sensitive, false) IS NOT DISTINCT FROM coalesce(l.prior_is_sensitive, false)));

  UPDATE public.capture_non_vehicle_log l
     SET reverted_at = now()
   WHERE l.user_id = p_user AND l.run_id = p_run AND l.reverted_at IS NULL
     AND l.signature LIKE 'privacy_from_document_ocr_v1 run=' || p_run::text || '%';
  GET DIAGNOSTICS n_nv = ROW_COUNT;

  RETURN jsonb_build_object(
    'run', p_run, 'reverted_private', n_priv, 'reverted_non_vehicle', n_nv, 'skipped', n_skip);
END
$function$;

REVOKE ALL ON FUNCTION public.capture_privacy_from_document_ocr_match_v1(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_privacy_from_document_ocr_v1(uuid, uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_privacy_from_document_ocr_revert_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_privacy_from_document_ocr_match_v1(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_privacy_from_document_ocr_v1(uuid, uuid, uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_privacy_from_document_ocr_revert_v1(uuid, uuid) TO service_role;
