-- owner_statement_v1: a sanctioned writer and a reader for a person's own statement, said in conversation and
-- transcribed by an agent, about an organisation or a relationship between organisations.
--
-- Why (owner 2026-11-17): "I should just be inputting data to you but you wouldn't be able to store it right."
-- No rule-abiding path could store such a statement: ingest-observation is vehicle-shaped and takes no speaker, the
-- connector's submit_observation is vehicle-only, and the answer writer named in AGENTS.md is not deployed.
--
-- What this adds, all on the existing fact log public.vehicle_observations (no table, no column, no enum label):
--   1. owner_statement_caller: resolves the speaker from the caller's own authentication. Never from an argument
--      that names a person: a signed-in session, or the raw OAuth token the connector's caller presented, hashed
--      here (a stored key hash is not accepted, so reading api_keys does not make anyone a speaker).
--   2. record_owner_statement: one row per message, stored whole. Nothing is interpreted at write time.
--   3. record_owner_statement_link: the recording agent's resolution of one name in a statement to an organisation
--      (or to none), kept on its own row so it is corrected without touching the statement.
--   4. get_my_owner_statements: the speaker's own statements, with a count.
--   5. Admission and update-guard triggers, and two read policies: only the speaker reads these rows, whatever
--      organisation they name. vo_subject_owner_read alone would show a link row to that organisation's managers.
--
-- Every row is labelled unsigned: the speaker's claim as transcribed, not a Sign. No Sign is built here.
-- Pattern: 20261008050000_garage_owner_corrections.sql (definer writer, invoker reader, RESTRICTIVE private read,
-- admission and update-guard triggers).
--
-- Clocks. Recorded-at is ingested_at (the column default, the database clock; no argument sets it). Said-at is the
-- event clock, with its basis in the speaker's or agent's words in structured_data.said_at_basis:
--   an instant -> source_event_at, precision 'exact', observed_at = that instant, observed_at_basis 'event_time';
--   a day      -> source_event_date, precision 'day' (a civil date, no invented midnight); observed_at = recording
--                 time, observed_at_basis 'source_capture_time';
--   neither    -> precision 'unknown'; observed_at = recording time, observed_at_basis 'source_capture_time'.
--
-- Whose row. A statement row is the speaker's testimony (source owner-input). A link row is the recording agent's
-- inference (source agent-submission, agent_inferred, confidence capped at 0.6); submitted_by_user_id on it is the
-- speaker only as the key of the private pool it lives in.
--
-- Privacy boundary, stated plainly: the policies keep these rows from anon and authenticated callers other than the
-- speaker, and no existing API reader returns a vehicle-less row of these methods (swept 2026-11-17). A session
-- holding the service key or the database owner role bypasses row security, as for every table here.
-- Registry: the two methods are observation_extractors rows (the producer registry), not a new kind, property or
-- column. kind stays the existing non-public label 'provenance'; property_id stays NULL, which also keeps the rows
-- out of vehicle_canonical (it joins on property_id).

-- One transaction: the deploy runs this file in autocommit, and the writers must never exist without the policies
-- and triggers that keep their rows private.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 0. Registry rows for the two producers --------------------------------------------------------------------------
INSERT INTO public.observation_extractors (source_id, slug, display_name, extractor_type, extractor_config, produces_kinds)
SELECT s.id, x.slug, x.display_name, 'rule_based', x.config, ARRAY[]::public.observation_kind[]
FROM (VALUES
  ('owner-input', 'owner-statement-v1', 'Owner statement, transcribed whole (unsigned)',
   '{"extraction_method":"owner_statement_v1","writer":"record_owner_statement","reader":"get_my_owner_statements","private":true,"interprets":false,"sign":"none"}'::jsonb),
  ('agent-submission', 'owner-statement-org-link-v1', 'Recording agent''s organisation resolution for an owner statement',
   '{"extraction_method":"owner_statement_org_link_v1","writer":"record_owner_statement_link","reader":"get_my_owner_statements","private":true,"agent_inferred":true}'::jsonb)
) AS x(source_slug, slug, display_name, config)
JOIN public.observation_sources s ON s.slug = x.source_slug
ON CONFLICT (slug) DO NOTHING;

