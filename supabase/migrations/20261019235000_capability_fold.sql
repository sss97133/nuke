-- Earned skills (R3 sections 3 and 7, step 7): actor_capabilities gets a writer. A deterministic, idempotent fold derives
-- capability rows from attributed evidence and records every basis id; nothing self-reported counts, and vouches or
-- co-signs never do.
--
--   * capability_evidence_map: the reviewed mapping from evidence keys onto the existing 64 capability_type values
--     (process_key prefixes, component_table system prefixes, operation task_type x system, task_type alone). A tier is
--     derived only where a mapping row defines one (none do yet: tiers stay unknown).
--   * Evidence, per actor (capability_fold_basis):
--       completion_acceptance  direct        a current provider completion attestation the customer accepted; the
--                                            attester's evidenced actor (approved work_evidence/co_sign/authenticated_sign
--                                            link) is credited with the job's mapped operations and performed processes
--       inspection_findings    direct        findings signed by the job's current accepted inspector -> inspection
--       reported_performed_spec direct when the source was signed by an evidenced user of the performer, otherwise
--                                            corroborating (an interpretation of attributed records)
--       component_event        corroborating component_events.actor_id attribution (system / operation mapping)
--       requested_spec_conflict against       the same operation's requested and reported-performed specs differ
--                                            (material or process, as work_order_resource_specifications compares them):
--                                            evidence against the requested capability, never a verdict
--   * actor_capability_basis keeps one row per (actor, capability, basis kind, basis id) with direction, strength and
--     the source clock; actor_capabilities gets derived rows (derivation evidence_fold) with evidence_count,
--     direct/corroborating/against counts, first/last demonstrated from source clocks. The three hand-entered rows
--     stay derivation legacy_hand_entered and are never recounted.
--   * Event-driven: the fold reruns for the affected actors when a completion acceptance, inspection findings, a
--     specification, a component_events attribution or an identity link is written (no cron). A fold error is
--     reported as a warning and never blocks the writer.
--   * Backfilled once below over the existing attributed evidence.
-- Contract: supabase/sql/test_capability_fold.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.actor_capabilities
  ADD COLUMN derivation text NOT NULL DEFAULT 'legacy_hand_entered' CHECK (derivation IN ('legacy_hand_entered','evidence_fold')),
  ADD COLUMN strength text CHECK (strength IN ('direct','corroborating')),
  ADD COLUMN direct_count integer CHECK (direct_count >= 0),
  ADD COLUMN corroborating_count integer CHECK (corroborating_count >= 0),
  ADD COLUMN against_count integer CHECK (against_count >= 0),
  ADD COLUMN folded_at timestamptz,
  ALTER COLUMN complexity_tier DROP NOT NULL,
  ADD CONSTRAINT actor_capabilities_tier_known_for_legacy CHECK (derivation = 'evidence_fold' OR complexity_tier IS NOT NULL),
  ADD CONSTRAINT actor_capabilities_fold_complete CHECK (derivation <> 'evidence_fold'
    OR (strength IS NOT NULL AND direct_count IS NOT NULL AND corroborating_count IS NOT NULL AND against_count IS NOT NULL AND folded_at IS NOT NULL));
CREATE UNIQUE INDEX actor_capabilities_fold_unique ON public.actor_capabilities(actor_id, capability_type) WHERE derivation = 'evidence_fold';
COMMENT ON COLUMN public.actor_capabilities.derivation IS 'legacy_hand_entered (pre-fold rows without basis) or evidence_fold (capability_fold_actor; basis in actor_capability_basis).';
COMMENT ON COLUMN public.actor_capabilities.strength IS 'direct when any basis is a customer-accepted provider completion, accepted-inspector findings or a performer-signed report; otherwise corroborating.';

