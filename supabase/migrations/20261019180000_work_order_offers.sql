-- Provider offers on requirements (QUOTE lane RSI pass 5: close the matching loop). Loop: open_requirements_read lists
-- a requirement with an explainable match -> a provider OFFERS -> the client ACCEPTS a provider -> quote -> acceptance.
-- This slice is the offer (theory decisions 2, 4, 8; R3 sections 4 and 7).
--
--   * An offer is a candidate arrangement made by the provider, so it extends work_order_resource_fulfillments (the
--     existing immutable, observation-keyed candidate owner that every resource reader already lists) instead of a
--     new table: offer_kind (individual | organization), offer_rung (the offerer's evidence rung at offer time),
--     offer_terms (priced lines like quote lines) and offer_hash. No user id or free text is added to the row (the
--     open resource readers pass fulfillment columns through); the offering user and any note stay on the signed
--     source observation.
--   * offer_on_requirement(p_requirement_id, p_terms, p_available_from, p_available_until, p_note) is the provider's
--     Sign. Individual: an account_link_claims actor claim of any rung (pending self_claim included; the rung is
--     recorded) offers that actor as performer on a skill or inspection requirement, the account as contracting
--     party. Organization (p_terms.organization_id): an active business_ownership owner offers the organization as
--     facility on a facility requirement, or as contracting party for a named performer actor on a skill or
--     inspection requirement (the actor is attributed by the organization, not authenticated). Terms: lines with
--     pricing_basis flat | hourly (hour) | day_rate (day) | per_operation (operation), a currency with every amount;
--     an unpriced offer is allowed. The work order must be open (not completed, paid, cancelled, rejected) on a public
--     vehicle or one the provider holds a slot on; the customer cannot offer on their own job.
--   * One current offer per offering account and requirement: a new offer supersedes the previous one;
--     withdraw_offer(p_offer_id) writes a withdrawal record that supersedes it. Superseded offers leave every reader.
--   * Projection: event type offer through project_work_order_resource_observation (offer_acceptance is reserved for
--     accept_offer), accepted only inside the Sign RPC. No payment, no messaging, no acceptance here.
-- Contract: supabase/sql/test_work_order_offers.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.work_order_resource_fulfillments
  ADD COLUMN offer_kind text CHECK (offer_kind IN ('individual','organization')),
  ADD COLUMN offer_rung text CHECK (offer_rung IN ('unknown','self_claim','work_evidence','co_sign','authenticated_sign','organization_owner')),
  ADD COLUMN offer_terms jsonb CHECK (jsonb_typeof(offer_terms) = 'object'),
  ADD COLUMN offer_hash text CHECK (offer_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT work_resource_offer_complete CHECK (num_nonnulls(offer_kind, offer_rung, offer_terms, offer_hash) IN (0,4));
COMMENT ON COLUMN public.work_order_resource_fulfillments.offer_kind IS 'Set when this candidate is a provider offer (offer_on_requirement): individual (an actor-claiming account) or organization. Null for attributed candidates.';
COMMENT ON COLUMN public.work_order_resource_fulfillments.offer_rung IS 'Evidence rung of the offerer at offer time: unknown, self_claim, work_evidence, co_sign, authenticated_sign (actor claim) or organization_owner. A rung is not competence.';
COMMENT ON COLUMN public.work_order_resource_fulfillments.offer_terms IS 'Offered terms {lines:[{description, pricing_basis, amount, currency, unit, quantity}]}; a currency with every amount. Terms are open; payment is not implied.';
COMMENT ON COLUMN public.work_order_resource_fulfillments.offer_hash IS 'SHA-256 of the canonical offer; accept_offer must present it.';

-- Offer lines: the quote line rules without references.
CREATE FUNCTION public.work_order_offer_terms_normalize(p_terms jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE ln jsonb; lines jsonb := '[]'::jsonb; raw jsonb := COALESCE(p_terms->'lines', '[]'::jsonb);
BEGIN
  IF p_terms IS NOT NULL AND (jsonb_typeof(p_terms) IS DISTINCT FROM 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_terms) k WHERE k NOT IN ('lines','organization_id','performer_actor_id'))) THEN
    RAISE EXCEPTION 'Terms must be {lines, organization_id?, performer_actor_id?}' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(raw) IS DISTINCT FROM 'array' OR jsonb_array_length(raw) > 20 THEN
    RAISE EXCEPTION 'Offer lines must be an array of at most 20 lines' USING ERRCODE = '23514';
  END IF;
  FOR ln IN SELECT value FROM jsonb_array_elements(raw) LOOP
    IF jsonb_typeof(ln) IS DISTINCT FROM 'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(ln) k WHERE k NOT IN ('description','pricing_basis','amount','currency','unit','quantity'))
      OR jsonb_typeof(ln->'description') IS DISTINCT FROM 'string' OR length(btrim(ln->>'description')) NOT BETWEEN 1 AND 300
      OR position(E'\n' IN ln->>'description') > 0
      OR COALESCE(ln->>'pricing_basis','') NOT IN ('flat','hourly','day_rate','per_operation')
      OR ln->>'unit' IS DISTINCT FROM (CASE ln->>'pricing_basis' WHEN 'hourly' THEN 'hour' WHEN 'day_rate' THEN 'day'
        WHEN 'per_operation' THEN 'operation' END)
      OR (ln->>'amount' IS NOT NULL AND (jsonb_typeof(ln->'amount') <> 'number' OR (ln->>'amount')::numeric < 0))
      OR (ln->>'amount' IS NULL) <> (ln->>'currency' IS NULL)
      OR (ln->>'currency' IS NOT NULL AND (jsonb_typeof(ln->'currency') <> 'string' OR ln->>'currency' !~ '^[A-Z]{3}$'))
      OR (ln->>'quantity' IS NOT NULL AND (ln->>'pricing_basis' = 'flat' OR jsonb_typeof(ln->'quantity') <> 'number'
        OR (ln->>'quantity')::numeric <= 0)) THEN
      RAISE EXCEPTION 'Invalid offer line: %', ln USING ERRCODE = '23514';
    END IF;
    lines := lines || jsonb_build_array(jsonb_build_object('description', btrim(ln->>'description'),
      'pricing_basis', ln->>'pricing_basis', 'amount', ln->'amount', 'currency', ln->'currency', 'unit', ln->'unit',
      'quantity', ln->'quantity'));
  END LOOP;
  RETURN jsonb_build_object('lines', lines);
END $$;
REVOKE ALL ON FUNCTION public.work_order_offer_terms_normalize(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Called only by project_work_order_resource_observation, which has already qualified the source.
CREATE FUNCTION public.project_work_order_offer_event(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  event_type text;
  rkind text;
  owner_source uuid;
  hash text;
BEGIN
  SELECT * INTO o FROM public.vehicle_observations WHERE id = p_observation_id FOR SHARE;
  e := o.structured_data->'work_order_resource';
  event_type := e->>'event_type';
  SELECT * INTO w FROM public.work_orders WHERE id = (e->>'work_order_id')::uuid FOR SHARE;
  IF event_type <> 'offer' THEN RAISE EXCEPTION 'offer_acceptance is recorded only by accept_offer' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_order_resource_fulfillments WHERE id = o.id) THEN
    RETURN jsonb_build_object('id', o.id, 'event_type', event_type, 'duplicate', true);
  END IF;
  IF current_setting('nuke.work_order_offer_sign', true) IS DISTINCT FROM o.id::text THEN
    RAISE EXCEPTION 'An offer is recorded only by offer_on_requirement' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF o.source_id IS DISTINCT FROM owner_source OR o.extraction_method IS DISTINCT FROM 'work_order_offer_sign_v1'
    OR o.submitted_by_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated provider Sign source required' USING ERRCODE = '42501';
  END IF;
  SELECT r.requirement_kind INTO rkind FROM public.work_order_resource_requirements r
    JOIN public.vehicle_observations s ON s.id = r.id
    JOIN public.work_order_line_items li ON li.id = r.line_item_id AND li.work_order_id = w.id
    WHERE r.id = (e->>'requirement_id')::uuid AND r.work_order_id = w.id AND s.is_superseded IS FALSE AND s.vehicle_id = w.vehicle_id
    FOR SHARE OF r, s, li;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current requirement in the same work order required'; END IF;
  IF NOT ((e->>'offer_kind' = 'individual' AND rkind IN ('skill','inspection') AND e->>'performer_actor_id' IS NOT NULL
        AND e->>'supplier_user_id' = o.submitted_by_user_id::text AND e->>'supplier_organization_id' IS NULL AND e->>'facility_organization_id' IS NULL)
      OR (e->>'offer_kind' = 'organization' AND e->>'supplier_organization_id' IS NOT NULL AND e->>'supplier_user_id' IS NULL
        AND ((rkind = 'facility' AND e->>'facility_organization_id' = e->>'supplier_organization_id' AND e->>'performer_actor_id' IS NULL)
          OR (rkind IN ('skill','inspection') AND e->>'performer_actor_id' IS NOT NULL AND e->>'facility_organization_id' IS NULL)))) THEN
    RAISE EXCEPTION 'This offer does not fit a % requirement', rkind USING ERRCODE = '23514';
  END IF;
  hash := encode(sha256(convert_to(jsonb_build_object('offer_id', o.id, 'work_order_id', w.id, 'requirement_id', e->'requirement_id',
    'offer_kind', e->'offer_kind', 'performer_actor_id', e->'performer_actor_id', 'supplier_user_id', e->'supplier_user_id',
    'supplier_organization_id', e->'supplier_organization_id', 'facility_organization_id', e->'facility_organization_id',
    'offer_rung', e->'offer_rung', 'terms', e->'terms', 'available_from', (e->>'available_from')::timestamptz,
    'available_until', (e->>'available_until')::timestamptz)::text, 'UTF8')), 'hex');
  INSERT INTO public.work_order_resource_fulfillments(id, work_order_id, requirement_id, supplier_user_id, supplier_organization_id,
    facility_organization_id, performer_actor_id, available_from, available_until, offer_kind, offer_rung, offer_terms, offer_hash)
  VALUES (o.id, w.id, (e->>'requirement_id')::uuid, (e->>'supplier_user_id')::uuid, (e->>'supplier_organization_id')::uuid,
    (e->>'facility_organization_id')::uuid, (e->>'performer_actor_id')::uuid, (e->>'available_from')::timestamptz,
    (e->>'available_until')::timestamptz, e->>'offer_kind', e->>'offer_rung', e->'terms', hash);
  RETURN jsonb_build_object('id', o.id, 'event_type', event_type, 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.project_work_order_offer_event(uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.project_work_order_offer_event(uuid) IS 'Internal: offer branch of project_work_order_resource_observation (offer_acceptance reserved for accept_offer). No direct grants.';

-- Live definition from 20261019094500 (pg_get_functiondef md5 prefix f697cef0 on 2026-10-19), with offer and
-- offer_acceptance added to the allowlist and delegated after the shared source checks.
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
  IF event_type IS NULL OR event_type NOT IN ('requirement','fulfillment','attestation','specification','operation','quote','quote_acceptance','offer','offer_acceptance') THEN
    RAISE EXCEPTION 'Unknown resource event type';
  END IF;
  SELECT * INTO w FROM public.work_orders WHERE id=(e->>'work_order_id')::uuid FOR SHARE;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN
    RAISE EXCEPTION 'Source and work order must identify the same vehicle';
  END IF;
  IF event_type IN ('quote','quote_acceptance') THEN
    RETURN public.project_work_order_quote_event(o.id);
  END IF;
  IF event_type IN ('offer','offer_acceptance') THEN
    RETURN public.project_work_order_offer_event(o.id);
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
COMMENT ON FUNCTION public.project_work_order_resource_observation(uuid) IS 'Service-only typed projection of an existing current work_record admitted through ingest-observation. Never inserts or changes testimony, permissions, bookings or payments. quote_acceptance projects only inside accept_work_order_quote; offer and offer_acceptance only inside their Sign RPCs.';

-- Who the caller can offer as on one requirement, or why not. Shared by the Sign RPC and the offers reader.
CREATE FUNCTION public.work_order_offer_eligibility(p_user uuid, p_requirement_id uuid, p_organization_id uuid DEFAULT NULL,
  p_performer_actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  w public.work_orders%ROWTYPE;
  rkind text;
  actors jsonb;
  pick jsonb;
BEGIN
  IF p_user IS NULL THEN RETURN jsonb_build_object('eligible', false, 'reason', 'authentication_required'); END IF;
  SELECT w0.* INTO w FROM public.work_order_resource_requirements r
    JOIN public.vehicle_observations s ON s.id = r.id
    JOIN public.work_orders w0 ON w0.id = r.work_order_id AND w0.vehicle_id = s.vehicle_id
    WHERE r.id = p_requirement_id AND s.is_superseded IS FALSE;
  IF NOT FOUND THEN RETURN jsonb_build_object('eligible', false, 'reason', 'requirement_unavailable'); END IF;
  SELECT r.requirement_kind INTO rkind FROM public.work_order_resource_requirements r WHERE r.id = p_requirement_id;
  IF w.status IN ('completed','paid','cancelled','rejected')
    OR NOT (public.work_order_vehicle_open(w.vehicle_id)
      OR cardinality(COALESCE((SELECT s.slots FROM public.work_order_viewer_slots(p_user, w.id) s), '{}'::text[])) > 0) THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'requirement_unavailable');
  END IF;
  IF w.customer_id IS NOT DISTINCT FROM p_user THEN RETURN jsonb_build_object('eligible', false, 'reason', 'customer_cannot_offer'); END IF;
  IF p_organization_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.business_ownership bo WHERE bo.business_id = p_organization_id AND bo.owner_id = p_user AND bo.status = 'active') THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'not_organization_owner');
    END IF;
    IF rkind = 'facility' AND p_performer_actor_id IS NULL THEN
      RETURN jsonb_build_object('eligible', true, 'offer_kind', 'organization', 'rung', 'organization_owner', 'requirement_kind', rkind,
        'supplier_organization_id', p_organization_id, 'facility_organization_id', p_organization_id);
    ELSIF rkind IN ('skill','inspection') AND p_performer_actor_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.actors a WHERE a.id = p_performer_actor_id) THEN
      RETURN jsonb_build_object('eligible', true, 'offer_kind', 'organization', 'rung', 'organization_owner', 'requirement_kind', rkind,
        'supplier_organization_id', p_organization_id, 'performer_actor_id', p_performer_actor_id);
    END IF;
    RETURN jsonb_build_object('eligible', false, 'reason', 'organization_offer_needs_facility_or_named_performer');
  END IF;
  IF rkind NOT IN ('skill','inspection') THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'individual_offers_cover_skill_and_inspection');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('actor_id', x.actor_id, 'rung', x.rung) ORDER BY x.actor_id), '[]'::jsonb) INTO actors
    FROM (SELECT c.actor_id, (array_agg(CASE WHEN c.status = 'approved' THEN c.verification_method
        ELSE COALESCE(NULLIF(c.verification_method, ''), 'self_claim') END
        ORDER BY array_position(ARRAY['authenticated_sign','co_sign','work_evidence','self_claim','unknown'],
          CASE WHEN c.status = 'approved' THEN c.verification_method ELSE COALESCE(NULLIF(c.verification_method, ''), 'self_claim') END)))[1] AS rung
      FROM public.account_link_claims c
      WHERE c.user_id = p_user AND c.actor_id IS NOT NULL AND c.status IN ('pending','approved')
      GROUP BY c.actor_id) x;
  IF jsonb_array_length(actors) = 0 THEN RETURN jsonb_build_object('eligible', false, 'reason', 'no_actor_link'); END IF;
  IF p_performer_actor_id IS NOT NULL THEN
    SELECT a INTO pick FROM jsonb_array_elements(actors) a WHERE a->>'actor_id' = p_performer_actor_id::text;
    IF pick IS NULL THEN RETURN jsonb_build_object('eligible', false, 'reason', 'actor_not_linked_to_account'); END IF;
  ELSIF jsonb_array_length(actors) = 1 THEN
    pick := actors->0;
  ELSE
    RETURN jsonb_build_object('eligible', false, 'reason', 'name_performer_actor_id', 'linked_actor_count', jsonb_array_length(actors));
  END IF;
  RETURN jsonb_build_object('eligible', true, 'offer_kind', 'individual', 'rung', COALESCE(pick->>'rung', 'unknown'), 'requirement_kind', rkind,
    'supplier_user_id', p_user, 'performer_actor_id', pick->'actor_id');
