-- Repair the existing popup comparison reader without declaring factory generations or condition equivalence.
-- Live 2026-10-04: a 1977 subject returned later compact SUVs and earlier full-size vehicles,
-- and one "sale" contradicted vehicle_sale_basis. Source function verified against live pg_proc.
-- Policy: exactly one explicitly supported registry scope -> cohort_members; none/overlap -> same year.
-- Context-only ranges (including supersets and unproven boundaries) never become comparison policy.
-- The owner-attributed supported K5 scope is registered once by subject ID; runtime SQL has no K5 rules.
-- Testimony/basis is preserved. The separate policy basis cannot be overwritten by the public
-- register_make_model_subject upsert, which does not write either comparison_scope_* column.
-- SECURITY INVOKER throughout; public comps require public, not deleted, real vehicle, sold rule and date.
-- Protect the registry inputs: live canonical_models had a public FOR ALL policy and both registries
-- granted client TRUNCATE (which bypasses RLS). Keep public SELECT and existing controlled registration.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.canonical_models, public.make_model_profiles FROM PUBLIC, anon, authenticated;
ALTER POLICY "Service role manages canonical models" ON public.canonical_models
  TO service_role USING (true) WITH CHECK (true);
COMMENT ON TABLE public.make_model_profiles IS
  'Registry of cohort subjects at year, model and inclusive range grain. cohort_members resolves membership through the canonical model FK. Comparison policy is explicit in comparison_scope_status/basis; ranges alone never prove factory generations or condition equivalence.';
COMMENT ON COLUMN public.canonical_models.make IS
  'Model registry make label; case insensitive dimension vocabulary used by cohort_members and comparison readers. Trusted registry maintenance, not a vehicle observation.';
COMMENT ON COLUMN public.canonical_models.canonical_model IS
  'Model registry canonical label at one model-family grain. aliases are spelling/naming equivalents within the registered year range, not declarations of trim or condition equivalence.';
COMMENT ON COLUMN public.canonical_models.aliases IS
  'Alternate recorded model labels for this model family. Exact case insensitive membership is used by comparison fallback; cohort_members also uses escaped whole-word matching. Trusted registry writes only.';
COMMENT ON COLUMN public.canonical_models.year_start IS
  'Inclusive earliest registered model year, used to constrain model alias resolution. NULL means an unknown bound. Model-year unit, never event or ingest time.';
COMMENT ON COLUMN public.canonical_models.year_end IS
  'Inclusive latest registered model year, used to constrain model alias resolution. NULL means an unknown bound. A model range does not by itself prove finer generation boundaries.';

ALTER TABLE public.make_model_profiles
  ADD COLUMN comparison_scope_status text NOT NULL DEFAULT 'context_only',
  ADD COLUMN comparison_scope_basis text,
  ADD CONSTRAINT make_model_profiles_comparison_scope_status_check
    CHECK (comparison_scope_status IN ('context_only', 'supported')),
  ADD CONSTRAINT make_model_profiles_supported_scope_basis_check
    CHECK (comparison_scope_status <> 'supported' OR (
      grain = 'generation' AND year_start IS NOT NULL AND year_end IS NOT NULL
      AND year_start <= year_end AND nullif(btrim(comparison_scope_basis), '') IS NOT NULL
    ));
COMMENT ON COLUMN public.make_model_profiles.comparison_scope_status IS
  'Comparison policy for this registered cohort, as of updated_at: context_only (default, descriptive range) or supported (explicitly attributed comparison grouping). Not proof of factory generation, condition equivalence or price causality. Trusted registry writes only.';
COMMENT ON COLUMN public.make_model_profiles.comparison_scope_basis IS
  'Attributed reason/date for activating this comparison grouping; mandatory for supported scopes. Policy evidence separate from mutable presentation basis, never written by public register_make_model_subject. Grain one registered scope; no monetary unit.';
COMMENT ON COLUMN public.make_model_profiles.subject_id IS
  'Primary key of one registered year/model/range cohort subject. cohort_members resolves vehicle membership; popup_vehicle_intel reads supported scopes by this key.';
