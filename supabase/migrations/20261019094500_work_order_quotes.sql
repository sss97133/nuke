-- Quotes and quote acceptance on the work-order spine (owner: "a job is a quote", 2026-10-19).
-- Lifecycle: estimate -> quote (revisions) -> acceptance -> deposit -> work order -> change order ->
-- completion -> invoice -> payment -> receipt. This slice holds the quote, its revisions and its acceptance.
--
-- Name: work_order_quotes keeps the standard name. The repo's 20251212000013_work_order_quotes.sql (mutable
-- status, customer insert/update policies, no provenance) was never applied: version 20251212000013 is recorded
-- live as profile_integrity_guardrails, to_regclass('public.work_order_quotes') was null on 2026-10-19, and the
-- deploy applies only files a push adds. It is not applied as written. Replaying it after this migration fails
-- inside its own transaction at its status index, before any of its write policies.
--
-- Quote: a work_record admitted through ingest-observation with event type quote, projected by
-- project_work_order_resource_observation into one immutable versioned row keyed by the observation id. It
-- freezes the current scope (operations, requirements, material/process specifications, parts, labor rows;
-- no progress fields or amounts; work_order_quote_scope_snapshot) and prices lines flat, hourly, day_rate or
-- per_operation, with a currency whenever an amount is stated. A revision names the current version it
-- supersedes; history stays. The quoting party is an explicit actor, user or organization id, or unknown:
-- attributed by the source, never inferred by name, not authenticated here.
-- Acceptance: only accept_work_order_quote, as the work order's customer, over the exact quote hash. It writes
-- an owner-input work_record (signer = auth.uid(), sign clock) and projects it in the same transaction. A
-- superseded or withdrawn quote, a changed scope or a changed customer withholds it from current reads.
-- work_orders.status and approved_at are not written; the reader reports approved_at as derived.
-- No deposit collection, payment, release or disbursement.
-- Reader: work_order_quotes_read, gated by work_order_is_accessible (the work_orders select rule). Amounts and the
-- scope snapshot (which carries service-only requirement and specification text) only for the customer and the
-- provider side; other viewers get counts. Customer contact fields are never read.
-- Contract: supabase/sql/test_work_order_quotes.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.work_order_quotes (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  supersedes_quote_id uuid,
  quoting_party_kind text NOT NULL CHECK (quoting_party_kind IN ('actor','user','organization','unknown')),
  quoting_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
  quoting_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  quoting_organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  scope_snapshot jsonb NOT NULL CHECK (jsonb_typeof(scope_snapshot) = 'object'),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) BETWEEN 1 AND 200),
  deposit_requested_amount numeric CHECK (deposit_requested_amount > 0 AND deposit_requested_amount < 'Infinity'::numeric),
  deposit_requested_currency text CHECK (deposit_requested_currency ~ '^[A-Z]{3}$'),
  valid_until timestamptz CHECK (isfinite(valid_until)),
  quote_hash text NOT NULL CHECK (quote_hash ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (work_order_id, version),
  UNIQUE (id, work_order_id),
  UNIQUE (id, work_order_id, quote_hash),
  FOREIGN KEY (supersedes_quote_id, work_order_id) REFERENCES public.work_order_quotes(id, work_order_id) ON DELETE RESTRICT,
  CONSTRAINT work_order_quote_not_self CHECK (supersedes_quote_id IS DISTINCT FROM id),
  CONSTRAINT work_order_quote_first_version CHECK (version > 1 OR supersedes_quote_id IS NULL),
  CONSTRAINT work_order_quote_deposit_pair CHECK (num_nonnulls(deposit_requested_amount, deposit_requested_currency) IN (0,2)),
  CONSTRAINT work_order_quote_party CHECK (CASE quoting_party_kind
    WHEN 'unknown' THEN num_nonnulls(quoting_actor_id, quoting_user_id, quoting_organization_id) = 0
    WHEN 'actor' THEN quoting_actor_id IS NOT NULL AND num_nonnulls(quoting_user_id, quoting_organization_id) = 0
    WHEN 'user' THEN quoting_user_id IS NOT NULL AND num_nonnulls(quoting_actor_id, quoting_organization_id) = 0
    ELSE quoting_organization_id IS NOT NULL AND num_nonnulls(quoting_actor_id, quoting_user_id) = 0 END)
);
CREATE INDEX work_order_quotes_supersedes ON public.work_order_quotes(supersedes_quote_id) WHERE supersedes_quote_id IS NOT NULL;
CREATE INDEX work_order_quotes_actor ON public.work_order_quotes(quoting_actor_id) WHERE quoting_actor_id IS NOT NULL;
CREATE INDEX work_order_quotes_user ON public.work_order_quotes(quoting_user_id) WHERE quoting_user_id IS NOT NULL;
CREATE INDEX work_order_quotes_org ON public.work_order_quotes(quoting_organization_id) WHERE quoting_organization_id IS NOT NULL;

