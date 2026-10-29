-- Contributor intake: the evidence ladder. Every answer or upload moves the car up sourced value rungs, the owner
-- is told what moved, and a re-evaluation is queued for an agent to refine the next questions.
-- Owner direction 2026-10-29 (~/nuke-logs/trans-am-20261028/CONTRIBUTOR_SPEC.md, addendum 10-29 11:58 PT, sections 2-3):
-- "adding this data increases the sale potential value... a profile completion recalculating with each input... an
-- api trigger to help through the process."
--
-- Shape (log -> state -> reader):
--   vehicle_evidence_rungs   the rungs a vehicle can stand on: label, hammer band, the comps that set it (basis), and
--                            the evidence item keys it requires. Data, never code: no number appears in a reader
--                            that is not a rung row with a basis.
--   vehicle_evidence_items   what proves the claims: a question (satisfied_by = question_key), a photo (a shot label)
--                            or a document. status open | proven | contradicted, proof_ref the observation or image.
--   vehicle_evidence_changes the log: each status move with the rung before and after.
--   contributor_intake_reevaluations  one queued row per input (idempotent on the observation or image id) for an
--                            agent loop to claim, re-read, and refine round-two questions. Nothing drains it here.
-- Readers: contributor_intake_progress_for(vehicle) (internal, no auth) and contributor_intake_progress(vehicle,
-- acting_as) (owner/editor, or the service role acting for them). contributor_intake_open and get_contributor_intake
-- carry the same block as 'progress'; contributor_intake_answer / _file return it as 'progress' after each input.
-- Writers: contributor_intake_answer marks the item whose satisfied_by = question_key proven (a non-empty answer);
-- contributor_intake_file marks the item whose key or label matches p_file.label proven; both log the move, enqueue
-- the re-evaluation and send the vehicle owner one user_notifications row through create_notification. A failed
-- notification never undoes the answer or the upload. Attestation rules are untouched.
-- Seed: the 1973 Firebird 20d21fb0 (owner 0b9f107a), rungs from ESTIMATE.md §8 and items from EVIDENCE.md §C/§D
-- and the eight round-one questions, only if that vehicle row exists.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.vehicle_evidence_rungs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z0-9_]{1,64}$'),
  position integer NOT NULL,
  label text NOT NULL,
  band_low integer CHECK (band_low IS NULL OR band_low >= 0),
  band_high integer CHECK (band_high IS NULL OR band_high >= coalesce(band_low, 0)),
  currency text NOT NULL DEFAULT 'USD',
  basis text NOT NULL,
  requirements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(requirements) = 'array'),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, key),
  UNIQUE (vehicle_id, position)
);
COMMENT ON TABLE public.vehicle_evidence_rungs IS
  'The value rungs one vehicle can stand on: a hammer band, the comps that set it (basis), and the evidence item keys it requires. A rung is reached when every required item is proven.';

CREATE TABLE IF NOT EXISTS public.vehicle_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z0-9_]{1,64}$'),
  label text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('question', 'photo', 'document')),
  satisfied_by text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'proven', 'contradicted')),
  proof_kind text CHECK (proof_kind IN ('observation', 'image')),
  proof_ref uuid,
  note text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, key)
);
COMMENT ON TABLE public.vehicle_evidence_items IS
  'What proves a vehicle''s claims: a question (satisfied_by = question_key), a photo (satisfied_by = shot label) or a document. proof_ref is the observation or image that proved or contradicted it.';
CREATE INDEX IF NOT EXISTS vehicle_evidence_items_vehicle_status_idx ON public.vehicle_evidence_items (vehicle_id, status);

