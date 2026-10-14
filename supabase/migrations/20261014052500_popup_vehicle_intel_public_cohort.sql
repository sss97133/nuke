-- popup_vehicle_intel: the comparable-sales cohort is read by definer readers that state "public, undeleted" themselves.
--
-- VehiclePopup and useVehicleIntel call this on every vehicle profile. pg_stat_statements since 2026-09-29: anon 828
-- calls, mean 2,624 ms, max 9,988 ms (its own 10 s statement_timeout, so the max is timeouts); authenticated 58 calls,
-- mean 2,577 ms. It runs as the caller, so every read of vehicles goes through the row policies, and under them a qual
-- that calls a non-leakproof function (lower(make), lower(model), the model regex ~) cannot be an index condition.
-- Measured 2026-10-14, as anon, EXPLAIN ANALYZE of the function's own statement:
--   K5 Blazer (registered 1976-1980 scope): 13,975 ms cold, 13,854 ms of it in cohort_members(); the scan took
--     idx_vehicles_year alone (50,326 vehicles of those five model years), read 44,390 heap blocks (24,960 from disk)
--     and applied make and model afterwards, to find 275 members. Warm, 242-262 ms. Timeouts at 10 s on other cold runs.
--   Mustang 1966 (no registered scope; exact make, year and model): 11,797 ms cold, 11,209 ms in the members scan
--     (the same idx_vehicles_year scan), 1,242 members.
--   live BaT lot, 2023 Porsche 911 (35 members): 3,073 ms cold, 3,025 ms in the members scan; 38-68 ms warm.
-- The deploy role (no row policies) answers the same cohort query with the partial index on public vehicles: for the K5
-- 4,620 heap blocks instead of 44,390, 2.0 s cold instead of 7.8-14 s.
-- Everything else in the function (comments, observations, events, scores, the six sale facts) was under 100 ms in all
-- three plans.
--
-- Why a definer reader is the same answer: the cohort only ever feeds `eligible`, which keeps public, undeleted,
-- non-part vehicles other than the one viewed, whoever asks. The one place the caller's own visibility mattered was
-- whether the viewed vehicle (which may be the caller's private one) belongs to a registered scope; that is now a test
-- of that one row against the scope's rule instead of a search of the cohort for it.
--
-- New (all additions, in public):
--   cohort_scope_rule(subject_id)            INVOKER   the scope's make, years and model regex, built exactly as
--                                                      cohort_members() builds them (registry tables are public-read)
--   cohort_members_public(subject_id)        DEFINER   cohort_members() restricted to public, undeleted vehicles
--   public_vehicles_by_model_year(...)       DEFINER   public, undeleted vehicles of a make, model year and model names
-- popup_vehicle_intel stays SECURITY INVOKER with its signature, statement_timeout and grants; the registry scopes,
-- canonical-model resolution, eligibility, price facts, sale rule, ranking and output keys are untouched.
-- cohort_members() itself is untouched (other readers use it).
--
-- Contract: supabase/sql/test_popup_vehicle_intel_public_cohort.sql (CI job popup-public-cohort-contract).
-- Source guard: popup_vehicle_intel is replaced only from its 2026-10-14 definition (md5 below); a re-run is a no-op.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_def text := pg_get_functiondef(to_regprocedure('public.popup_vehicle_intel(uuid)'));
BEGIN
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.popup_vehicle_intel(uuid) is missing; this migration replaces it';
  END IF;
  IF to_regclass('public.make_model_profiles') IS NULL OR to_regclass('public.canonical_models') IS NULL THEN
    RAISE EXCEPTION 'the cohort registry (make_model_profiles, canonical_models) is missing';
  END IF;
  IF md5(v_def) <> 'c1c623526bae4cd96ebb0bba86b7e277'  -- gitleaks:allow (md5 checksum of the 2026-10-14 function definition, not a secret)
     AND v_def NOT LIKE '%popup_public_cohort_v1%' THEN
    RAISE EXCEPTION 'popup_vehicle_intel is not the 2026-10-14 definition this migration was written from (md5 %); re-read it', md5(v_def);
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.cohort_scope_rule(p_subject_id uuid)
 RETURNS TABLE(canonical_make text, grain text, year integer, year_start integer, year_end integer, pattern text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- The rule cohort_members() applies, as data: make, years and the word-boundary model regex built from the canonical
  -- model and its aliases. NULL pattern = no usable model words (cohort_members() then returns nothing).
  WITH p AS (
    SELECT mp.canonical_make, mp.grain, mp.year, mp.year_start, mp.year_end, mp.canonical_model, mp.canonical_model_id
      FROM public.make_model_profiles mp
     WHERE mp.subject_id = p_subject_id
  ), alts AS (
    SELECT string_agg(regexp_replace(lower(s.t), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), '|') AS a
      FROM (
        SELECT lower(p.canonical_model) AS t FROM p
        UNION
        SELECT lower(al) FROM p JOIN public.canonical_models cm ON cm.id = p.canonical_model_id, unnest(cm.aliases) al
      ) s
     WHERE s.t IS NOT NULL AND length(trim(s.t)) > 0
  )
  SELECT p.canonical_make, p.grain, p.year, p.year_start, p.year_end,
         CASE WHEN alts.a IS NOT NULL AND alts.a <> '' THEN '\y(' || alts.a || ')\y' END
    FROM p CROSS JOIN alts
$fn$;

CREATE OR REPLACE FUNCTION public.cohort_members_public(p_subject_id uuid)
 RETURNS TABLE(vehicle_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.cohort_scope_rule(p_subject_id);
  IF NOT FOUND OR r.pattern IS NULL THEN RETURN; END IF;
  -- definer: the visitor's view of a cohort is public, undeleted, non-part vehicles, stated here so the make, model and
  -- year quals can use the partial indexes on public vehicles instead of waiting behind the row policies
  IF r.grain = 'year' THEN
    RETURN QUERY
      SELECT v.id FROM public.vehicles v
       WHERE lower(v.make) = lower(r.canonical_make) AND v.year = r.year AND lower(v.model) ~ r.pattern
         AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item' AND v.is_public AND v.deleted_at IS NULL;
  ELSE
    RETURN QUERY
      SELECT v.id FROM public.vehicles v
       WHERE lower(v.make) = lower(r.canonical_make) AND v.year BETWEEN r.year_start AND r.year_end AND lower(v.model) ~ r.pattern
         AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item' AND v.is_public AND v.deleted_at IS NULL;
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION public.public_vehicles_by_model_year(p_make text, p_year integer, p_models text[])
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- p_models are lower-cased model names; a vehicle matches when lower(model) is one of them
  SELECT v.id FROM public.vehicles v
   WHERE lower(v.make) = lower(p_make) AND v.year = p_year AND lower(v.model) = ANY (p_models)
     AND v.is_public AND v.deleted_at IS NULL
$fn$;

REVOKE ALL ON FUNCTION public.cohort_scope_rule(uuid), public.cohort_members_public(uuid),
  public.public_vehicles_by_model_year(text, integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cohort_scope_rule(uuid), public.cohort_members_public(uuid),
  public.public_vehicles_by_model_year(text, integer, text[]) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.cohort_members_public(uuid) IS
  'cohort_members() restricted to public, undeleted, non-part vehicles; SECURITY DEFINER so its make/model/year quals can use the partial indexes on public vehicles (under anon row policies a lower() qual cannot be an index condition; measured 2026-10-14). Used by popup_vehicle_intel.';
COMMENT ON FUNCTION public.public_vehicles_by_model_year(text, integer, text[]) IS
  'Ids of public, undeleted vehicles of a make (case-insensitive), model year and a list of lower-cased model names; SECURITY DEFINER for the same reason as cohort_members_public. Used by popup_vehicle_intel.';
COMMENT ON FUNCTION public.cohort_scope_rule(uuid) IS
  'The membership rule cohort_members() applies for a subject: make, years (grain), and the model regex built from the canonical model and its aliases.';

CREATE OR REPLACE FUNCTION public.popup_vehicle_intel(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '10s'
AS $function$
  -- popup_public_cohort_v1
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
  ), supported_scopes AS MATERIALIZED (
    -- The viewed vehicle belongs to a scope when its model satisfies the scope's rule (registry_scopes already holds
    -- its make and model year). Same test as cohort_members(), made on this one row instead of by listing the cohort.
    SELECT p.* FROM registry_scopes p CROSS JOIN ref r
    WHERE lower(r.model) ~ (SELECT cr.pattern FROM public.cohort_scope_rule(p.subject_id) cr)
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
    -- Only public, undeleted vehicles can be comparables (eligible says so again below), so the members are read
    -- by the definer readers that state that rule themselves: under the caller's row policies no make or model
    -- qual can use an index (lower() and ~ are not leakproof) and the scan read every vehicle of the model year.
    SELECT m.vehicle_id
    FROM scope s CROSS JOIN LATERAL public.cohort_members_public(s.subject_id) m
    WHERE s.subject_id IS NOT NULL
    UNION
    -- Conservative fallback: same model year and an unambiguous canonical alias,
    -- otherwise the exact recorded model. Never expand a missing year to all years.
    SELECT m.id
    FROM scope s CROSS JOIN LATERAL public.public_vehicles_by_model_year(s.make, s.year,
      ARRAY[lower(s.model)]
      || CASE WHEN s.canonical_model IS NOT NULL
           THEN ARRAY[lower(s.canonical_model)] || ARRAY(SELECT lower(a) FROM unnest(s.aliases) a)
           ELSE ARRAY[]::text[] END) m(id)
    WHERE s.subject_id IS NULL AND s.year IS NOT NULL AND nullif(btrim(s.model), '') IS NOT NULL
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

COMMIT;

-- Live verification (after apply), as anon through PostgREST:
--   POST /rest/v1/rpc/popup_vehicle_intel {"p_vehicle_id":"e08bf694-970f-4cbe-8a74-8715158a0f2e"}   -- recent_comps_scope.method = supported_registered_cohort, six recent_comps; cold well under 10 s (before: 9-14 s, timeouts)
--   POST /rest/v1/rpc/popup_vehicle_intel {"p_vehicle_id":"83f6f033-a3c3-4cf4-a85e-a60d2c588838"}   -- same document as before (before: 8-12 s cold, 1.3 s warm)