CREATE TABLE public.work_order_quote_acceptances (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL,
  quote_hash text NOT NULL,
  signer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  signer_role text NOT NULL CHECK (signer_role = 'customer'),
  signed_at timestamptz NOT NULL CHECK (isfinite(signed_at)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (quote_id, work_order_id, quote_hash)
    REFERENCES public.work_order_quotes(id, work_order_id, quote_hash) ON DELETE RESTRICT
);
CREATE INDEX work_order_quote_acceptances_quote ON public.work_order_quote_acceptances(quote_id, signer_user_id);
CREATE INDEX work_order_quote_acceptances_order ON public.work_order_quote_acceptances(work_order_id);
CREATE INDEX work_order_quote_acceptances_signer ON public.work_order_quote_acceptances(signer_user_id);

COMMENT ON TABLE public.work_order_quotes IS 'One quote version for a work order: frozen scope snapshot, priced lines, deposit requested, validity. Keyed to its immutable work_record source; a later version supersedes it, history kept. Not acceptance, deposit, payment or a work_orders status. Writer: project_work_order_resource_observation (event type quote). Reader: work_order_quotes_read.';
COMMENT ON TABLE public.work_order_quote_acceptances IS 'One customer acceptance (Sign) of one exact quote version, keyed to its owner-input work_record. Withheld from current reads when the quote is superseded or withdrawn, the scope changes or the customer changes. Not a deposit, payment or completion. Writer: accept_work_order_quote only.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_order_quotes','work_order_quote_acceptances'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role',t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
    EXECUTE format('CREATE POLICY quote_service_read ON public.%I FOR SELECT TO service_role USING (true)',t);
    EXECUTE format('CREATE TRIGGER quote_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.work_order_resource_immutable()',t);
    EXECUTE format('CREATE TRIGGER quote_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.work_order_resource_immutable()',t);
  END LOOP;
END $$;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('work_order_quotes','work_order_quote_acceptances') LOOP
    EXECUTE format('COMMENT ON COLUMN public.%I.%I IS %L',c.table_name,c.column_name,
      CASE c.column_name
        WHEN 'id' THEN 'Source vehicle_observations UUID and idempotency key. Source owns testimony, method, trust and original clocks.'
        WHEN 'work_order_id' THEN 'Work order (the job header) this quote or acceptance belongs to.'
        WHEN 'version' THEN 'Quote version, 1 for the first quote, next integer for each revision of the same work order.'
        WHEN 'supersedes_quote_id' THEN 'Quote version this revision replaced; it was the current version when this one was projected.'
        WHEN 'quoting_party_kind' THEN 'actor, user, organization or unknown. Attributed by the source, never inferred by name; not authenticated by this projection.'
        WHEN 'quoting_actor_id' THEN 'Quoting work actor (actors), when the source names one.'
        WHEN 'quoting_user_id' THEN 'Quoting account, when the source names one. Cannot accept its own quote.'
        WHEN 'quoting_organization_id' THEN 'Quoting organization, when the source names one.'
        WHEN 'scope_snapshot' THEN 'work_order_quote_scope_snapshot at quote time: operations, requirements, specifications, parts and labor rows without progress fields or amounts. A later scope change withholds acceptance.'
        WHEN 'lines' THEN 'Priced lines: ref_kind (operation, requirement, part, labor, fee), ref_id in the snapshot (null for fee), description, pricing_basis (flat, hourly, day_rate, per_operation), amount, currency (required with an amount), unit (hour, day, operation; null for flat), quantity (null for flat or when unstated).'
        WHEN 'deposit_requested_amount' THEN 'Deposit the quote requests; a request, not a payment record.'
        WHEN 'deposit_requested_currency' THEN 'ISO 4217 currency of the requested deposit.'
        WHEN 'valid_until' THEN 'Quote expiry stated by the source; null when not stated. An expired quote cannot be accepted.'
        WHEN 'quote_hash' THEN 'SHA-256 of the canonical quote content (id, work order, version, supersedes, party, snapshot, lines, deposit, validity). The acceptance Sign must present it.'
        WHEN 'signer_user_id' THEN 'auth.uid() of the authenticated signer at accept_work_order_quote.'
        WHEN 'signer_role' THEN 'Role the signer held when signing; customer (work_orders.customer_id).'
        WHEN 'signed_at' THEN 'Sign clock: when the customer accepted (source observed_at).'
        WHEN 'recorded_at' THEN 'Projection insertion clock; distinct from observation and ingestion clocks retained on the source.'
      END);
  END LOOP;
END $$;

-- Scope a quote covers: the work order's current operations and resource graph, without progress fields
-- (status, actor, hours) or amounts, so recording progress does not invalidate an accepted quote.
CREATE FUNCTION public.work_order_quote_scope_snapshot(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE r jsonb;
BEGIN
  r := public.read_work_order_resources(p_work_order_id);
  RETURN jsonb_build_object('snapshot_version',1,
    'operations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',li.id,'line_number',li.line_number,'task_type',li.task_type,
        'task_description',li.task_description,'source_observation_id',li.source_observation_id) ORDER BY li.id)
      FROM public.work_order_line_items li WHERE li.work_order_id=p_work_order_id),'[]'::jsonb),
    'requirements',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',q->'id','line_item_id',q->'line_item_id',
        'requirement_kind',q->'requirement_kind','description',q->'description','quantity',q->'quantity','unit',q->'unit') ORDER BY q->>'id')
      FROM jsonb_array_elements(COALESCE(r->'requirements','[]'::jsonb)) q),'[]'::jsonb),
    'specifications',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s->'id','line_item_id',s->'line_item_id',
        'specification_stage',s->'specification_stage','material_role',s->'material_role','material_label',s->'material_label',
        'material_key',s->'material_key','process_label',s->'process_label','process_key',s->'process_key') ORDER BY s->>'id')
      FROM jsonb_array_elements(COALESCE(r->'specifications','[]'::jsonb)) s),'[]'::jsonb),
    'parts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'part_name',p.part_name,'part_number',p.part_number,
        'brand',p.brand,'quantity',p.quantity,'job_op_code',p.job_op_code) ORDER BY p.id)
      FROM public.work_order_parts p WHERE p.work_order_id=p_work_order_id),'[]'::jsonb),
    'labor',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'task_name',l.task_name,'task_category',l.task_category,
        'job_op_code',l.job_op_code) ORDER BY l.id)
      FROM public.work_order_labor l WHERE l.work_order_id=p_work_order_id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.work_order_quote_scope_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_quote_scope_snapshot(uuid) TO service_role;
COMMENT ON FUNCTION public.work_order_quote_scope_snapshot(uuid) IS 'Service-only canonical scope snapshot a quote must carry: current operations, requirements, specifications, parts and labor rows without progress fields or amounts. Read-only.';

-- Why a signer cannot accept this quote now (null = acceptable). Shared by the Sign RPC, the projector and the
-- reader's actions. The presented hash is checked separately by the callers.
CREATE FUNCTION public.work_order_quote_acceptance_refusal(p_quote_id uuid, p_signer uuid, p_at timestamptz)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  q public.work_order_quotes%ROWTYPE;
  w public.work_orders%ROWTYPE;
BEGIN
  SELECT x.* INTO q FROM public.work_order_quotes x JOIN public.vehicle_observations s ON s.id=x.id
    JOIN public.work_orders wo ON wo.id=x.work_order_id AND wo.vehicle_id=s.vehicle_id
    WHERE x.id=p_quote_id AND s.is_superseded IS FALSE;
  IF NOT FOUND THEN RETURN 'quote_unavailable'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id=q.work_order_id;
  IF p_signer IS NULL OR w.customer_id IS DISTINCT FROM p_signer THEN RETURN 'not_customer'; END IF;
  IF q.quoting_user_id IS NOT DISTINCT FROM p_signer THEN RETURN 'quoting_party_cannot_accept'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_order_quotes x JOIN public.vehicle_observations s ON s.id=x.id
    WHERE x.work_order_id=w.id AND x.version>q.version AND s.is_superseded IS FALSE AND s.vehicle_id=w.vehicle_id) THEN
    RETURN 'quote_superseded';
  END IF;
  IF q.valid_until IS NOT NULL AND q.valid_until <= p_at THEN RETURN 'quote_expired'; END IF;
  IF q.scope_snapshot IS DISTINCT FROM public.work_order_quote_scope_snapshot(w.id) THEN RETURN 'scope_changed_since_quote'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.work_order_quote_acceptance_refusal(uuid,uuid,timestamptz) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.work_order_quote_acceptance_refusal(uuid,uuid,timestamptz) IS 'Internal: reason a signer cannot accept a quote at a clock (not_customer, quoting_party_cannot_accept, quote_superseded, quote_expired, scope_changed_since_quote, quote_unavailable), or null. No direct grants.';