-- 1. Who is speaking --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_statement_caller(p_credential text, p_write boolean)
RETURNS TABLE(speaker uuid, via text, key_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NOT NULL THEN
    IF p_credential IS NOT NULL THEN
      RAISE EXCEPTION 'a signed-in caller does not pass a credential' USING ERRCODE = '42501';
    END IF;
    -- An anonymous sign-in is not a person's account (the OAuth login refuses it too).
    IF coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' THEN
      RETURN;
    END IF;
    RETURN QUERY SELECT uid, 'account_session'::text, NULL::uuid;
    RETURN;
  END IF;
  -- The connector holds no user session. It passes the raw OAuth token its caller presented with this request; the
  -- token is hashed here, so a hash read from api_keys is useless. Only a live credential issued by the interactive
  -- OAuth login qualifies (expiring, prefix 'oauth'): long-lived API keys, whatever their scopes, do not. Writing
  -- needs write:observations, reading needs read; neither implies the other. The service role alone is nobody.
  IF coalesce(auth.role(), '') = 'service_role' AND p_credential IS NOT NULL
     AND p_credential ~ '^nuke_oauth_[a-f0-9]{64}$' THEN
    RETURN QUERY
      SELECT k.user_id, 'connector_credential'::text, k.id
      FROM public.api_keys k
      WHERE k.key_hash = 'sha256_' || encode(sha256(convert_to(p_credential, 'UTF8')), 'hex')
        AND k.key_prefix = 'oauth'
        AND k.is_active IS TRUE
        AND k.expires_at IS NOT NULL AND k.expires_at > now()
        AND k.user_id IS NOT NULL
        AND k.scopes @> ARRAY[CASE WHEN p_write THEN 'write:observations' ELSE 'read' END]
      LIMIT 1;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.owner_statement_caller(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_statement_caller(text, boolean) TO authenticated, service_role;

-- 2. One organisation link (internal; only the two writers below call it) ----------------------------------------
CREATE OR REPLACE FUNCTION public.owner_statement_write_link(
  p_speaker uuid, p_via text, p_key_id uuid, p_request_id uuid, p_statement_id uuid, p_name_as_written text,
  p_recording_agent text, p_organization_id uuid, p_supersedes uuid, p_withdraw boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' SET TimeZone = 'UTC' AS $fn$
DECLARE
  v_source_id uuid; v_trust numeric; v_extractor uuid; v_id uuid := gen_random_uuid(); v_hash text;
  v_resolution text; payload jsonb;
  stmt public.vehicle_observations%ROWTYPE;
  old public.vehicle_observations%ROWTYPE;
  previous public.vehicle_observations%ROWTYPE;
BEGIN
  IF p_speaker IS NULL OR p_request_id IS NULL OR p_statement_id IS NULL THEN
    RAISE EXCEPTION 'speaker, request key and statement are required' USING ERRCODE = '23514';
  END IF;
  IF p_name_as_written IS NULL OR btrim(p_name_as_written) = '' OR length(p_name_as_written) > 500 THEN
    RAISE EXCEPTION 'the name as written is required (at most 500 characters)' USING ERRCODE = '23514';
  END IF;
  IF nullif(btrim(p_recording_agent), '') IS NULL OR length(p_recording_agent) > 200 THEN
    RAISE EXCEPTION 'the recording agent names itself (at most 200 characters)' USING ERRCODE = '23514';
  END IF;
  IF coalesce(p_withdraw, false) AND (p_supersedes IS NULL OR p_organization_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a withdrawal names the link it withdraws and no organisation' USING ERRCODE = '23514';
  END IF;
  -- One writer per speaker at a time, taken before the statement is read: a concurrent correction cannot
  -- supersede it between this check and the insert.
  PERFORM pg_advisory_xact_lock(hashtextextended('owner-statement-speaker:' || p_speaker::text, 0));
  SELECT * INTO stmt FROM public.vehicle_observations o
   WHERE o.id = p_statement_id AND o.extraction_method = 'owner_statement_v1' AND o.submitted_by_user_id = p_speaker;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'statement not found among the speaker''s own' USING ERRCODE = '23514';
  END IF;
  IF stmt.is_superseded IS TRUE THEN
    RAISE EXCEPTION 'the statement was superseded; link its successor' USING ERRCODE = '23514';
  END IF;
  IF p_organization_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.organizations g WHERE g.id = p_organization_id) THEN
    RAISE EXCEPTION 'organisation not found; keep the name unresolved instead' USING ERRCODE = '23514';
  END IF;
  -- The link is the agent's inference, so it is filed under the agent source with that source's trust, capped.
  SELECT s.id, least(s.base_trust_score, 0.6) INTO v_source_id, v_trust
    FROM public.observation_sources s WHERE s.slug = 'agent-submission';
  IF v_source_id IS NULL THEN RAISE EXCEPTION 'agent submission source unavailable'; END IF;
  SELECT x.id INTO v_extractor FROM public.observation_extractors x WHERE x.slug = 'owner-statement-org-link-v1';

  v_resolution := CASE WHEN coalesce(p_withdraw, false) THEN 'withdrawn'
                       WHEN p_organization_id IS NOT NULL THEN 'resolved' ELSE 'unresolved' END;
  v_hash := md5('owner-statement-link:' || p_speaker::text || ':' || p_request_id::text);
  payload := jsonb_build_object(
    'claim_contract', 'owner_statement_org_link_v1',
    'statement_observation_id', p_statement_id,
    'name_as_written', p_name_as_written,
    'resolution', v_resolution,
    'organization_id', p_organization_id,
    'resolved_by', 'recording_agent',
    'agent_inferred', true,
    'recording_agent', p_recording_agent,
    'speaker_user_id', p_speaker,
    'sign_status', 'unsigned',
    'sign_note', 'the recording agent''s resolution of a name in an unsigned statement; not the speaker''s words and not a Sign',
    'is_public', false,
    'supersedes', p_supersedes);

  SELECT * INTO old FROM public.vehicle_observations o
   WHERE o.source_id = v_source_id AND o.source_identifier = p_request_id::text AND o.content_hash = v_hash LIMIT 1;
  IF FOUND THEN
    -- Same request = same statement, name, resolution and predecessor; who retried it and with which key is not compared.
    IF (old.structured_data - 'recording_agent' - 'intake') IS DISTINCT FROM (payload - 'recording_agent')
       OR old.content_text IS DISTINCT FROM p_name_as_written THEN
      RAISE EXCEPTION 'request key reused with different content' USING ERRCODE = '23514';
    END IF;
    RETURN old.id;
  END IF;

  IF p_supersedes IS NOT NULL THEN
    SELECT * INTO previous FROM public.vehicle_observations
     WHERE id = p_supersedes AND submitted_by_user_id = p_speaker AND extraction_method = 'owner_statement_org_link_v1'
     FOR UPDATE;
    IF NOT FOUND OR previous.is_superseded IS TRUE
       OR previous.structured_data->>'statement_observation_id' IS DISTINCT FROM p_statement_id::text THEN
      RAISE EXCEPTION 'preceding link missing, already superseded, or of another statement or speaker'
        USING ERRCODE = '23514';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.vehicle_observations o
      WHERE o.submitted_by_user_id = p_speaker AND o.extraction_method = 'owner_statement_org_link_v1'
        AND o.is_superseded IS NOT TRUE
        AND o.structured_data->>'statement_observation_id' = p_statement_id::text
        AND o.structured_data->>'name_as_written' = p_name_as_written) THEN
    RAISE EXCEPTION 'this name is already linked on the statement; name the link to supersede' USING ERRCODE = '23514';
  END IF;

  -- The log is append-only, so a runaway caller is stopped here rather than cleaned up afterwards.
  IF (SELECT count(*) FROM public.vehicle_observations o
       WHERE o.submitted_by_user_id = p_speaker AND o.extraction_method = 'owner_statement_org_link_v1'
         AND o.ingested_at > now() - interval '1 hour') >= 600 THEN
    RAISE EXCEPTION 'too many organisation links in the last hour; try again later' USING ERRCODE = '54000';
  END IF;
  payload := payload || jsonb_build_object('intake', jsonb_build_object('via', p_via, 'credential_key_id', p_key_id));
  PERFORM set_config('nuke.owner_statement_writer', v_id::text, true);
  INSERT INTO public.vehicle_observations (
    id, vehicle_id, subject_type, subject_id, subject_organization_id, source_id, source_identifier, observed_at,
    content_text, content_hash, structured_data, submitted_by_user_id, observer_raw, extraction_method, kind,
    confidence_score, extractor_id, is_processed
  ) VALUES (
    v_id, NULL,
    CASE WHEN v_resolution = 'resolved' THEN 'organization' ELSE 'user' END,
    CASE WHEN v_resolution = 'resolved' THEN p_organization_id ELSE p_speaker END,
    CASE WHEN v_resolution = 'resolved' THEN p_organization_id END,
    v_source_id, p_request_id::text, now(), p_name_as_written, v_hash, payload, p_speaker,
    jsonb_build_object('user_id', p_speaker, 'recording_agent', p_recording_agent),
    'owner_statement_org_link_v1', 'provenance'::public.observation_kind, v_trust, v_extractor, true
  );
  PERFORM set_config('nuke.owner_statement_writer', '', true);

  IF p_supersedes IS NOT NULL THEN
    UPDATE public.vehicle_observations
       SET is_superseded = true, superseded_by = v_id, superseded_at = now(),
           lineage_chain = array_append(coalesce(lineage_chain, ARRAY[]::uuid[]), v_id)
     WHERE id = p_supersedes;
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.owner_statement_write_link(uuid, text, uuid, uuid, uuid, text, text, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

-- 3. The statement writer ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_owner_statement(
  p_request_id uuid, p_statement text, p_said_at_basis text, p_recording_agent text,
  p_said_on date DEFAULT NULL, p_said_at timestamptz DEFAULT NULL,
  p_organization_links jsonb DEFAULT '[]'::jsonb, p_supersedes uuid DEFAULT NULL,
  p_conversation_ref text DEFAULT NULL, p_withdraw boolean DEFAULT false, p_credential text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' SET TimeZone = 'UTC' AS $fn$
DECLARE
  who record; v_speaker uuid; v_source_id uuid; v_trust numeric; v_extractor uuid; v_id uuid := gen_random_uuid();
  v_hash text; v_withdraw boolean := coalesce(p_withdraw, false);
  v_links jsonb := coalesce(p_organization_links, '[]'::jsonb); v_link jsonb; v_ord integer := 0;
  v_link_ids uuid[] := ARRAY[]::uuid[]; v_link_id uuid; v_digest text; payload jsonb;
  v_observed timestamptz; v_basis text; v_precision text; v_recorded timestamptz;
  old public.vehicle_observations%ROWTYPE;
  previous public.vehicle_observations%ROWTYPE;
BEGIN
  SELECT * INTO who FROM public.owner_statement_caller(p_credential, true);
  v_speaker := who.speaker;
  IF v_speaker IS NULL THEN
    RAISE EXCEPTION 'an authenticated speaker is required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'a request key is required' USING ERRCODE = '23514';
  END IF;
  -- Stored whole: refused when empty or too long, never trimmed or cut.
  IF p_statement IS NULL OR btrim(p_statement) = '' OR length(p_statement) > 100000 THEN
    RAISE EXCEPTION 'the statement is required (at most 100000 characters); it is stored whole or not at all'
      USING ERRCODE = '23514';
  END IF;
  IF nullif(btrim(p_said_at_basis), '') IS NULL OR length(p_said_at_basis) > 500 THEN
    RAISE EXCEPTION 'state the basis of the said-at time (at most 500 characters)' USING ERRCODE = '23514';
  END IF;
  IF nullif(btrim(p_recording_agent), '') IS NULL OR length(p_recording_agent) > 200 THEN
    RAISE EXCEPTION 'the recording agent names itself (at most 200 characters)' USING ERRCODE = '23514';
  END IF;
  IF p_conversation_ref IS NOT NULL AND length(p_conversation_ref) > 500 THEN
    RAISE EXCEPTION 'conversation reference too long' USING ERRCODE = '23514';
  END IF;
  IF p_said_on IS NOT NULL AND p_said_at IS NOT NULL THEN
    RAISE EXCEPTION 'give the said-at as a day or as an instant, not both' USING ERRCODE = '23514';
  END IF;
  -- A said-on day is the speaker's civil date; allow for any time zone ahead of the database clock.
  IF (p_said_on IS NOT NULL AND (NOT isfinite(p_said_on) OR p_said_on > ((now() + interval '14 hours') AT TIME ZONE 'UTC')::date))
     OR (p_said_at IS NOT NULL AND (NOT isfinite(p_said_at) OR p_said_at > now() + interval '5 minutes')) THEN
    RAISE EXCEPTION 'the said-at time cannot be in the future' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(v_links) IS DISTINCT FROM 'array' OR jsonb_array_length(v_links) > 50 THEN
    RAISE EXCEPTION 'organisation links are an array of at most 50' USING ERRCODE = '23514';
  END IF;
  FOR v_link IN SELECT value FROM jsonb_array_elements(v_links) LOOP
    IF jsonb_typeof(v_link) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_link) k WHERE k NOT IN ('name_as_written', 'organization_id'))
       OR jsonb_typeof(v_link->'name_as_written') IS DISTINCT FROM 'string'
       OR (v_link ? 'organization_id' AND v_link->'organization_id' <> 'null'::jsonb
           AND (jsonb_typeof(v_link->'organization_id') IS DISTINCT FROM 'string'
                OR NOT pg_input_is_valid(v_link->>'organization_id', 'uuid'))) THEN
      RAISE EXCEPTION 'a link is {name_as_written, organization_id?}' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- A withdrawal ("I did not say that", or the wrong person's words were stored) is a successor that withdraws its
  -- predecessor; its own text is the words of the withdrawal. It carries no links.
  IF v_withdraw AND (p_supersedes IS NULL OR jsonb_array_length(v_links) > 0) THEN
    RAISE EXCEPTION 'a withdrawal names the statement it withdraws and carries no links' USING ERRCODE = '23514';
  END IF;

  SELECT s.id, s.base_trust_score INTO v_source_id, v_trust
    FROM public.observation_sources s WHERE s.slug = 'owner-input';
  IF v_source_id IS NULL THEN RAISE EXCEPTION 'owner input source unavailable'; END IF;
  SELECT x.id INTO v_extractor FROM public.observation_extractors x WHERE x.slug = 'owner-statement-v1';

  IF p_said_at IS NOT NULL THEN
    v_observed := p_said_at; v_basis := 'event_time'; v_precision := 'exact';
  ELSIF p_said_on IS NOT NULL THEN
    v_observed := now(); v_basis := 'source_capture_time'; v_precision := 'day';
  ELSE
    v_observed := now(); v_basis := 'source_capture_time'; v_precision := 'unknown';
  END IF;

  v_hash := md5('owner-statement:' || v_speaker::text || ':' || p_request_id::text);
  -- What the caller asked for, so a replay of the same request is recognised and a reused key is refused.
  -- Identity of a request: the words, the said-at, the predecessor and the links. Not who retried it or how.
  v_digest := md5(jsonb_build_object('statement', p_statement, 'said_on', p_said_on, 'said_at', extract(epoch FROM p_said_at),
    'links', v_links, 'supersedes', p_supersedes, 'withdraw', v_withdraw)::text);
  payload := jsonb_build_object(
    'claim_contract', 'owner_statement_v1',
    'speaker_user_id', v_speaker,
    'recording_agent', p_recording_agent,
    'intake', jsonb_build_object('via', who.via, 'credential_key_id', who.key_id),
    'said_at_basis', p_said_at_basis,
    'sign_status', 'unsigned',
    'sign_note', 'the speaker''s claim as transcribed by the recording agent; not a Sign',
    'interpreted', false,
    'is_public', false,
    'withdrawal', v_withdraw,
    'supersedes', p_supersedes,
    'conversation_ref', p_conversation_ref,
    'request_digest', v_digest);

  PERFORM pg_advisory_xact_lock(hashtextextended('owner-statement-speaker:' || v_speaker::text, 0));
  SELECT * INTO old FROM public.vehicle_observations o
   WHERE o.source_id = v_source_id AND o.source_identifier = p_request_id::text AND o.content_hash = v_hash LIMIT 1;
  IF FOUND THEN
    IF old.structured_data->>'request_digest' IS DISTINCT FROM v_digest THEN
      RAISE EXCEPTION 'request key reused with different content' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object('statement_id', old.id, 'recorded_at', old.ingested_at, 'replay', true,
      'sign_status', 'unsigned',
      'link_ids', coalesce((SELECT jsonb_agg(l.id ORDER BY l.ingested_at, l.id) FROM public.vehicle_observations l
        WHERE l.submitted_by_user_id = v_speaker AND l.extraction_method = 'owner_statement_org_link_v1'
          AND l.structured_data->>'statement_observation_id' = old.id::text), '[]'::jsonb));
  END IF;

  IF p_supersedes IS NOT NULL THEN
    SELECT * INTO previous FROM public.vehicle_observations
     WHERE id = p_supersedes AND submitted_by_user_id = v_speaker AND extraction_method = 'owner_statement_v1'
     FOR UPDATE;
    IF NOT FOUND OR previous.is_superseded IS TRUE THEN
      RAISE EXCEPTION 'preceding statement missing, already superseded, or another speaker''s' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- The log is append-only, so a runaway caller is stopped here rather than cleaned up afterwards.
  IF (SELECT count(*) FROM public.vehicle_observations o
       WHERE o.submitted_by_user_id = v_speaker AND o.extraction_method = 'owner_statement_v1'
         AND o.ingested_at > now() - interval '1 hour') >= 120 THEN
    RAISE EXCEPTION 'too many statements in the last hour; try again later' USING ERRCODE = '54000';
  END IF;

  PERFORM set_config('nuke.owner_statement_writer', v_id::text, true);
  INSERT INTO public.vehicle_observations (
    id, vehicle_id, subject_type, subject_id, source_id, source_identifier, observed_at, observed_at_basis,
    source_event_at, source_event_date, source_event_time_precision, content_text, content_hash, structured_data,
    submitted_by_user_id, observer_raw, extraction_method, kind, confidence_score, extractor_id, is_processed
  ) VALUES (
    v_id, NULL, 'user', v_speaker, v_source_id, p_request_id::text, v_observed, v_basis,
    CASE WHEN v_precision = 'exact' THEN p_said_at END, CASE WHEN v_precision = 'day' THEN p_said_on END, v_precision,
    p_statement, v_hash, payload, v_speaker,
    jsonb_build_object('user_id', v_speaker, 'recording_agent', p_recording_agent),
    'owner_statement_v1', 'provenance'::public.observation_kind, v_trust, v_extractor, true
  ) RETURNING ingested_at INTO v_recorded;
  PERFORM set_config('nuke.owner_statement_writer', '', true);

  FOR v_link IN SELECT value FROM jsonb_array_elements(v_links) LOOP
    v_ord := v_ord + 1;
    v_link_id := public.owner_statement_write_link(v_speaker, who.via, who.key_id,
      md5(p_request_id::text || ':link:' || v_ord::text)::uuid, v_id, v_link->>'name_as_written', p_recording_agent,
      nullif(v_link->>'organization_id', '')::uuid, NULL, false);
    v_link_ids := array_append(v_link_ids, v_link_id);
  END LOOP;

  IF p_supersedes IS NOT NULL THEN
    UPDATE public.vehicle_observations
       SET is_superseded = true, superseded_by = v_id, superseded_at = now(),
           lineage_chain = array_append(coalesce(lineage_chain, ARRAY[]::uuid[]), v_id)
     WHERE id = p_supersedes;
  END IF;
  RETURN jsonb_build_object('statement_id', v_id, 'recorded_at', v_recorded, 'replay', false,
    'sign_status', 'unsigned', 'link_ids', to_jsonb(v_link_ids));
END $fn$;
REVOKE ALL ON FUNCTION public.record_owner_statement(uuid, text, text, text, date, timestamptz, jsonb, uuid, text, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_owner_statement(uuid, text, text, text, date, timestamptz, jsonb, uuid, text, boolean, text)
  TO authenticated, service_role;

-- 4. Correcting or adding one link ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_owner_statement_link(
  p_request_id uuid, p_statement_id uuid, p_name_as_written text, p_recording_agent text,
  p_organization_id uuid DEFAULT NULL, p_supersedes uuid DEFAULT NULL, p_withdraw boolean DEFAULT false,
  p_credential text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' SET TimeZone = 'UTC' AS $fn$
DECLARE who record;
BEGIN
  SELECT * INTO who FROM public.owner_statement_caller(p_credential, true);
  IF who.speaker IS NULL THEN
    RAISE EXCEPTION 'an authenticated speaker is required' USING ERRCODE = '42501';
  END IF;
  RETURN public.owner_statement_write_link(who.speaker, who.via, who.key_id, p_request_id, p_statement_id,
    p_name_as_written, p_recording_agent, p_organization_id, p_supersedes, coalesce(p_withdraw, false));
END $fn$;
REVOKE ALL ON FUNCTION public.record_owner_statement_link(uuid, uuid, text, text, uuid, uuid, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_owner_statement_link(uuid, uuid, text, text, uuid, uuid, boolean, text)
  TO authenticated, service_role;

-- 5. The speaker's reader ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_owner_statements(
  p_organization_id uuid DEFAULT NULL, p_said_from date DEFAULT NULL, p_said_to date DEFAULT NULL,
  p_include_superseded boolean DEFAULT false, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0,
  p_credential text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
  v_speaker uuid; v_total bigint; v_rows jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
  SELECT c.speaker INTO v_speaker FROM public.owner_statement_caller(p_credential, false) c;
  IF v_speaker IS NULL THEN
    RAISE EXCEPTION 'an authenticated speaker is required' USING ERRCODE = '42501';
  END IF;
  -- The speaker filter is stated here, not left to row security, so the answer is the same for every role.
  WITH matched AS (
    SELECT o.id, o.content_text, o.observed_at, o.ingested_at, o.source_event_at, o.source_event_date,
           o.source_event_time_precision, o.structured_data, o.is_superseded, o.superseded_by, o.superseded_at
    FROM public.vehicle_observations o
    WHERE o.submitted_by_user_id = v_speaker
      AND o.extraction_method = 'owner_statement_v1'
      AND (coalesce(p_include_superseded, false)
           OR (o.is_superseded IS NOT TRUE AND o.structured_data->'withdrawal' IS DISTINCT FROM 'true'::jsonb))
      AND (p_said_from IS NULL OR coalesce(o.source_event_date, (o.observed_at AT TIME ZONE 'UTC')::date) >= p_said_from)
      AND (p_said_to IS NULL OR coalesce(o.source_event_date, (o.observed_at AT TIME ZONE 'UTC')::date) <= p_said_to)
      AND (p_organization_id IS NULL OR EXISTS (
            SELECT 1 FROM public.vehicle_observations l
            WHERE l.submitted_by_user_id = v_speaker
              AND l.extraction_method = 'owner_statement_org_link_v1'
              AND l.is_superseded IS NOT TRUE
              AND l.subject_organization_id = p_organization_id
              AND l.structured_data->>'statement_observation_id' = o.id::text))
  ), page AS (
    SELECT m.*, coalesce(m.source_event_at, m.source_event_date::timestamp AT TIME ZONE 'UTC', m.observed_at) AS said_sort
    FROM matched m ORDER BY said_sort DESC, m.ingested_at DESC, m.id LIMIT v_limit OFFSET v_offset
  )
  SELECT (SELECT count(*) FROM matched),
         coalesce((SELECT jsonb_agg(jsonb_build_object(
           'id', p.id,
           'statement', p.content_text,
           'said_on', coalesce(p.source_event_date, (p.source_event_at AT TIME ZONE 'UTC')::date),
           'said_at', p.source_event_at,
           'said_at_precision', p.source_event_time_precision,
           'said_at_basis', p.structured_data->>'said_at_basis',
           'recorded_at', p.ingested_at,
           'recording_agent', p.structured_data->>'recording_agent',
           'conversation_ref', p.structured_data->>'conversation_ref',
           'sign_status', p.structured_data->>'sign_status',
           'withdrawal', coalesce(p.structured_data->'withdrawal', 'false'::jsonb),
           'supersedes', p.structured_data->'supersedes',
           'is_superseded', coalesce(p.is_superseded, false),
           'superseded_by', p.superseded_by,
           'superseded_at', p.superseded_at,
           'organization_links', coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                'link_id', l.id,
                'name_as_written', l.structured_data->>'name_as_written',
                'resolution', l.structured_data->>'resolution',
                'organization_id', l.subject_organization_id,
                -- the same visibility as the organisation's own read policies, stated here so it holds for every role
                'organization_name', (SELECT g.name FROM public.organizations g WHERE g.id = l.subject_organization_id
                   AND (g.is_public IS TRUE OR EXISTS (SELECT 1 FROM public.business_ownership bo
                         WHERE bo.business_id = g.id AND bo.owner_id = v_speaker AND bo.status = 'active'))),
                'resolved_by', l.structured_data->>'resolved_by',
                'agent_inferred', true,
                'recording_agent', l.structured_data->>'recording_agent',
                'recorded_at', l.ingested_at) ORDER BY l.ingested_at, l.structured_data->>'name_as_written', l.id)
              FROM public.vehicle_observations l
              WHERE l.submitted_by_user_id = v_speaker
                AND l.extraction_method = 'owner_statement_org_link_v1'
                AND l.is_superseded IS NOT TRUE
                AND l.structured_data->>'resolution' <> 'withdrawn'
                AND l.structured_data->>'statement_observation_id' = p.id::text), '[]'::jsonb))
           ORDER BY p.said_sort DESC, p.ingested_at DESC, p.id) FROM page p), '[]'::jsonb)
    INTO v_total, v_rows;
  RETURN jsonb_build_object(
    'reader', 'get_my_owner_statements',
    'as_of', now(),
    'speaker_user_id', v_speaker,
    'filters', jsonb_build_object('organization_id', p_organization_id, 'said_from', p_said_from, 'said_to', p_said_to,
      'include_superseded', coalesce(p_include_superseded, false), 'limit', v_limit, 'offset', v_offset),
    'total_count', v_total,
    'returned', jsonb_array_length(v_rows),
    'note', 'Unsigned: each statement is the speaker''s claim as transcribed, not a Sign and not a verified fact.',
    'statements', v_rows);
END $fn$;
REVOKE ALL ON FUNCTION public.get_my_owner_statements(uuid, date, date, boolean, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_owner_statements(uuid, date, date, boolean, integer, integer, text)
  TO authenticated, service_role;

-- 6. Only the speaker reads these rows --------------------------------------------------------------------------
DROP POLICY IF EXISTS owner_statement_private_read ON public.vehicle_observations;
CREATE POLICY owner_statement_private_read ON public.vehicle_observations AS RESTRICTIVE
FOR SELECT TO anon, authenticated USING (
  extraction_method IS NULL
  OR extraction_method NOT IN ('owner_statement_v1', 'owner_statement_org_link_v1')
  OR submitted_by_user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS owner_statement_speaker_read ON public.vehicle_observations;
CREATE POLICY owner_statement_speaker_read ON public.vehicle_observations
FOR SELECT TO authenticated USING (
  extraction_method IN ('owner_statement_v1', 'owner_statement_org_link_v1')
  AND submitted_by_user_id = (SELECT auth.uid()));

-- 7. Immutable rows; only the writers admit them ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_owner_statement_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  open_cols text[] := ARRAY['is_superseded', 'superseded_by', 'superseded_at', 'lineage_chain',
                            'is_processed', 'processing_metadata'];
BEGIN
  IF (to_jsonb(NEW) - open_cols) IS DISTINCT FROM (to_jsonb(OLD) - open_cols) THEN
    RAISE EXCEPTION 'an owner statement row is immutable; append a successor' USING ERRCODE = '23514';
  END IF;
  IF OLD.is_superseded IS TRUE AND (NEW.is_superseded IS NOT TRUE
      OR NEW.superseded_by IS DISTINCT FROM OLD.superseded_by OR NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'owner statement row already superseded' USING ERRCODE = '23514';
  END IF;
  -- A row leaves the current read only by pointing at its successor: same method, same speaker.
  IF NEW.is_superseded IS TRUE AND OLD.is_superseded IS NOT TRUE AND NOT EXISTS (
       SELECT 1 FROM public.vehicle_observations n WHERE n.id = NEW.superseded_by AND n.id <> OLD.id
         AND n.extraction_method = OLD.extraction_method AND n.submitted_by_user_id = OLD.submitted_by_user_id
         AND n.structured_data->>'supersedes' = OLD.id::text) THEN
    RAISE EXCEPTION 'an owner statement row is superseded only by its successor' USING ERRCODE = '23514';
  END IF;
  IF NEW.is_superseded IS NOT TRUE AND (NEW.superseded_by IS NOT NULL OR NEW.superseded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an owner statement row is superseded only by its successor' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.guard_owner_statement_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  RAISE EXCEPTION 'an owner statement row is never deleted; withdraw it with a successor' USING ERRCODE = '23514';
END $fn$;
DROP TRIGGER IF EXISTS trg_guard_owner_statement_delete ON public.vehicle_observations;
CREATE TRIGGER trg_guard_owner_statement_delete BEFORE DELETE ON public.vehicle_observations
FOR EACH ROW WHEN (OLD.extraction_method IN ('owner_statement_v1', 'owner_statement_org_link_v1'))
EXECUTE FUNCTION public.guard_owner_statement_delete();
DROP TRIGGER IF EXISTS trg_guard_owner_statement_update ON public.vehicle_observations;
CREATE TRIGGER trg_guard_owner_statement_update BEFORE UPDATE ON public.vehicle_observations
FOR EACH ROW WHEN (OLD.extraction_method IN ('owner_statement_v1', 'owner_statement_org_link_v1')
  OR NEW.extraction_method IN ('owner_statement_v1', 'owner_statement_org_link_v1'))
EXECUTE FUNCTION public.guard_owner_statement_update();

CREATE OR REPLACE FUNCTION public.admit_owner_statement()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  sd jsonb := NEW.structured_data;
  is_link boolean := NEW.extraction_method = 'owner_statement_org_link_v1';
BEGIN
  IF NEW.extraction_method IS NULL
     OR NEW.extraction_method NOT IN ('owner_statement_v1', 'owner_statement_org_link_v1')
     OR sd->>'claim_contract' IS DISTINCT FROM NEW.extraction_method
     -- Set by the writers for exactly this row, in this transaction, and the insert runs as the writers' owner
     -- (their definer context). An API role, the service role included, satisfies neither by itself; a session
     -- holding the database owner role can, as it can do anything else here.
     OR nullif(current_setting('nuke.owner_statement_writer', true), '') IS DISTINCT FROM NEW.id::text
     OR current_user <> (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p
          WHERE p.oid = 'public.owner_statement_write_link(uuid,text,uuid,uuid,uuid,text,text,uuid,uuid,boolean)'::regprocedure)
     OR NEW.vehicle_id IS NOT NULL OR NEW.property_id IS NOT NULL
     OR NEW.submitted_by_user_id IS NULL
     OR sd->>'speaker_user_id' IS DISTINCT FROM NEW.submitted_by_user_id::text
     OR sd->>'sign_status' IS DISTINCT FROM 'unsigned'
     OR sd->'is_public' IS DISTINCT FROM 'false'::jsonb
     OR NEW.source_identifier IS NULL OR NEW.content_text IS NULL
     OR NEW.is_superseded IS TRUE OR NEW.superseded_by IS NOT NULL
     -- the speaker's words under the owner source; the agent's resolution under the agent source
     OR NOT EXISTS (SELECT 1 FROM public.observation_sources s WHERE s.id = NEW.source_id
          AND s.slug = CASE WHEN is_link THEN 'agent-submission' ELSE 'owner-input' END) THEN
    RAISE EXCEPTION 'an owner statement is admitted only through its writer' USING ERRCODE = '23514';
  END IF;
  IF NOT is_link AND (
       NEW.subject_type IS DISTINCT FROM 'user' OR NEW.subject_id IS DISTINCT FROM NEW.submitted_by_user_id
       OR NEW.subject_organization_id IS NOT NULL
       OR NEW.content_hash IS DISTINCT FROM
          md5('owner-statement:' || NEW.submitted_by_user_id::text || ':' || NEW.source_identifier)) THEN
    RAISE EXCEPTION 'an owner statement row is the speaker''s own, keyed by its request' USING ERRCODE = '23514';
  END IF;
  IF is_link AND (
       NEW.content_hash IS DISTINCT FROM
          md5('owner-statement-link:' || NEW.submitted_by_user_id::text || ':' || NEW.source_identifier)
       OR sd->'agent_inferred' IS DISTINCT FROM 'true'::jsonb OR coalesce(NEW.confidence_score, 0) > 0.6
       OR sd->>'resolution' IS NULL OR sd->>'resolution' NOT IN ('resolved', 'unresolved', 'withdrawn')
       OR (sd->>'resolution' = 'resolved' AND (NEW.subject_type IS DISTINCT FROM 'organization'
            OR NEW.subject_organization_id IS NULL OR NEW.subject_id IS DISTINCT FROM NEW.subject_organization_id))
       OR (sd->>'resolution' <> 'resolved' AND (NEW.subject_type IS DISTINCT FROM 'user'
            OR NEW.subject_id IS DISTINCT FROM NEW.submitted_by_user_id OR NEW.subject_organization_id IS NOT NULL))
       OR NOT EXISTS (SELECT 1 FROM public.vehicle_observations s
            WHERE s.id::text = sd->>'statement_observation_id' AND s.extraction_method = 'owner_statement_v1'
              AND s.submitted_by_user_id = NEW.submitted_by_user_id)) THEN
    RAISE EXCEPTION 'an organisation link names the speaker''s own statement and one resolution' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_admit_owner_statement ON public.vehicle_observations;
CREATE TRIGGER trg_admit_owner_statement BEFORE INSERT ON public.vehicle_observations
FOR EACH ROW WHEN (NEW.extraction_method IN ('owner_statement_v1', 'owner_statement_org_link_v1')
  OR NEW.structured_data->>'claim_contract' IN ('owner_statement_v1', 'owner_statement_org_link_v1'))
EXECUTE FUNCTION public.admit_owner_statement();

-- 8. The database describes itself ------------------------------------------------------------------------------
COMMENT ON FUNCTION public.owner_statement_caller(text, boolean) IS
  'Who is speaking, for the owner-statement writers and reader: the signed-in user (auth.uid()), or, for the service role only, the user bound to the live OAuth-login credential whose raw token the connector passes from its caller''s request (hashed here; a stored hash is not accepted; long-lived API keys do not qualify; write needs write:observations, read needs read). No argument names a speaker; the service role alone is nobody.';
COMMENT ON FUNCTION public.record_owner_statement(uuid, text, text, text, date, timestamptz, jsonb, uuid, text, boolean, text) IS
  'Sanctioned writer. Stores one statement a person said in conversation, whole and uninterpreted, as a private vehicle_observations row (extraction_method owner_statement_v1, source owner-input, no vehicle, subject = the speaker). Speaker from authentication; recording agent stored apart; recorded-at = ingested_at (database clock); said-at in source_event_date/source_event_at with its stated basis. Unsigned: a transcribed claim, not a Sign. A correction is a new row naming p_supersedes; p_withdraw makes that successor a withdrawal. Idempotent on p_request_id. Private to the speaker against anon and authenticated callers; service-key and database-owner sessions bypass row security as everywhere.';
COMMENT ON FUNCTION public.record_owner_statement_link(uuid, uuid, text, text, uuid, uuid, boolean, text) IS
  'Sanctioned writer. The recording agent''s resolution of one name in the caller''s own statement: to an organisation (subject_organization_id), to none (kept as written), or withdrawn. Its own row (owner_statement_org_link_v1), corrected by a successor naming p_supersedes; the statement is untouched. An agent inference: source agent-submission, agent_inferred, confidence capped at 0.6.';
COMMENT ON FUNCTION public.get_my_owner_statements(uuid, date, date, boolean, integer, integer, text) IS
  'The caller''s own statements (owner_statement_v1) with current organisation links and total_count; optional organisation and said-date filters. Speaker from authentication only. Unsigned claims, not verified facts.';
COMMENT ON POLICY owner_statement_private_read ON public.vehicle_observations IS
  'Owner-statement rows and their organisation links are read by the speaker only, whatever other policy would match (vo_subject_owner_read would show a link to the named organisation''s managers). 2026-11-17.';

-- 9. Private rows are not public contributions ------------------------------------------------------------------
-- profile_stats.total_contributions is readable by anon. Its count of submitted observations (live definition read
-- 2026-11-17, otherwise unchanged) now leaves out the private account-scoped methods, so storing a statement does
-- not move a public number.
CREATE OR REPLACE FUNCTION public.recompute_profile_stats(p_user_id uuid)
 RETURNS TABLE(vehicles_count integer, total_vehicles integer, total_images integer, total_timeline_events integer, total_contributions integer, last_activity timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicles_count integer := 0;
  v_total_vehicles integer := 0;
  v_total_images integer := 0;
  v_timeline integer := 0;
  v_contrib integer := 0;
  v_last timestamptz;
BEGIN
  -- Distinct vehicles where this user is the principal (user_id ∪ uploaded_by ∪ owner_id ∪ created_by_user_id)
  SELECT COUNT(DISTINCT v.id) INTO v_total_vehicles
  FROM vehicles v
  WHERE v.user_id = p_user_id
     OR v.uploaded_by = p_user_id
     OR v.owner_id = p_user_id
     OR v.created_by_user_id = p_user_id;

  -- vehicles_count: distinct vehicles touched via events (more conservative "actually worked on")
  SELECT COUNT(DISTINCT vte.vehicle_id) INTO v_vehicles_count
  FROM vehicle_timeline_events vte
  WHERE vte.user_id = p_user_id;

  -- Images attributed to this user (via user_id; the other paths are redundant in practice)
  SELECT COUNT(*) INTO v_total_images
  FROM vehicle_images
  WHERE user_id = p_user_id;

  -- Timeline events authored by this user (vehicle + business)
  SELECT
    (SELECT COUNT(*) FROM vehicle_timeline_events WHERE user_id = p_user_id)
    + (SELECT COUNT(*) FROM business_timeline_events WHERE created_by = p_user_id)
  INTO v_timeline;

  -- Total contributions: timeline events + image uploads + observations submitted
  -- (private account-scoped rows are not contributions: owner statements, their links, garage corrections)
  SELECT v_timeline
    + v_total_images
    + (SELECT COUNT(*) FROM vehicle_observations WHERE submitted_by_user_id = p_user_id
         AND (extraction_method IS NULL OR extraction_method NOT IN
              ('owner_statement_v1', 'owner_statement_org_link_v1', 'garage_owner_correction_v1')))
  INTO v_contrib;

  -- Most recent activity across the contribution sources
  SELECT MAX(t) INTO v_last
  FROM (
    SELECT MAX(event_date) AS t FROM vehicle_timeline_events WHERE user_id = p_user_id
    UNION ALL SELECT MAX(taken_at)  FROM vehicle_images WHERE user_id = p_user_id
    UNION ALL SELECT MAX(created_at) FROM business_timeline_events WHERE created_by = p_user_id
  ) s;

  INSERT INTO public.profile_stats AS ps (
    user_id, vehicles_count, total_vehicles, total_images,
    total_timeline_events, total_contributions, last_activity, updated_at
  )
  VALUES (
    p_user_id, v_vehicles_count, v_total_vehicles, v_total_images,
    v_timeline, v_contrib, v_last, NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    vehicles_count        = EXCLUDED.vehicles_count,
    total_vehicles        = EXCLUDED.total_vehicles,
    total_images          = EXCLUDED.total_images,
    total_timeline_events = EXCLUDED.total_timeline_events,
    total_contributions   = EXCLUDED.total_contributions,
    last_activity         = EXCLUDED.last_activity,
    updated_at            = NOW();

  RETURN QUERY
  SELECT v_vehicles_count, v_total_vehicles, v_total_images,
         v_timeline, v_contrib, v_last;
END;
$function$;

-- 10. The activity view reads as its caller ---------------------------------------------------------------------
-- v_user_daily_activity shows the first 200 characters of every submitted observation and is granted to anon. Live it
-- already carries security_invoker = true (read 2026-11-17), so row security above applies and only the speaker sees
-- these rows in their own timeline; the repository's last definition of the view (20260507180000) does not say so.
-- Pin it here so the privacy of these rows never depends on an unrecorded setting.
DO $$ BEGIN
  IF to_regclass('public.v_user_daily_activity') IS NOT NULL THEN
    ALTER VIEW public.v_user_daily_activity SET (security_invoker = true);
  END IF;
END $$;

COMMIT;
