-- =============================================================================
-- DRAFT — make_model subject & cohort terminal.  DO NOT APPLY. DO NOT DEPLOY.
-- =============================================================================
-- This is a design artifact for review, companion to
--   docs/library/working/working-papers/2026-06-16_make_model_subject_and_cohort_terminal.md
--
-- It EXTENDS the existing subject system (projection_event + project_attribute +
-- attribute-registry.ts + vehicle_wiki). It does NOT mint a parallel layer.
-- A make_model subject is the cohort analog of a vehicle subject:
--   - keyed by canonical (make, model, year|generation)
--   - truth = weighted consensus of evidence-cited projection_event claims
--   - rendered by get_make_model_terminal(), the cohort analog of vehicle_wiki()
--
-- Schema changes here require Skylar's sign-off (universal invariant #4 +
-- platform-hygiene table rule). The TypeScript-side SubjectKind extension
-- ("make_model") and the MAKE_MODEL registry block are NOT in this file — they
-- live in _shared/cockpit/attribute-registry.ts and the mcp-connector enums.
-- =============================================================================

BEGIN;  -- (illustrative; this draft is not for execution)

-- -----------------------------------------------------------------------------
-- 1. make_model_profiles — the cohort subject row + denormalized header cache.
--    subject_id is what goes into projection_event.request_envelope->>'subject_id'.
--    This is the cohort analog of the `vehicles` header that vehicle_wiki caches.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.make_model_profiles (
  subject_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Canonical key (backbone = canonical_models nomenclature).
  canonical_make    text NOT NULL,                 -- canonical_models.make_canonical, e.g. 'FORD'
  canonical_model   text NOT NULL,                 -- canonical_models.canonical_name,  e.g. 'Mustang'
  grain             text NOT NULL DEFAULT 'year'
                      CHECK (grain IN ('year', 'generation')),
  year              integer,                        -- set when grain='year'
  year_start        integer,                        -- set when grain='generation'
  year_end          integer,
  canonical_model_id uuid REFERENCES public.canonical_models(id),  -- nomenclature link

  -- Denormalized header cache (materialized projection of the consensus claims,
  -- written ONLY by project_make_model_canonical() — never hand-overwritten).
  cohort_count          integer,
  median_price          numeric,
  rarity_tier           text,                       -- mirrors vehicle_production_data.rarity_level
  production_count      integer,
  survival_rate         numeric(5,4),
  sentiment_score       numeric,
  header_refreshed_at   timestamptz,

  -- LAYER-2 ACTIVATION HOOK (the financial index). Stub only — the subject is
  -- always-on; the index switches on at a mass threshold or sponsor funding.
  -- Default 'none' = subject exists, no index. This is NOT built in this draft.
  index_status      text NOT NULL DEFAULT 'none'
                      CHECK (index_status IN ('none', 'eligible', 'activated', 'sponsored')),
  index_sponsor_org_id uuid REFERENCES public.organizations(id),

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Natural key: one subject per (make, model, year, grain).
  UNIQUE (canonical_make, canonical_model, year, grain)
);

CREATE INDEX IF NOT EXISTS idx_mmp_make_model
  ON public.make_model_profiles (lower(canonical_make), lower(canonical_model));
CREATE INDEX IF NOT EXISTS idx_mmp_make_model_year
  ON public.make_model_profiles (lower(canonical_make), lower(canonical_model), year);
CREATE INDEX IF NOT EXISTS idx_mmp_index_status
  ON public.make_model_profiles (index_status) WHERE index_status <> 'none';

ALTER TABLE public.make_model_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mmp_public_read ON public.make_model_profiles;
CREATE POLICY mmp_public_read ON public.make_model_profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS mmp_service_write ON public.make_model_profiles;
CREATE POLICY mmp_service_write ON public.make_model_profiles
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
GRANT SELECT ON public.make_model_profiles TO anon, authenticated;

COMMENT ON TABLE public.make_model_profiles IS
  'First-class make_model (cohort) subject. subject_id pegs projection_event claims; '
  'header columns are the denormalized consensus cache (project_make_model_canonical). '
  'index_status is the Layer-2 financial-index activation hook (default none = subject only).';