-- Called only by project_work_order_resource_observation, which has already qualified the source.
CREATE FUNCTION public.project_work_order_quote_event(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  event_type text;
  cur public.work_order_quotes%ROWTYPE;
  q public.work_order_quotes%ROWTYPE;
  next_version integer;
  party_kind text;
  party_id uuid;
  snapshot jsonb;
  ln jsonb;
  priced integer := 0;
  hash text;
  owner_source uuid;
  refusal text;
BEGIN
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id FOR SHARE;
  IF NOT FOUND OR o.kind::text <> 'work_record' OR o.is_superseded IS DISTINCT FROM false OR o.source_id IS NULL THEN
    RAISE EXCEPTION 'Current attributed work_record source required';
  END IF;
  e := o.structured_data->'work_order_resource';
  event_type := e->>'event_type';
  SELECT * INTO w FROM public.work_orders WHERE id=(e->>'work_order_id')::uuid FOR SHARE;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN
    RAISE EXCEPTION 'Source and work order must identify the same vehicle';
  END IF;
  -- One writer per work order at a time, so version numbers and the current quote cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_quote:'||w.id::text,0));
  IF event_type='quote' THEN
    IF EXISTS (SELECT 1 FROM public.work_order_quotes WHERE id=o.id) THEN
      RETURN jsonb_build_object('id',o.id,'event_type',event_type,'duplicate',true);
    END IF;
    SELECT x.* INTO cur FROM public.work_order_quotes x JOIN public.vehicle_observations s ON s.id=x.id
      WHERE x.work_order_id=w.id AND s.is_superseded IS FALSE AND s.vehicle_id=w.vehicle_id
      ORDER BY x.version DESC LIMIT 1;
    SELECT COALESCE(max(version),0)+1 INTO next_version FROM public.work_order_quotes WHERE work_order_id=w.id;
    IF jsonb_typeof(e->'quote_version') IS DISTINCT FROM 'number' OR (e->>'quote_version')::numeric <> next_version THEN
      RAISE EXCEPTION 'Quote version must be the next version for this work order (%)',next_version;
    END IF;
    IF (e->>'supersedes_quote_id')::uuid IS DISTINCT FROM cur.id THEN
      RAISE EXCEPTION 'A quote revision must name the current quote version it supersedes';
    END IF;
    party_kind := e#>>'{quoting_party,kind}';
    party_id := (e#>>'{quoting_party,id}')::uuid;
    IF jsonb_typeof(e->'quoting_party') IS DISTINCT FROM 'object' OR party_kind IS NULL
      OR party_kind NOT IN ('actor','user','organization','unknown') OR (party_kind='unknown') <> (party_id IS NULL) THEN
      RAISE EXCEPTION 'Quoting party must be an explicit actor, user or organization id, or unknown';
    END IF;
    snapshot := public.work_order_quote_scope_snapshot(w.id);
    IF e->'scope_snapshot' IS DISTINCT FROM snapshot THEN
      RAISE EXCEPTION 'Quote scope snapshot must equal the current work order scope';
    END IF;
    IF jsonb_typeof(e->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'lines') NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Quote lines must be an array of 1 to 200 lines';
    END IF;
    FOR ln IN SELECT value FROM jsonb_array_elements(e->'lines') LOOP
      IF jsonb_typeof(ln) IS DISTINCT FROM 'object'
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(ln) k
          WHERE k NOT IN ('ref_kind','ref_id','description','pricing_basis','amount','currency','unit','quantity'))
        OR COALESCE(ln->>'ref_kind','') NOT IN ('operation','requirement','part','labor','fee')
        OR (ln->>'ref_kind'='fee') <> (ln->>'ref_id' IS NULL)
        OR (ln->>'ref_kind'<>'fee' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->(CASE ln->>'ref_kind'
            WHEN 'operation' THEN 'operations' WHEN 'requirement' THEN 'requirements' WHEN 'part' THEN 'parts' ELSE 'labor' END)) s
          WHERE s->>'id'=ln->>'ref_id'))
        OR jsonb_typeof(ln->'description') IS DISTINCT FROM 'string' OR length(btrim(ln->>'description')) NOT BETWEEN 1 AND 500
        OR COALESCE(ln->>'pricing_basis','') NOT IN ('flat','hourly','day_rate','per_operation')
        OR ln->>'unit' IS DISTINCT FROM (CASE ln->>'pricing_basis' WHEN 'hourly' THEN 'hour' WHEN 'day_rate' THEN 'day'
          WHEN 'per_operation' THEN 'operation' END)
        OR (ln->>'amount' IS NOT NULL AND (jsonb_typeof(ln->'amount')<>'number' OR (ln->>'amount')::numeric < 0))
        OR (ln->>'amount' IS NULL) <> (ln->>'currency' IS NULL)
        OR (ln->>'currency' IS NOT NULL AND (jsonb_typeof(ln->'currency')<>'string' OR ln->>'currency' !~ '^[A-Z]{3}$'))
        OR (ln->>'quantity' IS NOT NULL AND (ln->>'pricing_basis'='flat' OR jsonb_typeof(ln->'quantity')<>'number'
          OR (ln->>'quantity')::numeric <= 0)) THEN
        RAISE EXCEPTION 'Invalid quote line: %',ln;
      END IF;
      IF ln->>'amount' IS NOT NULL THEN priced := priced+1; END IF;
    END LOOP;
    IF priced=0 THEN
      RAISE EXCEPTION 'A quote prices at least one line; an unpriced scope is an estimate';
    END IF;
    IF e->>'deposit_requested' IS NOT NULL AND (jsonb_typeof(e->'deposit_requested')<>'object'
      OR (SELECT count(*) FROM jsonb_object_keys(e->'deposit_requested'))<>2
      OR NOT e->'deposit_requested' ?& ARRAY['amount','currency']
      OR jsonb_typeof(e#>'{deposit_requested,amount}')<>'number'
      OR jsonb_typeof(e#>'{deposit_requested,currency}')<>'string') THEN
      RAISE EXCEPTION 'Deposit requested must be {amount, currency}';
    END IF;
    IF e->>'valid_until' IS NOT NULL AND (e->>'valid_until')::timestamptz <= o.observed_at THEN
      RAISE EXCEPTION 'Quote validity must end after the quote clock';
    END IF;
    hash := encode(sha256(convert_to(jsonb_build_object('quote_id',o.id,'work_order_id',w.id,'version',next_version,
      'supersedes_quote_id',cur.id,'quoting_party',jsonb_build_object('kind',party_kind,'id',party_id),
      'scope_snapshot',snapshot,'lines',e->'lines','deposit_requested',e->'deposit_requested',
      'valid_until',(e->>'valid_until')::timestamptz)::text,'UTF8')),'hex');
    INSERT INTO public.work_order_quotes(id,work_order_id,version,supersedes_quote_id,quoting_party_kind,quoting_actor_id,
      quoting_user_id,quoting_organization_id,scope_snapshot,lines,deposit_requested_amount,deposit_requested_currency,valid_until,quote_hash)
      VALUES(o.id,w.id,next_version,cur.id,party_kind,CASE WHEN party_kind='actor' THEN party_id END,
      CASE WHEN party_kind='user' THEN party_id END,CASE WHEN party_kind='organization' THEN party_id END,
      snapshot,e->'lines',(e#>>'{deposit_requested,amount}')::numeric,e#>>'{deposit_requested,currency}',
      (e->>'valid_until')::timestamptz,hash);
  ELSIF event_type='quote_acceptance' THEN
    IF EXISTS (SELECT 1 FROM public.work_order_quote_acceptances WHERE id=o.id) THEN
      RETURN jsonb_build_object('id',o.id,'event_type',event_type,'duplicate',true);
    END IF;
    IF current_setting('nuke.work_order_quote_sign',true) IS DISTINCT FROM o.id::text THEN
      RAISE EXCEPTION 'Quote acceptance is recorded only by accept_work_order_quote' USING ERRCODE='42501';
    END IF;
    SELECT id INTO owner_source FROM public.observation_sources WHERE slug='owner-input';
    IF o.source_id IS DISTINCT FROM owner_source OR o.extraction_method IS DISTINCT FROM 'work_order_quote_acceptance_sign_v1'
      OR o.submitted_by_user_id IS NULL OR e->>'signer_user_id' IS DISTINCT FROM o.submitted_by_user_id::text THEN
      RAISE EXCEPTION 'Authenticated customer Sign source required' USING ERRCODE='42501';
    END IF;
    SELECT x.* INTO q FROM public.work_order_quotes x JOIN public.vehicle_observations s ON s.id=x.id
      WHERE x.id=(e->>'quote_id')::uuid AND x.work_order_id=w.id AND s.is_superseded IS FALSE AND s.vehicle_id=w.vehicle_id
      FOR SHARE OF x,s;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current quote in the same work order required'; END IF;
    IF e->>'quote_hash' IS DISTINCT FROM q.quote_hash THEN
      RAISE EXCEPTION 'Quote hash does not match this quote version' USING ERRCODE='23514';
    END IF;
    refusal := public.work_order_quote_acceptance_refusal(q.id,o.submitted_by_user_id,o.observed_at);
    IF refusal IS NOT NULL THEN RAISE EXCEPTION 'Quote cannot be accepted: %',refusal USING ERRCODE='42501'; END IF;
    INSERT INTO public.work_order_quote_acceptances(id,work_order_id,quote_id,quote_hash,signer_user_id,signer_role,signed_at)
      VALUES(o.id,w.id,q.id,q.quote_hash,o.submitted_by_user_id,'customer',o.observed_at);
  ELSE
    RAISE EXCEPTION 'Unknown quote event type';
  END IF;
  RETURN jsonb_build_object('id',o.id,'event_type',event_type,'duplicate',false);
END $$;
REVOKE ALL ON FUNCTION public.project_work_order_quote_event(uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.project_work_order_quote_event(uuid) IS 'Internal: quote and quote_acceptance branch of project_work_order_resource_observation. No direct grants.';

-- Live definition from 20261019051336 (pg_get_functiondef md5 prefix 830abbbc on 2026-10-19),
-- with quote and quote_acceptance added to the allowlist and delegated after the shared source checks.
CREATE OR REPLACE FUNCTION public.project_work_order_resource_observation(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  operation_id uuid;
  target_id uuid;
  event_type text;
  inserted_rows integer;
  required_kind text;
  basis_id uuid;
  basis_quote text;
  basis_clock timestamptz;
  spec_stage text;
  basis_text text;
  basis_values text[];
  part_status text;
BEGIN
  -- Fixed allowlisted projection only; the source is always read from the existing log.
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id FOR SHARE;
  IF NOT FOUND OR o.kind::text <> 'work_record' OR o.is_superseded IS DISTINCT FROM false OR o.source_id IS NULL THEN
    RAISE EXCEPTION 'Current attributed work_record source required';
  END IF;
  e := o.structured_data->'work_order_resource';
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->>'version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'work_order_resource version 1 envelope required';
  END IF;
  event_type := e->>'event_type';
  IF event_type IS NULL OR event_type NOT IN ('requirement','fulfillment','attestation','specification','operation','quote','quote_acceptance') THEN
    RAISE EXCEPTION 'Unknown resource event type';
  END IF;
  SELECT * INTO w FROM public.work_orders WHERE id=(e->>'work_order_id')::uuid FOR SHARE;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN
    RAISE EXCEPTION 'Source and work order must identify the same vehicle';
  END IF;
  IF event_type IN ('quote','quote_acceptance') THEN
    RETURN public.project_work_order_quote_event(o.id);
  END IF;
  -- Retained-source links are explicit, one-hop evidence, not inferred authorship.
  -- A legacy source may lack source_id; the new interpretation must still have it.
  IF event_type IN ('requirement','specification') THEN
    basis_id := (e->>'basis_observation_id')::uuid;
    basis_quote := e->>'basis_excerpt';
    basis_clock := o.observed_at;
  ELSIF event_type IN ('fulfillment','attestation') THEN
    SELECT r.basis_observation_id,r.basis_excerpt,s.observed_at
      INTO basis_id,basis_quote,basis_clock
      FROM public.work_order_resource_requirements r JOIN public.vehicle_observations s ON s.id=r.id
      WHERE r.id=CASE WHEN event_type='fulfillment' THEN (e->>'requirement_id')::uuid
        ELSE (SELECT f.requirement_id FROM public.work_order_resource_fulfillments f WHERE f.id=(e->>'fulfillment_id')::uuid) END
      FOR SHARE OF r,s;
  END IF;
  IF num_nonnulls(basis_id,basis_quote)=1 THEN RAISE EXCEPTION 'Retained basis ID and excerpt must be paired'; END IF;
  IF basis_id IS NOT NULL THEN
    IF length(btrim(basis_quote)) NOT BETWEEN 1 AND 2000 OR basis_id=o.id THEN
      RAISE EXCEPTION 'Nonempty original-source excerpt required';
    END IF;
    PERFORM 1 FROM public.vehicle_observations b WHERE b.id=basis_id AND b.kind::text='work_record'
      AND b.is_superseded IS FALSE AND b.vehicle_id=w.vehicle_id AND b.observed_at=basis_clock
      AND NOT (COALESCE(b.structured_data,'{}'::jsonb) ? 'work_order_resource')
      AND strpos(b.content_text,basis_quote)>0 FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current same-vehicle original basis, exact excerpt and original clock required'; END IF;
  END IF;
  -- Source IDs are idempotency keys. Replays still qualify every source and parent.
  IF event_type='requirement' THEN
    operation_id := (e->>'line_item_id')::uuid;
    PERFORM 1 FROM public.work_order_line_items WHERE id=operation_id AND work_order_id=w.id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Operation must belong to the work order'; END IF;
    INSERT INTO public.work_order_resource_requirements(id,work_order_id,line_item_id,requirement_kind,description,quantity,unit,basis_observation_id,basis_excerpt)
      VALUES(o.id,w.id,operation_id,e->>'requirement_kind',e->>'description',(e->>'quantity')::numeric,e->>'unit',basis_id,basis_quote)
      ON CONFLICT(id) DO NOTHING;
  ELSIF event_type='operation' THEN
    -- A requested scope item quoted from the work order itself; never priced, assigned or done here.
    basis_quote := e->>'basis_excerpt';
    basis_text := CASE e->>'basis_field' WHEN 'description' THEN w.description
      WHEN 'scope_description' THEN w.scope_description END;
    IF basis_text IS NULL OR basis_quote IS NULL OR length(btrim(basis_quote)) NOT BETWEEN 1 AND 500
      OR strpos(basis_text,basis_quote)=0 THEN
      RAISE EXCEPTION 'Exact excerpt of the work order scope text required';
    END IF;
    IF e->>'task_description' IS DISTINCT FROM basis_quote THEN
      RAISE EXCEPTION 'Operation text must be the quoted scope item';
    END IF;
    IF (e->>'line_number')::integer IS NULL OR (e->>'line_number')::integer < 1 THEN
      RAISE EXCEPTION 'Positive line number required';
    END IF;
    INSERT INTO public.work_order_line_items(id,work_order_id,line_number,task_type,task_description,status,notes,
      source_observation_id,basis_field,basis_excerpt)
      VALUES(o.id,w.id,(e->>'line_number')::integer,e->>'task_type',basis_quote,'pending',e->>'notes',
      o.id,e->>'basis_field',basis_quote) ON CONFLICT(id) DO NOTHING;
  ELSIF event_type='specification' THEN
    spec_stage := e->>'specification_stage';
    operation_id := (e->>'line_item_id')::uuid;
    IF operation_id IS NOT NULL THEN
      PERFORM 1 FROM public.work_order_line_items WHERE id=operation_id AND work_order_id=w.id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Operation must belong to the work order'; END IF;
    END IF;
    IF num_nonnulls(basis_id,e->>'basis_component_event_id',e->>'basis_work_order_part_id')<>1 THEN
      RAISE EXCEPTION 'Exactly one specification basis required';
    END IF;
    IF basis_id IS NOT NULL THEN
      IF e ? 'basis_snapshot' THEN RAISE EXCEPTION 'A retained excerpt basis carries no record snapshot'; END IF;
      basis_text := lower(basis_quote);
      basis_values := ARRAY[basis_text];
    ELSIF e->>'basis_component_event_id' IS NOT NULL THEN
      SELECT ARRAY(SELECT lower(m.value) FROM jsonb_each_text(COALESCE(ce.metadata,'{}'::jsonb)) m WHERE m.value IS NOT NULL)
        INTO basis_values
        FROM public.component_events ce JOIN public.work_order_line_items li
          ON li.component_event_id=ce.id AND li.id=operation_id AND li.work_order_id=w.id
        WHERE ce.id=(e->>'basis_component_event_id')::uuid AND ce.work_order_id=w.id AND ce.vehicle_id=w.vehicle_id
          AND e->'basis_snapshot'=to_jsonb(ce)
        FOR SHARE OF ce,li;
      IF NOT FOUND THEN RAISE EXCEPTION 'Exact same-operation component event snapshot required'; END IF;
    ELSE
      SELECT lower(p.part_name),p.status INTO basis_text,part_status FROM public.work_order_parts p
        WHERE p.id=(e->>'basis_work_order_part_id')::uuid AND p.work_order_id=w.id
          AND e->'basis_snapshot'=to_jsonb(p) FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Exact same-work-order part snapshot required'; END IF;
      IF NOT ((spec_stage='supplied' AND part_status='installed') OR (spec_stage='proposed' AND part_status='quoted')) THEN
        RAISE EXCEPTION 'Part status does not support this specification stage';
      END IF;
      basis_values := ARRAY[basis_text];
    END IF;
    -- Event metadata labels match a whole recorded value; excerpts and part names contain them.
    IF (e->>'material_label' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(basis_values) v WHERE
          CASE WHEN e->>'basis_component_event_id' IS NOT NULL THEN v=lower(e->>'material_label')
          ELSE strpos(v,lower(e->>'material_label'))>0 END))
      OR (e->>'process_label' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(basis_values) v WHERE
          CASE WHEN e->>'basis_component_event_id' IS NOT NULL THEN v=lower(e->>'process_label')
          ELSE strpos(v,lower(e->>'process_label'))>0 END)) THEN
      RAISE EXCEPTION 'Specification labels must be quoted from their basis record';
    END IF;
    INSERT INTO public.work_order_resource_specifications(id,work_order_id,line_item_id,specification_stage,material_role,
      material_label,material_key,process_label,process_key,basis_observation_id,basis_excerpt,basis_component_event_id,basis_work_order_part_id)
      VALUES(o.id,w.id,operation_id,spec_stage,e->>'material_role',e->>'material_label',e->>'material_key',
      e->>'process_label',e->>'process_key',basis_id,basis_quote,(e->>'basis_component_event_id')::uuid,(e->>'basis_work_order_part_id')::uuid)
      ON CONFLICT(id) DO NOTHING;
  ELSIF event_type='fulfillment' THEN
    target_id := (e->>'requirement_id')::uuid;
    SELECT r.requirement_kind INTO required_kind
      FROM public.work_order_resource_requirements r JOIN public.vehicle_observations s ON s.id=r.id
      JOIN public.work_order_line_items li ON li.id=r.line_item_id AND li.work_order_id=w.id
      WHERE r.id=target_id AND r.work_order_id=w.id AND s.is_superseded IS FALSE AND s.vehicle_id=w.vehicle_id
      FOR SHARE OF r,s,li;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current requirement in the same work order required'; END IF;
    IF NOT ((required_kind='tool' AND num_nonnulls(e->>'user_tool_id',e->>'inventory_tool_id',e->>'equipment_id')=1)
      OR (required_kind='equipment' AND e->>'equipment_id' IS NOT NULL)
      OR (required_kind='facility' AND e->>'facility_organization_id' IS NOT NULL)
      OR (required_kind IN ('skill','inspection') AND e->>'performer_actor_id' IS NOT NULL)) THEN
      RAISE EXCEPTION 'Resource type does not satisfy this requirement kind';
    END IF;
    -- A retained assignment is custody evidence, not proof of capability or consent.
    IF e->>'basis_line_item_id' IS NOT NULL THEN
      PERFORM 1 FROM public.work_order_line_items li JOIN public.work_order_resource_requirements r
        ON r.line_item_id=li.id AND r.id=target_id AND r.work_order_id=w.id
        WHERE li.id=(e->>'basis_line_item_id')::uuid AND li.work_order_id=w.id
          AND li.actor_id=(e->>'performer_actor_id')::uuid
          AND e->'basis_line_item_snapshot'=to_jsonb(li) FOR SHARE OF li,r;
      IF NOT FOUND THEN RAISE EXCEPTION 'Exact same-operation actor assignment snapshot required'; END IF;
    ELSIF e ? 'basis_line_item_snapshot' THEN
      RAISE EXCEPTION 'Assignment snapshot requires its typed line-item basis';
    END IF;
    INSERT INTO public.work_order_resource_fulfillments(id,work_order_id,requirement_id,supplier_user_id,supplier_organization_id,
      user_tool_id,inventory_tool_id,equipment_id,facility_organization_id,available_from,available_until,performer_actor_id,basis_line_item_id)
      VALUES(o.id,w.id,target_id,(e->>'supplier_user_id')::uuid,(e->>'supplier_organization_id')::uuid,
      (e->>'user_tool_id')::uuid,(e->>'inventory_tool_id')::uuid,(e->>'equipment_id')::uuid,(e->>'facility_organization_id')::uuid,
      (e->>'available_from')::timestamptz,(e->>'available_until')::timestamptz,
      (e->>'performer_actor_id')::uuid,(e->>'basis_line_item_id')::uuid) ON CONFLICT(id) DO NOTHING;
  ELSE
    target_id := (e->>'fulfillment_id')::uuid;
    PERFORM 1 FROM public.work_order_resource_fulfillments f
      JOIN public.vehicle_observations fs ON fs.id=f.id JOIN public.vehicle_observations rs ON rs.id=f.requirement_id
      JOIN public.work_order_resource_requirements r ON r.id=f.requirement_id
      JOIN public.work_order_line_items li ON li.id=r.line_item_id AND li.work_order_id=w.id
      WHERE f.id=target_id AND f.work_order_id=w.id AND fs.is_superseded IS FALSE AND rs.is_superseded IS FALSE
        AND fs.vehicle_id=w.vehicle_id AND rs.vehicle_id=w.vehicle_id
        AND (f.basis_line_item_id IS NULL OR (f.basis_line_item_id=li.id AND li.actor_id=f.performer_actor_id
          AND fs.structured_data#>'{work_order_resource,basis_line_item_snapshot}'=to_jsonb(li)))
      FOR SHARE OF f,fs,rs,r,li;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current fulfillment and requirement in the same work order required'; END IF;
    INSERT INTO public.work_order_resource_attestations(id,work_order_id,fulfillment_id,attestor_user_id,attestor_organization_id,
      attestation_kind,verdict,scope)
      VALUES(o.id,w.id,target_id,(e->>'attestor_user_id')::uuid,(e->>'attestor_organization_id')::uuid,
      e->>'attestation_kind',e->>'verdict',e->>'scope') ON CONFLICT(id) DO NOTHING;
  END IF;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  RETURN jsonb_build_object('id',o.id,'event_type',event_type,'duplicate',inserted_rows=0);
END $$;
REVOKE ALL ON FUNCTION public.project_work_order_resource_observation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_work_order_resource_observation(uuid) TO service_role;
COMMENT ON FUNCTION public.project_work_order_resource_observation(uuid) IS 'Service-only typed projection of an existing current work_record admitted through ingest-observation. Never inserts or changes testimony, permissions, bookings or payments. quote_acceptance projects only inside accept_work_order_quote.';

-- Sign: the work order's customer accepts one exact quote version.
CREATE FUNCTION public.accept_work_order_quote(p_quote_id uuid, p_quote_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  q public.work_order_quotes%ROWTYPE;
  w public.work_orders%ROWTYPE;
  prior public.work_order_quote_acceptances%ROWTYPE;
  owner_source uuid;
  obs_id uuid;
  refusal text;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO q FROM public.work_order_quotes WHERE id=p_quote_id;
  IF FOUND THEN SELECT * INTO w FROM public.work_orders WHERE id=q.work_order_id; END IF;
  IF q.id IS NULL OR w.customer_id IS DISTINCT FROM signer THEN
    RAISE EXCEPTION 'Quote unavailable' USING ERRCODE='42501';
  END IF;
  IF p_quote_hash IS DISTINCT FROM q.quote_hash THEN
    RAISE EXCEPTION 'Quote hash does not match this quote version' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_quote:'||w.id::text,0));
  refusal := public.work_order_quote_acceptance_refusal(q.id,signer,signed);
  IF refusal IS NOT NULL THEN RAISE EXCEPTION 'Quote cannot be accepted: %',refusal USING ERRCODE='42501'; END IF;
  SELECT a.* INTO prior FROM public.work_order_quote_acceptances a JOIN public.vehicle_observations s ON s.id=a.id
    WHERE a.quote_id=q.id AND a.signer_user_id=signer AND s.is_superseded IS FALSE
    ORDER BY a.signed_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('acceptance_id',prior.id,'quote_id',q.id,'quote_version',q.version,'quote_hash',q.quote_hash,
      'work_order_id',w.id,'signed_at',prior.signed_at,'signer_role','customer','duplicate',true,
      'work_order_status_changed',false,'deposit_collected',false,'payment_authorized',false);
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug='owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  INSERT INTO public.vehicle_observations(vehicle_id,source_id,source_identifier,observed_at,observed_at_basis,
    source_event_at,source_event_time_precision,kind,content_text,content_hash,structured_data,submitted_by_user_id,
    observer_raw,extraction_method,confidence,confidence_score)
  VALUES(w.vehicle_id,owner_source,'work_order_quote_acceptance:'||q.id::text,signed,'event_time',signed,'exact','work_record',
    format('Customer accepted quote version %s for work order %s (quote hash %s).',q.version,w.id,q.quote_hash),
    md5('work-order-quote-acceptance:'||signer::text||':'||q.id::text||':'||signed::text),
    jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','quote_acceptance',
      'work_order_id',w.id,'quote_id',q.id,'quote_hash',q.quote_hash,'signer_user_id',signer,'signer_role','customer')),
    signer,jsonb_build_object('user_id',signer,'intake_actor','account'),'work_order_quote_acceptance_sign_v1','high',0.95)
  RETURNING id INTO obs_id;
  PERFORM set_config('nuke.work_order_quote_sign',obs_id::text,true);
  PERFORM public.project_work_order_resource_observation(obs_id);
  PERFORM set_config('nuke.work_order_quote_sign','',true);
  RETURN jsonb_build_object('acceptance_id',obs_id,'quote_id',q.id,'quote_version',q.version,'quote_hash',q.quote_hash,
    'work_order_id',w.id,'signed_at',signed,'signer_role','customer','duplicate',false,
    'work_order_status_changed',false,'deposit_collected',false,'payment_authorized',false);
END $$;
REVOKE ALL ON FUNCTION public.accept_work_order_quote(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_work_order_quote(uuid,text) TO authenticated;
COMMENT ON FUNCTION public.accept_work_order_quote(uuid,text) IS 'Sign: the work order customer (auth.uid() = work_orders.customer_id) accepts one exact current quote version by its hash. Writes an owner-input work_record and its quote_acceptance projection. Changes no work_orders status or clock; collects no deposit; authorizes no payment.';

-- Reader: one work order's quotes for a party of that work order.
CREATE FUNCTION public.work_order_quotes_read(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  viewer uuid := auth.uid();
  w public.work_orders%ROWTYPE;
  cur record;
  acc record;
  is_customer boolean; is_org_owner boolean; is_quoting boolean := false; is_vehicle boolean; is_admin boolean;
  money boolean; scope_matches boolean; expired boolean; eligible boolean;
  current_scope jsonb; quote jsonb; history jsonb; acceptance jsonb;
  n_versions integer; n_current integer; n_acceptances integer;
BEGIN
  IF viewer IS NULL OR NOT public.work_order_is_accessible(p_work_order_id) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO w FROM public.work_orders WHERE id=p_work_order_id;
  current_scope := public.work_order_quote_scope_snapshot(w.id);

  SELECT x.*,s.observed_at,s.ingested_at,s.source_id,s.extraction_method,s.confidence_score INTO cur
    FROM public.work_order_quotes x JOIN public.vehicle_observations s ON s.id=x.id
    WHERE x.work_order_id=w.id AND s.is_superseded IS FALSE AND s.vehicle_id IS NOT DISTINCT FROM w.vehicle_id
    ORDER BY x.version DESC LIMIT 1;

  SELECT count(*),count(*) FILTER (WHERE s.is_superseded IS FALSE AND s.vehicle_id IS NOT DISTINCT FROM w.vehicle_id),
      COALESCE(jsonb_agg(jsonb_build_object('quote_id',x.id,'version',x.version,'supersedes_quote_id',x.supersedes_quote_id,
        'quote_hash',x.quote_hash,'observed_at',s.observed_at,
        'state',CASE WHEN x.id=cur.id THEN 'current'
          WHEN s.is_superseded IS NOT FALSE OR s.vehicle_id IS DISTINCT FROM w.vehicle_id THEN 'withdrawn' ELSE 'superseded' END,
        'withheld_reason',CASE WHEN x.id=cur.id THEN NULL
          WHEN s.is_superseded IS NOT FALSE OR s.vehicle_id IS DISTINCT FROM w.vehicle_id THEN 'source_withdrawn'
          ELSE 'superseded_by_newer_version' END,
        'acceptances_recorded',(SELECT count(*) FROM public.work_order_quote_acceptances a WHERE a.quote_id=x.id))
        ORDER BY x.version),'[]'::jsonb)
    INTO n_versions,n_current,history
    FROM public.work_order_quotes x JOIN public.vehicle_observations s ON s.id=x.id WHERE x.work_order_id=w.id;

  is_customer := w.customer_id IS NOT DISTINCT FROM viewer;
  is_org_owner := EXISTS (SELECT 1 FROM public.business_ownership bo WHERE bo.business_id=w.organization_id
    AND bo.owner_id=viewer AND bo.status='active');
  IF cur.id IS NOT NULL THEN
    is_quoting := cur.quoting_user_id IS NOT DISTINCT FROM viewer OR EXISTS (SELECT 1 FROM public.business_ownership bo
      WHERE bo.business_id=cur.quoting_organization_id AND bo.owner_id=viewer AND bo.status='active');
  END IF;
  is_vehicle := EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id=w.vehicle_id AND (v.user_id=viewer OR v.owner_id=viewer
    OR v.uploaded_by=viewer OR public.vehicle_user_has_access(v.id,viewer)));
  is_admin := EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id=viewer AND au.is_active);
  money := is_customer OR is_quoting OR is_org_owner;

  -- Latest acceptance of any version, with the reason it is withheld from current reads (null = current).
  SELECT a.*,x.version AS quote_version,
      CASE WHEN s.is_superseded IS NOT FALSE OR s.vehicle_id IS DISTINCT FROM w.vehicle_id THEN 'acceptance_source_withdrawn'
        WHEN qs.is_superseded IS NOT FALSE OR qs.vehicle_id IS DISTINCT FROM w.vehicle_id THEN 'quote_source_withdrawn'
        WHEN a.quote_id IS DISTINCT FROM cur.id THEN 'quote_superseded'
        WHEN a.signer_user_id IS DISTINCT FROM w.customer_id THEN 'signer_no_longer_customer'
        WHEN x.scope_snapshot IS DISTINCT FROM current_scope THEN 'scope_changed_since_quote' END AS withheld_reason
    INTO acc
    FROM public.work_order_quote_acceptances a JOIN public.vehicle_observations s ON s.id=a.id
    JOIN public.work_order_quotes x ON x.id=a.quote_id JOIN public.vehicle_observations qs ON qs.id=x.id
    WHERE a.work_order_id=w.id
    ORDER BY COALESCE(s.is_superseded IS FALSE AND a.quote_id=cur.id AND a.signer_user_id IS NOT DISTINCT FROM w.customer_id,false) DESC,
      a.signed_at DESC, a.id
    LIMIT 1;
  SELECT count(*) INTO n_acceptances FROM public.work_order_quote_acceptances WHERE work_order_id=w.id;
  acceptance := jsonb_build_object(
    'state',CASE WHEN acc.id IS NULL THEN 'not_accepted' WHEN acc.withheld_reason IS NULL THEN 'accepted' ELSE 'withheld' END,
    'accepted_by_viewer',acc.id IS NOT NULL AND acc.withheld_reason IS NULL AND acc.signer_user_id=viewer,
    'quote_id',acc.quote_id,'quote_version',acc.quote_version,'quote_hash',acc.quote_hash,
    'signed_at',acc.signed_at,'signer_role',acc.signer_role,'withheld_reason',acc.withheld_reason);

  IF cur.id IS NOT NULL THEN
    scope_matches := cur.scope_snapshot IS NOT DISTINCT FROM current_scope;
    expired := cur.valid_until IS NOT NULL AND cur.valid_until <= statement_timestamp();
    quote := jsonb_build_object('quote_id',cur.id,'version',cur.version,'supersedes_quote_id',cur.supersedes_quote_id,
      'quote_hash',cur.quote_hash,
      'quoting_party',jsonb_build_object('kind',cur.quoting_party_kind,
        'id',COALESCE(cur.quoting_actor_id,cur.quoting_user_id,cur.quoting_organization_id),
        'attribution','source_attributed_not_authenticated'),
      'valid_until',cur.valid_until,'expired',expired,
      'scope_status',CASE WHEN scope_matches THEN 'matches_current' ELSE 'changed_since_quote' END,
      'scope_snapshot',CASE WHEN money THEN cur.scope_snapshot END,
      'scope_counts',(SELECT jsonb_object_agg(k,jsonb_array_length(v)) FROM jsonb_each(cur.scope_snapshot) t(k,v)
        WHERE jsonb_typeof(v)='array'),
      'lines',(SELECT jsonb_agg(CASE WHEN money THEN l ELSE l||jsonb_build_object('amount',NULL,'currency',NULL) END ORDER BY n)
        FROM jsonb_array_elements(cur.lines) WITH ORDINALITY t(l,n)),
      'unpriced_lines',(SELECT count(*) FROM jsonb_array_elements(cur.lines) l WHERE l->>'amount' IS NULL),
      'totals_by_currency',CASE WHEN money THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency',c,'total',t,'complete',k) ORDER BY c),'[]'::jsonb)
        FROM (SELECT l->>'currency' c,
            sum(CASE WHEN l->>'pricing_basis'='flat' THEN (l->>'amount')::numeric
              WHEN l->>'quantity' IS NOT NULL THEN (l->>'amount')::numeric*(l->>'quantity')::numeric END) t,
            bool_and(l->>'pricing_basis'='flat' OR l->>'quantity' IS NOT NULL) k
          FROM jsonb_array_elements(cur.lines) l WHERE l->>'amount' IS NOT NULL GROUP BY 1) x) END,
      'totals_basis','flat amounts plus rate times stated quantity; a rate line without a quantity leaves its currency incomplete',
      'deposit_requested',CASE WHEN money AND cur.deposit_requested_amount IS NOT NULL THEN
        jsonb_build_object('amount',cur.deposit_requested_amount,'currency',cur.deposit_requested_currency) END,
      'source',jsonb_build_object('observation_id',cur.id,'source_id',cur.source_id,'extraction_method',cur.extraction_method,
        'confidence_score',cur.confidence_score,'observed_at',cur.observed_at,'ingested_at',cur.ingested_at),
      'recorded_at',cur.recorded_at);
  END IF;

  eligible := cur.id IS NOT NULL AND public.work_order_quote_acceptance_refusal(cur.id,viewer,statement_timestamp()) IS NULL
    AND NOT (acc.id IS NOT NULL AND acc.withheld_reason IS NULL AND acc.quote_id=cur.id);

  RETURN jsonb_build_object('work_order_id',w.id,'as_of',statement_timestamp(),
    'work_order_status',w.status,
    'quoted_at',jsonb_build_object('stored',w.quoted_at,'derived',cur.observed_at,'basis','current quote observation clock'),
    'approved_at',jsonb_build_object('stored',w.approved_at,
      'derived',CASE WHEN acc.id IS NOT NULL AND acc.withheld_reason IS NULL THEN acc.signed_at END,
      'basis','current quote acceptance sign clock; work_orders.approved_at is not written by this path'),
    'current_quote',quote,'history',history,'acceptance',acceptance,
    'viewer',jsonb_build_object(
      'context',CASE WHEN is_customer THEN 'customer' WHEN is_quoting OR is_org_owner THEN 'provider'
        WHEN is_vehicle THEN 'vehicle_access' WHEN is_admin THEN 'platform_admin' ELSE 'party' END,
      'slots',to_jsonb(array_remove(ARRAY[CASE WHEN is_customer THEN 'customer' END,CASE WHEN is_quoting THEN 'quoting_party' END,
        CASE WHEN is_org_owner THEN 'work_order_organization_owner' END,CASE WHEN is_vehicle THEN 'vehicle_access' END,
        CASE WHEN is_admin THEN 'platform_admin' END],NULL)),
      'money_visible',money,'contact_visible',false,'decided_from','auth.uid()',
      'actions',CASE WHEN eligible THEN jsonb_build_array(jsonb_build_object('action','accept_quote','rpc','accept_work_order_quote',
        'args',jsonb_build_object('p_quote_id',cur.id,'p_quote_hash',cur.quote_hash))) ELSE '[]'::jsonb END),
    'coverage',jsonb_build_object('quote_versions',n_versions,'versions_with_current_source',n_current,
      'acceptances_recorded',n_acceptances,'source_scope','explicitly_projected_work_record_observations',
      'money',CASE WHEN money THEN 'visible' ELSE 'withheld_for_viewer' END,'customer_contact','never_returned',
      'quoting_party_authentication','not_assessed'),
    'deposit_collected','not_established','payment_authorized',false,'disbursement','not_performed');
END $$;
REVOKE ALL ON FUNCTION public.work_order_quotes_read(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.work_order_quotes_read(uuid) TO authenticated;
COMMENT ON FUNCTION public.work_order_quotes_read(uuid) IS 'Authenticated quote reader for one work order, gated by work_order_is_accessible: current quote, version history, acceptance state (withheld when superseded, withdrawn or out of scope), viewer slots and actions decided from auth.uid(). Amounts only for the customer and provider side; never customer contact. Read-only.';

INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES
 ('work_order_quotes','id','project_work_order_quote_event','Quote versions projected from work_record testimony (event type quote); source id is the idempotency key.',true,'project_work_order_resource_observation(uuid)'),
 ('work_order_quote_acceptances','id','accept_work_order_quote','Customer Sign over an exact quote version; owner-input work_record plus its projection.',true,'accept_work_order_quote(uuid,text)');
NOTIFY pgrst, 'reload schema';
COMMIT;
