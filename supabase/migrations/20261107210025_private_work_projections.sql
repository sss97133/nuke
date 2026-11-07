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

-- Content scan shared by the trigger: credentials, raw text carriers, bank identifiers, e-mail addresses, and any key that
-- would assert verified hours, payment or ownership. Returns the first problem or NULL.
CREATE FUNCTION public.private_work_payload_problem(j jsonb) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v jsonb; k text; s text;
BEGIN
  FOR v IN SELECT jsonb_path_query(j, 'strict $.**') LOOP
    IF jsonb_typeof(v) = 'object' THEN
      FOR k IN SELECT jsonb_object_keys(v) LOOP
        IF lower(k) IN ('ocr_text','raw_text','full_text','full_ocr','body','body_text','html','snippet','iban','bank_iban','full_iban',
                        'email','phone','person_name','image_bytes','photo','face',
                        'verified_hours','billable_hours_verified','total_hours','combined_hours','sum_hours','payment_verified',
                        'ownership_verified','owner_verified','vehicle_owner','co_owner','coowner')
           OR lower(k) ~ '(token|password|secret|authorization|cookie|credential|api_?key)' THEN
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
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.owner_id AND deleted_at IS NULL AND is_anonymous IS NOT TRUE
                 AND (banned_until IS NULL OR banned_until <= now())) THEN
    RAISE EXCEPTION 'authenticated account required' USING ERRCODE = '42501';
  END IF;
  prob := public.private_work_payload_problem(p);
  IF prob IS NULL THEN   -- an RFC Message-ID looks like an address and is an opaque id, so it is exempt from the e-mail scan only
    prob := public.private_work_payload_problem(coalesce((SELECT jsonb_agg(e - 'rfc_message_id') FROM jsonb_array_elements(NEW.evidence_refs) e
                                                          WHERE jsonb_typeof(e) = 'object'), '[]'::jsonb));
  END IF;
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

  -- Typed payload contracts.
  IF NEW.projection_kind = 'image_timeline_event' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN
        ('event_key', 'stance', 'time', 'capture', 'identity', 'origin_class', 'intent', 'assertion_status',
         'completed_work_asserted', 'subject_vehicle_ref')) THEN RAISE EXCEPTION 'image timeline payload has unknown keys'; END IF;
    IF p->>'stance' IS DISTINCT FROM 'visual_observed' OR p->>'completed_work_asserted' IS DISTINCT FROM 'false'
       OR p->>'assertion_status' NOT IN ('observation_unverified', 'held')
       OR jsonb_typeof(p->'identity') <> 'object' OR p->'identity'->>'state' NOT IN ('confirmed', 'unconfirmed', 'context_only', 'unknown')
       OR jsonb_typeof(p->'capture') IS DISTINCT FROM 'object'
       OR p->'capture'->>'offset_state' NOT IN ('known', 'unknown') THEN
      RAISE EXCEPTION 'image timeline payload breaks the observation contract';
    END IF;
    IF p->'capture'->>'offset_state' = 'unknown' AND (p->'capture' ? 'utc' OR p->'time' ? 'utc') THEN
      RAISE EXCEPTION 'an unknown camera offset cannot carry a UTC time';
    END IF;
    IF (p->'identity'->>'state' <> 'confirmed' OR NEW.source_privacy_hold) AND p->>'assertion_status' <> 'held' THEN
      RAISE EXCEPTION 'unconfirmed identity or privacy-held frames must stay held';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN
        ('reconciliation_key', 'claim', 'observed', 'holds', 'rate_provenance', 'conflicts', 'relation', 'additive',
         'billable_hours', 'hours_verified')) THEN RAISE EXCEPTION 'labor payload has unknown keys'; END IF;
    IF NOT (p ?& ARRAY['claim', 'observed', 'holds', 'rate_provenance', 'conflicts', 'relation', 'additive', 'hours_verified'])
       OR p->>'additive' IS DISTINCT FROM 'false' OR p->>'hours_verified' IS DISTINCT FROM 'false'
       OR (p ? 'billable_hours' AND jsonb_typeof(p->'billable_hours') <> 'null')
       OR jsonb_typeof(p->'claim') <> 'object' OR p->'claim'->>'source_claim' IS DISTINCT FROM 'true'
       OR p->'claim'->>'verified' IS DISTINCT FROM 'false'
       OR jsonb_typeof(p->'observed') <> 'object' OR jsonb_typeof(p->'holds') <> 'object'
       OR jsonb_typeof(p->'rate_provenance') <> 'array' OR jsonb_typeof(p->'conflicts') <> 'array' THEN
      RAISE EXCEPTION 'labor payload breaks the claim-versus-observation contract';
    END IF;
  END IF;

  -- Revision chain: must extend the same projection of the same account; a privacy hold is sticky.
  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT * INTO prior FROM public.private_work_projections WHERE id = NEW.supersedes_id FOR UPDATE;
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
  IF coalesce(auth.role(), '') <> 'service_role' OR p_owner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = p_owner_id AND deleted_at IS NULL AND is_anonymous IS NOT TRUE
      AND (banned_until IS NULL OR banned_until <= now())
  ) THEN RAISE EXCEPTION 'authenticated account required' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_actor_context) IS DISTINCT FROM 'object' OR octet_length(p_actor_context::text) > 500
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_actor_context) k WHERE k NOT IN ('kind', 'agent_id'))
     OR (p_actor_context->>'kind' IS NOT NULL AND p_actor_context->>'kind' NOT IN ('user', 'api_key'))
     OR (p_actor_context->>'agent_id' IS NOT NULL AND p_actor_context->>'agent_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  THEN RAISE EXCEPTION 'invalid verified actor context'; END IF;
  IF p_revision IS NULL OR jsonb_typeof(p_revision) <> 'object' OR octet_length(p_revision::text) > 250000
     OR coalesce(length(v_key), 0) NOT BETWEEN 1 AND 200
     OR coalesce(length(p_revision->>'producer'), 0) NOT BETWEEN 1 AND 120
     OR coalesce(length(p_revision->>'method'), 0) NOT BETWEEN 1 AND 120
     OR coalesce(length(p_revision->>'version'), 0) NOT BETWEEN 1 AND 120
     OR coalesce(length(p_revision->>'run_label'), 0) NOT BETWEEN 1 AND 120
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