END $$;
REVOKE ALL ON FUNCTION public.work_order_offer_eligibility(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.work_order_offer_eligibility(uuid,uuid,uuid,uuid) IS 'Internal: whether and as what an account may offer on a requirement (individual actor claim of any rung, or organization owner), with the reason when not.';

CREATE FUNCTION public.offer_on_requirement(p_requirement_id uuid, p_terms jsonb DEFAULT NULL, p_available_from timestamptz DEFAULT NULL,
  p_available_until timestamptz DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  provider uuid := auth.uid();
  signed timestamptz := now();
  el jsonb;
  terms jsonb;
  w public.work_orders%ROWTYPE;
  req public.work_order_resource_requirements%ROWTYPE;
  owner_source uuid;
  request_key text;
  prev uuid;
  prev_hash text;
  obs_id uuid;
  f public.work_order_resource_fulfillments%ROWTYPE;
BEGIN
  IF provider IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  terms := public.work_order_offer_terms_normalize(p_terms);
  el := public.work_order_offer_eligibility(provider, p_requirement_id, (p_terms->>'organization_id')::uuid,
    (p_terms->>'performer_actor_id')::uuid);
  IF NOT (el->>'eligible')::boolean THEN
    RAISE EXCEPTION 'Offer unavailable: %', el->>'reason' USING ERRCODE = '42501';
  END IF;
  IF num_nonnulls(p_available_from, p_available_until) = 1 OR p_available_from >= p_available_until OR p_available_until <= signed
    OR NOT isfinite(COALESCE(p_available_from, signed)) OR NOT isfinite(COALESCE(p_available_until, signed)) THEN
    RAISE EXCEPTION 'Availability needs a future window with from before until' USING ERRCODE = '23514';
  END IF;
  IF p_note IS NOT NULL AND (length(btrim(p_note)) NOT BETWEEN 1 AND 500 OR position(E'\n' IN p_note) > 0) THEN
    RAISE EXCEPTION 'Note must be one line of at most 500 characters' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO req FROM public.work_order_resource_requirements WHERE id = p_requirement_id;
  SELECT * INTO w FROM public.work_orders WHERE id = req.work_order_id;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_offer:'||p_requirement_id::text||':'||provider::text, 0));
  request_key := md5(jsonb_build_array('work-order-offer', provider, p_requirement_id, el, terms, p_available_from, p_available_until, p_note)::text);
  SELECT f0.id, f0.offer_hash INTO prev, prev_hash FROM public.work_order_resource_fulfillments f0
    JOIN public.vehicle_observations s ON s.id = f0.id
    WHERE f0.requirement_id = p_requirement_id AND f0.offer_kind IS NOT NULL AND s.is_superseded IS FALSE
      AND s.submitted_by_user_id = provider AND s.extraction_method = 'work_order_offer_sign_v1'
    ORDER BY s.observed_at DESC LIMIT 1;
  IF prev IS NOT NULL AND (SELECT content_hash FROM public.vehicle_observations WHERE id = prev) = request_key THEN
    RETURN jsonb_build_object('offer_id', prev, 'offer_hash', prev_hash, 'requirement_id', p_requirement_id, 'work_order_id', w.id,
      'duplicate', true, 'payment_authorized', false, 'customer_notified', false);
  END IF;
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw,
    extraction_method, confidence, confidence_score)
  VALUES (w.vehicle_id, owner_source, 'work_order_offer:'||p_requirement_id::text||':'||provider::text, signed, 'event_time', signed, 'exact',
    'work_record', format('Provider offer on requirement %s (%s)%s.', p_requirement_id, el->>'requirement_kind',
      COALESCE(': ' || p_note, '')), request_key,
    jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'offer', 'work_order_id', w.id,
      'requirement_id', p_requirement_id, 'offer_kind', el->'offer_kind', 'offer_rung', el->'rung',
      'performer_actor_id', el->'performer_actor_id', 'supplier_user_id', el->'supplier_user_id',
      'supplier_organization_id', el->'supplier_organization_id', 'facility_organization_id', el->'facility_organization_id',
      'terms', terms, 'available_from', p_available_from, 'available_until', p_available_until, 'note', p_note,
      'supersedes_offer_id', prev)),
    provider, jsonb_build_object('user_id', provider, 'intake_actor', 'account'), 'work_order_offer_sign_v1', 'high', 0.95)
  RETURNING id INTO obs_id;
  PERFORM set_config('nuke.work_order_offer_sign', obs_id::text, true);
  PERFORM public.project_work_order_resource_observation(obs_id);
  PERFORM set_config('nuke.work_order_offer_sign', '', true);
  IF prev IS NOT NULL THEN
    UPDATE public.vehicle_observations SET is_superseded = true, superseded_by = obs_id, superseded_at = signed,
      lineage_chain = array_append(COALESCE(lineage_chain, ARRAY[]::uuid[]), obs_id) WHERE id = prev;
  END IF;
  SELECT * INTO f FROM public.work_order_resource_fulfillments WHERE id = obs_id;
  RETURN jsonb_build_object('offer_id', f.id, 'offer_hash', f.offer_hash, 'requirement_id', p_requirement_id, 'work_order_id', w.id,
    'requirement_kind', el->'requirement_kind', 'offer_kind', f.offer_kind, 'offer_rung', f.offer_rung,
    'performer_actor_id', f.performer_actor_id, 'supplier_organization_id', f.supplier_organization_id,
    'facility_organization_id', f.facility_organization_id, 'terms', f.offer_terms, 'available_from', f.available_from,
    'available_until', f.available_until, 'supersedes_offer_id', prev, 'offered_at', signed, 'duplicate', false,
    'payment_authorized', false, 'customer_notified', false);
