-- vehicle_statement_v1: a sanctioned writer and a page reader for what a person said in conversation ABOUT A VEHICLE
-- (a representative, a seller's agent, a shop, a previous owner or the owner), kept as that person's claim.
--
-- Why. The owner's model reads three sources of labor and cost: Nuke's estimate, user-reported claims and documented
-- paid paper. The middle one had no way to attach to a vehicle. record_owner_statement (20261117150000) stores a
-- speaker's words, but its admission trigger refuses any row that names a vehicle or a property, and the generic
-- ingest-observation path takes no speaker and validates no role. A statement such as "rear axle is posi" or a guess
-- at what a paint job cost could therefore not be recorded as a claim on a car.
--
-- What this adds (record_owner_statement and its triggers are NOT changed; an owner statement still cannot name a vehicle):
--   1. record_vehicle_statement: the sibling writer. Same safeguards (speaker from authentication only, request key,
--      words stored whole, said-on clocks, supersede or withdraw, private by default, unsigned) plus the vehicle (the
--      speaker must be tied to it by the rule the readers use), a speaker_role from a closed list ('owner' only when the
--      vehicles row names the speaker as owner), a statement_kind (assertion, estimate, recollection) and an optional
--      target property key with a text value.
--   2. vehicle_statement_links: the vehicle <-> statement pointer. The fact-log row itself keeps vehicle_id NULL. That is
--      deliberate: 36 anonymous-executable definer functions read vehicle_observations by vehicle_id and bypass row
--      security, so a row carrying the words (which can carry an amount) under a vehicle_id would reach readers nobody
--      reviewed. A vehicle-less row is invisible to them, as owner statements already are. The links table has row
--      security on, no policy and no grant: only the writer and the reader below touch it.
--   3. vehicle_statements(uuid): the page reader. Tied viewers (the vehicle_build_reconstruction rule) get the words;
--      everyone else gets role, kind, said-on date, the registered key's label and, for a registered key that is not
--      private, the value. A cost, price or amount, and every estimate, shows only "amount private". The quote is never
--      returned to anyone but a tied viewer, because a quote can contain the figure.
--   4. Admission, update-guard and delete-guard triggers and one restrictive read policy for the new method, so only the
--      writer admits these rows and only the speaker reads them raw.
--
-- Target keys and approval. A statement may name a target key before the key is registered: it is stored as words with
-- target_status 'pending'. Nothing is rewritten when the key is later ratified (observation_properties.ratified_at);
-- the reader resolves the key at read time, so the statement becomes a keyed claim the moment its key is approved.
-- No property_id is set: a statement never enters vehicle_canonical or any fold, and it is labelled class 'claim', so it
-- cannot outrank a document or a photo reading.
--
-- Not changed here: vehicle_facet_items (another branch is patching it). Its follow-up mapping: read current
-- vehicle_statements rows for key rear_axle_type as class 'claim' on drivetrain.axle.current.type, ranked below
-- receipt and reading, and show no private value.
-- Contract: supabase/sql/test_vehicle_statements.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 0. Registry row for the producer -----------------------------------------------------------------------------
INSERT INTO public.observation_extractors (source_id, slug, display_name, extractor_type, extractor_config, produces_kinds)
SELECT s.id, 'vehicle-statement-v1', 'Vehicle statement, transcribed whole (unsigned claim)', 'rule_based',
  '{"extraction_method":"vehicle_statement_v1","writer":"record_vehicle_statement","reader":"vehicle_statements","private":true,"interprets":false,"sign":"none","class":"claim"}'::jsonb,
  ARRAY[]::public.observation_kind[]
FROM public.observation_sources s WHERE s.slug = 'owner-input'
ON CONFLICT (slug) DO NOTHING;

-- 1. The vehicle <-> statement pointer --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_statement_links (
  statement_id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  speaker_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_statement_links_vehicle_idx ON public.vehicle_statement_links (vehicle_id);
ALTER TABLE public.vehicle_statement_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vehicle_statement_links FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.vehicle_statement_links IS
  'Which vehicle a vehicle_statement_v1 observation is about. Written only by record_vehicle_statement, read only by vehicle_statements. No policy and no grant on purpose: the observation row keeps vehicle_id NULL so definer readers by vehicle never meet it.';

-- 2. Whether a value is private ----------------------------------------------------------------------------------
-- Any cost, price or amount, and every estimate, is private. Judged on the key text, the registered data type and unit.
CREATE OR REPLACE FUNCTION public.vehicle_statement_value_is_private(p_key text, p_kind text, p_data_type text, p_unit text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT p_kind = 'estimate'
      OR coalesce(p_key, '') ~* '(cost|price|amount|usd|paid|spend|spent|budget|dollar|payment|fee)'
      OR coalesce(p_unit, '') ~* '(usd|\$|dollar|eur|cent)'
$fn$;
REVOKE ALL ON FUNCTION public.vehicle_statement_value_is_private(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vehicle_statement_value_is_private(text, text, text, text) TO authenticated, service_role;

-- 3. The writer ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_vehicle_statement(
  p_request_id uuid, p_vehicle_id uuid, p_statement text, p_speaker_role text, p_statement_kind text,
  p_said_at_basis text, p_recording_agent text,
  p_said_on date DEFAULT NULL, p_said_at timestamptz DEFAULT NULL,
  p_target_key text DEFAULT NULL, p_target_value text DEFAULT NULL,
  p_supersedes uuid DEFAULT NULL, p_conversation_ref text DEFAULT NULL, p_withdraw boolean DEFAULT false,
  p_credential text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' SET "TimeZone" = 'UTC' AS $fn$
DECLARE
  who record; v_speaker uuid; v_source_id uuid; v_trust numeric; v_extractor uuid; v_id uuid := gen_random_uuid();
  v_hash text; v_withdraw boolean := coalesce(p_withdraw, false);
  v_veh record; v_prop record; v_target_status text := 'none'; v_private boolean := false;
  v_digest text; payload jsonb; v_observed timestamptz; v_basis text; v_precision text; v_recorded timestamptz;
  old public.vehicle_observations%ROWTYPE; previous public.vehicle_observations%ROWTYPE;
BEGIN
  SELECT * INTO who FROM public.owner_statement_caller(p_credential, true);
  v_speaker := who.speaker;
  IF v_speaker IS NULL THEN
    RAISE EXCEPTION 'an authenticated speaker is required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'a request key and a vehicle are required' USING ERRCODE = '23514';
  END IF;
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
  IF p_speaker_role IS NULL OR p_speaker_role NOT IN ('owner', 'representative', 'seller_agent', 'shop', 'previous_owner') THEN
    RAISE EXCEPTION 'speaker_role is one of owner, representative, seller_agent, shop, previous_owner' USING ERRCODE = '23514';
  END IF;
  IF p_statement_kind IS NULL OR p_statement_kind NOT IN ('assertion', 'estimate', 'recollection') THEN
    RAISE EXCEPTION 'statement_kind is one of assertion, estimate, recollection' USING ERRCODE = '23514';
  END IF;
  IF p_said_on IS NOT NULL AND p_said_at IS NOT NULL THEN
    RAISE EXCEPTION 'give the said-at as a day or as an instant, not both' USING ERRCODE = '23514';
  END IF;
  IF (p_said_on IS NOT NULL AND (NOT isfinite(p_said_on) OR p_said_on > ((now() + interval '14 hours') AT TIME ZONE 'UTC')::date))
     OR (p_said_at IS NOT NULL AND (NOT isfinite(p_said_at) OR p_said_at > now() + interval '5 minutes')) THEN
    RAISE EXCEPTION 'the said-at time cannot be in the future' USING ERRCODE = '23514';
  END IF;
  IF (p_target_key IS NULL) <> (p_target_value IS NULL) THEN
    RAISE EXCEPTION 'a target is a key and its value together, or neither' USING ERRCODE = '23514';
  END IF;
  IF p_target_key IS NOT NULL AND (p_target_key !~ '^[a-z][a-z0-9_]{0,63}$' OR length(p_target_value) > 500) THEN
    RAISE EXCEPTION 'target key is lower_snake_case; target value at most 500 characters' USING ERRCODE = '23514';
  END IF;
  IF v_withdraw AND (p_supersedes IS NULL OR p_target_key IS NOT NULL) THEN
    RAISE EXCEPTION 'a withdrawal names the statement it withdraws and carries no target' USING ERRCODE = '23514';
  END IF;

  -- The vehicle, and the speaker's tie to it by the rule the readers use (vehicle_build_reconstruction).
  SELECT v.id, v.owner_id INTO v_veh FROM public.vehicles v
   WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'an identified, current vehicle is required' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id
       AND (v.user_id = v_speaker OR v.owner_id = v_speaker OR v.uploaded_by = v_speaker
            OR public.vehicle_user_has_access(v.id, v_speaker))) THEN
    RAISE EXCEPTION 'the speaker has no access to this vehicle' USING ERRCODE = '42501';
  END IF;
  -- "owner" only when the vehicle record names the speaker as owner; every other role is as stated, never inferred.
  IF p_speaker_role = 'owner' AND v_veh.owner_id IS DISTINCT FROM v_speaker THEN
    RAISE EXCEPTION 'speaker_role owner requires the vehicle record to name the speaker as owner' USING ERRCODE = '42501';
  END IF;

  -- The target key: registered and ratified, or pending approval. A registered key types its value.
  IF p_target_key IS NOT NULL THEN
    SELECT p.property_key, p.data_type, p.unit INTO v_prop FROM public.observation_properties p
     WHERE p.property_key = p_target_key AND p.ratified_at IS NOT NULL AND p.deprecated_at IS NULL;
    IF FOUND THEN
      v_target_status := 'registered';
      IF (v_prop.data_type = 'numeric' AND NOT pg_input_is_valid(p_target_value, 'numeric'))
         OR (v_prop.data_type = 'boolean' AND NOT pg_input_is_valid(p_target_value, 'boolean'))
         OR (v_prop.data_type = 'uuid_ref' AND NOT pg_input_is_valid(p_target_value, 'uuid')) THEN
        RAISE EXCEPTION 'the target value does not match the registered type of %', p_target_key USING ERRCODE = '23514';
      END IF;
      v_private := public.vehicle_statement_value_is_private(p_target_key, p_statement_kind, v_prop.data_type, v_prop.unit);
    ELSE
      v_target_status := 'pending';
      v_private := public.vehicle_statement_value_is_private(p_target_key, p_statement_kind, NULL, NULL);
    END IF;
  ELSE
    v_private := p_statement_kind = 'estimate';
  END IF;

  SELECT s.id, s.base_trust_score INTO v_source_id, v_trust FROM public.observation_sources s WHERE s.slug = 'owner-input';
  IF v_source_id IS NULL THEN RAISE EXCEPTION 'owner input source unavailable'; END IF;
  SELECT x.id INTO v_extractor FROM public.observation_extractors x WHERE x.slug = 'vehicle-statement-v1';

  IF p_said_at IS NOT NULL THEN
    v_observed := p_said_at; v_basis := 'event_time'; v_precision := 'exact';
  ELSIF p_said_on IS NOT NULL THEN
    v_observed := now(); v_basis := 'source_capture_time'; v_precision := 'day';
  ELSE
    v_observed := now(); v_basis := 'source_capture_time'; v_precision := 'unknown';
  END IF;

  v_hash := md5('vehicle-statement:' || v_speaker::text || ':' || p_request_id::text);
  v_digest := md5(jsonb_build_object('vehicle', p_vehicle_id, 'statement', p_statement, 'role', p_speaker_role,
    'kind', p_statement_kind, 'said_on', p_said_on, 'said_at', extract(epoch FROM p_said_at),
    'key', p_target_key, 'value', p_target_value, 'supersedes', p_supersedes, 'withdraw', v_withdraw)::text);
  payload := jsonb_build_object(
    'claim_contract', 'vehicle_statement_v1',
    'speaker_user_id', v_speaker,
    'vehicle_id', p_vehicle_id,
    'speaker_role', p_speaker_role,
    'statement_kind', p_statement_kind,
    'class', 'claim',
    'target_key', p_target_key,
    'target_value', p_target_value,
    'target_status_at_write', v_target_status,
    'value_private', v_private,
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

  PERFORM pg_advisory_xact_lock(hashtextextended('vehicle-statement-speaker:' || v_speaker::text, 0));
  SELECT * INTO old FROM public.vehicle_observations o
   WHERE o.source_id = v_source_id AND o.source_identifier = p_request_id::text AND o.content_hash = v_hash LIMIT 1;
  IF FOUND THEN
    IF old.structured_data->>'request_digest' IS DISTINCT FROM v_digest THEN
      RAISE EXCEPTION 'request key reused with different content' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object('statement_id', old.id, 'recorded_at', old.ingested_at, 'replay', true,
      'sign_status', 'unsigned', 'target_status', old.structured_data->>'target_status_at_write');
  END IF;

  IF p_supersedes IS NOT NULL THEN
    SELECT * INTO previous FROM public.vehicle_observations
     WHERE id = p_supersedes AND submitted_by_user_id = v_speaker AND extraction_method = 'vehicle_statement_v1'
     FOR UPDATE;
    IF NOT FOUND OR previous.is_superseded IS TRUE
       OR NOT EXISTS (SELECT 1 FROM public.vehicle_statement_links l
                      WHERE l.statement_id = previous.id AND l.vehicle_id = p_vehicle_id) THEN
      RAISE EXCEPTION 'preceding statement missing, already superseded, another speaker''s or about another vehicle'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF (SELECT count(*) FROM public.vehicle_observations o
       WHERE o.submitted_by_user_id = v_speaker AND o.extraction_method = 'vehicle_statement_v1'
         AND o.ingested_at > now() - interval '1 hour') >= 120 THEN
    RAISE EXCEPTION 'too many statements in the last hour; try again later' USING ERRCODE = '54000';
  END IF;

  PERFORM set_config('nuke.vehicle_statement_writer', v_id::text, true);
  INSERT INTO public.vehicle_observations (
    id, vehicle_id, subject_type, subject_id, source_id, source_identifier, observed_at, observed_at_basis,
    source_event_at, source_event_date, source_event_time_precision, content_text, content_hash, structured_data,
    submitted_by_user_id, observer_raw, extraction_method, kind, confidence_score, extractor_id, is_processed
  ) VALUES (
    v_id, NULL, 'user', v_speaker, v_source_id, p_request_id::text, v_observed, v_basis,
    CASE WHEN v_precision = 'exact' THEN p_said_at END, CASE WHEN v_precision = 'day' THEN p_said_on END, v_precision,
    p_statement, v_hash, payload, v_speaker,
    jsonb_build_object('user_id', v_speaker, 'recording_agent', p_recording_agent),
    'vehicle_statement_v1', 'provenance'::public.observation_kind, v_trust, v_extractor, true
  ) RETURNING ingested_at INTO v_recorded;
  PERFORM set_config('nuke.vehicle_statement_writer', '', true);
  INSERT INTO public.vehicle_statement_links (statement_id, vehicle_id, speaker_user_id) VALUES (v_id, p_vehicle_id, v_speaker);

  IF p_supersedes IS NOT NULL THEN
    UPDATE public.vehicle_observations
       SET is_superseded = true, superseded_by = v_id, superseded_at = now(),
           lineage_chain = array_append(coalesce(lineage_chain, ARRAY[]::uuid[]), v_id)
     WHERE id = p_supersedes;
  END IF;
  RETURN jsonb_build_object('statement_id', v_id, 'recorded_at', v_recorded, 'replay', false,
    'sign_status', 'unsigned', 'target_status', v_target_status);
END $fn$;
REVOKE ALL ON FUNCTION public.record_vehicle_statement(uuid, uuid, text, text, text, text, text, date, timestamptz, text, text, uuid, text, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_vehicle_statement(uuid, uuid, text, text, text, text, text, date, timestamptz, text, text, uuid, text, boolean, text)
  TO authenticated, service_role;

-- 4. The page reader ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vehicle_statements(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'pg_catalog', 'public' AS $fn$
  WITH v AS (
    SELECT v.id,
           (auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid() OR v.owner_id = auth.uid()
             OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid())))) IS TRUE AS tied
      FROM public.vehicles v
     WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
       AND (v.is_public IS TRUE OR auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid()
            OR v.owner_id = auth.uid() OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid()))))),
  s AS (
    SELECT o.id, o.content_text, o.structured_data AS sd, o.ingested_at,
           coalesce(o.source_event_date, o.source_event_at::date, o.observed_at::date) AS said_on,
           p.property_key AS reg_key, p.label AS reg_label, p.data_type AS reg_type, p.unit AS reg_unit
      FROM v
      JOIN public.vehicle_statement_links l ON l.vehicle_id = v.id
      JOIN public.vehicle_observations o ON o.id = l.statement_id
      LEFT JOIN public.observation_properties p ON p.property_key = o.structured_data->>'target_key'
           AND p.ratified_at IS NOT NULL AND p.deprecated_at IS NULL
     WHERE o.extraction_method = 'vehicle_statement_v1' AND o.is_superseded IS NOT TRUE AND o.superseded_by IS NULL
       AND coalesce((o.structured_data->>'withdrawal')::boolean, false) IS NOT TRUE
  ), r AS (
    SELECT s.*, (s.sd->>'value_private')::boolean IS TRUE
                OR public.vehicle_statement_value_is_private(s.sd->>'target_key', s.sd->>'statement_kind', s.reg_type, s.reg_unit) AS priv
      FROM s
  )
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'tied', coalesce((SELECT tied FROM v), false),
    'rule', 'A statement is a person''s own claim, recorded whole and unsigned. It never outranks a document or a photo reading. Words and private values are shown only to people tied to the vehicle.',
    'statements', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'statement_id', CASE WHEN (SELECT tied FROM v) THEN r.id END,
        'class', 'claim',
        'speaker_role', r.sd->>'speaker_role',
        'statement_kind', r.sd->>'statement_kind',
        'said_on', r.said_on,
        'recorded_at', r.ingested_at,
        'target_status', CASE WHEN r.sd->>'target_key' IS NULL THEN 'none' WHEN r.reg_key IS NOT NULL THEN 'registered' ELSE 'pending' END,
        'target_label', r.reg_label,
        'target_key', CASE WHEN (SELECT tied FROM v) THEN r.sd->>'target_key' END,
        'value', CASE WHEN r.reg_key IS NOT NULL AND NOT r.priv OR ((SELECT tied FROM v) AND r.sd->>'target_key' IS NOT NULL)
                      THEN r.sd->>'target_value' END,
        'value_note', CASE WHEN r.sd->>'target_key' IS NOT NULL AND r.priv AND NOT (SELECT tied FROM v) THEN 'amount private' END,
        'words', CASE WHEN (SELECT tied FROM v) THEN r.content_text END)
      ORDER BY r.said_on DESC, r.ingested_at DESC) FROM r), '[]'::jsonb))
  WHERE EXISTS (SELECT 1 FROM v)