CREATE TABLE IF NOT EXISTS public.vehicle_evidence_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  rung_from text,
  rung_to text,
  proof_kind text,
  proof_ref uuid,
  invite_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_evidence_changes_vehicle_at_idx ON public.vehicle_evidence_changes (vehicle_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.contributor_intake_reevaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  invite_id uuid REFERENCES public.vehicle_contributor_invites(id) ON DELETE SET NULL,
  observation_id uuid,
  image_id uuid,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'claimed', 'done', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  done_at timestamptz,
  result jsonb,
  CONSTRAINT contributor_intake_reevaluations_one_source CHECK ((observation_id IS NULL) <> (image_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS contributor_intake_reevaluations_observation_uniq
  ON public.contributor_intake_reevaluations (observation_id) WHERE observation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contributor_intake_reevaluations_image_uniq
  ON public.contributor_intake_reevaluations (image_id) WHERE image_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contributor_intake_reevaluations_queued_idx
  ON public.contributor_intake_reevaluations (created_at) WHERE status = 'queued';
COMMENT ON TABLE public.contributor_intake_reevaluations IS
  'One row per contributor input, queued for an agent to re-read the answer or file and refine the vehicle''s round-two questions. Claimed through claim_contributor_intake_reevaluation, closed through finish_contributor_intake_reevaluation.';

ALTER TABLE public.vehicle_evidence_rungs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_evidence_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributor_intake_reevaluations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_evidence_rungs, public.vehicle_evidence_items, public.vehicle_evidence_changes,
  public.contributor_intake_reevaluations FROM PUBLIC, anon, authenticated;

-- The rung a vehicle stands on and what moves it. Internal: no auth check (the callers check).
CREATE OR REPLACE FUNCTION public.contributor_intake_progress_for(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_proven text[];
  v_rungs jsonb;
  v_current jsonb;
  v_next jsonb;
  v_last jsonb;
BEGIN
  SELECT coalesce(array_agg(key), '{}') INTO v_proven FROM public.vehicle_evidence_items
   WHERE vehicle_id = p_vehicle_id AND status = 'proven';
  -- Every rung in order, with what it still needs. A rung is reached when all its requirements are proven; the rung
  -- the car stands on is the highest reached one whose lower rungs are also reached (no skipping).
  WITH r AS (
    SELECT g.*, ARRAY(SELECT x FROM jsonb_array_elements_text(g.requirements) x) AS req
      FROM public.vehicle_evidence_rungs g WHERE g.vehicle_id = p_vehicle_id),
  s AS (
    SELECT r.*, (r.req <@ v_proven) AS reached,
           ARRAY(SELECT x FROM unnest(r.req) x WHERE NOT (x = ANY (v_proven))) AS missing
      FROM r),
  t AS (
    SELECT s.*, bool_and(s.reached) OVER (ORDER BY s.position ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS standing
      FROM s)
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'position', t.position, 'label', t.label,
           'band_low', t.band_low, 'band_high', t.band_high, 'currency', t.currency, 'basis', t.basis,
           'requirements', t.requirements, 'reached', t.reached, 'standing', t.standing,
           'missing', to_jsonb(t.missing)) ORDER BY t.position), '[]'::jsonb),
         (SELECT jsonb_build_object('key', x.key, 'position', x.position, 'label', x.label, 'band_low', x.band_low,
            'band_high', x.band_high, 'currency', x.currency, 'basis', x.basis)
            FROM t x WHERE x.standing ORDER BY x.position DESC LIMIT 1)
    INTO v_rungs, v_current
    FROM t;
  -- Next: open items ordered by the lowest unreached rung that needs them, then by their own position.
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', n.key, 'label', n.label, 'kind', n.kind,
           'satisfied_by', n.satisfied_by, 'question_key', CASE WHEN n.kind = 'question' THEN n.satisfied_by END,
           'for_rung', n.for_rung, 'band_low', n.band_low, 'band_high', n.band_high)
           ORDER BY n.rung_position, n.position, n.key), '[]'::jsonb)
    INTO v_next
    FROM (
      SELECT d.* FROM (
        SELECT DISTINCT ON (it.key) it.key, it.label, it.kind, it.satisfied_by, it.position,
               g.key AS for_rung, g.position AS rung_position, g.band_low, g.band_high
          FROM public.vehicle_evidence_items it
          JOIN public.vehicle_evidence_rungs g ON g.vehicle_id = it.vehicle_id AND g.requirements ? it.key
         WHERE it.vehicle_id = p_vehicle_id AND it.status = 'open'
           AND NOT (ARRAY(SELECT x FROM jsonb_array_elements_text(g.requirements) x) <@ v_proven)
         ORDER BY it.key, g.position) d
       ORDER BY d.rung_position, d.position, d.key LIMIT 3) n;
  SELECT jsonb_build_object('at', c.changed_at, 'what', c.item_key, 'from_status', c.from_status, 'to_status', c.to_status,
           'moved_from', c.rung_from, 'moved_to', c.rung_to, 'proof_kind', c.proof_kind, 'proof_ref', c.proof_ref)
    INTO v_last
    FROM public.vehicle_evidence_changes c WHERE c.vehicle_id = p_vehicle_id ORDER BY c.changed_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'rung', v_current,
    'rungs', v_rungs,
    'proven', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'label', i.label, 'kind', i.kind,
        'satisfied_by', i.satisfied_by, 'proof_kind', i.proof_kind, 'proof_ref', i.proof_ref, 'note', i.note,
        'updated_at', i.updated_at) ORDER BY i.position, i.key), '[]'::jsonb)
      FROM public.vehicle_evidence_items i WHERE i.vehicle_id = p_vehicle_id AND i.status = 'proven'),
    'open', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'label', i.label, 'kind', i.kind,
        'satisfied_by', i.satisfied_by, 'note', i.note) ORDER BY i.position, i.key), '[]'::jsonb)
      FROM public.vehicle_evidence_items i WHERE i.vehicle_id = p_vehicle_id AND i.status = 'open'),
    'contradicted', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'label', i.label, 'kind', i.kind,
        'satisfied_by', i.satisfied_by, 'proof_kind', i.proof_kind, 'proof_ref', i.proof_ref, 'note', i.note,
        'updated_at', i.updated_at) ORDER BY i.position, i.key), '[]'::jsonb)
      FROM public.vehicle_evidence_items i WHERE i.vehicle_id = p_vehicle_id AND i.status = 'contradicted'),
    'counts', (SELECT jsonb_build_object('proven', count(*) FILTER (WHERE status = 'proven'),
        'open', count(*) FILTER (WHERE status = 'open'), 'contradicted', count(*) FILTER (WHERE status = 'contradicted'))
      FROM public.vehicle_evidence_items WHERE vehicle_id = p_vehicle_id),
    'next', v_next,
    'last_change', v_last);
