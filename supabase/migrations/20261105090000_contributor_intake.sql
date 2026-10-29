-- Contributor intake: a person without a Nuke account (a builder, previous owner, shop or appraiser) answers the
-- owner's questions and sends documents through a single-use link, and every answer and file lands with its source.
-- Contract: ~/nuke-logs/trans-am-20261028/CONTRIBUTOR_SPEC.md; owner direction: case ledger section 19.
--
-- Reuse, not a parallel:
--   external_identities  the person (platform 'contributor', handle = first invite id; phone kept only as sha256)
--   contributors         one row per person, contributor_type 'identity', verification_level invited -> attested
--   vehicle_observations every answer, kind 'contributor_answer', observer_id = the external identity,
--                        source_id = observation_sources 'contributor_link', the device attestation in structured_data
--   vehicle_images       every upload, source 'contributor_link', ingest_kind 'import' (the column is the clock
--                        semantics: live / backfill / import), deduped on (vehicle_id, file_hash)
--   device_attributions  the EXIF device (existing trigger) plus the new nullable contributor_id
-- New, because the grain differs: vehicle_contributor_invites (vehicle x contributor x relationship, token hash only),
-- contributor_intake_questions, and vehicle_contributor_invite_visits (the attestation of every open, answer, upload).
--
-- vehicle_contributors is not written: its user_id is NOT NULL with a profiles FK, its role check has no 'builder'
-- or 'shop', and its enforce_contributor_evidence trigger needs a photo by that user_id. The invite row carries the
-- relationship until vehicle_contributors is widened in its own reviewed change.
-- device_attributions.actual_contributor_id references auth.users, so a contributor without an account cannot be
-- put there; the new contributor_id column carries it.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TYPE public.observation_kind ADD VALUE IF NOT EXISTS 'contributor_answer';

INSERT INTO public.observation_sources (slug, display_name, category, notes)
VALUES ('contributor_link', 'Contributor link', 'owner',
  'Answers and files sent by a person the vehicle owner invited, through a single-use link (contributor intake).')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.device_attributions ADD COLUMN IF NOT EXISTS contributor_id uuid REFERENCES public.contributors(id);
COMMENT ON COLUMN public.device_attributions.contributor_id IS
  'The contributor (contributors.id) who sent the file, for people without an account; actual_contributor_id is auth.users only.';

CREATE TABLE IF NOT EXISTS public.vehicle_contributor_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  contributor_id uuid NOT NULL REFERENCES public.contributors(id),
  relationship text NOT NULL CHECK (relationship IN ('builder', 'previous_owner', 'shop', 'appraiser')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  revoked_at timestamptz,
  first_opened_at timestamptz,
  last_seen_at timestamptz,
  open_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS vehicle_contributor_invites_vehicle_idx ON public.vehicle_contributor_invites (vehicle_id);
COMMENT ON TABLE public.vehicle_contributor_invites IS
  'A single-use-per-contributor link to answer questions and send files for one vehicle. Only the sha256 of the token is stored.';

CREATE TABLE IF NOT EXISTS public.vehicle_contributor_invite_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.vehicle_contributor_invites(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('open', 'answer', 'upload')),
  ref_id uuid,
  seen_at timestamptz NOT NULL DEFAULT now(),
  device jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS vehicle_contributor_invite_visits_invite_idx
  ON public.vehicle_contributor_invite_visits (invite_id, seen_at DESC);
COMMENT ON TABLE public.vehicle_contributor_invite_visits IS
  'The device attestation of every open, answer and upload through a contributor link. No ip is stored, only ip_sha256.';

CREATE TABLE IF NOT EXISTS public.contributor_intake_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  invite_id uuid REFERENCES public.vehicle_contributor_invites(id) ON DELETE SET NULL,
  key text NOT NULL CHECK (key ~ '^[a-z0-9_]{1,64}$'),
  prompt text NOT NULL CHECK (length(prompt) BETWEEN 1 AND 2000),
  hint text,
  round smallint NOT NULL DEFAULT 1 CHECK (round IN (1, 2)),
  position integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, key)
);
COMMENT ON TABLE public.contributor_intake_questions IS
  'Questions the owner (or the evidence audit) asks contributors about one vehicle; invite_id null = every contributor.';

