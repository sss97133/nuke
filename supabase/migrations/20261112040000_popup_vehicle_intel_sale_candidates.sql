-- popup_vehicle_intel: price only the cohort members that can hold a recorded sale.
--
-- recent_comps keeps 6 members with a sold basis, a positive sold amount and a sold date, newest first. The function
-- passed every eligible member to vehicle_price_facts(), which calls vehicle_sale_price_untrusted_read() (a plpgsql
-- definer lookup) once per vehicle, so the cost grew with the cohort and not with the six rows shown.
-- Measured 2026-11-08 on production, as anon, Mustang 1966 (83f6f033, 2,712 eligible members, 430 with a sale):
--   whole function 4,448 ms cold (1,381 blocks read), 482 ms warm; vehicle_price_facts over the members 509 ms of a
--   562 ms comps stage. Edge logs, 24 h to 2026-11-08 20:00 UTC: 2,189 calls, p50 84 ms, p90 2,543 ms, p99 8,296 ms,
--   161 over 3 s, 14 answered 500 at the function's own 10 s statement_timeout.
--
-- The members are now filtered by conditions every comp must already meet, read from the vehicle row:
--   sold basis    vehicle_sale_basis() is NULL unless sale_status or auction_outcome is 'sold', or the row predates the
--                 2026-09-27 cutover (or has no created_at, which the cutover test does not exclude);
--   sold date     coalesce(sale_date, bat_sale_date, auction_end_date as a date) is not null;
--   sold amount   one of coalesce(sale_price_usd, sale_price), winning_bid, bat_sold_price, sold_price is above 0.
-- A member failing any of them gets no sold_basis, sold_on or positive sold_amount from vehicle_price_facts(), so the
-- six comps and every other key of the result are unchanged. Nothing else reads the eligible set.
-- Checked on production before merge: over 19,383 sampled public vehicles, 6,292 have a sold fact and none fails the
-- filter (7,088 pass it). Comps from the old and new member sets, as anon, 120 random public vehicles: 120 identical
-- (71 with comps); warm, min of two runs each, 3,316 -> 2,386 ms in total, p90 73 -> 45 ms, max 225 -> 133 ms.
-- Mustang 1966: 2,712 -> 698 members priced, same 6 comps, comps stage 468 -> 219 ms warm.
SET lock_timeout = '5s';
SET statement_timeout = '10s';

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
      -- Sale candidates only: conditions every comp below already meets (header of 20261112040000).
      AND (v.sale_status = 'sold' OR v.auction_outcome = 'sold'
        OR (v.created_at >= '2026-09-27 00:00:00+00'::timestamptz) IS NOT TRUE)
      AND (v.sale_date IS NOT NULL OR v.bat_sale_date IS NOT NULL OR v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}')
      AND (coalesce(v.sale_price_usd, v.sale_price) > 0 OR v.winning_bid > 0
        OR v.bat_sold_price > 0 OR v.sold_price > 0)
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
        JOIN public.auction_events_canonical e ON e.id = c.auction_event_id AND e.vehicle_id = c.vehicle_id
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
