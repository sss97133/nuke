-- Contributor intake: the owner's writers accept an agent acting for the owner.
--
-- The four owner-side writers (invite, revoke, set questions, read) took their actor from auth.uid() only, so an
-- agent session holding the service role could not seed a vehicle's questions or mint a contributor link for its
-- owner; the owner had to click through the web card. Each writer now takes p_acting_as, honoured only when there is
-- no user session and the caller is the service role (the request's JWT role, or a direct service_role connection).
-- The ownership check is unchanged: p_acting_as must itself be the vehicle's owner or an active editor, so the
-- service role cannot act for a stranger. Rows record the owner as created_by, as the web card would.
--
-- The old signatures are dropped so PostgREST sees one candidate per name.

CREATE OR REPLACE FUNCTION public.contributor_intake_actor(p_acting_as uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(auth.uid(),
    CASE WHEN p_acting_as IS NOT NULL
          AND coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                       nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text) = 'service_role'
         THEN p_acting_as END)
$$;
COMMENT ON FUNCTION public.contributor_intake_actor(uuid) IS
  'The user an intake writer acts as: the session user, or p_acting_as when the caller is the service role and no user is signed in.';
REVOKE ALL ON FUNCTION public.contributor_intake_actor(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.create_contributor_invite(uuid, text, text, text, int);
DROP FUNCTION IF EXISTS public.revoke_contributor_invite(uuid);
DROP FUNCTION IF EXISTS public.set_contributor_intake_questions(uuid, jsonb);
DROP FUNCTION IF EXISTS public.get_contributor_intake(uuid);

CREATE OR REPLACE FUNCTION public.create_contributor_invite(p_vehicle_id uuid, p_display_name text,
  p_relationship text, p_phone text DEFAULT NULL, p_expires_days int DEFAULT 30, p_acting_as uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.contributor_intake_actor(p_acting_as);
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

CREATE OR REPLACE FUNCTION public.revoke_contributor_invite(p_invite_id uuid, p_acting_as uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vehicle uuid;
BEGIN
  SELECT vehicle_id INTO v_vehicle FROM public.vehicle_contributor_invites WHERE id = p_invite_id;
  IF v_vehicle IS NULL OR NOT public.contributor_intake_can_manage(v_vehicle, public.contributor_intake_actor(p_acting_as)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.vehicle_contributor_invites SET revoked_at = coalesce(revoked_at, now()) WHERE id = p_invite_id;
  RETURN jsonb_build_object('invite_id', p_invite_id, 'revoked', true);
END $$;

CREATE OR REPLACE FUNCTION public.set_contributor_intake_questions(p_vehicle_id uuid, p_questions jsonb, p_acting_as uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := public.contributor_intake_actor(p_acting_as); v_count int;
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

CREATE OR REPLACE FUNCTION public.get_contributor_intake(p_vehicle_id uuid, p_acting_as uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.contributor_intake_can_manage(p_vehicle_id, public.contributor_intake_actor(p_acting_as)) THEN
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
    'visits', coalesce((SELECT jsonb_agg(jsonb_build_object('invite_id', x.invite_id, 'action', x.action,
        'ref_id', x.ref_id, 'seen_at', x.seen_at, 'device', x.device) ORDER BY x.seen_at DESC)
      FROM (SELECT w.* FROM public.vehicle_contributor_invite_visits w JOIN public.vehicle_contributor_invites i2
              ON i2.id = w.invite_id WHERE i2.vehicle_id = p_vehicle_id ORDER BY w.seen_at DESC LIMIT 500) x), '[]'::jsonb),
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
        'is_sensitive', vi.is_sensitive, 'sensitive_type', vi.sensitive_type,
        'bucket', coalesce(substring(vi.storage_path from '^(ownership-documents|user-documents)/'), 'vehicle-photos'),
        'image_url', CASE WHEN vi.is_sensitive THEN NULL ELSE nullif(vi.image_url, '') END,
        'contributor_id', da.contributor_id, 'device_fingerprint', da.device_fingerprint,
        'ghost_user_id', da.ghost_user_id, 'attribution_source', da.attribution_source) ORDER BY vi.created_at)
      FROM public.vehicle_images vi LEFT JOIN public.device_attributions da ON da.image_id = vi.id
      WHERE vi.vehicle_id = p_vehicle_id AND vi.source = 'contributor_link'), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.create_contributor_invite(uuid, text, text, text, int, uuid),
  public.revoke_contributor_invite(uuid, uuid),
  public.set_contributor_intake_questions(uuid, jsonb, uuid),
  public.get_contributor_intake(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_contributor_invite(uuid, text, text, text, int, uuid),
  public.revoke_contributor_invite(uuid, uuid),
  public.set_contributor_intake_questions(uuid, jsonb, uuid),
  public.get_contributor_intake(uuid, uuid) TO authenticated, service_role;