ALTER TABLE public.vehicle_contributor_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_contributor_invite_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributor_intake_questions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_contributor_invites, public.vehicle_contributor_invite_visits,
  public.contributor_intake_questions FROM PUBLIC, anon, authenticated;

-- Who may manage a vehicle's intake: its owner (vehicles.user_id) or an active editor in vehicle_contributors.
CREATE OR REPLACE FUNCTION public.contributor_intake_can_manage(p_vehicle_id uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.user_id = p_user)
    OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc WHERE vc.vehicle_id = p_vehicle_id AND vc.user_id = p_user
      AND vc.can_edit IS TRUE AND coalesce(vc.status, 'active') = 'active' AND vc.end_date IS NULL))
$$;

-- The live invite for a plaintext token, or null (unknown, expired and revoked look the same to the caller).
CREATE OR REPLACE FUNCTION public.contributor_intake_invite_for_token(p_token text)
RETURNS public.vehicle_contributor_invites LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.* FROM public.vehicle_contributor_invites i
   WHERE p_token ~ '^[0-9a-f]{64}$'
     AND i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     AND i.revoked_at IS NULL AND i.expires_at > now()
$$;

-- The attestation keys the spec names; anything else the caller sends is dropped.
CREATE OR REPLACE FUNCTION public.contributor_intake_device(p_device jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'user_agent', left(p_device ->> 'user_agent', 512),
    'platform', left(p_device ->> 'platform', 64),
    'model_hint', left(p_device ->> 'model_hint', 128),
    'screen', CASE WHEN jsonb_typeof(p_device -> 'screen') = 'object' THEN jsonb_strip_nulls(jsonb_build_object(
      'w', p_device #> '{screen,w}', 'h', p_device #> '{screen,h}', 'dpr', p_device #> '{screen,dpr}')) END,
    'timezone', left(p_device ->> 'timezone', 64),
    'language', left(p_device ->> 'language', 64),
    'ip_sha256', CASE WHEN p_device ->> 'ip_sha256' ~ '^[0-9a-f]{64}$' THEN p_device ->> 'ip_sha256' END,
    'opened_at', left(p_device ->> 'opened_at', 40)))
$$;

-- 1. The owner creates (or reuses) the person and their invite; the plaintext token is returned once.
CREATE OR REPLACE FUNCTION public.create_contributor_invite(p_vehicle_id uuid, p_display_name text,
  p_relationship text, p_phone text DEFAULT NULL, p_expires_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(p_display_name), '');
  v_phone_digits text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_phone_hash text;
  v_contributor uuid;
  v_identity uuid;
  v_invite uuid := gen_random_uuid();
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires timestamptz;
BEGIN
  IF NOT public.contributor_intake_can_manage(p_vehicle_id, v_uid) THEN
    RAISE EXCEPTION 'forbidden: only the vehicle owner or an editor can invite contributors' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR length(v_name) > 120 THEN RAISE EXCEPTION 'display_name is required (at most 120 characters)'; END IF;
  IF p_relationship IS NULL OR p_relationship NOT IN ('builder', 'previous_owner', 'shop', 'appraiser') THEN
    RAISE EXCEPTION 'relationship must be builder, previous_owner, shop or appraiser';
  END IF;
  IF coalesce(p_expires_days, 0) NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'expires_days must be 1 to 365'; END IF;
  v_expires := now() + make_interval(days => p_expires_days);
  IF v_phone_digits IS NOT NULL THEN v_phone_hash := encode(sha256(convert_to(v_phone_digits, 'UTF8')), 'hex'); END IF;

  -- Reuse: the same phone hash anywhere, else the same name already invited to this vehicle.
  IF v_phone_hash IS NOT NULL THEN
    SELECT c.id, e.id INTO v_contributor, v_identity
      FROM public.external_identities e JOIN public.contributors c ON c.external_identity_id = e.id
     WHERE e.platform = 'contributor' AND e.metadata ->> 'phone_sha256' = v_phone_hash
     ORDER BY e.created_at LIMIT 1;
  END IF;
  IF v_contributor IS NULL THEN
    SELECT c.id, e.id INTO v_contributor, v_identity
      FROM public.vehicle_contributor_invites i
      JOIN public.contributors c ON c.id = i.contributor_id
      JOIN public.external_identities e ON e.id = c.external_identity_id
     WHERE i.vehicle_id = p_vehicle_id AND lower(e.display_name) = lower(v_name)
     ORDER BY i.created_at LIMIT 1;
  END IF;
  IF v_contributor IS NULL THEN
    INSERT INTO public.external_identities (platform, handle, display_name, metadata)
    VALUES ('contributor', v_invite::text, v_name,
      jsonb_strip_nulls(jsonb_build_object('phone_sha256', v_phone_hash, 'invited_by', v_uid)))
    RETURNING id INTO v_identity;
    INSERT INTO public.contributors (contributor_type, external_identity_id, verification_level)
    VALUES ('identity', v_identity, 'invited') RETURNING id INTO v_contributor;
  ELSIF v_phone_hash IS NOT NULL THEN
    UPDATE public.external_identities SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phone_sha256', v_phone_hash),
      updated_at = now() WHERE id = v_identity AND metadata ->> 'phone_sha256' IS DISTINCT FROM v_phone_hash;
  END IF;

  INSERT INTO public.vehicle_contributor_invites (id, vehicle_id, contributor_id, relationship, token_hash, created_by, expires_at)
  VALUES (v_invite, p_vehicle_id, v_contributor, p_relationship, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_uid, v_expires);

  RETURN jsonb_build_object('invite_id', v_invite, 'contributor_id', v_contributor, 'token', v_token,
    'path', '/contribute/' || v_token, 'expires_at', v_expires);
END $$;

-- The owner revokes a link (the person and their past answers stay).
CREATE OR REPLACE FUNCTION public.revoke_contributor_invite(p_invite_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vehicle uuid;
BEGIN
  SELECT vehicle_id INTO v_vehicle FROM public.vehicle_contributor_invites WHERE id = p_invite_id;
  IF v_vehicle IS NULL OR NOT public.contributor_intake_can_manage(v_vehicle, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.vehicle_contributor_invites SET revoked_at = coalesce(revoked_at, now()) WHERE id = p_invite_id;
  RETURN jsonb_build_object('invite_id', p_invite_id, 'revoked', true);
END $$;

-- The questions for one invite (or all of the vehicle's contributors) with the latest answer through this invite.
CREATE OR REPLACE FUNCTION public.contributor_intake_questions_for(p_invite public.vehicle_contributor_invites, p_round smallint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- plpgsql, not sql: a sql body is parsed at creation and the new enum value is not usable in this transaction.
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('key', q.key, 'prompt', q.prompt, 'hint', q.hint, 'status', q.status,
      'answer', a.answer_text, 'answered_at', a.observed_at) ORDER BY q.position, q.key), '[]'::jsonb)
    FROM public.contributor_intake_questions q
    LEFT JOIN LATERAL (
      SELECT o.structured_data ->> 'answer_text' AS answer_text, o.observed_at
        FROM public.vehicle_observations o
       WHERE o.vehicle_id = p_invite.vehicle_id AND o.kind = 'contributor_answer'
         AND o.source_identifier = 'invite:' || p_invite.id || ':' || q.key AND o.is_superseded IS NOT TRUE
       ORDER BY o.observed_at DESC LIMIT 1) a ON true
   WHERE q.vehicle_id = p_invite.vehicle_id AND (q.invite_id IS NULL OR q.invite_id = p_invite.id)
     AND q.round = p_round AND q.status <> 'closed');
END $$;

-- 2. The link is opened (edge function, service role): record the device, return the card.
CREATE OR REPLACE FUNCTION public.contributor_intake_open(p_token text, p_device jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i public.vehicle_contributor_invites;
  v_device jsonb := public.contributor_intake_device(coalesce(p_device, '{}'::jsonb));
  v_card jsonb;
BEGIN
  i := public.contributor_intake_invite_for_token(p_token);
  IF i.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  UPDATE public.vehicle_contributor_invites SET open_count = open_count + 1,
    first_opened_at = coalesce(first_opened_at, now()), last_seen_at = now() WHERE id = i.id;
  INSERT INTO public.vehicle_contributor_invite_visits (invite_id, action, device) VALUES (i.id, 'open', v_device);

  SELECT jsonb_build_object(
    'ok', true,
    'invite', jsonb_build_object('id', i.id, 'expires_at', i.expires_at),
    'vehicle', jsonb_build_object('id', v.id, 'year', v.year, 'make', v.make, 'model', v.model, 'vin', v.vin,
      'color', v.color, 'body_style', v.body_style, 'transmission', v.transmission,
      'body', jsonb_strip_nulls(jsonb_build_object('trim', v.origin_metadata ->> 'trim',
        'engine', v.origin_metadata ->> 'engine', 'body', v.origin_metadata ->> 'body',
        'drivetrain', v.origin_metadata ->> 'drivetrain'))),
    'contributor', jsonb_build_object('display_name', e.display_name, 'relationship', i.relationship),
    'known_facts', coalesce((SELECT jsonb_agg(f ORDER BY f ->> 'observed_at' DESC) FROM (
        SELECT jsonb_build_object('kind', o.kind, 'text', left(o.content_text, 240), 'observed_at', o.observed_at,
          'source', s.slug) AS f
          FROM public.vehicle_observations o LEFT JOIN public.observation_sources s ON s.id = o.source_id
         WHERE o.vehicle_id = v.id AND o.kind IN ('specification', 'provenance') AND o.is_superseded IS NOT TRUE
           AND nullif(btrim(o.content_text), '') IS NOT NULL
         ORDER BY o.observed_at DESC LIMIT 12) x), '[]'::jsonb),
    'questions', public.contributor_intake_questions_for(i, 1::smallint),
    'round_two', public.contributor_intake_questions_for(i, 2::smallint),
    'documents_count', (SELECT count(*) FROM public.vehicle_images vi WHERE vi.vehicle_id = v.id
      AND vi.source = 'contributor_link' AND vi.storage_path LIKE '%contributors/' || i.id || '/%'))
    INTO v_card
    FROM public.vehicles v, public.contributors c JOIN public.external_identities e ON e.id = c.external_identity_id
   WHERE v.id = i.vehicle_id AND c.id = i.contributor_id;
  RETURN v_card;
END $$;

-- 3. One answer: one vehicle_observations row with the contributor as its source and the device attestation.
CREATE OR REPLACE FUNCTION public.contributor_intake_answer(p_token text, p_question_key text, p_answer text,
  p_device jsonb, p_recorded_by uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i public.vehicle_contributor_invites;
  q public.contributor_intake_questions;
  v_identity uuid;
  v_source uuid;
  v_text text := nullif(btrim(p_answer), '');
  v_device jsonb := public.contributor_intake_device(coalesce(p_device, '{}'::jsonb));
  v_ident text;
  v_hash text;
  v_prior uuid;
  v_id uuid;
BEGIN
  i := public.contributor_intake_invite_for_token(p_token);
  IF i.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  SELECT * INTO q FROM public.contributor_intake_questions
   WHERE vehicle_id = i.vehicle_id AND key = p_question_key AND (invite_id IS NULL OR invite_id = i.id) AND status <> 'closed';
  IF q.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown_question'); END IF;
  IF v_text IS NULL OR length(v_text) > 20000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_answer');
  END IF;
  IF p_recorded_by IS NOT NULL AND NOT public.contributor_intake_can_manage(i.vehicle_id, p_recorded_by) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recorder_not_owner');
  END IF;
  SELECT external_identity_id INTO v_identity FROM public.contributors WHERE id = i.contributor_id;
  SELECT id INTO v_source FROM public.observation_sources WHERE slug = 'contributor_link';
  v_ident := 'invite:' || i.id || ':' || q.key;
  v_hash := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');

  SELECT id INTO v_id FROM public.vehicle_observations
   WHERE source_id = v_source AND source_identifier = v_ident AND kind = 'contributor_answer' AND content_hash = v_hash;
  IF v_id IS NULL THEN
    SELECT id INTO v_prior FROM public.vehicle_observations
     WHERE vehicle_id = i.vehicle_id AND source_id = v_source AND source_identifier = v_ident
       AND kind = 'contributor_answer' AND is_superseded IS NOT TRUE
     ORDER BY observed_at DESC LIMIT 1;
    INSERT INTO public.vehicle_observations (vehicle_id, subject_type, subject_id, observed_at, source_id,
      source_identifier, observer_id, kind, content_text, content_hash, structured_data, submitted_by_user_id,
      extraction_method, observer_raw)
    VALUES (i.vehicle_id, 'vehicle', i.vehicle_id, now(), v_source, v_ident, v_identity, 'contributor_answer',
      v_text, v_hash,
      jsonb_strip_nulls(jsonb_build_object('question_key', q.key, 'prompt', q.prompt, 'answer_text', v_text,
        'round', q.round, 'contributor_id', i.contributor_id, 'invite_id', i.id, 'relationship', i.relationship,
        'channel', 'contributor_link', 'device_attestation', v_device, 'recorded_by_user_id', p_recorded_by)),
      p_recorded_by, CASE WHEN p_recorded_by IS NULL THEN 'contributor_link' ELSE 'contributor_link_owner_recorded' END,
      jsonb_build_object('contributor_id', i.contributor_id, 'device_attestation', v_device))
    RETURNING id INTO v_id;
    IF v_prior IS NOT NULL THEN
      UPDATE public.vehicle_observations SET is_superseded = true, superseded_by = v_id, superseded_at = now()
       WHERE id = v_prior;
    END IF;
  END IF;

  UPDATE public.contributor_intake_questions SET status = 'answered' WHERE id = q.id AND status = 'open';
  INSERT INTO public.vehicle_contributor_invite_visits (invite_id, action, ref_id, device) VALUES (i.id, 'answer', v_id, v_device);
  UPDATE public.vehicle_contributor_invites SET last_seen_at = now() WHERE id = i.id;
  IF p_recorded_by IS NULL AND v_device ->> 'user_agent' IS NOT NULL THEN
    UPDATE public.contributors SET verification_level = 'attested'
     WHERE id = i.contributor_id AND verification_level IS DISTINCT FROM 'attested';
  END IF;
  RETURN jsonb_build_object('ok', true, 'observation_id', v_id, 'superseded', v_prior);
END $$;

-- 4. One uploaded file: a vehicle_images row (deduped on vehicle + sha256) and its device attribution.
CREATE OR REPLACE FUNCTION public.contributor_intake_file(p_token text, p_file jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i public.vehicle_contributor_invites;
  v_sha text := lower(p_file ->> 'sha256');
  v_path text := p_file ->> 'storage_path';
  v_url text := p_file ->> 'image_url';
  v_exif jsonb := CASE WHEN jsonb_typeof(p_file -> 'exif') = 'object' AND p_file -> 'exif' <> '{}'::jsonb THEN p_file -> 'exif' END;
  v_device jsonb := public.contributor_intake_device(coalesce(p_file -> 'device', '{}'::jsonb));
  v_id uuid;
  v_fp text;
BEGIN
  i := public.contributor_intake_invite_for_token(p_token);
  IF i.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_sha IS NULL OR v_sha !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_sha256'); END IF;
  IF v_path IS NULL OR v_path !~ ('^(vehicle-photos/)?contributors/' || i.id || '/' || v_sha || '/[^/]{1,200}$') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_storage_path');
  END IF;
  IF v_url IS NULL OR v_url !~ '^https://' THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_image_url'); END IF;

  SELECT id INTO v_id FROM public.vehicle_images
   WHERE vehicle_id = i.vehicle_id AND file_hash = v_sha AND coalesce(is_superseded, false) = false LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.vehicle_contributor_invite_visits (invite_id, action, ref_id, device) VALUES (i.id, 'upload', v_id, v_device);
    RETURN jsonb_build_object('ok', true, 'image_id', v_id, 'duplicate', true);
  END IF;

  INSERT INTO public.vehicle_images (vehicle_id, image_url, storage_path, file_hash, file_name, filename, file_size,
    mime_type, source, is_external, exif_data, caption, ingest_kind, image_medium, photographer_attribution)
  VALUES (i.vehicle_id, v_url, v_path, v_sha, left(p_file ->> 'file_name', 255), left(p_file ->> 'file_name', 255),
    nullif(p_file ->> 'size_bytes', '')::bigint, left(p_file ->> 'mime_type', 128), 'contributor_link', true, v_exif,
    left(p_file ->> 'label', 500), 'import', 'received', 'contributor:' || i.contributor_id)
  RETURNING id INTO v_id;

  -- trg_auto_attribute_image_to_device wrote the EXIF device row when the EXIF names a device; point it at the
  -- contributor, or write the link's own row when it did not.
  UPDATE public.device_attributions SET contributor_id = i.contributor_id, updated_at = now() WHERE image_id = v_id;
  IF NOT FOUND THEN
    v_fp := CASE WHEN v_exif IS NOT NULL THEN public.generate_device_fingerprint(v_exif) END;
    INSERT INTO public.device_attributions (image_id, device_fingerprint, contributor_id, attribution_source,
      confidence_score, extraction_method, raw_exif)
    VALUES (v_id, CASE WHEN v_fp IS NULL OR v_fp = 'Unknown-Unknown-Unknown-Unknown'
        THEN 'contributor_link:' || i.contributor_id ELSE v_fp END,
      i.contributor_id, 'contributor_link', 60, 'contributor_link', v_exif)
    ON CONFLICT (image_id) DO UPDATE SET contributor_id = EXCLUDED.contributor_id;
  END IF;
  UPDATE public.vehicle_images vi SET ghost_user_id = da.ghost_user_id
    FROM public.device_attributions da WHERE vi.id = v_id AND da.image_id = v_id AND da.ghost_user_id IS NOT NULL;

  INSERT INTO public.vehicle_contributor_invite_visits (invite_id, action, ref_id, device) VALUES (i.id, 'upload', v_id, v_device);
  UPDATE public.vehicle_contributor_invites SET last_seen_at = now() WHERE id = i.id;
  RETURN jsonb_build_object('ok', true, 'image_id', v_id, 'duplicate', false);
END $$;

-- 5. The owner sets the questions; upsert by key.
CREATE OR REPLACE FUNCTION public.set_contributor_intake_questions(p_vehicle_id uuid, p_questions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_count int;
BEGIN
  IF NOT public.contributor_intake_can_manage(p_vehicle_id, v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) > 50 THEN
    RAISE EXCEPTION 'questions must be an array of at most 50';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_questions) q
      WHERE nullif(q ->> 'invite_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicle_contributor_invites i
        WHERE i.id = (q ->> 'invite_id')::uuid AND i.vehicle_id = p_vehicle_id)) THEN
    RAISE EXCEPTION 'invite_id does not belong to this vehicle';
  END IF;
  INSERT INTO public.contributor_intake_questions (vehicle_id, invite_id, key, prompt, hint, round, position, status, created_by)
  SELECT p_vehicle_id, nullif(q ->> 'invite_id', '')::uuid, q ->> 'key', q ->> 'prompt', q ->> 'hint',
    coalesce((q ->> 'round')::smallint, 1), coalesce((q ->> 'position')::int, ord::int), coalesce(q ->> 'status', 'open'), v_uid
    FROM jsonb_array_elements(p_questions) WITH ORDINALITY AS t(q, ord)
  ON CONFLICT (vehicle_id, key) DO UPDATE SET prompt = EXCLUDED.prompt, hint = EXCLUDED.hint, round = EXCLUDED.round,
    position = EXCLUDED.position, invite_id = EXCLUDED.invite_id,
    status = CASE WHEN EXCLUDED.status = 'closed' THEN 'closed'
                  WHEN contributor_intake_questions.status = 'answered' THEN 'answered' ELSE EXCLUDED.status END;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'upserted', v_count);
END $$;

-- 6. The owner's read: invites, visits, answers with attestation, uploads.
CREATE OR REPLACE FUNCTION public.get_contributor_intake(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.contributor_intake_can_manage(p_vehicle_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'invites', coalesce((SELECT jsonb_agg(jsonb_build_object('invite_id', i.id, 'contributor_id', i.contributor_id,
        'display_name', e.display_name, 'relationship', i.relationship, 'verification_level', c.verification_level,
        'created_at', i.created_at, 'expires_at', i.expires_at, 'revoked_at', i.revoked_at,
        'first_opened_at', i.first_opened_at, 'last_seen_at', i.last_seen_at, 'open_count', i.open_count,
        'visits', coalesce((SELECT jsonb_agg(jsonb_build_object('action', x.action, 'ref_id', x.ref_id,
            'seen_at', x.seen_at, 'device', x.device) ORDER BY x.seen_at DESC)
          FROM (SELECT * FROM public.vehicle_contributor_invite_visits w WHERE w.invite_id = i.id
                ORDER BY w.seen_at DESC LIMIT 100) x), '[]'::jsonb)) ORDER BY i.created_at)
      FROM public.vehicle_contributor_invites i JOIN public.contributors c ON c.id = i.contributor_id
      JOIN public.external_identities e ON e.id = c.external_identity_id
      WHERE i.vehicle_id = p_vehicle_id), '[]'::jsonb),
    'questions', coalesce((SELECT jsonb_agg(jsonb_build_object('key', q.key, 'prompt', q.prompt, 'hint', q.hint,
        'round', q.round, 'position', q.position, 'status', q.status, 'invite_id', q.invite_id) ORDER BY q.round, q.position, q.key)
      FROM public.contributor_intake_questions q WHERE q.vehicle_id = p_vehicle_id), '[]'::jsonb),
    'answers', coalesce((SELECT jsonb_agg(jsonb_build_object('observation_id', o.id, 'observed_at', o.observed_at,
        'question_key', o.structured_data ->> 'question_key', 'prompt', o.structured_data ->> 'prompt',
        'answer_text', o.structured_data ->> 'answer_text', 'contributor_id', o.structured_data ->> 'contributor_id',
        'invite_id', o.structured_data ->> 'invite_id', 'recorded_by_user_id', o.submitted_by_user_id,
        'device_attestation', o.structured_data -> 'device_attestation', 'is_superseded', coalesce(o.is_superseded, false))
        ORDER BY o.observed_at)
      FROM public.vehicle_observations o
      WHERE o.vehicle_id = p_vehicle_id AND o.kind = 'contributor_answer'), '[]'::jsonb),
    'uploads', coalesce((SELECT jsonb_agg(jsonb_build_object('image_id', vi.id, 'created_at', vi.created_at,
        'file_name', vi.file_name, 'mime_type', vi.mime_type, 'size_bytes', vi.file_size, 'sha256', vi.file_hash,
        'label', vi.caption, 'storage_path', vi.storage_path, 'is_document', vi.is_document,
        'contributor_id', da.contributor_id, 'device_fingerprint', da.device_fingerprint,
        'ghost_user_id', da.ghost_user_id, 'attribution_source', da.attribution_source) ORDER BY vi.created_at)
      FROM public.vehicle_images vi LEFT JOIN public.device_attributions da ON da.image_id = vi.id
      WHERE vi.vehicle_id = p_vehicle_id AND vi.source = 'contributor_link'), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.contributor_intake_can_manage(uuid, uuid),
  public.contributor_intake_invite_for_token(text),
  public.contributor_intake_device(jsonb),
  public.contributor_intake_questions_for(public.vehicle_contributor_invites, smallint),
  public.create_contributor_invite(uuid, text, text, text, int),
  public.revoke_contributor_invite(uuid),
  public.contributor_intake_open(text, jsonb),
  public.contributor_intake_answer(text, text, text, jsonb, uuid),
  public.contributor_intake_file(text, jsonb),
  public.set_contributor_intake_questions(uuid, jsonb),
  public.get_contributor_intake(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_contributor_invite(uuid, text, text, text, int),
  public.revoke_contributor_invite(uuid),
  public.set_contributor_intake_questions(uuid, jsonb),
  public.get_contributor_intake(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contributor_intake_open(text, jsonb),
  public.contributor_intake_answer(text, text, text, jsonb, uuid),
  public.contributor_intake_file(text, jsonb) TO service_role;