CREATE TABLE public.capability_evidence_map (
  kind text NOT NULL CHECK (kind IN ('process_key','component_system','task_system','task_type')),
  source_key text NOT NULL CHECK (source_key ~ '^[a-z0-9_.:]+$'),
  system_key text,
  capability_type text,
  complexity_tier text CHECK (complexity_tier IN ('basic','intermediate','advanced','expert','master')),
  note text,
  PRIMARY KEY (kind, source_key),
  CHECK ((kind = 'component_system') = (system_key IS NOT NULL)),
  CHECK (kind = 'component_system' OR capability_type IS NOT NULL)
);
COMMENT ON TABLE public.capability_evidence_map IS 'Reviewed mapping (checked into 20261019235000) from evidence keys onto actor_capabilities.capability_type. process_key and component_system match the key or a finer dotted/underscored key (longest wins); task_system is task_type:system_key. A tier only where defined.';
INSERT INTO public.capability_evidence_map(kind, source_key, system_key, capability_type, note) VALUES
  ('process_key', 'welding.tig', NULL, 'welding_tig', NULL),
  ('process_key', 'welding.mig', NULL, 'welding_mig', NULL),
  ('process_key', 'welding.stick', NULL, 'welding_stick', NULL),
  ('process_key', 'welding.gas', NULL, 'welding_gas', NULL),
  ('process_key', 'welding.oxyacetylene', NULL, 'welding_gas', NULL),
  ('process_key', 'welding.brazing', NULL, 'welding_brazing', NULL),
  ('process_key', 'brazing', NULL, 'welding_brazing', NULL),
  ('process_key', 'machining.lathe', NULL, 'machine_lathe', NULL),
  ('process_key', 'machining.mill', NULL, 'machine_mill', NULL),
  ('process_key', 'machining.cnc', NULL, 'machine_cnc', NULL),
  ('process_key', 'machining.hone', NULL, 'machine_hone', NULL),
  ('process_key', 'machining.grind', NULL, 'machine_grind', NULL),
  ('process_key', 'paint.refinish', NULL, 'paint_refinish', NULL),
  ('process_key', 'coating.powder', NULL, 'powder_coating', NULL),
  ('process_key', 'plating.chrome', NULL, 'chrome_plating', NULL),
  ('process_key', 'anodizing', NULL, 'anodizing', NULL),
  ('component_system', 'engine_exhaust', 'exhaust', 'exhaust_system', NULL),
  ('component_system', 'exhaust', 'exhaust', 'exhaust_system', NULL),
  ('component_system', 'engine_intake', 'intake', 'intake_system', NULL),
  ('component_system', 'intake', 'intake', 'intake_system', NULL),
  ('component_system', 'engine_fuel', 'fuel', 'fuel_system', NULL),
  ('component_system', 'fuel', 'fuel', 'fuel_system', NULL),
  ('component_system', 'engine_cooling', 'cooling', 'cooling_system', NULL),
  ('component_system', 'cooling', 'cooling', 'cooling_system', NULL),
  ('component_system', 'radiator', 'cooling', 'cooling_system', NULL),
  ('component_system', 'electrical', 'electrical', 'electrical_repair', NULL),
  ('component_system', 'wiring', 'electrical', 'electrical_repair', NULL),
  ('component_system', 'ac', 'hvac', 'ac_system', NULL),
  ('component_system', 'hvac', 'hvac', 'ac_system', NULL),
  ('component_system', 'audio', 'audio', 'audio_system', NULL),
  ('component_system', 'hydraulic', 'hydraulic', 'hydraulics', NULL),
  ('component_system', 'brake', 'brake', NULL, 'installing brake parts alone names no capability'),
  ('component_system', 'suspension', 'suspension', NULL, 'installing suspension parts alone names no capability'),
  ('component_system', 'steering', 'steering', NULL, 'installing steering parts alone names no capability'),
  ('component_system', 'frame', 'frame', NULL, NULL),
  ('component_system', 'body', 'body', NULL, NULL),
  ('component_system', 'transmission', 'transmission', NULL, NULL),
  ('component_system', 'differential', 'differential', NULL, NULL),
  ('component_system', 'transfer_case', 'transfer_case', NULL, NULL),
  ('task_system', 'fabricate:exhaust', NULL, 'fabrication_exhaust', NULL),
  ('task_system', 'fabricate:brake', NULL, 'brake_fabrication', NULL),
  ('task_system', 'fabricate:suspension', NULL, 'suspension_fabrication', NULL),
  ('task_system', 'fabricate:steering', NULL, 'steering_fabrication', NULL),
  ('task_system', 'fabricate:frame', NULL, 'frame_fabrication', NULL),
  ('task_system', 'fabricate:body', NULL, 'body_fabrication', NULL),
  ('task_system', 'rebuild:brake', NULL, 'brake_rebuild', NULL),
  ('task_system', 'rebuild:suspension', NULL, 'suspension_rebuild', NULL),
  ('task_system', 'rebuild:steering', NULL, 'steering_rebuild', NULL),
  ('task_system', 'rebuild:transmission', NULL, 'transmission_rebuild', NULL),
  ('task_system', 'rebuild:differential', NULL, 'differential_rebuild', NULL),
  ('task_system', 'rebuild:transfer_case', NULL, 'transfer_case_rebuild', NULL),
  ('task_system', 'repair:frame', NULL, 'frame_repair', NULL),
  ('task_system', 'repair:body', NULL, 'body_repair', NULL),
  ('task_system', 'repair:electrical', NULL, 'electrical_repair', NULL),
  ('task_type', 'inspect', NULL, 'inspection', NULL),
  ('task_type', 'paint', NULL, 'paint_refinish', NULL);