-- NOTE on projection_event: NO schema change needed. subject_kind is carried in
-- request_envelope (jsonb), not a column. A make_model claim is just:
--   request_envelope = {subject_id, subject_kind:'make_model', attribute:'make_model.X', audience, as_of}
-- The only code-side change is adding 'make_model' to the SubjectKind union in
-- attribute-registry.ts and the connector enums (TypeScript, not SQL).

-- -----------------------------------------------------------------------------
-- 2. cohort_members(subject_id) — the membership RESOLVER (a query, not a stored
--    edge set). Rides idx_vehicles_lower_make_model + canonical_models.aliases.
--    Same pattern as get_comps_combined's case-insensitive match.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cohort_members(p_subject_id uuid)
RETURNS TABLE(vehicle_id uuid) LANGUAGE plpgsql STABLE AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM public.make_model_profiles WHERE subject_id = p_subject_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT v.id
  FROM public.vehicles v
  LEFT JOIN public.canonical_models cm
    ON cm.id = p.canonical_model_id
  WHERE lower(v.make) = lower(p.canonical_make)
    AND (
      lower(v.model) = lower(p.canonical_model)
      OR (cm.aliases IS NOT NULL AND lower(v.model) = ANY (SELECT lower(a) FROM unnest(cm.aliases) a))
    )
    AND (
      (p.grain = 'year'       AND v.year = p.year)
      OR (p.grain = 'generation' AND v.year BETWEEN p.year_start AND p.year_end)
    );
END;
$$;

COMMENT ON FUNCTION public.cohort_members(uuid) IS
  'Resolver: vehicle_ids belonging to a make_model cohort. A live query (not a stored '
  'FK on vehicles) so membership stays correct as vehicles are added/merged/superseded.';

