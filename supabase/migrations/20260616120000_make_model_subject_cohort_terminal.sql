-- =============================================================================
-- make_model subject & cohort terminal
-- =============================================================================
-- Makes a year-make-model (e.g. "1966 Ford Mustang") a FIRST-CLASS SUBJECT, the
-- cohort analog of a `vehicle` subject. Search resolves to ONE rich entity (a
-- Bloomberg terminal for the cohort), not a grid of vehicle rows.
--
-- Develop-from-what-exists: EXTENDS the existing subject system
-- (projection_event + project_attribute + attribute-registry + vehicle_wiki).
-- subject_kind 'make_model' is carried in projection_event.request_envelope
-- (jsonb) — NO projection_event schema change. The only new table is
-- make_model_profiles (the cohort header/peg, analog of the `vehicles` header).
--
-- Authorized by Skylar 2026-06-16 (owner sign-off for the new table per
-- universal invariant #4 + platform-hygiene table rule). Additive only — no
-- drops, no testimony-table writes.
--
-- Validated against live schema 2026-06-16:
--   canonical_models(make, canonical_model, aliases, year_start, year_end, id)
--   vehicle_events(vehicle_id, final_price, sold_at, ended_at, seller_identifier)
--   comment_discoveries(vehicle_id, sentiment_score)
--   survival_rate_estimates(make, model, survival_rate, estimated_surviving,
--                           confidence_score, year_start, year_end)
--   get_vehicle_rarity_data(make,model,year) -> (total_produced, rarity_level,
--                           collector_demand_score, ...)
--   get_comps_combined(make, model, year_min, year_max, ...) -> TABLE
--   project_attribute(subject_id, attribute) -> jsonb {consensus, conflict, ...}
-- =============================================================================

-- 1. make_model_profiles — cohort subject row + denormalized header cache.
CREATE TABLE IF NOT EXISTS public.make_model_profiles (
  subject_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_make      text NOT NULL,
  canonical_model     text NOT NULL,
  grain               text NOT NULL DEFAULT 'year' CHECK (grain IN ('year','generation')),
  year                integer,
  year_start          integer,
  year_end            integer,
  canonical_model_id  uuid REFERENCES public.canonical_models(id),
  -- denormalized consensus cache (written only by project_make_model_canonical)
  cohort_count        integer,
  median_price        numeric,
  rarity_tier         text,
  production_count    integer,
  survival_rate       numeric(6,4),
  sentiment_score     numeric,
  header_refreshed_at timestamptz,
  -- Layer-2 financial-index activation hook. Stub: 'none' = subject only, no index.
  index_status        text NOT NULL DEFAULT 'none'
                        CHECK (index_status IN ('none','eligible','activated','sponsored')),
  index_sponsor_org_id uuid REFERENCES public.organizations(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
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
  'header columns are the denormalized consensus cache. index_status is the Layer-2 '
  'financial-index activation hook (default none = subject only).';

-- 2. cohort_members(subject_id) — membership RESOLVER (live query, not stored edges).
-- Resolves membership by matching the canonical model (and its canonical_models
-- aliases) as a WHOLE WORD against the model string, over the small make+year slice.
-- Exact `lower(model)=ANY(aliases)` under-captured fragmented names (K5 Blazer ->
-- "K5 Blazer Cheyenne 4x4"; Mustang -> "Mustang GT"). Word-boundary (\y...\y) is
-- precise: 'blazer' matches "K5 Blazer" but NOT "Trailblazer". The make+year filter
-- reduces to a small slice first (verified: BitmapAnd year+make indexes -> regex
-- filter), so it's fast. Dynamic EXECUTE keeps a custom plan. Regex specials in the
-- model names are escaped so '4Runner'/'911'/'Series III' can't break the pattern.
CREATE OR REPLACE FUNCTION public.cohort_members(p_subject_id uuid)
RETURNS TABLE(vehicle_id uuid) LANGUAGE plpgsql STABLE AS $$
DECLARE p record; alts text; pattern text;
BEGIN
  SELECT * INTO p FROM public.make_model_profiles WHERE subject_id = p_subject_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT string_agg(
           regexp_replace(lower(t), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), '|')
    INTO alts
  FROM (
    SELECT lower(p.canonical_model) AS t
    UNION
    SELECT lower(a) FROM public.canonical_models cm, unnest(cm.aliases) a
     WHERE cm.id = p.canonical_model_id
  ) s
  WHERE t IS NOT NULL AND length(trim(t)) > 0;

  IF alts IS NULL OR alts = '' THEN RETURN; END IF;
  pattern := '\y(' || alts || ')\y';

  -- Inline values as escaped literals (format %L), NOT EXECUTE ... USING bound
  -- params. Bound params produced a poor plan that timed out on big make+year
  -- slices (Chevrolet 1969); the literal form plans as BitmapAnd(year, make) ->
  -- regex filter and is fast even for the largest cohorts. %L quotes/escapes
  -- safely; pattern is regex-escaped from canonical data, make is canonical.
  IF p.grain = 'year' THEN
    RETURN QUERY EXECUTE format(
      'SELECT v.id FROM public.vehicles v
        WHERE lower(v.make) = lower(%L) AND v.year = %s AND lower(v.model) ~ %L',
      p.canonical_make, p.year, pattern);
  ELSE
    RETURN QUERY EXECUTE format(
      'SELECT v.id FROM public.vehicles v
        WHERE lower(v.make) = lower(%L) AND v.year BETWEEN %s AND %s AND lower(v.model) ~ %L',
      p.canonical_make, p.year_start, p.year_end, pattern);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.cohort_members(uuid) IS
  'Resolver: vehicle_ids in a make_model cohort. Live query (not a stored FK) so '
  'membership stays correct as vehicles are added/merged/superseded.';

-- 3. register_make_model_subject() — lazy demand-created upsert. Returns subject_id.
--    SECURITY DEFINER + granted to anon so the cohort terminal self-registers ANY
--    year-make-model on first view (treemap / search / direct URL). Safe: only a
--    controlled idempotent canonical upsert, no dynamic SQL; guards reject junk.
CREATE OR REPLACE FUNCTION public.register_make_model_subject(
  p_make text, p_model text, p_year integer DEFAULT NULL, p_grain text DEFAULT 'year'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid; v_cm public.canonical_models%ROWTYPE;
BEGIN
  IF p_make IS NULL OR length(trim(p_make)) < 1
     OR p_model IS NULL OR length(trim(p_model)) < 1 THEN
    RETURN NULL;
  END IF;
  IF p_grain = 'year' AND (p_year IS NULL OR p_year < 1885
     OR p_year > extract(year from now())::int + 1) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_cm FROM public.canonical_models cm
   WHERE lower(cm.make) = lower(p_make)
     AND (lower(cm.canonical_model) = lower(p_model)
          OR lower(p_model) = ANY (SELECT lower(a) FROM unnest(cm.aliases) a))
   LIMIT 1;

  INSERT INTO public.make_model_profiles
    (canonical_make, canonical_model, grain, year, year_start, year_end, canonical_model_id)
  VALUES (
    upper(COALESCE(v_cm.make, p_make)),
    COALESCE(v_cm.canonical_model, p_model),
    p_grain,
    CASE WHEN p_grain = 'year' THEN p_year END,
    CASE WHEN p_grain = 'generation' THEN v_cm.year_start END,
    CASE WHEN p_grain = 'generation' THEN v_cm.year_end END,
    v_cm.id
  )
  ON CONFLICT (canonical_make, canonical_model, year, grain) DO UPDATE SET updated_at = now()
  RETURNING subject_id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.register_make_model_subject(text,text,integer,text) IS
  'Lazy upsert of a make_model cohort subject (demand-created, not full Cartesian product). '
  'Canonicalizes via canonical_models. Returns subject_id to peg projection_event claims.';

-- 4. get_make_model_terminal() — the cohort terminal. ASSEMBLES live aggregates from
--    existing substrate + PROJECTS curated fields via project_attribute. Cohort analog
--    of vehicle_wiki(). Every block carries `populated`; a dark block is an intake gap,
--    never a fabricated number or a "cold market" verdict.
CREATE OR REPLACE FUNCTION public.get_make_model_terminal(
  p_make text, p_model text, p_year integer DEFAULT NULL, p_grain text DEFAULT 'year'
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_subject uuid; v_ids uuid[]; v_count int; v_canon_model text;
  v_price jsonb; v_flow jsonb; v_sentiment jsonb; v_production jsonb;
  v_survival jsonb; v_comps jsonb; v_dealers jsonb; v_cited jsonb;
BEGIN
  -- Canonicalize the input model (alias-aware) like register does, so querying an
  -- alias ('Blazer' / 'K5') resolves to the stored 'K5 Blazer' subject.
  SELECT cm.canonical_model INTO v_canon_model
  FROM public.canonical_models cm
  WHERE lower(cm.make) = lower(p_make)
    AND (lower(cm.canonical_model) = lower(p_model)
         OR lower(p_model) = ANY (SELECT lower(a) FROM unnest(cm.aliases) a))
  LIMIT 1;
  v_canon_model := COALESCE(v_canon_model, p_model);

  SELECT subject_id INTO v_subject FROM public.make_model_profiles
   WHERE lower(canonical_make) = lower(p_make)
     AND lower(canonical_model) = lower(v_canon_model)
     AND grain = p_grain
     AND (p_grain <> 'year' OR year = p_year)
   LIMIT 1;

  IF v_subject IS NULL THEN
    RETURN jsonb_build_object('resolved', false,
      'note', 'No make_model subject registered yet — call register_make_model_subject(). '
              'Absence is an intake gap, not a market verdict.');
  END IF;

  SELECT array_agg(vehicle_id) INTO v_ids FROM public.cohort_members(v_subject);
  v_count := COALESCE(array_length(v_ids, 1), 0);

  -- ASSEMBLE: price distribution + median over member auction events
  SELECT jsonb_build_object(
           'populated', count(*) > 0, 'source', 'vehicle_events.final_price',
           'method', 'cohort_aggregate', 'n', count(*),
           'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price),
           'p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY ve.final_price),
           'p75', percentile_cont(0.75) WITHIN GROUP (ORDER BY ve.final_price),
           'min', min(ve.final_price), 'max', max(ve.final_price), 'observed_at', now())
    INTO v_price
  FROM public.vehicle_events ve
  WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0;

  -- ASSEMBLE: market flow / trend over quarters
  SELECT jsonb_build_object(
           'populated', count(*) > 0, 'source', 'vehicle_events', 'method', 'quarterly_flow',
           'series', COALESCE(jsonb_agg(jsonb_build_object(
                       'quarter', q, 'sales', n, 'median_price', med) ORDER BY q), '[]'::jsonb))
    INTO v_flow
  FROM (
    SELECT date_trunc('quarter', COALESCE(ve.sold_at, ve.ended_at)) AS q, count(*) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price) AS med
    FROM public.vehicle_events ve
    WHERE ve.vehicle_id = ANY (v_ids)
      AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL
      AND ve.final_price IS NOT NULL AND ve.final_price > 0
    GROUP BY 1
  ) s;

  -- ASSEMBLE: sentiment from comment_discoveries over members
  SELECT jsonb_build_object(
           'populated', count(cd.sentiment_score) > 0, 'source', 'comment_discoveries',
           'method', 'cohort_avg', 'avg_sentiment_score', avg(cd.sentiment_score),
           'n', count(cd.sentiment_score), 'observed_at', now())
    INTO v_sentiment
  FROM public.comment_discoveries cd
  WHERE cd.vehicle_id = ANY (v_ids);

  -- ASSEMBLE: dealer flow — most active sellers in this cohort (cohort-scoped)
  SELECT jsonb_build_object(
           'populated', count(*) > 0, 'source', 'vehicle_events.seller_identifier',
           'method', 'top_sellers_in_cohort',
           'top', COALESCE(jsonb_agg(jsonb_build_object(
                    'seller', seller_identifier, 'events', n, 'median_price', med) ORDER BY n DESC), '[]'::jsonb))
    INTO v_dealers
  FROM (
    SELECT ve.seller_identifier, count(*) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price) AS med
    FROM public.vehicle_events ve
    WHERE ve.vehicle_id = ANY (v_ids) AND ve.seller_identifier IS NOT NULL AND ve.seller_identifier <> ''
    GROUP BY ve.seller_identifier
    ORDER BY count(*) DESC
    LIMIT 10
  ) d;

  -- production / rarity: ONLY sourced rows. vehicle_production_data holds unsourced,
  -- contradictory seed fabrications (source_url NULL, e.g. three different F-150 2020
  -- totals). A production figure without provenance must never display as fact
  -- (cardinal rule: numbers carry source DNA). Require source_url, else honest dark.
  SELECT jsonb_build_object(
           'populated', vp.total_produced IS NOT NULL, 'source', 'vehicle_production_data',
           'total_produced', vp.total_produced, 'rarity_level', vp.rarity_level,
           'collector_demand_score', vp.collector_demand_score, 'source_url', vp.source_url)
    INTO v_production
  FROM public.vehicle_production_data vp
  WHERE lower(vp.make) = lower(p_make) AND lower(vp.model) = lower(p_model) AND vp.year = p_year
    AND vp.source_url IS NOT NULL
  ORDER BY vp.verification_date DESC NULLS LAST
  LIMIT 1;

  -- SPARSE: survival estimate (table near-empty; member-VIN count is a lower-bound floor)
  SELECT jsonb_build_object(
           'populated', sre.survival_rate IS NOT NULL, 'source', 'survival_rate_estimates',
           'survival_rate', sre.survival_rate, 'estimated_surviving', sre.estimated_surviving,
           'confidence', sre.confidence_score, 'floor_known_members', v_count,
           'note', 'survival_rate_estimates is sparse; member count is a lower-bound floor, not the estimate.')
    INTO v_survival
  FROM public.survival_rate_estimates sre
  WHERE lower(sre.make) = lower(p_make) AND lower(sre.model) = lower(p_model)
    AND COALESCE(p_year, sre.year_start) BETWEEN sre.year_start AND sre.year_end
  LIMIT 1;

  -- ASSEMBLE: comps = the cohort's OWN sold events. NOT get_comps_combined() —
  -- that runs the 9-factor get_comps_scored similarity engine over every same-make
  -- candidate and times out even at service role. A cohort is already filtered to
  -- exact make/model/year, so its own sold vehicle_events are both faster (indexed
  -- on vehicle_id) and truer than a fuzzy adjacent-year similarity match.
  SELECT jsonb_build_object(
           'populated', count(*) > 0, 'source', 'vehicle_events (cohort sold)', 'n', count(*),
           'rows', COALESCE(jsonb_agg(jsonb_build_object(
                     'vehicle_id', vehicle_id, 'year', yr, 'make', mk, 'model', mdl, 'trim', tr,
                     'sale_price', sale_price, 'miles', miles, 'platform', platform,
                     'sold_date', sold_date, 'listing_url', listing_url, 'image_url', image_url)
                     ORDER BY sale_price DESC NULLS LAST), '[]'::jsonb))
    INTO v_comps
  FROM (
    SELECT ve.vehicle_id, v.year AS yr, v.make AS mk, v.model AS mdl, v.trim AS tr,
           ve.final_price AS sale_price, v.mileage AS miles, ve.source_platform AS platform,
           COALESCE(ve.sold_at, ve.ended_at) AS sold_date, ve.source_url AS listing_url,
           v.primary_image_url AS image_url
    FROM public.vehicle_events ve
    JOIN public.vehicles v ON v.id = ve.vehicle_id
    WHERE ve.vehicle_id = ANY (v_ids)
      AND ve.final_price IS NOT NULL AND ve.final_price > 0
      AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL
    ORDER BY ve.final_price DESC
    LIMIT 24
  ) c;

  -- PROJECT: curated/agent-maintained cohort fields via the consensus engine
  SELECT jsonb_agg(public.project_attribute(v_subject, attr) ORDER BY attr) INTO v_cited
  FROM (
    SELECT DISTINCT request_envelope->>'attribute' AS attr
    FROM public.projection_event
    WHERE request_envelope->>'subject_id' = v_subject::text
      AND request_envelope->>'subject_kind' = 'make_model'
      AND retracted_at IS NULL
  ) a;

  RETURN jsonb_build_object(
    'resolved', true, 'subject_id', v_subject,
    'cohort', jsonb_build_object('make', p_make, 'model', COALESCE(v_canon_model, p_model), 'year', p_year, 'grain', p_grain),
    'cohort_count', jsonb_build_object('populated', v_count > 0, 'value', v_count, 'source', 'cohort_members'),
    'price_distribution', COALESCE(v_price, jsonb_build_object('populated', false)),
    'market_flow', COALESCE(v_flow, jsonb_build_object('populated', false)),
    'sentiment', COALESCE(v_sentiment, jsonb_build_object('populated', false)),
    'dealer_flow', COALESCE(v_dealers, jsonb_build_object('populated', false)),
    'production', COALESCE(v_production, jsonb_build_object('populated', false)),
    'survival', COALESCE(v_survival, jsonb_build_object('populated', false, 'floor_known_members', v_count)),
    'comps', COALESCE(v_comps, jsonb_build_object('populated', false)),
    'cited_fields', COALESCE(v_cited, '[]'::jsonb),
    'note', 'Cohort terminal: live aggregates ASSEMBLED from substrate + curated fields '
            'PROJECTED via project_attribute (weighted consensus, conflict-surfaced). '
            'A block with populated=false is an intake gap, never a market verdict.'
  );
END;
$$;

COMMENT ON FUNCTION public.get_make_model_terminal(text,text,integer,text) IS
  'Cohort terminal (analog of vehicle_wiki). Assembles count/price/flow/sentiment/dealer/'
  'production/survival/comps from existing substrate and projects curated make_model.* fields '
  'via project_attribute. Every block carries populated; dark blocks are intake gaps.';

GRANT EXECUTE ON FUNCTION public.cohort_members(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_make_model_terminal(text,text,integer,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_make_model_subject(text,text,integer,text) TO anon, authenticated, service_role;

-- 5. project_make_model_canonical() — materialize header cache from non-conflicted
--    consensus claims (mirror of project_vehicle_canonical). Maintenance path.
CREATE OR REPLACE FUNCTION public.project_make_model_canonical(p_subject_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE m jsonb; applied jsonb := '[]'::jsonb;
BEGIN
  m := public.project_attribute(p_subject_id, 'make_model.rarity_tier');
  IF m->>'consensus' IS NOT NULL AND NOT COALESCE((m->>'conflict')::boolean, false) THEN
    UPDATE public.make_model_profiles SET rarity_tier = m->>'consensus', header_refreshed_at = now()
     WHERE subject_id = p_subject_id;
    applied := applied || jsonb_build_object('attribute','make_model.rarity_tier','value', m->>'consensus');
  END IF;

  m := public.project_attribute(p_subject_id, 'make_model.production_count');
  IF m->>'consensus' IS NOT NULL AND NOT COALESCE((m->>'conflict')::boolean, false) THEN
    UPDATE public.make_model_profiles
       SET production_count = NULLIF(regexp_replace(m->>'consensus','[^0-9]','','g'),'')::int,
           header_refreshed_at = now()
     WHERE subject_id = p_subject_id;
    applied := applied || jsonb_build_object('attribute','make_model.production_count','value', m->>'consensus');
  END IF;

  RETURN jsonb_build_object('subject_id', p_subject_id, 'applied', applied);
END;
$$;

COMMENT ON FUNCTION public.project_make_model_canonical(uuid) IS
  'Materializes make_model_profiles header cache from non-conflicted consensus claims '
  '(mirror of project_vehicle_canonical). Canonical = projection of claims, not overwrite.';