END $$;
REVOKE ALL ON FUNCTION public.offer_on_requirement(uuid,jsonb,timestamptz,timestamptz,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offer_on_requirement(uuid,jsonb,timestamptz,timestamptz,text) TO authenticated;
COMMENT ON FUNCTION public.offer_on_requirement(uuid,jsonb,timestamptz,timestamptz,text) IS 'Sign: a provider offers on a requirement: an account with an actor claim of any rung (rung recorded) as the performer on a skill or inspection requirement, or an organization owner for its facility or a named performer. Owner-input work_record projected as a fulfillment offer; a new offer supersedes the account''s previous one on that requirement. No acceptance, payment or messaging.';

CREATE FUNCTION public.withdraw_offer(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  provider uuid := auth.uid();
  signed timestamptz := now();
  f public.work_order_resource_fulfillments%ROWTYPE;
  s public.vehicle_observations%ROWTYPE;
  owner_source uuid;
  obs_id uuid;
BEGIN
  IF provider IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO f FROM public.work_order_resource_fulfillments WHERE id = p_offer_id AND offer_kind IS NOT NULL;
  SELECT * INTO s FROM public.vehicle_observations WHERE id = p_offer_id FOR UPDATE;
  IF f.id IS NULL OR s.is_superseded IS DISTINCT FROM false OR NOT (s.submitted_by_user_id = provider
      OR (f.supplier_organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_ownership bo
        WHERE bo.business_id = f.supplier_organization_id AND bo.owner_id = provider AND bo.status = 'active'))) THEN
    RAISE EXCEPTION 'Offer unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw,
    extraction_method, confidence, confidence_score)
  VALUES (s.vehicle_id, owner_source, 'work_order_offer_withdrawal:'||p_offer_id::text, signed, 'event_time', signed, 'exact', 'work_record',
    format('Provider withdrew offer %s.', p_offer_id), md5('offer-withdrawal:'||p_offer_id::text),
    jsonb_build_object('offer_withdrawal', jsonb_build_object('version', 1, 'offer_id', p_offer_id, 'work_order_id', f.work_order_id,
      'requirement_id', f.requirement_id)),
    provider, jsonb_build_object('user_id', provider, 'intake_actor', 'account'), 'work_order_offer_withdrawal_sign_v1', 'high', 0.95)
  RETURNING id INTO obs_id;
  UPDATE public.vehicle_observations SET is_superseded = true, superseded_by = obs_id, superseded_at = signed,
    lineage_chain = array_append(COALESCE(lineage_chain, ARRAY[]::uuid[]), obs_id) WHERE id = p_offer_id;
  RETURN jsonb_build_object('offer_id', p_offer_id, 'withdrawal_observation_id', obs_id, 'withdrawn_at', signed,
    'work_order_id', f.work_order_id, 'requirement_id', f.requirement_id);
END $$;
REVOKE ALL ON FUNCTION public.withdraw_offer(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_offer(uuid) TO authenticated;
COMMENT ON FUNCTION public.withdraw_offer(uuid) IS 'Sign: the offering account (or an owner of the offering organization) withdraws a current offer: a withdrawal record supersedes the offer source, which then leaves every reader. History kept.';

UPDATE public.pipeline_registry SET write_via = write_via || '; offer_on_requirement(uuid,jsonb,timestamptz,timestamptz,text)'
  WHERE table_name = 'work_order_resource_fulfillments' AND column_name = 'id' AND write_via NOT LIKE '%offer_on_requirement%';
NOTIFY pgrst, 'reload schema';
COMMIT;