ALTER TABLE public.capability_evidence_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capability_evidence_map FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.capability_evidence_map TO anon, authenticated, service_role;
CREATE POLICY capability_evidence_map_read ON public.capability_evidence_map FOR SELECT USING (true);

CREATE TABLE public.actor_capability_basis (
  actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE CASCADE,
  capability_type text NOT NULL,
  basis_kind text NOT NULL CHECK (basis_kind IN ('completion_acceptance','inspection_findings','reported_performed_spec','component_event','requested_spec_conflict')),
  basis_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('for','against')),
  strength text NOT NULL CHECK (strength IN ('direct','corroborating')),
  work_order_id uuid,
  line_item_id uuid,
  demonstrated_on date,
  complexity_tier text,
  reason text,
  folded_at timestamptz NOT NULL,
  PRIMARY KEY (actor_id, capability_type, basis_kind, basis_id)
);
COMMENT ON TABLE public.actor_capability_basis IS 'Basis ids behind each evidence_fold actor_capabilities row (capability_fold_actor rewrites an actor''s rows). Service-only: basis ids can name private jobs.';
ALTER TABLE public.actor_capability_basis ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.actor_capability_basis FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.actor_capability_basis TO service_role;
CREATE POLICY actor_capability_basis_service_read ON public.actor_capability_basis FOR SELECT TO service_role USING (true);

CREATE FUNCTION public.capability_map_process(p_key text) RETURNS TABLE(capability_type text, complexity_tier text)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT m.capability_type, m.complexity_tier FROM public.capability_evidence_map m
  WHERE m.kind = 'process_key' AND p_key IS NOT NULL AND (p_key = m.source_key OR starts_with(p_key, m.source_key || '.'))
  ORDER BY length(m.source_key) DESC LIMIT 1
$$;
CREATE FUNCTION public.capability_map_operation(p_task_type text, p_component_table text) RETURNS TABLE(capability_type text, complexity_tier text)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  WITH sys AS (SELECT m.system_key, m.capability_type, m.complexity_tier FROM public.capability_evidence_map m
      WHERE m.kind = 'component_system' AND p_component_table IS NOT NULL
        AND (p_component_table = m.source_key OR starts_with(p_component_table, m.source_key || '_'))
      ORDER BY length(m.source_key) DESC LIMIT 1),
    ts AS (SELECT m.capability_type, m.complexity_tier FROM public.capability_evidence_map m, sys
      WHERE m.kind = 'task_system' AND m.source_key = p_task_type || ':' || sys.system_key),
    tt AS (SELECT m.capability_type, m.complexity_tier FROM public.capability_evidence_map m WHERE m.kind = 'task_type' AND m.source_key = p_task_type)
  SELECT * FROM ts
  UNION ALL SELECT s.capability_type, s.complexity_tier FROM sys s WHERE s.capability_type IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ts)
  UNION ALL SELECT * FROM tt WHERE NOT EXISTS (SELECT 1 FROM ts) AND NOT EXISTS (SELECT 1 FROM sys WHERE sys.capability_type IS NOT NULL)