-- -----------------------------------------------------------------------------
-- 3. register_make_model_subject() — lazy upsert. Subjects are DEMAND-created
--    (on search / atom-fill / vehicle-count floor), never the full YMM Cartesian
--    product. Returns the subject_id to peg projection_event claims on.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_make_model_subject(
  p_make text, p_model text, p_year integer DEFAULT NULL, p_grain text DEFAULT 'year'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_cm public.canonical_models%ROWTYPE;
BEGIN
  -- Resolve canonical nomenclature (and alias-normalize the model).
  SELECT * INTO v_cm FROM public.canonical_models cm
   WHERE lower(cm.make_canonical) = lower(p_make)
     AND (lower(cm.canonical_name) = lower(p_model)
          OR lower(p_model) = ANY (SELECT lower(a) FROM unnest(cm.aliases) a))
   LIMIT 1;

  INSERT INTO public.make_model_profiles
    (canonical_make, canonical_model, grain, year, year_start, year_end, canonical_model_id)
  VALUES (
    upper(COALESCE(v_cm.make_canonical, p_make)),
    COALESCE(v_cm.canonical_name, p_model),
    p_grain,
    CASE WHEN p_grain = 'year' THEN p_year END,
    CASE WHEN p_grain = 'generation' THEN v_cm.year_start END,
    CASE WHEN p_grain = 'generation' THEN v_cm.year_end END,
    v_cm.id
  )
  ON CONFLICT (canonical_make, canonical_model, year, grain) DO UPDATE
    SET updated_at = now()
  RETURNING subject_id INTO v_id;

  RETURN v_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. get_make_model_terminal() — the cohort terminal. ASSEMBLES live aggregates
--    from existing substrate + PROJECTS curated fields via project_attribute().
--    The cohort analog of vehicle_wiki(uuid). Every block carries a populated
--    flag so a sparse block renders dark (intake gap), never a fabricated number.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_make_model_terminal(
  p_make text, p_model text, p_year integer DEFAULT NULL, p_grain text DEFAULT 'year'
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_subject uuid;
  v_ids uuid[];
  v_count int;
  v_price jsonb;
  v_flow jsonb;
  v_sentiment jsonb;
  v_production jsonb;
  v_survival jsonb;
  v_cited jsonb;
BEGIN
  -- Resolve (do NOT create here; registration is a separate, writable call).
  SELECT subject_id INTO v_subject FROM public.make_model_profiles
   WHERE lower(canonical_make) = lower(p_make)
     AND lower(canonical_model) = lower(p_model)
     AND grain = p_grain
     AND (p_grain <> 'year' OR year = p_year)
   LIMIT 1;

  IF v_subject IS NULL THEN
    RETURN jsonb_build_object(
      'resolved', false,
      'note', 'No make_model subject registered yet — call register_make_model_subject(). '
              'Absence is an intake gap, not a market verdict.');
  END IF;

  SELECT array_agg(vehicle_id) INTO v_ids FROM public.cohort_members(v_subject);
  v_count := COALESCE(array_length(v_ids, 1), 0);

  -- ── ASSEMBLE: price distribution + median over member auction events ────────
  SELECT jsonb_build_object(
           'populated', count(*) > 0, 'source', 'vehicle_events.final_price', 'method', 'cohort_aggregate',
           'n', count(*),
           'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price),
           'p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY ve.final_price),
           'p75', percentile_cont(0.75) WITHIN GROUP (ORDER BY ve.final_price),
           'min', min(ve.final_price), 'max', max(ve.final_price),
           'observed_at', now())
    INTO v_price
  FROM public.vehicle_events ve
  WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0;

  -- ── ASSEMBLE: market flow / trend over quarters ─────────────────────────────
  SELECT jsonb_build_object(
           'populated', count(*) > 0, 'source', 'vehicle_events', 'method', 'quarterly_flow',
           'series', COALESCE(jsonb_agg(jsonb_build_object(
                       'quarter', q, 'sales', n, 'median_price', med) ORDER BY q), '[]'::jsonb),
           'observed_at', now())
    INTO v_flow
  FROM (
    SELECT date_trunc('quarter', COALESCE(ve.sold_at, ve.ended_at)) AS q,
           count(*) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price) AS med
    FROM public.vehicle_events ve
    WHERE ve.vehicle_id = ANY (v_ids)
      AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL
    GROUP BY 1
  ) s;

  -- ── ASSEMBLE: sentiment from comment_discoveries over members ───────────────
  SELECT jsonb_build_object(
           'populated', count(*) > 0, 'source', 'comment_discoveries', 'method', 'cohort_avg',
           'avg_sentiment_score', avg(cd.sentiment_score), 'n', count(*), 'observed_at', now())
    INTO v_sentiment
  FROM public.comment_discoveries cd
  WHERE cd.vehicle_id = ANY (v_ids);

  -- ── PARTIAL: production / rarity (seed-only — mostly empty) ──────────────────
  SELECT jsonb_build_object(
           'populated', total_produced IS NOT NULL, 'source', 'vehicle_production_data',
           'total_produced', total_produced, 'rarity_level', rarity_level,
           'collector_demand_score', collector_demand_score)
    INTO v_production
  FROM public.get_vehicle_rarity_data(p_make, p_model, p_year);

  -- ── SPARSE/EMPTY: survival estimate (table near-empty; member-VIN count is floor) ──
  SELECT jsonb_build_object(
           'populated', sre.survival_rate IS NOT NULL, 'source', 'survival_rate_estimates',
           'survival_rate', sre.survival_rate, 'estimated_surviving', sre.estimated_surviving,
           'confidence', sre.confidence_score,
           'floor_known_members', v_count,
           'note', 'survival_rate_estimates is sparse; member count is a lower-bound floor, not the estimate.')
    INTO v_survival
  FROM public.survival_rate_estimates sre
  WHERE lower(sre.make) = lower(p_make) AND lower(sre.model) = lower(p_model)
    AND COALESCE(p_year, sre.year_start) BETWEEN sre.year_start AND sre.year_end
  LIMIT 1;

  -- ── PROJECT: curated/agent-maintained cohort fields via the consensus engine ──
  --    Identical mechanism to vehicle_wiki's cited_fields. Empty until agents fill
  --    make_model.* atoms — renders [] cleanly (a BUILD surface, not a failure).
  SELECT jsonb_agg(public.project_attribute(v_subject, attr) ORDER BY attr) INTO v_cited
  FROM (
    SELECT DISTINCT request_envelope->>'attribute' AS attr
    FROM public.projection_event
    WHERE request_envelope->>'subject_id' = v_subject::text
      AND request_envelope->>'subject_kind' = 'make_model'
      AND retracted_at IS NULL
  ) a;

  -- comps and dealer_behavior are assembled in the edge/connector layer (they call
  -- get_comps_combined() and get_seller_analytics() respectively) and merged into
  -- this envelope there, to keep this RPC inside the 120s/15s timeout budget and
  -- reuse the exact comps path api-v1-comps already uses. Stubs returned here:
  RETURN jsonb_build_object(
    'resolved', true,
    'subject_id', v_subject,
    'cohort', jsonb_build_object('make', p_make, 'model', p_model, 'year', p_year, 'grain', p_grain),
    'cohort_count', jsonb_build_object('populated', v_count > 0, 'value', v_count, 'source', 'cohort_members'),
    'price_distribution', COALESCE(v_price, jsonb_build_object('populated', false)),
    'market_flow', COALESCE(v_flow, jsonb_build_object('populated', false)),
    'sentiment', COALESCE(v_sentiment, jsonb_build_object('populated', false)),
    'production', COALESCE(v_production, jsonb_build_object('populated', false)),
    'survival', COALESCE(v_survival, jsonb_build_object('populated', false, 'floor_known_members', v_count)),
    'comps', jsonb_build_object('populated', null, 'note', 'assembled in edge layer via get_comps_combined'),
    'dealer_behavior', jsonb_build_object('populated', null, 'note', 'assembled in edge layer via get_seller_analytics'),
    'cited_fields', COALESCE(v_cited, '[]'::jsonb),
    'note', 'Cohort terminal: live aggregates ASSEMBLED from substrate + curated fields '
            'PROJECTED via project_attribute (weighted consensus, conflict-surfaced). '
            'A block with populated=false is an intake gap, never a market verdict.'
  );
END;
$$;

COMMENT ON FUNCTION public.get_make_model_terminal(text, text, integer, text) IS
  'DRAFT cohort terminal. Cohort analog of vehicle_wiki(): assembles count/price/flow/'
  'sentiment/production/survival from existing substrate and projects curated make_model.* '
  'fields via project_attribute. comps + dealer_behavior merged in the edge layer.';

-- -----------------------------------------------------------------------------
-- 5. project_make_model_canonical() — mirror of project_vehicle_canonical().
--    Syncs the make_model_profiles header cache FROM non-conflicted consensus
--    claims, with provenance. Skeleton only.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_make_model_canonical(p_subject_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE m jsonb; applied jsonb := '[]'::jsonb;
BEGIN
  -- rarity_tier (enum) and production_count (number) are the cleanly-projectable
  -- header fields; price/sentiment are recomputed live by the terminal, not cached
  -- here (they drift faster than consensus claims).
  m := public.project_attribute(p_subject_id, 'make_model.rarity_tier');
  IF m->>'consensus' IS NOT NULL AND NOT COALESCE((m->>'conflict')::boolean, false) THEN
    UPDATE public.make_model_profiles
       SET rarity_tier = m->>'consensus', header_refreshed_at = now()
     WHERE subject_id = p_subject_id;
    applied := applied || jsonb_build_object('attribute', 'make_model.rarity_tier', 'value', m->>'consensus');
  END IF;

  m := public.project_attribute(p_subject_id, 'make_model.production_count');
  IF m->>'consensus' IS NOT NULL AND NOT COALESCE((m->>'conflict')::boolean, false) THEN
    UPDATE public.make_model_profiles
       SET production_count = (m->>'consensus')::int, header_refreshed_at = now()
     WHERE subject_id = p_subject_id;
    applied := applied || jsonb_build_object('attribute', 'make_model.production_count', 'value', m->>'consensus');
  END IF;

  RETURN jsonb_build_object('subject_id', p_subject_id, 'applied', applied);
END;
$$;

COMMENT ON FUNCTION public.project_make_model_canonical(uuid) IS
  'DRAFT: materializes make_model_profiles header cache from non-conflicted consensus '
  'claims (mirror of project_vehicle_canonical). Canonical = projection of claims, not overwrite.';

ROLLBACK;  -- DRAFT: never commit. Review artifact only.
