-- Live definitions as production had them on 2026-10-14 (pg_get_functiondef), the "before" state of
-- supabase/migrations/20261014052500_popup_vehicle_intel_public_cohort.sql and its contract
-- supabase/sql/test_popup_vehicle_intel_public_cohort.sql. The migration changes only popup_vehicle_intel; the other
-- three are what it calls.
--   popup_vehicle_intel(uuid)       md5(pg_get_functiondef) c1c623526bae4cd96ebb0bba86b7e277  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
--   cohort_members(uuid)            md5(pg_get_functiondef) a2550afffab3f758943cbea0c188235f  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
--   vehicle_price_facts(uuid[])     md5(pg_get_functiondef) 32bef56e17986c4de7942d948ebde45f  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
--   vehicle_sale_basis(...)         md5(pg_get_functiondef) 4a648fbaef6ff2f41fb44226a8a68b08  -- gitleaks:allow (md5 checksum of a function definition, not a secret)

CREATE OR REPLACE FUNCTION public.vehicle_sale_basis(p_sale_status text, p_auction_outcome text, p_canonical_platform text, p_listing_url text, p_discovery_url text, p_sale_price numeric, p_notes text, p_import_metadata jsonb, p_created_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE PARALLEL SAFE
AS $function$
  WITH x AS (
    SELECT
      CASE
        WHEN p_listing_url LIKE 'conceptcarz://%' OR p_listing_url LIKE 'https://conceptcarz://%' THEN 'conceptcarz'
        ELSE COALESCE(
          NULLIF(p_canonical_platform, 'unknown'),
          CASE
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'carsandbids\.com'     THEN 'cars-and-bids'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'mecum\.com'           THEN 'mecum'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'barrett-jackson\.com' THEN 'barrett-jackson'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'goodingco\.com'       THEN 'gooding'
            ELSE NULL
          END)
      END AS plat
  )
  SELECT CASE
    -- contradicting testimony: an explicit no-sale on the row means the sale is not proven (2026-09-27, part 4)
    WHEN p_auction_outcome IN ('reserve_not_met', 'no_sale')
      OR p_sale_status IN ('not_sold', 'unsold', 'bid_to')
      OR (plat = 'mecum' AND p_notes ~ 'Result: bid-goes-on')                                              THEN NULL
    -- the rule: a status says money moved
    WHEN p_sale_status = 'sold' OR p_auction_outcome = 'sold' THEN 'status'
    -- after the cutover nothing but a status counts
    WHEN p_created_at >= '2026-09-27 00:00:00+00'::timestamptz THEN NULL
    -- legacy rows: the platform's own sale marker, left on the row by the writer
    WHEN plat = 'mecum'           AND p_sale_price > 0 AND p_notes ~ 'Result: sold'                       THEN 'mecum_sale_result'
    WHEN plat = 'cars-and-bids'   AND p_sale_price > 0 AND p_import_metadata->>'auction_status' = 'sold'  THEN 'cab_auction_status'
    WHEN plat = 'gooding'         AND p_sale_price > 0                                                    THEN 'gooding_sale_price'
    WHEN plat = 'barrett-jackson' AND p_sale_price > 0
         AND p_auction_outcome IS DISTINCT FROM 'no_sale' AND p_sale_status IS DISTINCT FROM 'not_sold'   THEN 'bj_result_price'
    WHEN plat = 'conceptcarz'     AND p_sale_price > 0 AND p_notes ~ '"status": "sold"'                   THEN 'conceptcarz_sold'
    -- everything else (BaT, pcarmarket, bonhams, rm-sothebys, broad-arrow, hagerty, every classified,
    -- every aggregator, unknown): not a sale until a status proves it
    ELSE NULL
  END
  FROM x;
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_price_facts(p_vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, price_kind text, price_amount numeric, price_as_of timestamp with time zone, price_live boolean, sold_amount numeric, sold_on date, sold_basis text, sold_amount_from text, ask_amount numeric, ask_as_of timestamp with time zone, bid_amount numeric, bid_on date, bid_from text, estimate_amount numeric, estimate_confidence integer, estimate_as_of timestamp with time zone, outcome text, platform text, source_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Keep the canonical sale basis once per selected vehicle. The SQL helper
  -- returns all twenty fields, so folding this stage repeats its source rule.
  WITH v AS MATERIALIZED (
    SELECT v.id, v.sale_status, v.auction_outcome, v.reserve_status, v.sale_price, v.bat_sold_price, v.sold_price, v.winning_bid, v.high_bid,
           v.asking_price, v.sale_date, v.bat_sale_date, v.listing_updated_at, v.listing_posted_at,
           v.nuke_estimate, v.nuke_estimate_confidence, v.valuation_calculated_at,
           v.canonical_outcome, v.canonical_platform,
           COALESCE(v.listing_url, v.bat_auction_url, v.platform_url) AS source_url,
           vehicle_sale_basis(v.sale_status, v.auction_outcome, v.canonical_platform, v.listing_url,
                              v.discovery_url, v.sale_price::numeric, v.notes, v.import_metadata,
                              v.created_at) AS basis,
           v.auction_end_date
    FROM vehicles v
    WHERE v.id = ANY (p_vehicle_ids)
      AND v.deleted_at IS NULL
  ),
  dated AS (
    -- Leave date parsing inline: an unused malformed legacy date must retain
    -- the old lazy CASE behavior rather than becoming a new reader exception.
    SELECT v.*, CASE WHEN v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}'
      THEN left(v.auction_end_date, 10)::date END AS auction_end_on
    FROM v
  ),
  f AS (
    SELECT v.*,
      CASE WHEN v.basis IS NOT NULL THEN COALESCE(NULLIF(v.sale_price, 0)::numeric, NULLIF(v.winning_bid, 0)::numeric,
                                                  NULLIF(v.bat_sold_price, 0)::numeric, NULLIF(v.sold_price, 0)::numeric)
      END AS f_sold_amount,
      CASE WHEN v.basis IS NOT NULL THEN
        CASE WHEN v.sale_price > 0 THEN 'sale_price' WHEN v.winning_bid > 0 THEN 'winning_bid'
             WHEN v.bat_sold_price > 0 THEN 'bat_sold_price' WHEN v.sold_price > 0 THEN 'sold_price' END
      END AS f_sold_from,
      CASE WHEN v.basis IS NOT NULL THEN COALESCE(v.sale_date, v.bat_sale_date, v.auction_end_on) END AS f_sold_on,
      NULLIF(v.asking_price, 0) AS f_ask,
      COALESCE(NULLIF(v.high_bid, 0), NULLIF(v.winning_bid, 0))::numeric AS f_bid,
      CASE WHEN v.high_bid > 0 THEN 'high_bid' WHEN v.winning_bid > 0 THEN 'winning_bid' END AS f_bid_from,
      NULLIF(v.nuke_estimate, 0) AS f_estimate,
      COALESCE(v.sale_status = 'auction_live', false) AS f_live,
      COALESCE(v.sale_status, '') NOT IN ('sold', 'ended', 'not_sold', 'unsold', 'bid_to', 'auction_live', 'upcoming')
        AS f_ask_active
    FROM dated v
  )
  SELECT
    f.id,
    CASE WHEN f.basis IS NOT NULL                     THEN 'sold'
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN 'bid'
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN 'ask'
         WHEN f.f_bid IS NOT NULL                     THEN 'bid'
         WHEN f.f_estimate IS NOT NULL                THEN 'estimate'
    END,
    CASE WHEN f.basis IS NOT NULL                     THEN f.f_sold_amount
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN f.f_bid
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN f.f_ask
         WHEN f.f_bid IS NOT NULL                     THEN f.f_bid
         ELSE f.f_estimate
    END,
    CASE WHEN f.basis IS NOT NULL                     THEN f.f_sold_on::timestamptz
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN NULL
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN COALESCE(f.listing_updated_at, f.listing_posted_at)
         WHEN f.f_bid IS NOT NULL                     THEN f.auction_end_on::timestamptz
         ELSE f.valuation_calculated_at
    END,
    f.f_live,
    f.f_sold_amount, f.f_sold_on, f.basis, f.f_sold_from,
    f.f_ask, CASE WHEN f.f_ask IS NOT NULL THEN COALESCE(f.listing_updated_at, f.listing_posted_at) END,
    f.f_bid, CASE WHEN f.f_bid IS NOT NULL THEN f.auction_end_on END, f.f_bid_from,
    f.f_estimate, CASE WHEN f.f_estimate IS NOT NULL THEN f.nuke_estimate_confidence END,
    CASE WHEN f.f_estimate IS NOT NULL THEN f.valuation_calculated_at END,
    CASE WHEN f.basis IS NOT NULL THEN 'sold'
         WHEN f.sale_status IN ('not_sold', 'unsold', 'bid_to') OR f.reserve_status = 'reserve_not_met'
              OR f.auction_outcome IN ('reserve_not_met', 'no_sale')                          THEN 'reserve_not_met'
         WHEN f.sale_status IN ('auction_live', 'upcoming')                                   THEN 'active'
         WHEN f.sale_status = 'for_sale'
              OR (COALESCE(f.asking_price, 0) > 0 AND COALESCE(f.sale_status, 'available') NOT IN ('ended'))
                                                                                              THEN 'for_sale'
         WHEN f.sale_status = 'ended'                                                         THEN 'ended'
         WHEN f.sale_status = 'available' AND (COALESCE(f.high_bid, 0) > 0 OR COALESCE(f.winning_bid, 0) > 0)
                                                                                              THEN 'ended'
         ELSE 'unknown'
    END,
    f.canonical_platform, f.source_url
  FROM f;
$function$;

CREATE OR REPLACE FUNCTION public.cohort_members(p_subject_id uuid)
 RETURNS TABLE(vehicle_id uuid)
 LANGUAGE plpgsql
 STABLE
AS $function$
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

  IF p.grain = 'year' THEN
    RETURN QUERY EXECUTE format(
      'SELECT v.id FROM public.vehicles v
        WHERE lower(v.make) = lower(%L) AND v.year = %s AND lower(v.model) ~ %L
          AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item''',
      p.canonical_make, p.year, pattern);
  ELSE
    RETURN QUERY EXECUTE format(
      'SELECT v.id FROM public.vehicles v
        WHERE lower(v.make) = lower(%L) AND v.year BETWEEN %s AND %s AND lower(v.model) ~ %L
          AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item''',
      p.canonical_make, p.year_start, p.year_end, pattern);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.popup_vehicle_intel(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
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