COMMENT ON COLUMN public.make_model_profiles.canonical_make IS
  'Recorded make dimension label of this cohort, matched case insensitively by cohort_members. Canonical model FK supplies aliases when known.';
COMMENT ON COLUMN public.make_model_profiles.canonical_model IS
  'Recorded model dimension label of this cohort. Canonical aliases come from canonical_model_id; a range or grain label does not establish factory generation truth.';
COMMENT ON COLUMN public.make_model_profiles.canonical_model_id IS
  'Nullable FK to canonical_models.id, the canonical model vocabulary and alias owner. NULL means model unresolved, never a guessed model.';
COMMENT ON COLUMN public.make_model_profiles.grain IS
  'Scope kind: year (one model year), generation (inclusive registered range), model (registered full model range). generation names a cohort grain, not independently proved factory boundaries.';
COMMENT ON COLUMN public.make_model_profiles.year IS
  'Model year for a year-grain cohort; NULL for range grains. Model year, never event time or ingest time.';
COMMENT ON COLUMN public.make_model_profiles.year_start IS
  'Inclusive lower model-year bound for generation/model scope; used by cohort_members. Its evidence is basis/comparison_scope_basis, not a price cluster alone.';
COMMENT ON COLUMN public.make_model_profiles.year_end IS
  'Inclusive upper model-year bound for generation/model scope; used by cohort_members. Unproven boundaries remain context_only.';

UPDATE public.make_model_profiles
SET comparison_scope_status = 'supported',
    comparison_scope_basis = 'Owner testimony, 2026-10-03: 1976-80 K5 vehicles are comparable to each other and are separated from 1973-75 by the stated roof-structure difference. This is an attributed comparison grouping; the roof detail is not yet recorded as verified factory evidence. The 1981 boundary remains unproven.',
    updated_at = now()