END $$;

-- The owner's (or an editor's, or the service role acting for them) read of the same block.
CREATE OR REPLACE FUNCTION public.contributor_intake_progress(p_vehicle_id uuid, p_acting_as uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.contributor_intake_can_manage(p_vehicle_id, public.contributor_intake_actor(p_acting_as)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.contributor_intake_progress_for(p_vehicle_id);
END $$;

-- One input landed: mark the item it satisfies, log the move with the rung before and after, queue the
-- re-evaluation, tell the owner. Returns the progress block. Never raises: an input is never undone by this.
CREATE OR REPLACE FUNCTION public.contributor_intake_after_input(p_invite public.vehicle_contributor_invites,
  p_action text, p_ref uuid, p_question_key text, p_label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it public.vehicle_evidence_items;
  v_before jsonb;
  v_after jsonb;
  v_rung_from text;
  v_rung_to text;
  v_owner uuid;
  v_name text;
  v_title text;
  v_msg text;
  v_match text := lower(btrim(coalesce(p_question_key, p_label, '')));
BEGIN
  v_before := public.contributor_intake_progress_for(p_invite.vehicle_id);
  v_rung_from := v_before #>> '{rung,key}';
  IF v_match <> '' THEN
    SELECT * INTO it FROM public.vehicle_evidence_items
     WHERE vehicle_id = p_invite.vehicle_id AND status = 'open'
       AND (lower(coalesce(satisfied_by, '')) = v_match OR key = v_match OR lower(label) = v_match)
     ORDER BY (lower(coalesce(satisfied_by, '')) = v_match) DESC, position LIMIT 1;
    IF it.id IS NOT NULL THEN
      UPDATE public.vehicle_evidence_items SET status = 'proven',
        proof_kind = CASE WHEN p_action = 'upload' THEN 'image' ELSE 'observation' END, proof_ref = p_ref, updated_at = now()
       WHERE id = it.id;
      v_after := public.contributor_intake_progress_for(p_invite.vehicle_id);
      v_rung_to := v_after #>> '{rung,key}';
      INSERT INTO public.vehicle_evidence_changes (vehicle_id, item_key, from_status, to_status, rung_from, rung_to,
        proof_kind, proof_ref, invite_id)
      VALUES (p_invite.vehicle_id, it.key, 'open', 'proven', v_rung_from, v_rung_to,
        CASE WHEN p_action = 'upload' THEN 'image' ELSE 'observation' END, p_ref, p_invite.id);
      v_after := public.contributor_intake_progress_for(p_invite.vehicle_id);
    END IF;
  END IF;
  IF v_after IS NULL THEN v_after := v_before; END IF;
  INSERT INTO public.contributor_intake_reevaluations (vehicle_id, invite_id, observation_id, image_id)
  VALUES (p_invite.vehicle_id, p_invite.id, CASE WHEN p_action = 'upload' THEN NULL ELSE p_ref END,
    CASE WHEN p_action = 'upload' THEN p_ref END)
  ON CONFLICT DO NOTHING;
  BEGIN
    SELECT v.user_id INTO v_owner FROM public.vehicles v WHERE v.id = p_invite.vehicle_id;
    SELECT e.display_name INTO v_name FROM public.contributors c JOIN public.external_identities e ON e.id = c.external_identity_id
     WHERE c.id = p_invite.contributor_id;
    IF v_owner IS NOT NULL THEN
      v_title := coalesce(v_name, 'A contributor') || CASE WHEN p_action = 'upload' THEN ' sent a file' ELSE ' answered' END;
      v_msg := CASE WHEN it.id IS NULL THEN 'No evidence item changed.'
                    WHEN v_rung_to IS DISTINCT FROM v_rung_from THEN
                      format('%s proven. The car moved from %s to %s.', it.label, coalesce(v_before #>> '{rung,label}', 'no rung'),
                        coalesce(v_after #>> '{rung,label}', v_rung_to))
                    ELSE format('%s proven. Still on %s; next: %s.', it.label, coalesce(v_after #>> '{rung,label}', 'no rung'),
                      coalesce(v_after #>> '{next,0,label}', 'nothing open')) END;
      PERFORM public.create_notification(v_owner, 'contributor_intake_progress', v_title, v_msg, p_invite.vehicle_id, NULL,
        jsonb_strip_nulls(jsonb_build_object('invite_id', p_invite.id, 'action', p_action, 'ref_id', p_ref,
          'item_key', it.key, 'rung_from', v_rung_from, 'rung_to', v_rung_to,
          'action_url', '/vehicle/' || p_invite.vehicle_id)), 1);
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'contributor_intake_after_input: notification failed: %', SQLERRM;
  END;
  RETURN v_after;
EXCEPTION WHEN others THEN
  RAISE WARNING 'contributor_intake_after_input: %', SQLERRM;
  RETURN coalesce(v_after, v_before);
END $$;

-- The agent loop: claim queued re-evaluations (oldest first), then close each with its result.
CREATE OR REPLACE FUNCTION public.claim_contributor_intake_reevaluation(p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  WITH picked AS (
    SELECT id FROM public.contributor_intake_reevaluations WHERE status = 'queued'
     ORDER BY created_at LIMIT greatest(1, least(coalesce(p_limit, 10), 100)) FOR UPDATE SKIP LOCKED),
  upd AS (
    UPDATE public.contributor_intake_reevaluations r SET status = 'claimed', claimed_at = now()
      FROM picked WHERE r.id = picked.id
    RETURNING r.*)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'vehicle_id', u.vehicle_id, 'invite_id', u.invite_id,
           'observation_id', u.observation_id, 'image_id', u.image_id, 'created_at', u.created_at) ORDER BY u.created_at), '[]'::jsonb)
    INTO v_rows FROM upd u;
  RETURN v_rows;
END $$;

CREATE OR REPLACE FUNCTION public.finish_contributor_intake_reevaluation(p_id uuid, p_ok boolean, p_result jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  UPDATE public.contributor_intake_reevaluations SET status = CASE WHEN p_ok THEN 'done' ELSE 'failed' END,
    done_at = now(), result = p_result WHERE id = p_id AND status = 'claimed'
  RETURNING status INTO v_status;
  RETURN jsonb_build_object('id', p_id, 'status', v_status);
END $$;

-- The three service-role writers and the owner read, re-created with the ladder hooks (bodies otherwise as merged).
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
    'invite_id', i.id,
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
      AND vi.source = 'contributor_link' AND vi.storage_path LIKE '%contributors/' || i.id || '/%'),
    'progress', public.contributor_intake_progress_for(v.id))
    INTO v_card
    FROM public.vehicles v, public.contributors c JOIN public.external_identities e ON e.id = c.external_identity_id
   WHERE v.id = i.vehicle_id AND c.id = i.contributor_id;
  RETURN v_card;
END $$;

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
  v_progress jsonb;
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
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
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
  v_progress := public.contributor_intake_after_input(i, 'answer', v_id, q.key, NULL);
  INSERT INTO public.vehicle_contributor_invite_visits (invite_id, action, ref_id, device) VALUES (i.id, 'answer', v_id, v_device);
  UPDATE public.vehicle_contributor_invites SET last_seen_at = now() WHERE id = i.id;
  IF p_recorded_by IS NULL AND v_device ->> 'user_agent' IS NOT NULL THEN
    UPDATE public.contributors SET verification_level = 'attested'
     WHERE id = i.contributor_id AND verification_level IS DISTINCT FROM 'attested';
  END IF;
  RETURN jsonb_build_object('ok', true, 'observation_id', v_id, 'superseded', v_prior, 'progress', v_progress);
END $$;

CREATE OR REPLACE FUNCTION public.contributor_intake_file(p_token text, p_file jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i public.vehicle_contributor_invites;
  v_sha text := lower(p_file ->> 'sha256');
  -- Bucket: vehicle-photos (public) for photos, ownership-documents / user-documents (private) for papers.
  -- vehicle-photos paths stay bucket-relative, as every existing vehicle_images row records them; a private
  -- bucket's path is stored as '<bucket>/<path>' so the gated read knows to sign it from that bucket.
  v_bucket text := coalesce(nullif(p_file ->> 'bucket', ''), 'vehicle-photos');
  v_sensitive boolean := coalesce((p_file ->> 'is_sensitive')::boolean, false);
  v_path text := regexp_replace(coalesce(p_file ->> 'storage_path', ''), '^(vehicle-photos|ownership-documents|user-documents)/', '');
  v_url text := p_file ->> 'image_url';
  v_exif jsonb := CASE WHEN jsonb_typeof(p_file -> 'exif') = 'object' AND p_file -> 'exif' <> '{}'::jsonb THEN p_file -> 'exif' END;
  v_device jsonb := public.contributor_intake_device(coalesce(p_file -> 'device', '{}'::jsonb));
  v_id uuid;
  v_fp text;
  v_recorded_by uuid;
  v_progress jsonb;
BEGIN
  i := public.contributor_intake_invite_for_token(p_token);
  IF i.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF nullif(p_file ->> 'recorded_by', '') IS NOT NULL THEN
    IF p_file ->> 'recorded_by' !~ '^[0-9a-f-]{36}$'
       OR NOT public.contributor_intake_can_manage(i.vehicle_id, (p_file ->> 'recorded_by')::uuid) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    v_recorded_by := (p_file ->> 'recorded_by')::uuid;
  END IF;
  IF v_sha IS NULL OR v_sha !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_sha256'); END IF;
  IF v_bucket NOT IN ('vehicle-photos', 'ownership-documents', 'user-documents') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_bucket');
  END IF;
  -- A sensitive file lives only in a private bucket, and a private bucket holds only sensitive files.
  IF v_sensitive <> (v_bucket <> 'vehicle-photos') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bucket_sensitivity_mismatch');
  END IF;
  IF v_path !~ ('^contributors/' || i.id || '/' || v_sha || '/[^/]{1,200}$') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_storage_path');
  END IF;
  IF v_bucket <> 'vehicle-photos' THEN v_path := v_bucket || '/' || v_path; END IF;
  -- A sensitive row never carries an object URL; the gated read signs storage_path.
  IF v_sensitive THEN v_url := '';
  ELSIF v_url IS NULL OR v_url !~ '^https://' THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_image_url'); END IF;

  SELECT id INTO v_id FROM public.vehicle_images
   WHERE vehicle_id = i.vehicle_id AND file_hash = v_sha AND coalesce(is_superseded, false) = false LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.vehicle_contributor_invite_visits (invite_id, action, ref_id, device) VALUES (i.id, 'upload', v_id, v_device);
    RETURN jsonb_build_object('ok', true, 'image_id', v_id, 'duplicate', true);
  END IF;

  INSERT INTO public.vehicle_images (vehicle_id, image_url, storage_path, file_hash, file_name, filename, file_size,
    mime_type, source, is_external, exif_data, caption, ingest_kind, image_medium, photographer_attribution, submitted_by,
    is_sensitive, sensitive_type)
  VALUES (i.vehicle_id, v_url, v_path, v_sha, left(p_file ->> 'file_name', 255), left(p_file ->> 'file_name', 255),
    nullif(p_file ->> 'size_bytes', '')::bigint, left(p_file ->> 'mime_type', 128), 'contributor_link', true, v_exif,
    left(p_file ->> 'label', 500), 'import', 'received', 'contributor:' || i.contributor_id, v_recorded_by,
    v_sensitive, CASE WHEN v_sensitive THEN 'document' END)
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
  v_progress := public.contributor_intake_after_input(i, 'upload', v_id, NULL, p_file ->> 'label');
  RETURN jsonb_build_object('ok', true, 'image_id', v_id, 'duplicate', false, 'progress', v_progress);
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
    'progress', public.contributor_intake_progress_for(p_vehicle_id),
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

REVOKE ALL ON FUNCTION public.contributor_intake_progress_for(uuid),
  public.contributor_intake_after_input(public.vehicle_contributor_invites, text, uuid, text, text),
  public.claim_contributor_intake_reevaluation(integer),
  public.finish_contributor_intake_reevaluation(uuid, boolean, jsonb),
  public.contributor_intake_progress(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_contributor_intake_reevaluation(integer),
  public.finish_contributor_intake_reevaluation(uuid, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.contributor_intake_progress(uuid, uuid) TO authenticated, service_role;

-- Seed: the 1973 Firebird's rungs and items, only if its row exists (ESTIMATE.md §8, EVIDENCE.md §C/§D, SAM_QA.md).
DO $seed$
DECLARE v uuid := '20d21fb0-4651-4469-a0ba-e751309a1e54'; o uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = v) THEN RETURN; END IF;
  INSERT INTO public.vehicle_evidence_items (vehicle_id, key, label, kind, satisfied_by, status, note, position) VALUES
    (v, 'shot_vin_plate', 'Windshield VIN plate', 'photo', 'Windshield VIN plate', 'open', 'IMG_5176 in the owner''s library; lands when the phone relays it', 1),
    (v, 'shot_title', 'Title, front and back', 'document', 'Title', 'open', 'IMG_5224/5225 in the owner''s library; Nevada title in the builder''s name', 2),
    (v, 'shot_cowl_rivets', 'Cowl tag rivets, close and side-lit', 'photo', 'Cowl tag rivets', 'open', NULL, 3),
    (v, 'shot_pad_stamp', 'Engine pad stamp, front passenger side', 'photo', 'Engine pad stamp', 'open', 'Not in any frame yet', 4),
    (v, 'shot_block_casting', 'Block casting number and date code', 'photo', 'Block casting', 'open', 'IMG_4968 reads 9799140 (a 1970 455 block); needs the date code too', 5),
    (v, 'shot_carb_number', 'Carburetor number under the Uremco tag', 'photo', 'Carburetor number', 'contradicted', 'Uremco 14-4164 remanufactured, tagged 9/9/24 (IMG_4953/4954): not an SD Quadrajet, not a factory part', 6),
    (v, 'shot_distributor', 'Distributor tag or band', 'photo', 'Distributor', 'open', NULL, 7),
    (v, 'shot_intake', 'Intake casting and date', 'photo', 'Intake casting', 'open', NULL, 8),
    (v, 'shot_heads', 'Head castings and date codes, both heads', 'photo', 'Head castings', 'open', 'The SD heads carry a 16 between the center exhaust ports', 9),
    (v, 'shot_pumps', 'Water pump and fuel pump castings', 'photo', 'Pump castings', 'open', NULL, 10),
    (v, 'shot_cover_balancer', 'Valve cover and balancer', 'photo', 'Valve cover and balancer', 'open', NULL, 11),
    (v, 'shot_manifolds', 'Exhaust manifolds, outside face of each', 'photo', 'Exhaust manifolds', 'open', NULL, 12),
    (v, 'shot_trans_stamp', 'Transmission VIN stamp on the case pad', 'photo', 'Transmission stamp', 'open', NULL, 13),
    (v, 'shot_axle_code', 'Rear axle code on the passenger tube', 'photo', 'Rear axle code', 'open', NULL, 14),
    (v, 'shot_ta_hardware', 'Fender extractors, air dam and rear spoiler', 'photo', 'Trans Am hardware', 'open', NULL, 15),
    (v, 'shot_gauges', 'Tach face and gauge cluster', 'photo', 'Gauge cluster', 'open', NULL, 16),
    (v, 'shot_glass_codes', 'Glass date codes and weatherstrip', 'photo', 'Glass date codes', 'open', NULL, 17),
    (v, 'underside_detailed', 'Underside detailed and re-shot: wheelhouses, tank area, floor seams, front brakes', 'photo', 'Underside detailed', 'open', 'IMG_4853-4870, 4833, 4899-4927 show scale rust and used brake hardware today', 18),
    (v, 'q1', 'The block: where from, which year, bore, mains', 'question', 'q1', 'open', NULL, 21),
    (v, 'q2', 'The heads: which casting, where from', 'question', 'q2', 'open', NULL, 22),
    (v, 'q3', 'Crank, rods, pistons, balance', 'question', 'q3', 'open', NULL, 23),
    (v, 'q4', 'The cam', 'question', 'q4', 'open', NULL, 24),
    (v, 'q5', 'Intake, carb, distributor, manifolds: which are SD pieces', 'question', 'q5', 'open', NULL, 25),
    (v, 'q6', 'Who did the work, when, and where the receipts are', 'question', 'q6', 'open', NULL, 26),
    (v, 'q7', 'Body and paint', 'question', 'q7', 'open', NULL, 27),
    (v, 'q8', 'The title: bill of sale, seller of record', 'question', 'q8', 'open', NULL, 28),
    (v, 'doc_receipts', 'Receipts for the machine work and parts', 'document', 'Receipts', 'open', NULL, 31),
    (v, 'doc_build_photos', 'Build photos: bare shell, engine assembly, paint', 'document', 'Build photos', 'open', NULL, 32),
    (v, 'doc_dyno', 'Dyno sheet or timeslip', 'document', 'Dyno sheet', 'open', NULL, 33),
    (v, 'doc_bill_of_sale', 'Bill of sale from the builder', 'document', 'Bill of sale', 'open', NULL, 34),
    (v, 'claim_every_part_new', 'Every part on the car is new', 'photo', 'Every part new', 'contradicted', 'Scale rust on the wheelhouses, tank area and floor seams; rusty front brake hardware; worn ashtray and trunk hardware (EVIDENCE §D)', 41),
    (v, 'claim_sd_block', 'The block is an SD-455 casting', 'photo', 'SD block casting', 'contradicted', 'Casting 9799140 is the 1970 455 block; the SD-455 block is 485428 (IMG_4968)', 42)
  ON CONFLICT (vehicle_id, key) DO NOTHING;
  INSERT INTO public.vehicle_evidence_rungs (vehicle_id, key, position, label, band_low, band_high, basis, requirements, created_by) VALUES
    (v, 'as_photographed', 1, 'As the frames show it today', 35000, 45000,
     'ESTIMATE.md §8 row 1: BaT 455/461-powered base Firebirds 2025-26 sold at $35,455, $38,500, $44,900 and $56,500 (the $56.5k car had a full chassis build); real-body non-SD 1973 Trans Am median $70.2k (2024-26, n=33) sits above. The frames: 1970 455 block, remanufactured carb, Trans Am hardware, fresh paint and interior, used underside.',
     '[]'::jsonb, o),
    (v, 'numbers_photographed', 2, 'Underside detailed, every engine number photographed', 55000, 65000,
     'ESTIMATE.md §8 row 2: LS2 Trans Am-style car $62,000; Mecum 1970 re-creation $66,000; the 1.51x nut-and-bolt premium across the ten biggest 1965-74 muscle groups on the $42.0k plain Firebird base (MARKET.md §2, n=29 vs 279). Needs the underside detailed and the pad stamp, block casting and date, distributor, intake, heads, manifolds, transmission stamp and axle code in frames, plus the builder''s account of the block and the work.',
     '["underside_detailed","shot_pad_stamp","shot_block_casting","shot_distributor","shot_intake","shot_heads","shot_manifolds","shot_trans_stamp","shot_axle_code","q1","q6"]'::jsonb, o),
    (v, 'sd_parts_proven', 3, 'SD parts proven on castings and dates', 60000, 70000,
     'ESTIMATE.md §8 row 3: the real Buccaneer Red SD-455 automatic at Mecum 05-2025 ($60,500) and the real 1974 SDs at $57-80k are the roof; a buyer can still choose a real one. The block itself is a 1970 455 and the listing says so. Needs the heads (16 mark), intake, distributor and manifolds read as SD pieces in frames, the builder''s answers on heads, cam and SD pieces, and the receipts.',
     '["underside_detailed","shot_pad_stamp","shot_block_casting","shot_distributor","shot_intake","shot_heads","shot_manifolds","shot_trans_stamp","shot_axle_code","q1","q2","q4","q5","q6","doc_receipts"]'::jsonb, o)
  ON CONFLICT (vehicle_id, key) DO NOTHING;
END $seed$;

COMMIT;