$fn$;
REVOKE ALL ON FUNCTION public.vehicle_statements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_statements(uuid) TO anon, authenticated, service_role;

-- 5. Only the speaker reads the raw rows; immutable; only the writer admits them -----------------------------------
DROP POLICY IF EXISTS vehicle_statement_private_read ON public.vehicle_observations;
CREATE POLICY vehicle_statement_private_read ON public.vehicle_observations AS RESTRICTIVE
FOR SELECT TO anon, authenticated USING (
  extraction_method IS DISTINCT FROM 'vehicle_statement_v1'
  OR submitted_by_user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_vehicle_statement_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  open_cols text[] := ARRAY['is_superseded', 'superseded_by', 'superseded_at', 'lineage_chain',
                            'is_processed', 'processing_metadata'];
BEGIN
  IF (to_jsonb(NEW) - open_cols) IS DISTINCT FROM (to_jsonb(OLD) - open_cols) THEN
    RAISE EXCEPTION 'a vehicle statement row is immutable; append a successor' USING ERRCODE = '23514';
  END IF;
  IF OLD.is_superseded IS TRUE AND (NEW.is_superseded IS NOT TRUE
      OR NEW.superseded_by IS DISTINCT FROM OLD.superseded_by OR NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'vehicle statement row already superseded' USING ERRCODE = '23514';
  END IF;
  IF NEW.is_superseded IS TRUE AND OLD.is_superseded IS NOT TRUE AND NOT EXISTS (
       SELECT 1 FROM public.vehicle_observations n WHERE n.id = NEW.superseded_by AND n.id <> OLD.id
         AND n.extraction_method = OLD.extraction_method AND n.submitted_by_user_id = OLD.submitted_by_user_id
         AND n.structured_data->>'supersedes' = OLD.id::text) THEN
    RAISE EXCEPTION 'a vehicle statement row is superseded only by its successor' USING ERRCODE = '23514';
  END IF;
  IF NEW.is_superseded IS NOT TRUE AND (NEW.superseded_by IS NOT NULL OR NEW.superseded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a vehicle statement row is superseded only by its successor' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.guard_vehicle_statement_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  RAISE EXCEPTION 'a vehicle statement row is never deleted; withdraw it with a successor' USING ERRCODE = '23514';
END $fn$;
DROP TRIGGER IF EXISTS trg_guard_vehicle_statement_delete ON public.vehicle_observations;
CREATE TRIGGER trg_guard_vehicle_statement_delete BEFORE DELETE ON public.vehicle_observations
FOR EACH ROW WHEN (OLD.extraction_method = 'vehicle_statement_v1')
EXECUTE FUNCTION public.guard_vehicle_statement_delete();
DROP TRIGGER IF EXISTS trg_guard_vehicle_statement_update ON public.vehicle_observations;
CREATE TRIGGER trg_guard_vehicle_statement_update BEFORE UPDATE ON public.vehicle_observations
FOR EACH ROW WHEN (OLD.extraction_method = 'vehicle_statement_v1' OR NEW.extraction_method = 'vehicle_statement_v1')
EXECUTE FUNCTION public.guard_vehicle_statement_update();

CREATE OR REPLACE FUNCTION public.admit_vehicle_statement()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  sd jsonb := NEW.structured_data;
BEGIN
  IF NEW.extraction_method IS DISTINCT FROM 'vehicle_statement_v1'
     OR sd->>'claim_contract' IS DISTINCT FROM 'vehicle_statement_v1'
     -- Set by the writer for exactly this row, in this transaction; the insert runs as the writer's owner.
     OR nullif(current_setting('nuke.vehicle_statement_writer', true), '') IS DISTINCT FROM NEW.id::text
     OR current_user <> (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p
          WHERE p.oid = 'public.record_vehicle_statement(uuid,uuid,text,text,text,text,text,date,timestamptz,text,text,uuid,text,boolean,text)'::regprocedure)
     OR NEW.vehicle_id IS NOT NULL OR NEW.property_id IS NOT NULL
     OR NEW.submitted_by_user_id IS NULL
     OR sd->>'speaker_user_id' IS DISTINCT FROM NEW.submitted_by_user_id::text
     OR sd->>'sign_status' IS DISTINCT FROM 'unsigned'
     OR sd->'is_public' IS DISTINCT FROM 'false'::jsonb
     OR sd->>'class' IS DISTINCT FROM 'claim'
     OR sd->>'speaker_role' NOT IN ('owner', 'representative', 'seller_agent', 'shop', 'previous_owner')
     OR sd->>'statement_kind' NOT IN ('assertion', 'estimate', 'recollection')
     OR NEW.source_identifier IS NULL OR NEW.content_text IS NULL
     OR NEW.is_superseded IS TRUE OR NEW.superseded_by IS NOT NULL
     OR NEW.subject_type IS DISTINCT FROM 'user' OR NEW.subject_id IS DISTINCT FROM NEW.submitted_by_user_id
     OR NEW.subject_organization_id IS NOT NULL
     OR NEW.content_hash IS DISTINCT FROM md5('vehicle-statement:' || NEW.submitted_by_user_id::text || ':' || NEW.source_identifier)
     OR NOT EXISTS (SELECT 1 FROM public.observation_sources s WHERE s.id = NEW.source_id AND s.slug = 'owner-input') THEN
    RAISE EXCEPTION 'a vehicle statement is admitted only through its writer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_admit_vehicle_statement ON public.vehicle_observations;
CREATE TRIGGER trg_admit_vehicle_statement BEFORE INSERT ON public.vehicle_observations
FOR EACH ROW WHEN (NEW.extraction_method = 'vehicle_statement_v1' OR NEW.structured_data->>'claim_contract' = 'vehicle_statement_v1')
EXECUTE FUNCTION public.admit_vehicle_statement();

-- 6. Private rows are not public contributions ---------------------------------------------------------------------
-- profile_stats.total_contributions is anon-readable. Add the new method to the live exclusion list, reading the live
-- definition so nothing else in it is restated here; a definition without the list is left alone.
DO $$
DECLARE
  def text;
  needle constant text := '''garage_owner_correction_v1'')';
BEGIN
  IF to_regprocedure('public.recompute_profile_stats(uuid)') IS NULL THEN RETURN; END IF;
  def := pg_get_functiondef('public.recompute_profile_stats(uuid)'::regprocedure);
  IF position('vehicle_statement_v1' IN def) > 0 THEN RETURN; END IF;
  IF position(needle IN def) = 0 THEN
    RAISE NOTICE 'recompute_profile_stats has no private-method list; left unchanged';
    RETURN;
  END IF;
  EXECUTE replace(def, needle, '''garage_owner_correction_v1'', ''vehicle_statement_v1'')');
END $$;

-- 7. The database describes itself ----------------------------------------------------------------------------------
COMMENT ON FUNCTION public.record_vehicle_statement(uuid, uuid, text, text, text, text, text, date, timestamptz, text, text, uuid, text, boolean, text) IS
  'Sanctioned writer. Stores one statement a person said about a vehicle, whole and uninterpreted, as a private unsigned claim (extraction_method vehicle_statement_v1, source owner-input, vehicle_id NULL on the row, the vehicle on vehicle_statement_links). Speaker from authentication only; must be tied to the vehicle; speaker_role owner only when the vehicle record names the speaker as owner. Optional target key + value: pending until the key is ratified. Supersede or withdraw by successor.';
COMMENT ON FUNCTION public.vehicle_statements(uuid) IS
  'Page reader for a vehicle''s current statements. Tied viewers see the words; others see role, kind, said-on date, the registered key''s label and a non-private value; a cost, price, amount or estimate shows only "amount private". Never returns a name.';
COMMENT ON POLICY vehicle_statement_private_read ON public.vehicle_observations IS
  'Vehicle-statement rows are read raw by the speaker only; the page reads them through vehicle_statements. 2026-11-20.';

COMMIT;
