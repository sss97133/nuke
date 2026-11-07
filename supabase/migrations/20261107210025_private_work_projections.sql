BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- Owner-private, append-only projections of image-derived timeline observations and invoice-vs-photo labor
-- reconciliation. Account scope only (owner_id = the authenticated account); this table grants nothing about vehicle
-- ownership. Photo evidence is never turned into billable hours, verified work, payment or ownership here: the payload
-- contract below refuses those claims. Rows are never updated or deleted; a correction is a new revision that names the
-- current head (supersedes_id), and a source privacy hold can never be cleared by a later revision.
-- Writer: ingest_private_work_projection (service role, reached only through ingest-observation financial_evidence_v1
-- actions that derive the account from the caller's credential). No public timeline_events / work_sessions row is touched.

CREATE TABLE public.private_work_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  projection_kind text NOT NULL CHECK (projection_kind IN ('image_timeline_event', 'labor_reconciliation')),
  projection_key text NOT NULL CHECK (projection_key ~ '^[a-f0-9]{16,64}$'),
  revision_no integer NOT NULL CHECK (revision_no >= 1),
  supersedes_id uuid REFERENCES public.private_work_projections(id),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 300),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  producer text NOT NULL CHECK (char_length(producer) BETWEEN 1 AND 120),
  method text NOT NULL CHECK (char_length(method) BETWEEN 1 AND 120),
  version text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 120),
  run_label text NOT NULL CHECK (char_length(run_label) BETWEEN 1 AND 120),
  source_privacy_hold boolean NOT NULL,
  holds jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(holds) = 'array' AND jsonb_array_length(holds) <= 40),
  evidence_refs jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array' AND jsonb_array_length(evidence_refs) BETWEEN 1 AND 200),
  financial_document_id uuid REFERENCES public.financial_documents(id),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 24000),
  privacy_tier text NOT NULL DEFAULT 'private' CHECK (privacy_tier = 'private'),
  actor_user_id uuid NOT NULL,
  auth_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((revision_no = 1) = (supersedes_id IS NULL)),
  CHECK (projection_kind <> 'labor_reconciliation' OR financial_document_id IS NOT NULL),
  UNIQUE (owner_id, idempotency_key),
  UNIQUE (owner_id, projection_key, revision_no),
  UNIQUE (supersedes_id)
);
COMMENT ON TABLE public.private_work_projections IS
  'Owner-private append-only image-derived timeline observations and labor reconciliation projections. Account scope, not vehicle ownership. Photo evidence is never billable hours, verified work, payment or ownership. Not for public timeline_events/work_sessions.';
COMMENT ON COLUMN public.private_work_projections.owner_id IS 'Authorized account (server-derived), not a vehicle owner.';
COMMENT ON COLUMN public.private_work_projections.projection_key IS 'Stable identity of the subject across revisions (hash of cited evidence, never of a title).';
COMMENT ON COLUMN public.private_work_projections.supersedes_id IS 'Previous revision of the same projection_key; the head is the row nothing supersedes.';
COMMENT ON COLUMN public.private_work_projections.source_privacy_hold IS 'Sticky: once true, no later revision may set it false.';
COMMENT ON COLUMN public.private_work_projections.evidence_refs IS 'Exact immutable refs: image sha256, source message origin key, attachment sha256, financial document revision (document, run, original sha256).';
COMMENT ON COLUMN public.private_work_projections.payload IS 'Bounded typed projection (claim, observed clusters, holds, rate provenance, conflicts); no raw mail body, OCR, person or bank data.';

CREATE INDEX private_work_projections_owner_key_idx ON public.private_work_projections(owner_id, projection_key, revision_no DESC);
CREATE INDEX private_work_projections_financial_document_idx ON public.private_work_projections(financial_document_id) WHERE financial_document_id IS NOT NULL;

ALTER TABLE public.private_work_projections ENABLE ROW LEVEL SECURITY;   -- no policy: default deny for every non-bypass role
REVOKE ALL ON public.private_work_projections FROM PUBLIC, anon, authenticated, service_role;   -- also undoes platform default grants
GRANT SELECT, INSERT ON public.private_work_projections TO service_role;  -- never UPDATE, DELETE or TRUNCATE

-- Account admission without widening the service role. Deployed fact (read-only privilege probe, 2026-11-07): service_role has
-- USAGE on schema auth and extensions, SELECT on financial_documents and EXECUTE on extensions.digest, but NO SELECT on auth.users.
-- The invoker functions below therefore never read auth.users. The one account read lives in a NEW dedicated schema that is not in
-- the API's exposed schemas (supabase/config.toml: public, graphql_public), so PostgREST does not publish it as an RPC. Every function in
-- public stays SECURITY INVOKER; this migration creates no SECURITY DEFINER object in public. The helper answers one boolean for one
-- uuid, only for a service_role session, like the deployed ingest_financial_evidence does as its owner. No existing schema ACL is changed.
CREATE SCHEMA private_work_internal;
REVOKE ALL ON SCHEMA private_work_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private_work_internal TO service_role;   -- usage on this schema only, nothing on auth.users
CREATE FUNCTION private_work_internal.account_ok(p_owner uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(auth.role(), '') = 'service_role' AND p_owner IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = p_owner AND u.deleted_at IS NULL AND u.is_anonymous IS NOT TRUE
      AND (u.banned_until IS NULL OR u.banned_until <= pg_catalog.now()))