$$;

CREATE FUNCTION public.capability_evidenced_users(p_actor_id uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(DISTINCT c.user_id), '{}') FROM public.account_link_claims c
  WHERE c.actor_id = p_actor_id AND c.status = 'approved' AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign')
$$;

-- Every basis row the evidence supports for one actor (read-only, deterministic).
CREATE FUNCTION public.capability_fold_basis(p_actor_id uuid)
RETURNS TABLE(capability_type text, basis_kind text, basis_id uuid, direction text, strength text, work_order_id uuid, line_item_id uuid,
  demonstrated_on date, complexity_tier text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE users uuid[] := public.capability_evidenced_users(p_actor_id);
BEGIN
  RETURN QUERY
  WITH specs AS (
    SELECT sp.*, s.submitted_by_user_id, s.observed_at, li.actor_id AS li_actor, ce.actor_id AS ce_actor, ce.event_date
    FROM public.work_order_resource_specifications sp
    JOIN public.vehicle_observations s ON s.id = sp.id AND s.is_superseded IS FALSE
    LEFT JOIN public.work_order_line_items li ON li.id = sp.line_item_id
    LEFT JOIN public.component_events ce ON ce.id = sp.basis_component_event_id
  ), performed AS (
    SELECT * FROM specs WHERE specification_stage = 'reported_performed' AND COALESCE(li_actor, ce_actor) = p_actor_id
  ), accepted AS (
    SELECT acc.id AS acceptance_id, acc.work_order_id, acc.signed_at
    FROM public.work_order_completion_acceptances acc
    JOIN public.vehicle_observations sa ON sa.id = acc.id AND sa.is_superseded IS FALSE
    JOIN public.work_order_completion_attestations att ON att.id = acc.completion_id
    WHERE att.signer_user_id = ANY (users)
      AND public.work_order_completion_overlay(acc.work_order_id, '{}'::jsonb)#>>'{customer_acceptance_sign,acceptance_id}' = acc.id::text
  )
  SELECT m.capability_type, 'component_event'::text, ce.id, 'for'::text, 'corroborating'::text, ce.work_order_id, li.id, ce.event_date,
    m.complexity_tier, format('%s %s attributed to the actor', ce.event_type, ce.component_table)
  FROM public.component_events ce
  LEFT JOIN LATERAL (SELECT x.* FROM public.work_order_line_items x WHERE x.component_event_id = ce.id ORDER BY x.id LIMIT 1) li ON true
  CROSS JOIN LATERAL public.capability_map_operation(li.task_type, ce.component_table) m
  WHERE ce.actor_id = p_actor_id
  UNION ALL
  SELECT m.capability_type, 'reported_performed_spec', p.id, 'for',
    CASE WHEN p.submitted_by_user_id = ANY (users) THEN 'direct' ELSE 'corroborating' END, p.work_order_id, p.line_item_id,
    COALESCE(p.event_date, p.observed_at::date), m.complexity_tier, format('reported performed %s', p.process_key)
  FROM performed p CROSS JOIN LATERAL public.capability_map_process(p.process_key) m
  UNION ALL
  SELECT DISTINCT ON (rq.id, m.capability_type) m.capability_type, 'requested_spec_conflict', rq.id, 'against', 'corroborating', rq.work_order_id,
    rq.line_item_id, COALESCE(p.event_date, p.observed_at::date), NULL::text,
    format('requested %s %s; reported performed %s %s', COALESCE(rq.material_key, '-'), COALESCE(rq.process_key, '-'),
      COALESCE(p.material_key, '-'), COALESCE(p.process_key, '-'))
  FROM specs rq JOIN performed p ON p.line_item_id = rq.line_item_id AND p.id <> rq.id
  CROSS JOIN LATERAL public.capability_map_process(rq.process_key) m
  WHERE rq.specification_stage = 'requested' AND rq.line_item_id IS NOT NULL
    AND ((rq.material_key IS NOT NULL AND p.material_key IS NOT NULL AND rq.material_role = p.material_role AND rq.material_key <> p.material_key
          AND NOT starts_with(rq.material_key, p.material_key || '.') AND NOT starts_with(p.material_key, rq.material_key || '.'))
      OR (rq.process_key IS NOT NULL AND p.process_key IS NOT NULL AND rq.process_key <> p.process_key
          AND NOT starts_with(rq.process_key, p.process_key || '.') AND NOT starts_with(p.process_key, rq.process_key || '.')))
  UNION ALL
  SELECT DISTINCT ON (a.acceptance_id, m.capability_type) m.capability_type, 'completion_acceptance', a.acceptance_id, 'for', 'direct',
    a.work_order_id, NULL::uuid, a.signed_at::date, m.complexity_tier, 'provider completion accepted by the customer'
  FROM accepted a
  CROSS JOIN LATERAL (
    SELECT om.capability_type, om.complexity_tier FROM public.work_order_line_items li
      LEFT JOIN public.component_events ce ON ce.id = li.component_event_id
      CROSS JOIN LATERAL public.capability_map_operation(li.task_type, ce.component_table) om
      WHERE li.work_order_id = a.work_order_id AND (li.actor_id IS NULL OR li.actor_id = p_actor_id) AND li.status IS DISTINCT FROM 'cancelled'
    UNION ALL
    SELECT pm.capability_type, pm.complexity_tier FROM specs sp CROSS JOIN LATERAL public.capability_map_process(sp.process_key) pm
      WHERE sp.work_order_id = a.work_order_id AND sp.specification_stage = 'reported_performed'
        AND (COALESCE(sp.li_actor, sp.ce_actor) IS NULL OR COALESCE(sp.li_actor, sp.ce_actor) = p_actor_id)) m
  UNION ALL
  SELECT 'inspection', 'inspection_findings', o.id, 'for', 'direct', w.id, NULL::uuid, o.observed_at::date, NULL::text,
    'findings signed by the accepted inspector'
  FROM public.work_orders w
  CROSS JOIN LATERAL public.work_order_accepted_providers(w.id) ap
  JOIN public.vehicle_observations o ON o.source_id = (SELECT id FROM public.observation_sources WHERE slug = 'owner-input')
    AND o.source_identifier = 'inspection_findings:' || w.id::text AND o.kind::text = 'work_record' AND o.is_superseded IS FALSE
    AND o.extraction_method = 'inspection_findings_sign_v1' AND o.submitted_by_user_id = ap.account_id
  WHERE w.scope_category = 'inspection' AND ap.role = 'inspector' AND ap.account_id = ANY (users);
END $$;

CREATE FUNCTION public.capability_fold_actor(p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  folded timestamptz := clock_timestamp();
  n_basis integer;
  n_caps integer;
  n_removed integer;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.actors WHERE id = p_actor_id) THEN
    RETURN jsonb_build_object('actor_id', p_actor_id, 'folded', false, 'reason', 'actor_unavailable');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('capability_fold:' || p_actor_id::text, 0));
  DELETE FROM public.actor_capability_basis WHERE actor_id = p_actor_id;
  INSERT INTO public.actor_capability_basis(actor_id, capability_type, basis_kind, basis_id, direction, strength, work_order_id, line_item_id,
    demonstrated_on, complexity_tier, reason, folded_at)
  SELECT DISTINCT ON (b.capability_type, b.basis_kind, b.basis_id) p_actor_id, b.capability_type, b.basis_kind, b.basis_id, b.direction, b.strength,
    b.work_order_id, b.line_item_id, b.demonstrated_on, b.complexity_tier, b.reason, folded
  FROM public.capability_fold_basis(p_actor_id) b
  ORDER BY b.capability_type, b.basis_kind, b.basis_id, b.strength;
  GET DIAGNOSTICS n_basis = ROW_COUNT;
  WITH agg AS (
    SELECT b.capability_type,
      count(*) FILTER (WHERE b.direction = 'for') AS n_for,
      count(*) FILTER (WHERE b.direction = 'for' AND b.strength = 'direct') AS n_direct,
      count(*) FILTER (WHERE b.direction = 'for' AND b.strength = 'corroborating') AS n_corr,
      count(*) FILTER (WHERE b.direction = 'against') AS n_against,
      min(b.demonstrated_on) FILTER (WHERE b.direction = 'for') AS first_on,
      max(b.demonstrated_on) FILTER (WHERE b.direction = 'for') AS last_on,
      (array_agg(b.complexity_tier ORDER BY array_position(ARRAY['master','expert','advanced','intermediate','basic'], b.complexity_tier))
        FILTER (WHERE b.direction = 'for' AND b.complexity_tier IS NOT NULL))[1] AS tier
    FROM public.actor_capability_basis b WHERE b.actor_id = p_actor_id GROUP BY b.capability_type
  ), upserted AS (
    INSERT INTO public.actor_capabilities(actor_id, capability_type, complexity_tier, evidence_count, first_demonstrated, last_demonstrated, notes,
      derivation, strength, direct_count, corroborating_count, against_count, folded_at)
    SELECT p_actor_id, a.capability_type, a.tier, a.n_for, a.first_on, a.last_on,
      'Derived from attributed evidence by capability_fold_actor; basis ids in actor_capability_basis.', 'evidence_fold',
      CASE WHEN a.n_direct > 0 THEN 'direct' ELSE 'corroborating' END, a.n_direct, a.n_corr, a.n_against, folded
    FROM agg a WHERE a.n_for > 0
    ON CONFLICT (actor_id, capability_type) WHERE derivation = 'evidence_fold' DO UPDATE SET
      complexity_tier = EXCLUDED.complexity_tier, evidence_count = EXCLUDED.evidence_count, first_demonstrated = EXCLUDED.first_demonstrated,
      last_demonstrated = EXCLUDED.last_demonstrated, strength = EXCLUDED.strength, direct_count = EXCLUDED.direct_count,
      corroborating_count = EXCLUDED.corroborating_count, against_count = EXCLUDED.against_count, folded_at = EXCLUDED.folded_at
    RETURNING capability_type
  )
  SELECT count(*) INTO n_caps FROM upserted;
  DELETE FROM public.actor_capabilities c WHERE c.actor_id = p_actor_id AND c.derivation = 'evidence_fold'
    AND NOT EXISTS (SELECT 1 FROM public.actor_capability_basis b WHERE b.actor_id = p_actor_id AND b.capability_type = c.capability_type AND b.direction = 'for');
  GET DIAGNOSTICS n_removed = ROW_COUNT;
  RETURN jsonb_build_object('actor_id', p_actor_id, 'folded', true, 'capabilities', n_caps, 'basis_rows', n_basis,
    'against_rows', (SELECT count(*) FROM public.actor_capability_basis WHERE actor_id = p_actor_id AND direction = 'against'), 'removed', n_removed);