WHERE subject_id = 'f5586ac1-dc51-4d4b-bd26-abb1b207f872';
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.make_model_profiles
    WHERE subject_id = 'f5586ac1-dc51-4d4b-bd26-abb1b207f872'
      AND comparison_scope_status = 'supported' AND grain = 'generation'
      AND year_start = 1976 AND year_end = 1980
      AND lower(canonical_make) = 'chevrolet' AND lower(canonical_model) = 'k5 blazer'
  ) THEN
    RAISE EXCEPTION 'Owner-attributed comparison scope is missing or its registered shape changed';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.popup_vehicle_intel(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '10s'
AS $function$
  WITH ref AS MATERIALIZED (
    SELECT v.id, v.year, v.make, v.model
    FROM public.vehicles v
    WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
  ), registry_scopes AS MATERIALIZED (
    SELECT p.subject_id, p.canonical_model, p.comparison_scope_basis, p.year_start, p.year_end
    FROM public.make_model_profiles p CROSS JOIN ref r
    WHERE p.comparison_scope_status = 'supported'
      AND p.grain = 'generation'
      AND lower(p.canonical_make) = lower(r.make)
      AND r.year BETWEEN p.year_start AND p.year_end
  ), scoped_members AS MATERIALIZED (
    -- Resolve each eligible scope once; reuse the bridge for both reference and candidate membership.
    SELECT p.subject_id, m.vehicle_id
    FROM registry_scopes p CROSS JOIN LATERAL public.cohort_members(p.subject_id) m
  ), supported_scopes AS MATERIALIZED (
    SELECT p.* FROM registry_scopes p CROSS JOIN ref r
    WHERE EXISTS (SELECT 1 FROM scoped_members m WHERE m.subject_id = p.subject_id AND m.vehicle_id = r.id)
  ), canonical_candidates AS MATERIALIZED (
    SELECT cm.id, cm.canonical_model, cm.aliases
    FROM public.canonical_models cm CROSS JOIN ref r
    WHERE lower(cm.make) = lower(r.make)
      AND (cm.year_start IS NULL OR r.year >= cm.year_start)
      AND (cm.year_end IS NULL OR r.year <= cm.year_end)
      AND (lower(cm.canonical_model) = lower(r.model)
        OR lower(r.model) = ANY (SELECT lower(a) FROM unnest(cm.aliases) a))
  ), scope AS MATERIALIZED (
    SELECT r.*,
      (SELECT count(*) FROM supported_scopes) AS supported_scope_count,
      (SELECT count(*) FROM canonical_candidates) AS canonical_model_count,
      CASE WHEN (SELECT count(*) FROM supported_scopes) = 1
        THEN (SELECT subject_id FROM supported_scopes) END AS subject_id,
      CASE WHEN (SELECT count(*) FROM canonical_candidates) = 1
        THEN (SELECT canonical_model FROM canonical_candidates) END AS canonical_model,
      CASE WHEN (SELECT count(*) FROM canonical_candidates) = 1
        THEN (SELECT aliases FROM canonical_candidates) END AS aliases
    FROM ref r
  ), members AS MATERIALIZED (
    -- Use the canonical membership resolver only for one supported scope.
    -- Multiple supported scopes are an unresolved policy conflict, never "narrowest wins".
    SELECT m.vehicle_id
    FROM scope s JOIN scoped_members m ON m.subject_id = s.subject_id
    WHERE s.subject_id IS NOT NULL
    UNION
    -- Conservative fallback: same model year and an unambiguous canonical alias,
    -- otherwise the exact recorded model. Never expand a missing year to all years.
    SELECT v.id
    FROM scope s JOIN public.vehicles v
      ON lower(v.make) = lower(s.make) AND v.year = s.year
    WHERE s.subject_id IS NULL AND s.year IS NOT NULL AND nullif(btrim(s.model), '') IS NOT NULL
      AND (lower(v.model) = lower(s.model)
        OR (s.canonical_model IS NOT NULL AND (
          lower(v.model) = lower(s.canonical_model)
          OR lower(v.model) = ANY (SELECT lower(a) FROM unnest(s.aliases) a)
        )))
  ), eligible AS MATERIALIZED (
    SELECT v.id, v.year, v.model, v.primary_image_url AS thumbnail, v.mileage
    FROM members m JOIN public.vehicles v ON v.id = m.vehicle_id
    WHERE v.id <> p_vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
  ), comps AS MATERIALIZED (
    SELECT e.*, f.sold_amount AS sale_price, f.sold_on AS sale_date,
           f.sold_basis, f.sold_amount_from, f.platform, f.source_url,
           false AS condition_matched
    FROM eligible e
    JOIN public.vehicle_price_facts(ARRAY(SELECT id FROM eligible)) f ON f.vehicle_id = e.id
    WHERE f.sold_basis IS NOT NULL AND f.sold_amount > 0 AND f.sold_on IS NOT NULL
    ORDER BY f.sold_on DESC, e.id
    LIMIT 6
  )
  SELECT jsonb_build_object(
    'comment_evidence', (
      WITH source_page AS MATERIALIZED (
        SELECT c.id, c.auction_event_id, c.posted_at, c.is_seller, c.comment_type,
               c.external_identity_id, c.source_url, c.comment_text
        FROM public.auction_comments c
        JOIN public.auction_events e ON e.id = c.auction_event_id AND e.vehicle_id = c.vehicle_id
        JOIN public.vehicles v ON v.id = c.vehicle_id AND v.is_public IS TRUE
        WHERE c.vehicle_id = p_vehicle_id AND c.bid_amount IS NULL
          AND c.comment_type IS DISTINCT FROM 'bid' AND c.posted_at IS NOT NULL
          AND nullif(btrim(c.comment_text), '') IS NOT NULL
        ORDER BY c.posted_at DESC, c.id DESC LIMIT 21
      ), sources AS MATERIALIZED (
        SELECT * FROM source_page ORDER BY posted_at DESC, id DESC LIMIT 20
      ), atom_page AS MATERIALIZED (
        SELECT o.id, o.source_comment_id, o.content_text, o.structured_data,
               o.confidence_score, o.observed_at, o.ingested_at, o.agent_model,
               o.extraction_method
        FROM public.vehicle_observations o
        JOIN sources c ON c.id = o.source_comment_id
        WHERE o.vehicle_id = p_vehicle_id AND o.kind::text = 'comment'
          AND o.is_superseded IS NOT TRUE AND o.observed_at = c.posted_at
          AND o.confidence_score BETWEEN 0 AND 0.6
          AND o.structured_data->'is_inferred' = 'true'::jsonb
          AND nullif(btrim(o.content_text), '') IS NOT NULL
          AND strpos(c.comment_text, o.content_text) > 0
        ORDER BY o.ingested_at DESC, o.id DESC LIMIT 201
      ), atoms AS MATERIALIZED (
        SELECT * FROM atom_page ORDER BY ingested_at DESC, id DESC LIMIT 200
      )
      SELECT jsonb_build_object(
        'source_limit', 20, 'atom_limit', 200,
        'sources_returned', (SELECT count(*) FROM sources),
        'atoms_returned', (SELECT count(*) FROM atoms),
        'sources_truncated', (SELECT count(*) > 20 FROM source_page),
        'atoms_truncated', (SELECT count(*) > 200 FROM atom_page),
        'scope', 'Latest 20 non-bid public source comments; at most 200 qualified atoms linked to those sources. Inferred source testimony, not verified vehicle facts.',
        'source_comments', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'comment_id', c.id, 'auction_event_id', c.auction_event_id,
            'posted_at', c.posted_at, 'source_url', c.source_url,
            'is_seller', c.is_seller, 'comment_type', c.comment_type,
            'author_identity_id', c.external_identity_id,
            'excerpt', left(c.comment_text, 1200),
            'excerpt_truncated', length(c.comment_text) > 1200,
            'processed', coalesce(p.llm_processed IS TRUE
              AND p.extraction_version = 'public_comment_atoms_v1', false),
            'extraction_version', p.extraction_version,
            'processed_at', p.processed_at
          ) ORDER BY c.posted_at DESC, c.id DESC)
          FROM sources c LEFT JOIN public.comment_claims_progress p ON p.comment_id = c.id
        ), '[]'::jsonb),
        'atoms', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'observation_id', a.id, 'source_comment_id', a.source_comment_id,
            'quote', a.content_text, 'data', a.structured_data,
            'confidence', a.confidence_score, 'is_inferred', true,
            'observed_at', a.observed_at, 'ingested_at', a.ingested_at,
            'agent_model', a.agent_model, 'extraction_method', a.extraction_method
          ) ORDER BY a.ingested_at DESC, a.id DESC) FROM atoms a
        ), '[]'::jsonb)
      )
    ),
    'comment_intel', (
      SELECT jsonb_build_object(
        'sentiment', raw_extraction->'sentiment',
        'key_quotes', raw_extraction->'key_quotes',
        'expert_insights', raw_extraction->'expert_insights',
        'community_concerns', raw_extraction->'community_concerns',
        'price_sentiment', raw_extraction->'price_sentiment',
        'market_signals', raw_extraction->'market_signals',
        'seller_disclosures', raw_extraction->'seller_disclosures',
        'authenticity', raw_extraction->'authenticity_discussion',
        'overall_sentiment', overall_sentiment,
        'sentiment_score', sentiment_score,
        'comment_count', comment_count
      )
      FROM comment_discoveries
      WHERE vehicle_id = p_vehicle_id
      ORDER BY discovered_at DESC
      LIMIT 1
    ),
    'description_intel', (
      SELECT jsonb_build_object(
        'red_flags', raw_extraction->'flags',
        'mods', raw_extraction->'mods',
        'work_history', raw_extraction->'work',
        'condition', raw_extraction->'cond',
        'condition_note', raw_extraction->'cond_note',
        'title_status', raw_extraction->'title',
        'owner_count', raw_extraction->'owners',
        'matching_numbers', raw_extraction->'matching',
        'documentation', raw_extraction->'docs',
        'option_codes', raw_extraction->'codes',
        'equipment', raw_extraction->'equip',
        'price_positive', raw_extraction->'price_pos',
        'price_negative', raw_extraction->'price_neg'
      )
      FROM description_discoveries
      WHERE vehicle_id = p_vehicle_id
      ORDER BY discovered_at DESC
      LIMIT 1
    ),
    'scores', (
      SELECT jsonb_build_object(
        'nuke_estimate', nuke_estimate,
        'nuke_confidence', nuke_estimate_confidence,
        'heat_score', heat_score,
        'deal_score', deal_score
      )
      FROM vehicles
      WHERE id = p_vehicle_id
    ),
    'apparitions', COALESCE((
      SELECT jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.event_date DESC NULLS LAST)
      FROM (
        SELECT source_platform as platform, source_url as url,
               event_type, COALESCE(sold_at, ended_at, started_at) as event_date,
               COALESCE(final_price, current_price) as price
        FROM vehicle_events
        WHERE vehicle_id = p_vehicle_id
        ORDER BY COALESCE(sold_at, ended_at, started_at) DESC NULLS LAST
        LIMIT 10
      ) sub
    ), '[]'::jsonb),
    'recent_comps_scope', (
      SELECT jsonb_build_object(
        'method', CASE WHEN s.subject_id IS NOT NULL THEN 'supported_registered_cohort'
          WHEN s.year IS NULL OR nullif(btrim(s.model), '') IS NULL THEN 'blocked'
          WHEN s.canonical_model_count = 1 THEN 'same_year_canonical_model'
          ELSE 'same_year_exact_model' END,
        'subject_id', s.subject_id,
        'label', CASE WHEN s.subject_id IS NOT NULL
          THEN (SELECT p.year_start || '-' || p.year_end || ' ' || p.canonical_model FROM supported_scopes p)
          ELSE s.year::text || ' ' || coalesce(s.canonical_model, s.model) END,
        'basis', CASE WHEN s.subject_id IS NOT NULL
          THEN (SELECT comparison_scope_basis FROM supported_scopes)
          ELSE 'Same recorded model year; canonical aliases only when the canonical model resolves uniquely.' END,
        'fallback_reason', CASE WHEN s.subject_id IS NOT NULL THEN NULL
          WHEN s.year IS NULL THEN 'missing_model_year'
          WHEN nullif(btrim(s.model), '') IS NULL THEN 'missing_model'
          WHEN s.supported_scope_count > 1 THEN 'overlapping_supported_scopes'
          WHEN s.canonical_model_count > 1 THEN 'ambiguous_canonical_model'
          ELSE 'no_supported_registered_scope' END,
        'supported_scope_count', s.supported_scope_count,
        'condition_matched', false,
        'condition_note', 'Sold context only. Condition, restoration and build class have not been matched.',
        'sale_rule', 'vehicle_price_facts / vehicle_sale_basis',
        'date_rule', 'Recorded sold date required; ingest time is never a sale date.',
        'grain', 'one current recorded sale per public vehicle; not a historical transaction ledger'
      ) FROM scope s
    ),
    'recent_comps', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.sale_date DESC, c.id) FROM comps c
    ), '[]'::jsonb)
  )
  WHERE EXISTS (SELECT 1 FROM ref);
$function$;

COMMENT ON FUNCTION public.popup_vehicle_intel(uuid) IS
  'Vehicle intelligence with bounded sourced comment evidence and recent sold context. Comparison uses exactly one supported registered cohort via cohort_members; unsupported/overlapping scopes fall back to same-year canonical/exact model. Public, nondeleted real vehicles only; sold amount/date/provenance from vehicle_price_facts and vehicle_sale_basis. Condition/restoration/build class remain explicitly unmatched. Invoker RLS and parent visibility apply; all legacy intelligence keys preserved.';

NOTIFY pgrst, 'reload schema';
COMMIT;