$$;
REVOKE ALL ON FUNCTION private_work_internal.account_ok(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_work_internal.account_ok(uuid) TO service_role;

-- Registered producer route. A new producer or version is a new migration (reviewed), never caller free text.
-- Mirrors scripts/client_evidence/projection.py PRODUCER / METHOD / VERSION (parity is tested).
CREATE FUNCTION public.private_work_producer_registered(p_producer text, p_method text, p_version text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((p_producer, p_method, p_version) IN (
    -- parity:producer_registry
    ('client_evidence_projector', 'image_labor_projection', '2026-11-07a')), false)
$$;
REVOKE ALL ON FUNCTION public.private_work_producer_registered(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_work_producer_registered(text, text, text) TO service_role;

-- Closed key sets per payload object. Mirrored by scripts/client_evidence/projection.py ALLOWED_KEYS (parity is tested).
CREATE FUNCTION public.private_work_allowed_keys(p_name text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_name
    -- parity:allowed_keys
    WHEN 'image' THEN ARRAY['event_key', 'stance', 'time', 'capture', 'identity', 'origin_class', 'intent', 'assertion_status', 'completed_work_asserted', 'subject_vehicle_ref']
    WHEN 'image_time' THEN ARRAY['kind', 'basis', 'camera_local', 'utc']
    WHEN 'image_capture' THEN ARRAY['source', 'offset_state', 'camera_local', 'utc']
    WHEN 'image_identity' THEN ARRAY['state', 'basis']
    WHEN 'labor' THEN ARRAY['reconciliation_key', 'claim', 'observed', 'holds', 'rate_provenance', 'conflicts', 'relation', 'additive', 'billable_hours', 'hours_verified']
    WHEN 'labor_claim' THEN ARRAY['claimed_hours', 'computed_labor', 'source_claim', 'verified', 'service_period', 'categories']
    WHEN 'labor_category' THEN ARRAY['category', 'hours', 'rate', 'amount', 'rate_source']
    WHEN 'labor_period' THEN ARRAY['start', 'end']
    WHEN 'labor_observed' THEN ARRAY['status', 'window', 'observed_days', 'observed_day_count', 'frames_in_scope', 'clusters', 'camera_local_review', 'hours_lower', 'hours_lower_exact_seconds', 'note']
    WHEN 'labor_cluster' THEN ARRAY['start', 'end', 'frames', 'capped', 'single_frame']
    WHEN 'labor_local_review' THEN ARRAY['clock_offset', 'days']
    WHEN 'labor_local_day' THEN ARRAY['camera_local_day', 'frames', 'first_local', 'last_local']
    WHEN 'labor_holds' THEN ARRAY['unknown_clock', 'other_vehicle', 'identity_not_confirmed', 'identity_context_only', 'excluded_origin', 'no_trusted_capture_time', 'implausible_clock', 'before_service_window', 'after_service_window', 'outside_vehicle_date_range', 'non_install_intent', 'intent_unclassified', 'intent_not_billable']
    WHEN 'labor_rate' THEN ARRAY['category', 'rate', 'rate_source']
    ELSE ARRAY[]::text[] END
$$;
REVOKE ALL ON FUNCTION public.private_work_allowed_keys(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_work_allowed_keys(text) TO service_role;

-- True only for a JSON object whose keys are all in the named closed set. NULL input is false (fail closed).
CREATE FUNCTION public.private_work_keys_within(j jsonb, p_name text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN jsonb_typeof(j) = 'object'   -- CASE orders the evaluation: jsonb_object_keys raises on a non-object
              THEN NOT EXISTS (SELECT 1 FROM jsonb_object_keys(j) k WHERE k <> ALL (public.private_work_allowed_keys(p_name)))
              ELSE false END
$$;
REVOKE ALL ON FUNCTION public.private_work_keys_within(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_work_keys_within(jsonb, text) TO service_role;

-- Keys whose value may be a nested object or array, per closed object. Every other value must be a JSON scalar, so a leaf cannot
-- smuggle a nested object. Mirrored by scripts/client_evidence/projection.py CONTAINER_KEYS (parity is tested).
CREATE FUNCTION public.private_work_container_keys(p_name text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_name
    -- parity:container_keys
    WHEN 'image' THEN ARRAY['time', 'capture', 'identity']
    WHEN 'labor' THEN ARRAY['claim', 'observed', 'holds', 'rate_provenance', 'conflicts']
    WHEN 'labor_claim' THEN ARRAY['service_period', 'categories']
    WHEN 'labor_observed' THEN ARRAY['window', 'observed_days', 'clusters', 'camera_local_review']
    WHEN 'labor_local_review' THEN ARRAY['days']
    ELSE ARRAY[]::text[] END
$$;
REVOKE ALL ON FUNCTION public.private_work_container_keys(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_work_container_keys(text) TO service_role;

-- Closed key set AND scalar leaves: only the named containers may be objects or arrays. NULL input is false (fail closed).
CREATE FUNCTION public.private_work_closed_scalar(j jsonb, p_name text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT public.private_work_keys_within(j, p_name) AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(j) = 'object' THEN j ELSE '{}'::jsonb END) e
    WHERE e.key <> ALL (public.private_work_container_keys(p_name)) AND jsonb_typeof(e.value) IN ('object', 'array'))
$$;
REVOKE ALL ON FUNCTION public.private_work_closed_scalar(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_work_closed_scalar(jsonb, text) TO service_role;

-- Content scan shared by the trigger: credentials, raw text carriers, bank identifiers, e-mail addresses, and any key that
-- would assert verified hours, payment or ownership. Returns the first problem or NULL.
CREATE FUNCTION public.private_work_payload_problem(j jsonb) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v jsonb; k text; s text;
BEGIN
  FOR v IN SELECT jsonb_path_query(j, 'strict $.**') LOOP
    IF jsonb_typeof(v) = 'object' THEN
      FOR k IN SELECT jsonb_object_keys(v) LOOP
        -- parity:forbidden_keys
        IF lower(k) IN ('ocr_text','raw_text','full_text','full_ocr','body','body_text','html','snippet','iban','bank_iban','full_iban',
                        'email','phone','person_name','image_bytes','photo','face',
                        'verified_hours','billable_hours_verified','total_hours','combined_hours','sum_hours','payment_verified',
                        'ownership_verified','owner_verified','vehicle_owner','co_owner','coowner')
           OR lower(k) ~ '(token|password|secret|authorization|cookie|credential|api_?key)'
           OR lower(k) ~ '(actual|worked|paid|payment|billable|photo_hours)' THEN   -- no key may present a claim as hours worked or paid
          RETURN 'forbidden key ' || k;
        END IF;
      END LOOP;
    ELSIF jsonb_typeof(v) = 'string' THEN
      s := v #>> '{}';
      IF length(s) > 500 THEN RETURN 'oversized text'; END IF;
      IF s ~ '[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}' THEN RETURN 'bank identifier'; END IF;
      IF s ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}' THEN RETURN 'e-mail address'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.private_work_payload_problem(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_work_payload_problem(jsonb) TO service_role;

-- Immutability for everyone, including the service role: a correction is a new revision.
CREATE FUNCTION public.private_work_projection_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'private work projections are append-only; supersede with a new revision' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.private_work_projection_immutable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER private_work_projections_append_only BEFORE UPDATE OR DELETE ON public.private_work_projections
  FOR EACH ROW EXECUTE FUNCTION public.private_work_projection_immutable();
CREATE TRIGGER private_work_projections_no_truncate BEFORE TRUNCATE ON public.private_work_projections
  FOR EACH STATEMENT EXECUTE FUNCTION public.private_work_projection_immutable();

-- Typed payload contract. Fail closed: every condition is positive and a NULL (missing key, wrong JSON type) is a refusal, never a
-- pass. Returns the first problem or NULL. Mirrored by scripts/client_evidence/projection.py check_item (parity is tested).
CREATE FUNCTION public.private_work_contract_problem(p_kind text, p jsonb, p_hold boolean) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE ok boolean; cap jsonb; st text; e jsonb; v jsonb;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN 'projection payload must be an object'; END IF;
  IF p_kind = 'image_timeline_event' THEN
    IF public.private_work_closed_scalar(p, 'image') IS NOT TRUE THEN RETURN 'image timeline payload has unknown keys'; END IF;
    ok := (p ?& ARRAY['event_key', 'stance', 'time', 'capture', 'identity', 'origin_class', 'intent', 'assertion_status', 'completed_work_asserted'])
      AND p->'stance' = '"visual_observed"'::jsonb
      AND p->'completed_work_asserted' = 'false'::jsonb               -- the JSON boolean false, not the string "false"
      AND jsonb_typeof(p->'event_key') = 'string' AND jsonb_typeof(p->'origin_class') = 'string' AND jsonb_typeof(p->'intent') = 'string'
      AND jsonb_typeof(p->'assertion_status') = 'string' AND (p->>'assertion_status') IN ('observation_unverified', 'held')
      AND public.private_work_closed_scalar(p->'identity', 'image_identity') AND (p->'identity') ? 'state'
      AND jsonb_typeof(p->'identity'->'state') = 'string' AND (p->'identity'->>'state') IN ('confirmed', 'unconfirmed', 'context_only', 'unknown')
      AND public.private_work_closed_scalar(p->'capture', 'image_capture') AND (p->'capture') ?& ARRAY['source', 'offset_state']
      AND jsonb_typeof(p->'capture'->'offset_state') = 'string' AND (p->'capture'->>'offset_state') IN ('known', 'unknown')
      AND public.private_work_closed_scalar(p->'time', 'image_time') AND (p->'time') ? 'kind'
      AND jsonb_typeof(p->'time'->'kind') = 'string' AND (p->'time'->>'kind') IN ('instant', 'unknown');
    IF ok IS NOT TRUE THEN RETURN 'image timeline payload breaks the observation contract'; END IF;
    cap := p->'capture';
    st := cap->>'offset_state';
    IF st = 'unknown' AND (cap ? 'utc' OR (p->'time') ? 'utc') THEN RETURN 'an unknown camera offset cannot carry a UTC time'; END IF;
    IF st = 'known' AND NOT (cap ?& ARRAY['camera_local', 'utc'] AND jsonb_typeof(cap->'utc') = 'string') THEN
      RETURN 'image timeline payload breaks the observation contract (a known offset needs its camera-local and UTC time)';
    END IF;
    IF (p->'time') ? 'utc' AND st IS DISTINCT FROM 'known' THEN RETURN 'an unknown camera offset cannot carry a UTC time'; END IF;
    IF ((p->'identity'->>'state') <> 'confirmed' OR p_hold IS NOT FALSE) AND (p->>'assertion_status') <> 'held' THEN
      RETURN 'unconfirmed identity or privacy-held frames must stay held';
    END IF;
    -- A vehicle reference is an unverified pointer on an unheld frame, never ownership or authority over the vehicle.
    IF p ? 'subject_vehicle_ref' AND NOT (jsonb_typeof(p->'subject_vehicle_ref') = 'string'
         AND (p->>'subject_vehicle_ref') ~ '^[A-Za-z0-9_-]{1,64}$'
         AND (p->>'assertion_status') = 'observation_unverified') THEN
      RETURN 'image timeline payload breaks the observation contract (vehicle reference)';
    END IF;
    RETURN NULL;
  ELSIF p_kind = 'labor_reconciliation' THEN
    IF public.private_work_closed_scalar(p, 'labor') IS NOT TRUE THEN RETURN 'labor payload has unknown keys'; END IF;
    ok := (p ?& ARRAY['reconciliation_key', 'claim', 'observed', 'holds', 'rate_provenance', 'conflicts', 'relation', 'additive', 'hours_verified'])
      AND jsonb_typeof(p->'reconciliation_key') = 'string'
      AND p->'additive' = 'false'::jsonb AND p->'hours_verified' = 'false'::jsonb            -- JSON booleans, never strings
      AND (NOT (p ? 'billable_hours') OR jsonb_typeof(p->'billable_hours') = 'null')
      AND public.private_work_closed_scalar(p->'claim', 'labor_claim')
      AND p->'claim'->'source_claim' = 'true'::jsonb AND p->'claim'->'verified' = 'false'::jsonb
      AND (p->'claim') ? 'claimed_hours' AND jsonb_typeof(p->'claim'->'claimed_hours') = 'string'
      AND public.private_work_closed_scalar(p->'observed', 'labor_observed') AND (p->'observed') ? 'status'
      AND jsonb_typeof(p->'observed'->'status') = 'string'
      AND (p->'observed'->>'status') IN ('not_supplied', 'not_assessable', 'no_evidence', 'presence_only', 'review_camera_local_only', 'estimated_from_photos')
      AND public.private_work_closed_scalar(p->'holds', 'labor_holds')
      AND jsonb_typeof(p->'rate_provenance') = 'array' AND jsonb_typeof(p->'conflicts') = 'array'
      AND jsonb_typeof(p->'relation') = 'string'
      AND (p->>'relation') IN ('not_assessable', 'no_hours', 'photo_lower_bound_exceeds_claim', 'photo_lower_bound_within_claim_not_corroboration_of_total');
    IF ok IS NOT TRUE THEN RETURN 'labor payload breaks the claim-versus-observation contract'; END IF;
    FOR v IN SELECT value FROM jsonb_each(p->'holds') LOOP
      IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN RETURN 'labor payload breaks the claim-versus-observation contract (holds are counts)'; END IF;
    END LOOP;
    -- Claim: closed shape; the claimed hours stay a source claim.
    IF (p->'claim') ? 'service_period' AND jsonb_typeof(p->'claim'->'service_period') <> 'null'
       AND public.private_work_closed_scalar(p->'claim'->'service_period', 'labor_period') IS NOT TRUE THEN
      RETURN 'labor payload breaks the claim-versus-observation contract (service period)';
    END IF;
    IF (p->'claim') ? 'categories' THEN
      IF jsonb_typeof(p->'claim'->'categories') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'claim'->'categories') > 60 THEN
        RETURN 'labor payload breaks the claim-versus-observation contract (claim categories)'; END IF;
      FOR e IN SELECT x FROM jsonb_array_elements(p->'claim'->'categories') x LOOP
        IF public.private_work_closed_scalar(e, 'labor_category') IS NOT TRUE THEN
          RETURN 'labor payload breaks the claim-versus-observation contract (claim category)'; END IF;
      END LOOP;
    END IF;
    IF jsonb_array_length(p->'rate_provenance') > 60 OR jsonb_array_length(p->'conflicts') > 100 THEN
      RETURN 'labor payload breaks the claim-versus-observation contract (size)'; END IF;
    FOR e IN SELECT x FROM jsonb_array_elements(p->'rate_provenance') x LOOP
      IF public.private_work_closed_scalar(e, 'labor_rate') IS NOT TRUE THEN
        RETURN 'labor payload breaks the claim-versus-observation contract (rate provenance)'; END IF;
    END LOOP;
    FOR e IN SELECT x FROM jsonb_array_elements(p->'conflicts') x LOOP
      IF jsonb_typeof(e) IS DISTINCT FROM 'string' THEN RETURN 'labor payload breaks the claim-versus-observation contract (conflicts are text)'; END IF;
    END LOOP;
    -- Observation: closed shape at every level. Only a photo-derived lower bound may carry hours, and only with aware frames.
    v := p->'observed';
    IF v ? 'window' AND jsonb_typeof(v->'window') <> 'null' AND public.private_work_closed_scalar(v->'window', 'labor_period') IS NOT TRUE THEN
      RETURN 'labor payload breaks the claim-versus-observation contract (observed window)'; END IF;
    IF v ? 'observed_days' AND (jsonb_typeof(v->'observed_days') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'observed_days') > 400) THEN
      RETURN 'labor payload breaks the claim-versus-observation contract (observed days)'; END IF;
    IF v ? 'observed_days' THEN
      FOR e IN SELECT x FROM jsonb_array_elements(v->'observed_days') x LOOP
        IF jsonb_typeof(e) IS DISTINCT FROM 'string' THEN RETURN 'labor payload breaks the claim-versus-observation contract (observed days)'; END IF;
      END LOOP;
    END IF;
    IF v ? 'clusters' THEN
      IF jsonb_typeof(v->'clusters') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'clusters') > 400 THEN
        RETURN 'labor payload breaks the claim-versus-observation contract (clusters)'; END IF;
      FOR e IN SELECT x FROM jsonb_array_elements(v->'clusters') x LOOP
        IF public.private_work_closed_scalar(e, 'labor_cluster') IS NOT TRUE THEN
          RETURN 'labor payload breaks the claim-versus-observation contract (cluster)'; END IF;
      END LOOP;
    END IF;
    IF v ? 'camera_local_review' AND jsonb_typeof(v->'camera_local_review') <> 'null' THEN
      IF public.private_work_closed_scalar(v->'camera_local_review', 'labor_local_review') IS NOT TRUE
         OR jsonb_typeof(v->'camera_local_review'->'days') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'camera_local_review'->'days') > 400 THEN
        RETURN 'labor payload breaks the claim-versus-observation contract (camera-local review)'; END IF;
      FOR e IN SELECT x FROM jsonb_array_elements(v->'camera_local_review'->'days') x LOOP
        IF public.private_work_closed_scalar(e, 'labor_local_day') IS NOT TRUE THEN
          RETURN 'labor payload breaks the claim-versus-observation contract (camera-local day)'; END IF;
      END LOOP;
    END IF;
    IF (v ? 'hours_lower' AND jsonb_typeof(v->'hours_lower') <> 'null')
       OR (v ? 'hours_lower_exact_seconds' AND jsonb_typeof(v->'hours_lower_exact_seconds') <> 'null') THEN
      IF (v->>'status') IS DISTINCT FROM 'estimated_from_photos' THEN
        RETURN 'labor payload breaks the claim-versus-observation contract (hours need aware photo evidence)'; END IF;
    END IF;
    RETURN NULL;
  END IF;
  RETURN 'unknown projection kind';
END $$;
REVOKE ALL ON FUNCTION public.private_work_contract_problem(text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_work_contract_problem(text, jsonb, boolean) TO service_role;

-- Admission contract, enforced on every insert path (not only the writer function).
CREATE FUNCTION public.private_work_projection_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  prob text; r jsonb; d public.financial_documents%ROWTYPE; prior public.private_work_projections%ROWTYPE;
  p jsonb := NEW.payload; doc_ref_seen boolean := false; h jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'private work projections require service admission' USING ERRCODE = '42501';
  END IF;
  IF private_work_internal.account_ok(NEW.owner_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'authenticated account required' USING ERRCODE = '42501';
  END IF;
  -- Registered producer route and an exact run trace, on every insert path (not only the writer).
  IF public.private_work_producer_registered(NEW.producer, NEW.method, NEW.version) IS NOT TRUE THEN
    RAISE EXCEPTION 'producer, method and version are not a registered projection route';
  END IF;
  IF NEW.idempotency_key IS NULL OR NEW.idempotency_key !~ '^pwp:[a-f0-9]{48}:[a-f0-9]{16,64}$'
     OR split_part(NEW.idempotency_key, ':', 3) IS DISTINCT FROM NEW.projection_key
     OR NEW.run_label IS DISTINCT FROM substr(NEW.idempotency_key, 1, 20) THEN
    RAISE EXCEPTION 'run trace is not the registered batch key and label';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'projection payload must be an object'; END IF;
  prob := public.private_work_payload_problem(p - 'billable_hours');   -- top-level billable_hours is checked below (null only)
  IF prob IS NULL THEN   -- an RFC Message-ID looks like an address and is an opaque id, so it is exempt from the e-mail scan only
    prob := public.private_work_payload_problem(coalesce((SELECT jsonb_agg(e - 'rfc_message_id') FROM jsonb_array_elements(NEW.evidence_refs) e
                                                          WHERE jsonb_typeof(e) = 'object'), '[]'::jsonb));
  END IF;
  IF prob IS NOT NULL THEN RAISE EXCEPTION 'projection content refused: %', prob; END IF;
  prob := public.private_work_payload_problem(NEW.holds);   -- holds get the same content scan as every other payload
  IF prob IS NOT NULL THEN RAISE EXCEPTION 'projection content refused: %', prob; END IF;
  FOR h IN SELECT jsonb_array_elements(NEW.holds) LOOP
    IF jsonb_typeof(h) <> 'string' OR length(h #>> '{}') > 80 THEN RAISE EXCEPTION 'holds must be short strings'; END IF;
  END LOOP;

  -- Evidence refs are exact and immutable: hashes for bytes, a document revision for the source claim.
  FOR r IN SELECT jsonb_array_elements(NEW.evidence_refs) LOOP
    IF jsonb_typeof(r) <> 'object' THEN RAISE EXCEPTION 'invalid evidence ref'; END IF;
    CASE r->>'kind'
      WHEN 'image', 'attachment' THEN
        IF coalesce(r->>'sha256', '') !~ '^[a-f0-9]{64}$'
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('kind', 'sha256', 'origin_key')) THEN
          RAISE EXCEPTION 'image and attachment refs need an exact sha256';
        END IF;
      WHEN 'source_message' THEN
        IF coalesce(length(r->>'origin_key'), 0) NOT BETWEEN 1 AND 300
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('kind', 'origin_key', 'rfc_message_id')) THEN
          RAISE EXCEPTION 'invalid source message ref';
        END IF;
      WHEN 'financial_document_revision' THEN
        IF EXISTS (SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN
              ('kind', 'document_id', 'extraction_run_id', 'original_sha256', 'revision_idempotency_key'))
           OR coalesce(r->>'document_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR coalesce(r->>'extraction_run_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR coalesce(r->>'original_sha256', '') !~ '^[a-f0-9]{64}$'
           OR coalesce(length(r->>'revision_idempotency_key'), 0) NOT BETWEEN 1 AND 200 THEN
          RAISE EXCEPTION 'invalid financial document revision ref';
        END IF;
        SELECT * INTO d FROM public.financial_documents WHERE id = (r->>'document_id')::uuid;
        IF NOT FOUND OR d.owner_id IS DISTINCT FROM NEW.owner_id OR d.content_sha256 IS DISTINCT FROM r->>'original_sha256'
           OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(d.attributes->'runs', '[]'::jsonb)) x
                          WHERE x->>'run_id' = r->>'extraction_run_id' AND x->>'key' = r->>'revision_idempotency_key') THEN
          RAISE EXCEPTION 'financial document revision is not in this account scope';
        END IF;
        IF NEW.financial_document_id IS NOT DISTINCT FROM d.id THEN doc_ref_seen := true; END IF;
      ELSE RAISE EXCEPTION 'unknown evidence ref kind';
    END CASE;
  END LOOP;
  IF NEW.financial_document_id IS NOT NULL AND NOT doc_ref_seen THEN
    RAISE EXCEPTION 'financial_document_id must be backed by a financial_document_revision ref';
  END IF;

  -- Typed payload contract (fail closed: a missing key is a refusal, never a pass).
  prob := public.private_work_contract_problem(NEW.projection_kind, p, coalesce(NEW.source_privacy_hold, true));
  IF prob IS NOT NULL THEN RAISE EXCEPTION '%', prob; END IF;

  -- Revision chain: must extend the same projection of the same account; a privacy hold is sticky.
  IF NEW.supersedes_id IS NOT NULL THEN
    -- Plain read: service_role holds SELECT and INSERT only, and FOR UPDATE would need UPDATE. Concurrent forks are impossible without
    -- a row lock: the writer holds a per-key advisory lock and UNIQUE(supersedes_id) / UNIQUE(owner_id, projection_key, revision_no) refuse a second child.
    SELECT * INTO prior FROM public.private_work_projections WHERE id = NEW.supersedes_id;
    IF NOT FOUND OR prior.owner_id <> NEW.owner_id OR prior.projection_key <> NEW.projection_key
       OR prior.projection_kind <> NEW.projection_kind OR NEW.revision_no <> prior.revision_no + 1 THEN
      RAISE EXCEPTION 'supersession must extend the same projection in the same account';
    END IF;
    IF prior.source_privacy_hold AND NOT NEW.source_privacy_hold THEN
      RAISE EXCEPTION 'a source privacy hold cannot be cleared';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.private_work_projection_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER private_work_projections_guard BEFORE INSERT ON public.private_work_projections
  FOR EACH ROW EXECUTE FUNCTION public.private_work_projection_guard();

-- The writer. SECURITY INVOKER (service role only); the account is chosen by the server from the caller's credential.
CREATE FUNCTION public.ingest_private_work_projection(
  p_owner_id uuid, p_revision jsonb, p_actor_context jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_key text := p_revision->>'idempotency_key';
  item jsonb; head public.private_work_projections%ROWTYPE; old public.private_work_projections%ROWTYPE;
  v_content text; v_request text; v_item_key text; v_id uuid; v_results jsonb := '[]'; v_writes integer := 0;
  v_supersedes uuid; v_has_head boolean; v_rev integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' OR private_work_internal.account_ok(p_owner_id) IS NOT TRUE
  THEN RAISE EXCEPTION 'authenticated account required' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_actor_context) IS DISTINCT FROM 'object' OR octet_length(p_actor_context::text) > 500
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_actor_context) k WHERE k NOT IN ('kind', 'agent_id'))
     OR (p_actor_context->>'kind' IS NOT NULL AND p_actor_context->>'kind' NOT IN ('user', 'api_key'))
     OR (p_actor_context->>'agent_id' IS NOT NULL AND p_actor_context->>'agent_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  THEN RAISE EXCEPTION 'invalid verified actor context'; END IF;
  IF p_revision IS NULL OR jsonb_typeof(p_revision) <> 'object' OR octet_length(p_revision::text) > 250000
     OR coalesce(v_key, '') !~ '^pwp:[a-f0-9]{48}$'
     OR public.private_work_producer_registered(p_revision->>'producer', p_revision->>'method', p_revision->>'version') IS NOT TRUE
     OR p_revision->>'run_label' IS DISTINCT FROM substr(v_key, 1, 20)
     OR jsonb_typeof(p_revision->'projections') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_revision->'projections') NOT BETWEEN 1 AND 50
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_revision) k WHERE k NOT IN
          ('idempotency_key', 'producer', 'method', 'version', 'run_label', 'projections'))
  THEN RAISE EXCEPTION 'invalid private work projection envelope'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_revision->'projections')) <>
     (SELECT count(DISTINCT x->>'projection_key') FROM jsonb_array_elements(p_revision->'projections') x)
  THEN RAISE EXCEPTION 'duplicate projection keys'; END IF;

  FOR item IN SELECT x FROM jsonb_array_elements(p_revision->'projections') x ORDER BY x->>'projection_key' LOOP
    IF jsonb_typeof(item) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN
            ('kind', 'projection_key', 'supersedes_id', 'source_privacy_hold', 'holds', 'evidence_refs', 'financial_document_id', 'payload'))
       OR coalesce(item->>'projection_key', '') !~ '^[a-f0-9]{16,64}$'
       OR jsonb_typeof(item->'source_privacy_hold') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(item->'holds') IS DISTINCT FROM 'array'
       OR jsonb_typeof(item->'evidence_refs') IS DISTINCT FROM 'array'
       OR jsonb_typeof(item->'payload') IS DISTINCT FROM 'object'
       OR coalesce(item->>'kind', '') NOT IN ('image_timeline_event', 'labor_reconciliation')
    THEN RAISE EXCEPTION 'invalid projection item'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':pwp:' || (item->>'projection_key'), 0));
    v_item_key := v_key || ':' || (item->>'projection_key');
    v_content := encode(extensions.digest(convert_to(jsonb_build_object('kind', item->'kind', 'hold', item->'source_privacy_hold',
      'holds', item->'holds', 'refs', item->'evidence_refs', 'financial_document_id', item->'financial_document_id',
      'payload', item->'payload')::text, 'UTF8'), 'sha256'), 'hex');
    v_request := encode(extensions.digest(convert_to(jsonb_build_object('content', v_content, 'producer', p_revision->'producer',
      'method', p_revision->'method', 'version', p_revision->'version')::text, 'UTF8'), 'sha256'), 'hex');   -- supersedes_id is routing, not content

    SELECT * INTO old FROM public.private_work_projections WHERE owner_id = p_owner_id AND idempotency_key = v_item_key;
    IF FOUND THEN
      IF old.request_digest <> v_request THEN RAISE EXCEPTION 'idempotency key payload conflict'; END IF;
      v_results := v_results || jsonb_build_object('projection_key', old.projection_key, 'id', old.id,
        'revision_no', old.revision_no, 'status', 'duplicate');
      CONTINUE;
    END IF;

    SELECT * INTO head FROM public.private_work_projections p WHERE p.owner_id = p_owner_id AND p.projection_key = item->>'projection_key'
      AND NOT EXISTS (SELECT 1 FROM public.private_work_projections s WHERE s.supersedes_id = p.id)
      ORDER BY p.revision_no DESC LIMIT 1;
    v_has_head := FOUND;
    v_supersedes := nullif(item->>'supersedes_id', '')::uuid;
    IF v_has_head THEN
      IF head.projection_kind <> item->>'kind' THEN RAISE EXCEPTION 'projection kind cannot change'; END IF;
      IF head.content_digest = v_content THEN   -- same content under a new run: nothing to write
        v_results := v_results || jsonb_build_object('projection_key', head.projection_key, 'id', head.id,
          'revision_no', head.revision_no, 'status', 'unchanged');
        CONTINUE;
      END IF;
      IF v_supersedes IS DISTINCT FROM head.id THEN RAISE EXCEPTION 'correction must name the current revision'; END IF;
    ELSIF v_supersedes IS NOT NULL THEN
      RAISE EXCEPTION 'correction must name the current revision';
    END IF;

    INSERT INTO public.private_work_projections(owner_id, projection_kind, projection_key, revision_no, supersedes_id,
      idempotency_key, request_digest, content_digest, producer, method, version, run_label, source_privacy_hold, holds,
      evidence_refs, financial_document_id, payload, actor_user_id, auth_context)
    VALUES (p_owner_id, item->>'kind', item->>'projection_key', CASE WHEN v_has_head THEN head.revision_no + 1 ELSE 1 END, v_supersedes,
      v_item_key, v_request, v_content, p_revision->>'producer', p_revision->>'method', p_revision->>'version', p_revision->>'run_label',
      (item->>'source_privacy_hold')::boolean, item->'holds', item->'evidence_refs', nullif(item->>'financial_document_id', '')::uuid,
      item->'payload', p_owner_id, p_actor_context)
    RETURNING id, revision_no INTO v_id, v_rev;
    v_writes := v_writes + 1;
    v_results := v_results || jsonb_build_object('projection_key', item->>'projection_key', 'id', v_id,
      'revision_no', v_rev, 'status', 'created');
  END LOOP;
  RETURN jsonb_build_object('run_label', p_revision->>'run_label', 'results', v_results, 'writes', v_writes,
    'expense_posted', false, 'payment_posted', false, 'public_timeline_written', false);