END $$;

CREATE FUNCTION public.capability_fold_safe(p_actor_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a uuid;
BEGIN
  FOR a IN SELECT DISTINCT x FROM unnest(p_actor_ids) x WHERE x IS NOT NULL LOOP
    BEGIN
      PERFORM public.capability_fold_actor(a);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'capability fold for actor % failed: %', a, SQLERRM;
    END;
  END LOOP;
END $$;

CREATE FUNCTION public.capability_fold_all() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE a uuid; r jsonb; n_actors integer := 0; n_caps integer := 0; n_basis integer := 0;
BEGIN
  FOR a IN SELECT DISTINCT x FROM (
      SELECT ce.actor_id x FROM public.component_events ce WHERE ce.actor_id IS NOT NULL
      UNION SELECT li.actor_id FROM public.work_order_line_items li WHERE li.actor_id IS NOT NULL
      UNION SELECT c.actor_id FROM public.account_link_claims c WHERE c.actor_id IS NOT NULL AND c.status = 'approved'
        AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign')
      UNION SELECT c.actor_id FROM public.actor_capabilities c WHERE c.derivation = 'evidence_fold') s
    JOIN public.actors ac ON ac.id = s.x ORDER BY x LOOP
    r := public.capability_fold_actor(a);
    n_actors := n_actors + 1; n_caps := n_caps + (r->>'capabilities')::int; n_basis := n_basis + (r->>'basis_rows')::int;
  END LOOP;
  RETURN jsonb_build_object('actors_folded', n_actors, 'capability_rows', n_caps, 'basis_rows', n_basis);
END $$;

CREATE FUNCTION public.capability_fold_on_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actors uuid[] := '{}'; u uuid;
BEGIN
  IF TG_TABLE_NAME = 'component_events' THEN
    actors := ARRAY[NEW.actor_id] || CASE WHEN TG_OP = 'UPDATE' THEN ARRAY[OLD.actor_id] ELSE '{}'::uuid[] END;
  ELSIF TG_TABLE_NAME = 'account_link_claims' THEN
    actors := ARRAY[NEW.actor_id] || CASE WHEN TG_OP = 'UPDATE' THEN ARRAY[OLD.actor_id] ELSE '{}'::uuid[] END;
  ELSIF TG_TABLE_NAME = 'work_order_resource_specifications' THEN
    actors := ARRAY[(SELECT li.actor_id FROM public.work_order_line_items li WHERE li.id = NEW.line_item_id),
      (SELECT ce.actor_id FROM public.component_events ce WHERE ce.id = NEW.basis_component_event_id)];
  ELSIF TG_TABLE_NAME = 'work_order_completion_acceptances' THEN
    u := (SELECT att.signer_user_id FROM public.work_order_completion_attestations att WHERE att.id = NEW.completion_id);
    SELECT COALESCE(array_agg(DISTINCT c.actor_id), '{}') INTO actors FROM public.account_link_claims c
      WHERE c.user_id = u AND c.actor_id IS NOT NULL AND c.status = 'approved' AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign');
  ELSIF TG_TABLE_NAME = 'vehicle_observations' THEN
    SELECT COALESCE(array_agg(DISTINCT c.actor_id), '{}') INTO actors FROM public.account_link_claims c
      WHERE c.user_id = NEW.submitted_by_user_id AND c.actor_id IS NOT NULL AND c.status = 'approved'
        AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign');
  END IF;
  PERFORM public.capability_fold_safe(actors);
  RETURN NULL;
END $$;
CREATE TRIGGER capability_fold_component_events AFTER INSERT OR UPDATE OF actor_id, component_table, event_type, event_date
  ON public.component_events FOR EACH ROW EXECUTE FUNCTION public.capability_fold_on_event();
CREATE TRIGGER capability_fold_account_links AFTER INSERT OR UPDATE OF status, verification_method, actor_id
  ON public.account_link_claims FOR EACH ROW EXECUTE FUNCTION public.capability_fold_on_event();
CREATE TRIGGER capability_fold_specifications AFTER INSERT ON public.work_order_resource_specifications
  FOR EACH ROW EXECUTE FUNCTION public.capability_fold_on_event();
CREATE TRIGGER capability_fold_completion_acceptances AFTER INSERT ON public.work_order_completion_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.capability_fold_on_event();
CREATE TRIGGER capability_fold_inspection_findings AFTER INSERT ON public.vehicle_observations
  FOR EACH ROW WHEN (NEW.extraction_method = 'inspection_findings_sign_v1') EXECUTE FUNCTION public.capability_fold_on_event();

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['capability_map_process(text)','capability_map_operation(text,text)','capability_evidenced_users(uuid)',
      'capability_fold_basis(uuid)','capability_fold_actor(uuid)','capability_fold_safe(uuid[])','capability_fold_all()','capability_fold_on_event()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
COMMENT ON FUNCTION public.capability_fold_actor(uuid) IS 'Service-only, deterministic and idempotent: rewrites one actor''s actor_capability_basis rows and evidence_fold actor_capabilities rows from attributed evidence (capability_fold_basis). Legacy rows untouched.';

INSERT INTO public.pipeline_registry(table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT t, c, 'capability_fold_actor', d, true, 'capability_fold_actor(uuid) (event triggers: completion acceptance, inspection findings, specifications, component_events, account links)'
FROM (VALUES ('actor_capabilities', 'derivation', 'evidence_fold rows are derived from attributed evidence with basis ids; never hand-written.'),
  ('actor_capability_basis', 'basis_id', 'Basis ids behind derived capabilities; rewritten per actor by the fold.')) x(t, c, d)
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r WHERE r.table_name = x.t AND r.column_name = x.c);

SELECT public.capability_fold_all();
NOTIFY pgrst, 'reload schema';
COMMIT;