END $$;
REVOKE ALL ON FUNCTION public.ingest_private_work_projection(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_private_work_projection(uuid, jsonb, jsonb) TO service_role;

-- Reader for the preflight/backup and the account's own review: current heads by default.
CREATE FUNCTION public.read_private_work_projections(
  p_owner_id uuid, p_keys text[] DEFAULT NULL, p_kind text DEFAULT NULL, p_include_superseded boolean DEFAULT false,
  p_after uuid DEFAULT NULL, p_limit integer DEFAULT 200
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' OR p_owner_id IS NULL THEN
    RAISE EXCEPTION 'authenticated account required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 OR (p_keys IS NOT NULL AND cardinality(p_keys) > 100)
     OR (p_kind IS NOT NULL AND p_kind NOT IN ('image_timeline_event', 'labor_reconciliation')) THEN
    RAISE EXCEPTION 'invalid projection read';
  END IF;
  SELECT coalesce(jsonb_agg(row_to_json_obj ORDER BY id), '[]'::jsonb) INTO result FROM (
    SELECT p.id, jsonb_build_object('id', p.id, 'projection_kind', p.projection_kind, 'projection_key', p.projection_key,
      'revision_no', p.revision_no, 'supersedes_id', p.supersedes_id, 'content_digest', p.content_digest,
      'producer', p.producer, 'method', p.method, 'version', p.version, 'run_label', p.run_label,
      'source_privacy_hold', p.source_privacy_hold, 'holds', p.holds, 'evidence_refs', p.evidence_refs,
      'financial_document_id', p.financial_document_id, 'payload', p.payload, 'created_at', p.created_at,
      'superseded', EXISTS (SELECT 1 FROM public.private_work_projections s WHERE s.supersedes_id = p.id)) AS row_to_json_obj
    FROM public.private_work_projections p
    WHERE p.owner_id = p_owner_id AND (p_keys IS NULL OR p.projection_key = ANY (p_keys))
      AND (p_kind IS NULL OR p.projection_kind = p_kind) AND (p_after IS NULL OR p.id > p_after)
      AND (p_include_superseded OR NOT EXISTS (SELECT 1 FROM public.private_work_projections s WHERE s.supersedes_id = p.id))
    ORDER BY p.id LIMIT p_limit
  ) q;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_private_work_projections(uuid, text[], text, boolean, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_private_work_projections(uuid, text[], text, boolean, uuid, integer) TO service_role;

COMMIT;
