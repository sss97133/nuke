-- Listing readers count canonical rows only: FROM/JOIN auction_events -> auction_events_canonical (duplicate_of is null),
-- and the two one-off linkers key lots by canonical_listing_url. Bodies otherwise unchanged. Rollback restores prior bodies.
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

CREATE OR REPLACE FUNCTION public.get_user_reconciliation(p_user_id uuid DEFAULT NULL::uuid, p_section text DEFAULT NULL::text)
 RETURNS TABLE(section text, item text, label text, severity text, n bigint, of_n bigint, source text, as_of timestamp with time zone, note text, examples jsonb, ord integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid uuid := coalesce(p_user_id, auth.uid());
BEGIN
  IF v_uid IS NULL
     OR NOT (auth.uid() IS NOT DISTINCT FROM v_uid OR coalesce(auth.role(), '') = 'service_role') THEN
    RETURN;
  END IF;

  IF p_section IS NULL OR p_section = 'vehicles' THEN
  -- <Q1> breaks per vehicle
  RETURN QUERY
  WITH mine AS (
    SELECT s.vehicle_id, min(s.pr) AS pr FROM (
      SELECT o.vehicle_id, 1 AS pr FROM vehicle_ownerships o WHERE o.owner_profile_id = v_uid AND o.is_current
      UNION ALL SELECT ov.vehicle_id, 1 FROM ownership_verifications ov WHERE ov.user_id = v_uid AND ov.status = 'approved'
      UNION ALL SELECT o.vehicle_id, 2 FROM vehicle_ownerships o WHERE o.owner_profile_id = v_uid AND o.is_current IS NOT TRUE
      UNION ALL SELECT d.vehicle_id, 2 FROM discovered_vehicles d
                WHERE d.user_id = v_uid AND d.is_active AND d.relationship_type = 'previously_owned'
      UNION ALL SELECT c.vehicle_id, 3 FROM vehicle_contributors c WHERE c.user_id = v_uid
      UNION ALL SELECT DISTINCT i.vehicle_id, 6 FROM vehicle_images i WHERE i.user_id = v_uid AND i.vehicle_id IS NOT NULL
    ) s WHERE s.vehicle_id IS NOT NULL GROUP BY s.vehicle_id
  ),
  handles AS (
    SELECT coalesce(array_agg(DISTINCT lower(x.handle)), '{}') AS h FROM external_identities x
    WHERE x.platform = 'bat' AND (x.claimed_by_user_id = v_uid OR x.user_id = v_uid)
  ),
  v AS (
    SELECT ve.id, concat_ws(' ', ve.year, ve.make, ve.model) AS name, ve.vin, ve.make,
           ve.bat_auction_url, ve.bat_seller, ve.sale_price, ve.sold_price, ve.bat_sold_price, ve.winning_bid,
           ve.asking_price, ve.canonical_outcome, ve.canonical_sold_price, ve.image_count,
           ve.provenance_metadata -> 'content_source' AS content_source, m.pr,
           -- the sale rule the canonical-columns trigger applies today; the stored canonical_outcome can predate it
           vehicle_sale_basis(ve.sale_status, ve.auction_outcome, ve.canonical_platform, ve.listing_url, ve.discovery_url,
                              ve.sale_price::numeric, ve.notes, ve.import_metadata, ve.created_at) AS basis,
           CASE m.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously owned' WHEN 3 THEN 'contributor'
                     ELSE 'your photos only' END AS rel
    FROM mine m JOIN vehicles ve ON ve.id = m.vehicle_id
    WHERE ve.status IS DISTINCT FROM 'deleted' AND ve.status IS DISTINCT FROM 'merged'
  ),
  lots AS (   -- one row per BaT lot; the same lot can sit in auction_events with and without a trailing slash
    SELECT e.vehicle_id, regexp_replace(lower(e.source_url), '/+$', '') AS lot,
           max(e.total_bids) AS bids, max(e.comments_count) AS comments, max(e.auction_end_date) AS ended,
           max(e.seller_name) AS seller
    FROM public.auction_events_canonical e
    WHERE e.vehicle_id IN (SELECT id FROM v) AND e.source = 'bat' AND e.source_url IS NOT NULL
    GROUP BY 1, 2
  ),
  ae AS (
    SELECT l.vehicle_id, count(*) AS lots, sum(l.bids) AS bids, sum(l.comments) AS comments,
           (array_agg(l.seller ORDER BY l.ended DESC NULLS LAST) FILTER (WHERE l.seller IS NOT NULL))[1] AS seller
    FROM lots l GROUP BY 1
  ),
  ac AS (
    SELECT c.vehicle_id, count(*) FILTER (WHERE c.comment_type = 'bid') AS bids, count(*) AS entries
    FROM auction_comments c WHERE c.vehicle_id IN (SELECT id FROM v) GROUP BY 1
  ),
  bb AS (SELECT b.vehicle_id, count(*) AS n FROM bat_bids b WHERE b.vehicle_id IN (SELECT id FROM v) GROUP BY 1),
  vi AS (
    SELECT i.vehicle_id,
           count(*) FILTER (WHERE i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE) AS held,
           count(*) FILTER (WHERE i.is_superseded IS NOT TRUE
                              AND (coalesce(i.is_external, false) OR i.image_url LIKE '%bringatrailer.com%')) AS hotlinked,
           count(*) FILTER (WHERE i.is_superseded IS NOT TRUE AND i.file_hash IS NULL
                              AND NOT coalesce(i.is_external, false)) AS hashless
    FROM vehicle_images i WHERE i.vehicle_id IN (SELECT id FROM v) GROUP BY 1
  ),
  vv AS (
    SELECT DISTINCT ON (x.vehicle_id) x.vehicle_id, x.estimated_value, x.valuation_date
    FROM vehicle_valuations x WHERE x.vehicle_id IN (SELECT id FROM v)
    ORDER BY x.vehicle_id, x.valuation_date DESC NULLS LAST
  ),
  lot_keys AS (
    SELECT DISTINCT regexp_replace(lower(v.bat_auction_url), '/+$', '') AS k FROM v WHERE v.bat_auction_url IS NOT NULL
  ),
  lot_twins AS (
    SELECT regexp_replace(lower(x.bat_auction_url), '/+$', '') AS k, count(*) AS n
    FROM vehicles x
    WHERE x.bat_auction_url = ANY (ARRAY(SELECT k FROM lot_keys UNION ALL SELECT k || '/' FROM lot_keys
                                         UNION ALL SELECT v.bat_auction_url FROM v WHERE v.bat_auction_url IS NOT NULL))
      AND x.status IS DISTINCT FROM 'merged' AND x.status IS DISTINCT FROM 'deleted'
    GROUP BY 1
  ),
  facts AS (
    SELECT v.id, v.name, v.rel, v.pr, f.*
    FROM v
    CROSS JOIN handles h
    LEFT JOIN ae ON ae.vehicle_id = v.id
    LEFT JOIN ac ON ac.vehicle_id = v.id
    LEFT JOIN bb ON bb.vehicle_id = v.id
    LEFT JOIN vi ON vi.vehicle_id = v.id
    LEFT JOIN vv ON vv.vehicle_id = v.id
    LEFT JOIN lot_twins lt ON lt.k = regexp_replace(lower(v.bat_auction_url), '/+$', '')
    CROSS JOIN LATERAL (
      SELECT count(*) AS n FROM vehicles x
      WHERE v.vin IS NOT NULL AND length(v.vin) >= 6
        AND upper(x.vin) = upper(v.vin) AND x.vin IS NOT NULL AND x.deleted_at IS NULL
        AND x.id <> v.id AND x.status IS DISTINCT FROM 'merged' AND x.status IS DISTINCT FROM 'deleted'
        AND (length(v.vin) = 17 OR lower(x.make) IS NOT DISTINCT FROM lower(v.make))
    ) vt
    LEFT JOIN LATERAL (   -- the VIN the latest BaT lot record states for this car
      SELECT upper(btrim(x.structured_data ->> 'vin')) AS vin, x.source_url
      FROM vehicle_observations x
      WHERE x.vehicle_id = v.id AND x.kind IN ('sale_result', 'listing') AND x.is_superseded IS NOT TRUE
        AND x.source_url LIKE '%bringatrailer.com/listing/%' AND length(btrim(x.structured_data ->> 'vin')) >= 6
      ORDER BY x.observed_at DESC LIMIT 1
    ) lotvin ON true
    CROSS JOIN LATERAL (VALUES
      ('sale / ask stored as sale', 'Sale price on a car with no recorded sale', 'error',
       'vehicles.sale_price vs vehicle_sale_basis (a status must say money moved)',
       v.basis IS NULL AND v.sale_price IS NOT NULL,
       format('sale_price %s with no sale status%s', v.sale_price,
              CASE WHEN v.asking_price = v.sale_price THEN '; it equals the asking price' ELSE '' END), 10),

      ('sale / stale outcome', 'Marked sold, but the sale rule finds no sale', 'error',
       'vehicles.canonical_outcome vs vehicle_sale_basis',
       v.canonical_outcome = 'sold' AND v.basis IS NULL,
       format('canonical outcome sold at %s, written before the current sale rule', v.canonical_sold_price), 11),

      ('sale / columns disagree', 'Sale columns disagree on a sold car', 'error',
       'vehicles sale columns vs canonical_sold_price',
       v.basis IS NOT NULL AND (
            (v.sale_price IS NOT NULL AND v.sale_price <> v.canonical_sold_price)
         OR (v.sold_price IS NOT NULL AND v.sold_price <> v.canonical_sold_price)
         OR (v.bat_sold_price IS NOT NULL AND v.bat_sold_price <> v.canonical_sold_price)
         OR (v.winning_bid IS NOT NULL AND v.winning_bid <> v.canonical_sold_price)),
       concat_ws(' · ', 'canonical ' || v.canonical_sold_price, 'sale_price ' || v.sale_price, 'sold_price ' || v.sold_price,
                 'bat_sold_price ' || v.bat_sold_price, 'winning_bid ' || v.winning_bid), 12),

      ('identity / lot twins', 'More than one vehicle row on one BaT lot', 'error',
       'vehicles.bat_auction_url',
       coalesce(lt.n, 1) > 1,
       format('%s vehicle rows point at %s', lt.n, v.bat_auction_url), 13),

      ('identity / VIN twins', 'Another vehicle row carries the same VIN', 'error',
       'vehicles.vin',
       vt.n > 0,
       format('%s other row(s) with VIN %s', vt.n, v.vin), 14),

      ('identity / VIN vs lot page', 'VIN on the row differs from the VIN on its BaT lot', 'error',
       'vehicles.vin vs BaT sale_result / listing observation',
       v.vin IS NOT NULL AND lotvin.vin IS NOT NULL AND upper(btrim(v.vin)) <> lotvin.vin,
       format('row VIN %s, lot page VIN %s (%s)', v.vin, lotvin.vin, lotvin.source_url), 14),

      ('auction / seller', 'Seller on the row does not match the lot page', 'error',
       'vehicles.bat_seller vs auction_events.seller_name',
       (ae.seller IS NOT NULL AND v.bat_seller IS NOT NULL AND lower(ae.seller) <> lower(v.bat_seller))
         OR (ae.seller IS NULL AND v.bat_seller IS NOT NULL AND v.rel = 'owner' AND NOT (lower(v.bat_seller) = ANY (h.h))),
       CASE WHEN ae.seller IS NOT NULL THEN format('row says %s, lot page says %s', v.bat_seller, ae.seller)
            ELSE format('seller %s is not one of your handles', v.bat_seller) END, 15),

      ('auction / bids', 'Bid rows held do not match the lot page', 'error',
       'auction_events.total_bids vs auction_comments (type bid)',
       ae.bids IS NOT NULL AND coalesce(ac.bids, 0) <> ae.bids,
       format('lot page %s bids on %s lot(s) · bid rows held %s', ae.bids, ae.lots, coalesce(ac.bids, 0)), 16),

      ('auction / comments', 'Comment rows held do not match the lot page', 'error',
       'auction_events.comments_count vs auction_comments',
       ae.comments IS NOT NULL AND coalesce(ac.entries, 0) <> ae.comments,
       format('lot page %s entries · rows held %s', ae.comments, coalesce(ac.entries, 0)), 17),

      ('auction / bids table', 'Bids table does not match the bid rows', 'error',
       'bat_bids vs auction_comments (type bid)',
       coalesce(ac.bids, 0) > 0 AND coalesce(bb.n, 0) <> ac.bids,
       format('bid rows %s · bids table %s%s', ac.bids, coalesce(bb.n, 0),
              CASE WHEN coalesce(bb.n, 0) = 0 THEN ' (bat_bids needs a bat_listings row the lot loader does not write)' ELSE '' END), 18),

      ('valuation / sold', 'Latest valuation far from the hammer price', 'error',
       'vehicle_valuations vs canonical_sold_price',
       v.basis IS NOT NULL AND vv.estimated_value IS NOT NULL AND v.canonical_sold_price > 0
         AND abs(vv.estimated_value - v.canonical_sold_price) / v.canonical_sold_price > 0.25,
       format('valuation %s from %s vs hammer %s', vv.estimated_value, vv.valuation_date::date, v.canonical_sold_price), 19),

      ('provenance / content source', 'Sold under your handle, credited to someone else', 'warn',
       'vehicles.provenance_metadata.content_source vs auction_events.seller_name',
       v.rel = 'owner' AND v.content_source ->> 'entity_type' = 'organization'
         AND ae.seller IS NOT NULL AND lower(ae.seller) = ANY (h.h),
       format('lot seller %s, row credits %s', ae.seller, v.content_source ->> 'entity'), 30),

      ('identity / no VIN', 'No VIN on record', 'warn',
       'vehicles.vin',
       v.vin IS NULL OR btrim(v.vin) = '',
       'no VIN', 31),

      ('photos / hashless', 'Photos with no content hash', 'warn',
       'vehicle_images.file_hash',
       coalesce(vi.hashless, 0) > 0,
       format('%s photos without a hash', vi.hashless), 32),

      ('photos / count drift', 'Photo count on the row does not match the photos held', 'warn',
       'vehicles.image_count vs vehicle_images',
       coalesce(v.image_count, 0) <> coalesce(vi.held, 0),
       format('row says %s, photos held %s', coalesce(v.image_count, 0), coalesce(vi.held, 0)), 33),

      ('photos / hotlinked', 'Lot photos linked to BaT, not held', 'warn',
       'vehicle_images.is_external',
       coalesce(vi.hotlinked, 0) > 0,
       format('%s photos are links with no bytes or hash held', vi.hotlinked), 34)
    ) AS f(item, label, severity, source, is_break, note, ord)
  )
  SELECT 'vehicles'::text, f.item, f.label, f.severity,
         count(*) FILTER (WHERE f.is_break), count(*), 'from ' || f.source, now(),
         NULL::text,
         to_jsonb((array_agg(jsonb_build_object('vehicle_id', f.id, 'vehicle', f.name, 'rel', f.rel, 'note', f.note)
                             ORDER BY f.pr, f.name) FILTER (WHERE f.is_break))[1:5]),
         f.ord
  FROM facts f
  GROUP BY f.item, f.label, f.severity, f.source, f.ord;
  -- </Q1>
  END IF;

  IF p_section IS NULL OR p_section = 'account' THEN
  -- <Q2> breaks at the account level (one pass over the user's photos)
  RETURN QUERY
  WITH imgs AS (
    SELECT i.vehicle_id, count(*) AS photos,
           count(*) FILTER (WHERE i.file_hash IS NULL AND NOT coalesce(i.is_external, false)) AS hashless,
           max(i.taken_at) AS newest
    FROM vehicle_images i WHERE i.user_id = v_uid AND i.is_superseded IS NOT TRUE
    GROUP BY 1
  ),
  p AS (
    SELECT coalesce(sum(m.photos), 0)::bigint AS total,
           coalesce(sum(m.photos) FILTER (WHERE m.vehicle_id IS NULL), 0)::bigint AS unfiled,
           coalesce(sum(m.hashless), 0)::bigint AS hashless,
           max(m.newest) AS newest,
           count(*) FILTER (WHERE m.vehicle_id IS NOT NULL) AS vehicles
    FROM imgs m
  ),
  linked AS (
    SELECT o.vehicle_id FROM vehicle_ownerships o WHERE o.owner_profile_id = v_uid
    UNION SELECT ov.vehicle_id FROM ownership_verifications ov WHERE ov.user_id = v_uid AND ov.status = 'approved'
    UNION SELECT d.vehicle_id FROM discovered_vehicles d WHERE d.user_id = v_uid AND d.is_active
    UNION SELECT c.vehicle_id FROM vehicle_contributors c WHERE c.user_id = v_uid
  ),
  photo_only AS (
    SELECT m.vehicle_id, m.photos FROM imgs m
    WHERE m.vehicle_id IS NOT NULL AND m.vehicle_id NOT IN (SELECT vehicle_id FROM linked WHERE vehicle_id IS NOT NULL)
  ),
  owner_rows AS (
    SELECT x.id, concat_ws(' ', x.year, x.make, x.model) AS name, x.status,
           x.id IN (SELECT vehicle_id FROM linked WHERE vehicle_id IS NOT NULL) AS has_record
    FROM vehicles x
    WHERE x.owner_id = v_uid AND x.status IS DISTINCT FROM 'merged' AND x.status IS DISTINCT FROM 'deleted'
  ),
  c AS (SELECT max(u.contribution_date) AS last FROM user_contributions u WHERE u.user_id = v_uid)
  SELECT 'account', 'photos / on no vehicle', 'Your photos on no vehicle', 'warn',
         p.unfiled, p.total, 'from vehicle_images (vehicle_id empty)', now(), NULL::text, NULL::jsonb, 40
  FROM p
  UNION ALL
  SELECT 'account', 'photos / hashless (all)', 'Your photos with no content hash', 'warn',
         p.hashless, p.total, 'from vehicle_images.file_hash', now(), NULL, NULL, 41
  FROM p
  UNION ALL
  SELECT 'account', 'photos / newest', 'Days since your newest photo', 'warn',
         CASE WHEN p.newest IS NULL THEN NULL ELSE (current_date - p.newest::date)::bigint END, NULL,
         'from vehicle_images.taken_at', p.newest, 'newest photo taken ' || to_char(p.newest, 'YYYY-MM-DD'), NULL, 42
  FROM p
  UNION ALL
  SELECT 'account', 'vehicles / photo-only', 'Vehicles with your photos but no ownership, contributor or discovery link to you', 'warn',
         (SELECT count(*) FROM photo_only), (SELECT p.vehicles FROM p),
         'from vehicle_images vs vehicle_ownerships, ownership_verifications, discovered_vehicles, vehicle_contributors', now(),
         NULL,
         (SELECT to_jsonb((array_agg(jsonb_build_object('vehicle_id', po.vehicle_id,
                    'vehicle', (SELECT concat_ws(' ', x.year, x.make, x.model) FROM vehicles x WHERE x.id = po.vehicle_id),
                    'note', po.photos || ' of your photos') ORDER BY po.photos DESC))[1:5]) FROM photo_only po),
         43
  UNION ALL
  SELECT 'account', 'ownership / owner_id without record', 'Rows naming you owner with no ownership record', 'warn',
         count(*) FILTER (WHERE NOT o.has_record), count(*),
         'from vehicles.owner_id vs vehicle_ownerships, ownership_verifications, discovered_vehicles, vehicle_contributors', now(),
         NULL,
         to_jsonb((array_agg(jsonb_build_object('vehicle_id', o.id, 'vehicle', o.name, 'note', 'status ' || coalesce(o.status, 'none'))
                             ORDER BY o.name) FILTER (WHERE NOT o.has_record))[1:5]),
         44
  FROM owner_rows o
  UNION ALL
  SELECT 'account', 'ledger / contributions', 'Days since the contribution ledger was written', 'warn',
         CASE WHEN c.last IS NULL THEN NULL ELSE (current_date - c.last::date)::bigint END, NULL,
         'from user_contributions.contribution_date', c.last::timestamptz,
         'last written ' || to_char(c.last, 'YYYY-MM-DD'), NULL, 45
  FROM c;
  -- </Q2>
  END IF;

  IF p_section IS NULL OR p_section = 'books' THEN
  -- <Q3> books chain
  RETURN QUERY
  WITH qb AS (
    SELECT pc.quickbooks_connected_at AS connected_at FROM parent_company pc
    WHERE pc.owner_user_id = v_uid AND pc.quickbooks_realm_id IS NOT NULL
    ORDER BY pc.quickbooks_connected_at DESC NULLS LAST LIMIT 1
  ),
  lines AS (
    SELECT count(*) AS n, count(t.vehicle_id) AS on_vehicle, min(t.date) AS first_line, max(t.date) AS last_line,
           greatest(max(t.created_at), max(t.updated_at)) AS last_pull
    FROM qb_transactions t WHERE false /* no owner bridge: global aggregate withheld */
  ),
  rc AS (
    SELECT r.id,
           (SELECT h FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.raw_json -> 'scope_history') = 'array'
                                                    THEN r.raw_json -> 'scope_history' END) WITH ORDINALITY AS x(h, i)
             WHERE h ->> 'reason' LIKE 'reconcile-v1%' ORDER BY x.i DESC LIMIT 1) AS d
    FROM receipts r
    WHERE r.user_id = v_uid AND r.is_superseded IS NOT TRUE AND r.is_active IS NOT FALSE
  ),
  rs AS (
    SELECT count(*) AS held, count(rc.d) AS decided,
           count(*) FILTER (WHERE rc.d IS NOT NULL AND rc.d ->> 'reason' NOT LIKE '%"unresolved":[]%') AS missing,
           max(CASE WHEN rc.d ->> 'at' ~ '^\d{4}-\d{2}-\d{2}' THEN (rc.d ->> 'at')::timestamptz END) AS last_decided
    FROM rc
  ),
  sold AS (
    SELECT ve.id, concat_ws(' ', ve.year, ve.make, ve.model) AS name, ve.canonical_sold_price AS sold_usd,
           (SELECT o.source_url FROM vehicle_observations o
             WHERE o.vehicle_id = ve.id AND o.kind = 'sale_result' AND o.is_superseded IS NOT TRUE AND o.source_url IS NOT NULL
             ORDER BY o.observed_at DESC LIMIT 1) AS sold_source,
           ve.purchase_price
    FROM vehicles ve
    WHERE vehicle_sale_basis(ve.sale_status, ve.auction_outcome, ve.canonical_platform, ve.listing_url, ve.discovery_url,
                             ve.sale_price::numeric, ve.notes, ve.import_metadata, ve.created_at) IS NOT NULL
      AND ve.status IS DISTINCT FROM 'merged' AND ve.status IS DISTINCT FROM 'deleted'
      AND ve.id IN (
        SELECT o.vehicle_id FROM vehicle_ownerships o WHERE o.owner_profile_id = v_uid
        UNION SELECT ov.vehicle_id FROM ownership_verifications ov WHERE ov.user_id = v_uid AND ov.status = 'approved'
        UNION SELECT d.vehicle_id FROM discovered_vehicles d
              WHERE d.user_id = v_uid AND d.is_active AND d.relationship_type = 'previously_owned')
  ),
  cars AS (
    SELECT s.*, round(compute_active_minutes_burst_total(s.id, 30) / 60.0, 1) AS hours,
           -- a purchase counts only when a live sale_result names this user as the buyer; vehicles.purchase_price has no source
           (SELECT CASE WHEN p.t ~ '^[0-9]+(\.[0-9]+)?$' THEN p.t::numeric END
              FROM vehicle_observations o
             CROSS JOIN LATERAL (SELECT coalesce(o.structured_data ->> 'sale_price_usd', o.structured_data ->> 'sale_price') AS t) p
             WHERE o.vehicle_id = s.id AND o.kind = 'sale_result' AND o.is_superseded IS NOT TRUE
               AND (o.structured_data ->> 'buyer_user_id' = v_uid::text
                    OR lower(o.structured_data ->> 'buyer_handle') IN (
                         SELECT lower(x.handle) FROM external_identities x
                          WHERE x.claimed_by_user_id = v_uid OR x.user_id = v_uid))
             ORDER BY o.observed_at DESC LIMIT 1) AS purchase_usd
    FROM sold s
  )
  SELECT 'books', 'books / bank feeds', 'Bank feeds into QuickBooks', 'unknown',
         NULL::bigint, NULL::bigint, 'QuickBooks Banking screen (not readable through the QuickBooks API)', qb.connected_at,
         'QuickBooks connected ' || to_char(qb.connected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
           || '. Which bank feeds are connected or broken is shown only inside QuickBooks.', NULL::jsonb, 1
  FROM qb
  UNION ALL
  SELECT 'books', 'books / quickbooks review', 'Waiting in QuickBooks "For review"', 'unknown',
         NULL, NULL, 'QuickBooks Banking screen (not readable through the QuickBooks API)', NULL,
         'Bank items reach Nuke only after they are posted in QuickBooks.', NULL, 2
  FROM qb
  UNION ALL
  SELECT 'books', 'books / nuke books', 'Books lines in Nuke', CASE WHEN l.last_pull < now() - interval '7 days' THEN 'warn' ELSE 'ok' END,
         l.n, NULL, 'from QuickBooks pull ' || to_char(l.last_pull AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z (qb_transactions)',
         l.last_pull,
         format('lines dated %s to %s; %s of %s name a vehicle', l.first_line, l.last_line, l.on_vehicle, l.n), NULL, 3
  FROM lines l WHERE l.n > 0
  UNION ALL
  SELECT 'books', 'books / receipts', 'Receipts through receipts:reconcile', CASE WHEN rs.missing > 0 OR rs.decided < rs.held THEN 'warn' ELSE 'ok' END,
         rs.decided, rs.held, 'from receipts and receipts:reconcile decisions (receipts.raw_json.scope_history)', rs.last_decided,
         format('%s still missing evidence (who paid, or no matching books line); %s not yet run', rs.missing, rs.held - rs.decided),
         NULL, 4
  FROM rs WHERE rs.held > 0
  UNION ALL
  SELECT 'books', 'books / cars', 'Sold cars with a return per documented hour',
         CASE WHEN count(*) FILTER (WHERE c.purchase_usd IS NOT NULL AND c.hours > 0) = count(*) THEN 'ok' ELSE 'blocked' END,
         count(*) FILTER (WHERE c.purchase_usd IS NOT NULL AND c.hours > 0), count(*),
         'from sale records, sourced purchases and photo bursts (compute_active_minutes_burst_total)', now(),
         'Return per hour = (sale - purchase) / documented hours. It needs a sourced purchase price; vehicles.purchase_price carries no source.',
         jsonb_agg(jsonb_build_object(
           'vehicle_id', c.id, 'vehicle', c.name, 'sold_usd', c.sold_usd,
           'sold_source', coalesce(c.sold_source, 'vehicles.canonical_sold_price'),
           'hours', c.hours, 'purchase_usd', c.purchase_usd,
           'purchase_on_row_unsourced', CASE WHEN c.purchase_usd IS NULL THEN c.purchase_price END,
           'return_per_hour', CASE WHEN c.purchase_usd IS NOT NULL AND c.hours > 0
                                   THEN round((c.sold_usd - c.purchase_usd) / c.hours, 2) END,
           'blocked_on', CASE WHEN c.purchase_usd IS NULL THEN 'purchase price has no source'
                              WHEN c.hours = 0 THEN 'no documented hours' END)
           ORDER BY c.sold_usd DESC NULLS LAST),
         5
  FROM cars c HAVING count(*) > 0;
  -- </Q3>
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.live_lot_temperature(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET statement_timeout TO '8s'
 SET lock_timeout TO '2s'
 SET enable_indexscan TO 'off'
AS $function$
  -- live_lot_folded_v1
  -- enable_indexscan is off for this function only: it reads the rows of up to 300 comparable vehicles from tables far larger
  -- than memory, and a bitmap scan prefetches those heap pages where an index scan fetches them one at a time.
  WITH lot AS (   -- the live lot, with an end time that has a clock (a bare date would move h by up to a day)
    SELECT v.id,
           v.make,
           v.model,
           v.auction_end_date::timestamptz AS ends_at,
           substring(v.listing_url FROM '/listing/([^/?#]+)') AS slug
    FROM vehicles v
    WHERE v.id = p_vehicle_id
      AND v.sale_status = 'auction_live'
      AND v.make IS NOT NULL
      AND v.model IS NOT NULL
      AND v.listing_url ~ 'bringatrailer\.com/listing/[^/?#]+'
      AND v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
  ),
  own AS (   -- the lot's own rows from this listing, as of its last read
    SELECT count(*) AS n_rows,
           count(*) FILTER (WHERE c.comment_type = 'bid') AS bids,
           count(DISTINCT c.author_username) FILTER (WHERE c.comment_type = 'bid') AS bidders,
           max(c.bid_amount) FILTER (WHERE c.comment_type = 'bid') AS bid,
           max(c.created_at) AS last_row_at
    FROM lot
    JOIN auction_comments c ON c.vehicle_id = lot.id
    WHERE substring(c.source_url FROM '/listing/([^/?#]+)') = lot.slug
  ),
  at AS (    -- when it was read, and the hours to close at that moment
    SELECT lot.*,
           r.read_at,
           extract(epoch FROM (lot.ends_at - r.read_at)) / 3600.0 AS h
    FROM lot
    CROSS JOIN own
    CROSS JOIN LATERAL (
      SELECT least(now(), greatest(own.last_row_at, (
               SELECT max(e.updated_at) FROM public.auction_events_canonical e
               WHERE e.vehicle_id = lot.id
                 AND substring(e.source_url FROM '/listing/([^/?#]+)') = lot.slug))) AS read_at
    ) r
    WHERE own.n_rows > 0
      AND lot.ends_at > now()
  ),
  cand AS (  -- comparable vehicles: same make and model, a BaT listing, not live; the 300 most recent
    -- Exact make and model through idx_vehicles_make_model. Under RLS (SECURITY INVOKER, anon) a qual that calls a
    -- non-leakproof function such as lower() can't be an index condition, and that plan read the whole table
    -- (timed out at 15 s as anon); plain text equality is leakproof: 0.76 s cold for 1,245 SL500 rows.
    SELECT v.id, v.sale_status,
           substring(v.listing_url FROM '/listing/([^/?#]+)') AS slug,
           v.auction_end_date AS ends
    FROM vehicles v
    WHERE v.make = (SELECT at.make FROM at)
      AND v.model = (SELECT at.model FROM at)
      AND v.id <> p_vehicle_id
      AND v.deleted_at IS NULL
      AND v.merged_into_vehicle_id IS NULL
      AND v.sale_status IS DISTINCT FROM 'auction_live'
      AND v.listing_url ~ 'bringatrailer\.com/listing/'
    ORDER BY v.auction_end_date DESC NULLS LAST
    LIMIT 300
  ),
  lot_folded AS (  -- their BaT comment and bid rows, folded to one row per listing slug in one pass: every row counted
                   -- (n_rows) and the bid rows kept as aligned arrays (event time only: posted_at). The joins below are
                   -- then lots x lots, not rows x lots (K5-sized cohorts: 34,000 rows x 206 lots, run as a nested loop).
    SELECT c.vehicle_id,
           substring(c.source_url FROM '/listing/([^/?#]+)') AS slug,
           count(*) AS n_rows,
           array_agg(c.posted_at       ORDER BY c.posted_at, c.author_username, c.bid_amount) FILTER (WHERE c.comment_type = 'bid') AS bid_at,
           array_agg(c.author_username ORDER BY c.posted_at, c.author_username, c.bid_amount) FILTER (WHERE c.comment_type = 'bid') AS bid_by,
           array_agg(c.bid_amount      ORDER BY c.posted_at, c.author_username, c.bid_amount) FILTER (WHERE c.comment_type = 'bid') AS bid_amt
    FROM auction_comments c
    WHERE c.vehicle_id = ANY (ARRAY(SELECT cand.id FROM cand))   -- one bitmap scan over all the comparables, not one scan each
      AND c.platform = 'bat'
      AND c.posted_at IS NOT NULL
      AND c.source_url ~ '/listing/[^/?#]+'
    GROUP BY 1, 2
  ),
  closes AS (  -- one close per lot: auction_events.auction_end_date for that listing (latest row), else the vehicle's
               -- own end when it is this listing's and carries a clock. A lot with neither has no h: unknown, not counted.
               -- C5: auction_comments.hours_until_close is not read here; it was derived from ingest time on 73% of rows.
    SELECT k.vehicle_id, k.slug,
           COALESCE(ev.auction_end_date,
                    CASE WHEN cand.slug = k.slug AND cand.ends ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
                         THEN cand.ends::timestamptz END) AS closed_at
    FROM lot_folded k
    JOIN cand ON cand.id = k.vehicle_id
    LEFT JOIN LATERAL (
      SELECT e.auction_end_date FROM public.auction_events_canonical e
      WHERE e.vehicle_id = k.vehicle_id
        AND e.auction_end_date IS NOT NULL
        AND substring(e.source_url FROM '/listing/([^/?#]+)') = k.slug
      ORDER BY e.updated_at DESC NULLS LAST
      LIMIT 1
    ) ev ON true
  ),
  lot_close AS MATERIALIZED (  -- each folded lot with its close: lots x lots, joined before anything is computed per lot
    SELECT f.vehicle_id, f.slug, f.n_rows, cl.closed_at, f.bid_at, f.bid_by, f.bid_amt
    FROM lot_folded f
    JOIN closes cl ON cl.vehicle_id = f.vehicle_id AND cl.slug = f.slug
    WHERE cl.closed_at IS NOT NULL
  ),
  lots AS (  -- each lot with a known close, counted from bid rows posted h or more hours before that close
    SELECT lc.vehicle_id,
           lc.slug,
           lc.n_rows,
           lc.closed_at,
           b.bids,
           b.bidders,
           b.bid
    FROM at
    CROSS JOIN lot_close lc
    CROSS JOIN LATERAL (
      SELECT count(*) AS bids,
             count(DISTINCT u.a) AS bidders,
             max(u.amt) AS bid
      FROM unnest(lc.bid_at, lc.bid_by, lc.bid_amt) AS u(t, a, amt)
      WHERE u.t <= lc.closed_at - at.h * interval '1 hour'
    ) b
  ),
  comp AS (  -- one row per finished listing (a lot on two vehicles counts once), with whether it sold
    SELECT DISTINCT ON (l.slug)
           l.slug, l.closed_at, l.bids, l.bidders, l.bid,
           COALESCE(ev.outcome = 'sold', cand.sale_status = 'sold') AS sold
    FROM lots l
    JOIN cand ON cand.id = l.vehicle_id
    LEFT JOIN LATERAL (
      SELECT e.outcome FROM public.auction_events_canonical e
      WHERE e.vehicle_id = l.vehicle_id
        AND substring(e.source_url FROM '/listing/([^/?#]+)') = l.slug
      ORDER BY e.updated_at DESC NULLS LAST
      LIMIT 1
    ) ev ON true
    WHERE l.closed_at < now()
      AND l.slug IS DISTINCT FROM (SELECT slug FROM at)
    ORDER BY l.slug, l.n_rows DESC
  ),
  price AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE c.bid < own.bid) AS below,
           count(*) FILTER (WHERE c.bid = own.bid) AS same,
           COALESCE(jsonb_agg(c.bid ORDER BY c.bid), '[]'::jsonb) AS comps,
           min(c.closed_at) AS first_close,
           max(c.closed_at) AS last_close
    FROM comp c
    CROSS JOIN own
    WHERE c.sold AND c.bid IS NOT NULL
  ),
  activity AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE c.bids < own.bids) AS bids_below,
           count(*) FILTER (WHERE c.bids = own.bids) AS bids_same,
           count(*) FILTER (WHERE c.bidders < own.bidders) AS bidders_below,
           count(*) FILTER (WHERE c.bidders = own.bidders) AS bidders_same,
           COALESCE(jsonb_agg(c.bids ORDER BY c.bids), '[]'::jsonb) AS comps,
           COALESCE(jsonb_agg(c.bidders ORDER BY c.bidders), '[]'::jsonb) AS comps_bidders,
           min(c.closed_at) AS first_close,
           max(c.closed_at) AS last_close
    FROM comp c
    CROSS JOIN own
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM lot) THEN jsonb_build_object('status', 'not_live')
    WHEN (SELECT l.ends_at FROM lot l) <= now() THEN jsonb_build_object('status', 'ended')
    WHEN NOT EXISTS (SELECT 1 FROM at) THEN jsonb_build_object('status', 'not_read')
    ELSE (
      SELECT jsonb_build_object(
        'status', 'ok',
        'make', at.make,
        'model', at.model,
        'read_at', at.read_at,
        'ends_at', at.ends_at,
        'hours_left', round(at.h::numeric, 2),
        'min_comparables', 8,
        'vehicles_cap', 300,
        'vehicles_considered', (SELECT count(*) FROM cand),
        'lots_without_close', (SELECT count(*) FROM closes WHERE closed_at IS NULL),
        'price', jsonb_build_object(
          'bid', own.bid,
          'n', price.n, 'below', price.below, 'same', price.same,
          'first_close', price.first_close, 'last_close', price.last_close,
          'comps', price.comps),
        'activity', jsonb_build_object(
          'bids', own.bids, 'bidders', own.bidders,
          'n', activity.n,
          'bids_below', activity.bids_below, 'bids_same', activity.bids_same,
          'bidders_below', activity.bidders_below, 'bidders_same', activity.bidders_same,
          'first_close', activity.first_close, 'last_close', activity.last_close,
          'comps', activity.comps, 'comps_bidders', activity.comps_bidders))
      FROM at, own, price, activity
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.vein_lx450_condition_stats(p_rubric text, p_since date, p_until date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH lots AS (
    SELECT DISTINCT ON (ae.vehicle_id) ae.vehicle_id, v.mileage::float8 AS m,
           coalesce(ae.winning_bid, ae.high_bid)::float8 AS p, rtrim(ae.source_url, '/') AS url
    FROM public.auction_events_canonical ae
    JOIN vehicles v ON v.id = ae.vehicle_id
    WHERE v.make ILIKE 'lexus' AND v.model ILIKE 'LX%450%' AND v.year BETWEEN 1996 AND 1997
      AND ae.outcome = 'sold' AND ae.auction_end_date >= p_since AND ae.auction_end_date < p_until
      AND v.mileage > 0 AND coalesce(ae.winning_bid, ae.high_bid) > 0
    ORDER BY ae.vehicle_id, ae.auction_end_date DESC
  ), cond AS (
    -- Condition is a property of the lot as listed, so the score must come from the same listing as the sale.
    SELECT DISTINCT ON (o.vehicle_id, rtrim(o.source_url, '/')) o.vehicle_id, rtrim(o.source_url, '/') AS url,
           o.structured_data AS sd
    FROM vehicle_observations o
    WHERE o.kind = 'condition' AND o.vehicle_id IN (SELECT vehicle_id FROM lots)
      AND o.structured_data ->> 'rubric' = p_rubric AND coalesce(o.is_superseded, false) = false
    ORDER BY o.vehicle_id, rtrim(o.source_url, '/'), o.ingested_at DESC
  ), j AS (
    SELECT l.*, c.sd FROM lots l JOIN cond c USING (vehicle_id, url)
  ), fit AS (
    SELECT regr_slope(ln(p), m) AS b, regr_intercept(ln(p), m) AS a, regr_r2(ln(p), m) AS r2, count(*) AS n FROM j
  ), r AS (
    SELECT j.sd, ln(j.p) - (fit.a + fit.b * j.m) AS res FROM j, fit
  ), feat AS (
              SELECT 'records' AS f,            (sd ->> 'records')::int = 1           AS x, res FROM r
    UNION ALL SELECT 'lockers',                 (sd ->> 'lockers')::int = 1,                res FROM r
    UNION ALL SELECT 'engine_major_work',       (sd ->> 'engine_major_work')::int = 1,      res FROM r
    UNION ALL SELECT 'paint_poor',              (sd ->> 'paint')::int = 0,                  res FROM r
    UNION ALL SELECT 'interior_damaged',        (sd ->> 'interior')::int = 0,               res FROM r
    UNION ALL SELECT 'title_flag',              (sd ->> 'title_flag') IS NOT NULL,          res FROM r
  ), st AS (
    SELECT f,
           count(*) FILTER (WHERE x) AS n1, count(*) FILTER (WHERE NOT x) AS n0,
           avg(res) FILTER (WHERE x) AS m1, avg(res) FILTER (WHERE NOT x) AS m0,
           var_samp(res) FILTER (WHERE x) AS v1, var_samp(res) FILTER (WHERE NOT x) AS v0
    FROM feat GROUP BY f
  )
  SELECT jsonb_build_object(
    'rubric', p_rubric, 'since', p_since, 'until', p_until,
    'n', (SELECT n FROM fit), 'slope_per_mile', (SELECT b FROM fit), 'intercept', (SELECT a FROM fit),
    'r2', (SELECT r2 FROM fit),
    'features', coalesce((SELECT jsonb_object_agg(f, jsonb_build_object(
        'n_with', n1, 'n_without', n0, 'mean_with', m1, 'mean_without', m0, 'var_with', v1, 'var_without', v0,
        'effect', m1 - m0,
        'welch_t', CASE WHEN n1 > 1 AND n0 > 1 AND (v1 / n1 + v0 / n0) > 0
                        THEN (m1 - m0) / sqrt(v1 / n1 + v0 / n0) END)) FROM st), '{}'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.market_lot_activity(p_vehicle_ids uuid[], p_limit_per_lot integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '10s'
AS $function$
WITH settings AS MATERIALIZED (
  SELECT statement_timestamp() AS as_of, LEAST(40, GREATEST(1, COALESCE(p_limit_per_lot, 40))) AS row_cap
), requested AS MATERIALIZED (
  -- Bound even duplicate-heavy inputs before grouping; callers pass at most eight current lots.
  SELECT id, min(ordinality) AS ordinal
  FROM unnest(p_vehicle_ids[1:8]) WITH ORDINALITY r(id, ordinality)
  WHERE id IS NOT NULL GROUP BY id
), selected AS MATERIALIZED (
  SELECT id FROM requested ORDER BY ordinal LIMIT 8
), eligible AS MATERIALIZED (
  SELECT v.id, rtrim(v.listing_url, '/') AS lot_url,
    CASE WHEN COALESCE(v.high_bid, v.sale_price) >= 0 THEN COALESCE(v.high_bid, v.sale_price) END AS current_bid_at_capture
  FROM selected r JOIN public.vehicles v ON v.id = r.id CROSS JOIN settings s
  WHERE v.is_public AND v.deleted_at IS NULL
    AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    AND v.sale_status = 'auction_live' AND v.platform_source = 'bringatrailer'
    AND v.auction_end_date IS NOT NULL AND v.auction_end_date::timestamptz > s.as_of
    AND v.listing_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
), lots AS MATERIALIZED (
  SELECT v.id, v.lot_url, e.id AS source_auction_event_id, e.scraped_at AS source_read_at,
    COALESCE(e.raw_data #>> '{source_read,basis}', 'unknown') AS source_read_basis,
    v.current_bid_at_capture, e.source_bid_amount,
    CASE WHEN e.source_bid_amount IS NOT NULL THEN e.updated_at END AS source_bid_ingested_at,
    CASE WHEN e.source_bid_amount IS NULL OR v.current_bid_at_capture IS NULL THEN 'unknown'
      WHEN e.source_bid_amount = v.current_bid_at_capture THEN 'matched' ELSE 'mismatched' END AS source_bid_match,
    a.activity, a.has_more
  FROM eligible v CROSS JOIN settings s
  LEFT JOIN LATERAL (
    SELECT e.id, e.scraped_at, e.raw_data, e.updated_at,
      CASE WHEN min(e.bound_bid) OVER same_read = max(e.bound_bid) OVER same_read
        THEN e.bound_bid END AS source_bid_amount
    FROM (
      SELECT e.id, e.scraped_at, e.raw_data, e.updated_at,
        CASE WHEN e.outcome = 'live' AND e.auction_end_date > s.as_of
          AND e.high_bid > 0 AND e.high_bid < 'Infinity'::numeric
          AND e.raw_data #>> '{source_read,bid_amount_version}' = '1'
          AND e.raw_data #> '{source_read,bid_amount}' = to_jsonb(e.high_bid)
          AND e.raw_data->>'listing_url' IN (v.lot_url, v.lot_url || '/')
          THEN e.high_bid END AS bound_bid
      FROM public.auction_events_canonical e
      WHERE e.vehicle_id = v.id AND e.source = 'bat'
        AND e.source_url IN (v.lot_url, v.lot_url || '/')
        AND e.raw_data->>'extractor' = 'extract-bat-core'
        AND e.raw_data #>> '{source_read,clock_version}' = '1'
        AND e.raw_data #>> '{source_read,basis}' IN ('direct_fetch', 'cached_snapshot')
        AND e.scraped_at <= s.as_of AND e.created_at <= s.as_of AND e.updated_at <= s.as_of
        AND to_char(e.scraped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          = e.raw_data #>> '{source_read,at}'
    ) e
    WINDOW same_read AS (PARTITION BY e.scraped_at)
    -- Conflicting bound prices at the same read stay unknown, regardless of URL alias or row ID.
    ORDER BY e.scraped_at DESC, e.bound_bid NULLS LAST, e.id LIMIT 1
  ) e ON true
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'vehicle_id', v.id, 'posted_at', c.posted_at, 'comment_type', c.comment_type,
        'bid_amount', c.bid_amount, 'sequence_number', c.sequence_number, 'source_url', c.source_url
      ) ORDER BY c.posted_at DESC, c.id) FILTER (WHERE c.position <= s.row_cap), '[]'::jsonb) AS activity,
      count(*) > s.row_cap AS has_more
    FROM (
      SELECT d.*, row_number() OVER (ORDER BY d.posted_at DESC, d.id) AS position
      FROM (
        SELECT DISTINCT ON (COALESCE(c.bat_comment_id::text, c.id::text))
          c.id, c.posted_at, c.comment_type, c.bid_amount, c.sequence_number, c.source_url
        FROM public.auction_comments c
        WHERE c.vehicle_id = v.id AND c.source_url IN (v.lot_url, v.lot_url || '/')
          AND c.posted_at <= s.as_of AND c.created_at <= s.as_of
        ORDER BY COALESCE(c.bat_comment_id::text, c.id::text), c.posted_at, c.id
      ) d
      ORDER BY d.posted_at DESC, d.id LIMIT (s.row_cap + 1)
    ) c
  ) a
)
SELECT jsonb_build_object(
  'as_of', s.as_of, 'max_lots', 8, 'per_lot_limit', s.row_cap,
  'input_truncated', COALESCE(cardinality(p_vehicle_ids), 0) > 8,
  'eligible_lots', (SELECT count(*) FROM lots),
  'scope', 'captured public current BaT listings; posted bids/comments, not completed transactions',
  'lots', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'vehicle_id', id, 'source_url', lot_url || '/',
    'source_auction_event_id', source_auction_event_id,
    'source_read_at', source_read_at, 'source_read_basis', source_read_basis,
    'source_bid_amount', source_bid_amount, 'source_bid_ingested_at', source_bid_ingested_at,
    'current_bid_at_capture', current_bid_at_capture, 'source_bid_match', source_bid_match,
    'source_bid_currency', NULL, 'current_bid_currency_at_capture', NULL,
    'source_bid_match_basis', CASE WHEN source_bid_match = 'unknown' THEN 'unknown'
      ELSE 'numeric_amount_only_currency_unverified' END,
    'activity_rows', jsonb_array_length(activity), 'has_more', has_more, 'activity', activity
  ) ORDER BY id) FROM lots), '[]'::jsonb)
) FROM settings s;
$function$;

CREATE OR REPLACE FUNCTION public.get_market_trends(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '5s'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  cutoff timestamptz:=statement_timestamp();
  event_from timestamptz; event_to timestamptz;
  scope_kind text; scope_id uuid; scope_row record; source_row record;
  scope_receipt jsonb; result jsonb; evidence_cap integer:=20;
  evidence_day date; evidence_series text;
  subject_make text; subject_grain text; subject_year integer; subject_year_start integer; subject_year_end integer;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR length(p_request::text)>4096 THEN
    RAISE EXCEPTION 'Requires a bounded JSON object' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN(
    'metric','scope','source_registry_slug','benchmark','event_from','event_to','knowledge_as_of',
    'evidence_limit','evidence_bucket','evidence_series')) THEN
    RAISE EXCEPTION 'Unknown market-trends request field' USING ERRCODE='22023';
  END IF;
  IF p_request->>'metric' IS DISTINCT FROM 'recorded_sale_events'
    OR p_request->>'source_registry_slug' IS DISTINCT FROM 'bringatrailer'
    OR p_request->>'benchmark' IS DISTINCT FROM 'same_platform_excluding_scope' THEN
    RETURN jsonb_build_object('contract_version',1,'metric_id','recorded_sale_events',
      'state','unavailable','reason','unsupported_measure_source_or_benchmark');
  END IF;
  IF p_request->>'knowledge_as_of' IS NOT NULL THEN
    RETURN jsonb_build_object('contract_version',1,'metric_id','recorded_sale_events',
      'state','unavailable','reason','historical_knowledge_versions_unavailable',
      'knowledge_mode','current_recorded_state','knowledge_cutoff',cutoff);
  END IF;
  BEGIN
    event_from:=(p_request->>'event_from')::timestamptz;
    event_to:=(p_request->>'event_to')::timestamptz;
    evidence_cap:=LEAST(20,GREATEST(1,COALESCE((p_request->>'evidence_limit')::integer,20)));
    evidence_day:=(p_request->>'evidence_bucket')::date;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
    OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Invalid bounded time or evidence parameter' USING ERRCODE='22023';
  END;
  IF event_from IS NULL OR event_to IS NULL OR NOT isfinite(event_from) OR NOT isfinite(event_to)
    OR event_to<=event_from OR event_to>cutoff OR event_to-event_from>interval '7 days'
    OR (p_request->>'event_from') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
    OR (p_request->>'event_to') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RAISE EXCEPTION 'Requires an explicit-zone past/current half-open window of at most seven days' USING ERRCODE='22023';
  END IF;
  evidence_series:=p_request->>'evidence_series';
  IF evidence_series IS NOT NULL AND evidence_series NOT IN('selected','benchmark') THEN
    RAISE EXCEPTION 'Invalid evidence series' USING ERRCODE='22023';
  END IF;
  IF evidence_day IS NOT NULL AND (evidence_day<event_from::date OR evidence_day>(event_to-interval '1 microsecond')::date) THEN
    RAISE EXCEPTION 'Evidence bucket lies outside the event window' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_request->'scope') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Requires a registry scope' USING ERRCODE='22023';
  END IF;
  scope_kind:=p_request#>>'{scope,kind}';
  IF scope_kind NOT IN('canonical_make','supported_subject') OR scope_kind IS NULL THEN
    RETURN jsonb_build_object('contract_version',1,'metric_id','recorded_sale_events',
      'state','unavailable','reason','unsupported_registry_scope');
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_request->'scope') k
    WHERE k NOT IN('kind','canonical_make_id','subject_id')) THEN
    RAISE EXCEPTION 'Unknown registry scope field' USING ERRCODE='22023';
  END IF;
  IF (scope_kind='canonical_make' AND p_request->'scope' ? 'subject_id')
    OR (scope_kind='supported_subject' AND p_request->'scope' ? 'canonical_make_id') THEN
    RAISE EXCEPTION 'Registry scope IDs must match the selected kind' USING ERRCODE='22023';
  END IF;
  BEGIN
    scope_id:=CASE WHEN scope_kind='canonical_make' THEN (p_request#>>'{scope,canonical_make_id}')::uuid
      ELSE (p_request#>>'{scope,subject_id}')::uuid END;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid registry scope UUID' USING ERRCODE='22023';
  END;
  IF scope_kind='canonical_make' THEN
    SELECT id,canonical_name INTO scope_row FROM public.canonical_makes WHERE id=scope_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('state','unavailable','reason','unknown_canonical_make');
    END IF;
    scope_receipt:=jsonb_build_object('kind',scope_kind,'canonical_make_id',scope_id,
      'label',scope_row.canonical_name,'membership_method','canonical_make_fk_or_unique_exact_registry_name_alias',
      'comparison_basis','make population, not condition-equivalent valuation cohort');
  ELSE
    SELECT p.* INTO scope_row FROM public.make_model_profiles p
    JOIN public.canonical_models cm ON cm.id=p.canonical_model_id
    WHERE p.subject_id=scope_id AND p.comparison_scope_status='supported'
      AND nullif(btrim(p.comparison_scope_basis),'') IS NOT NULL
      AND nullif(btrim(p.canonical_make),'') IS NOT NULL AND nullif(btrim(p.canonical_model),'') IS NOT NULL
      AND ((p.grain='year' AND p.year IS NOT NULL)
        OR (p.grain IN('generation','model') AND p.year_start IS NOT NULL
          AND p.year_end IS NOT NULL AND p.year_end>=p.year_start));
    IF NOT FOUND THEN
      RETURN jsonb_build_object('state','unavailable','reason','unsupported_or_unknown_subject');
    END IF;
    subject_make:=scope_row.canonical_make; subject_grain:=scope_row.grain;
    subject_year:=scope_row.year; subject_year_start:=scope_row.year_start; subject_year_end:=scope_row.year_end;
    scope_receipt:=jsonb_build_object('kind',scope_kind,'subject_id',scope_id,
      'label',scope_row.canonical_make||' '||scope_row.canonical_model,'grain',scope_row.grain,
      'year',scope_row.year,'year_start',scope_row.year_start,'year_end',scope_row.year_end,
      'comparison_scope_status',scope_row.comparison_scope_status,'comparison_scope_basis',scope_row.comparison_scope_basis,
      'membership_method','cohort_members_supported_registry_subject',
      'comparison_basis','explicit attributed grouping; condition and factory generation are unverified');
  END IF;
  SELECT id,slug,display_name,NULL::text AS extractor_function INTO source_row FROM public.v_market_trend_source_labels WHERE slug='bringatrailer';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','unavailable','reason','source_registry_row_missing');
  END IF;

  WITH candidates AS MATERIALIZED (
    -- Eligibility precedes the cap: private parents cannot consume or leak public counts/caps.
    SELECT e.id,e.vehicle_id,rtrim(e.source_url,'/') AS source_key,e.auction_end_date AS event_at,
      e.outcome,e.winning_bid,e.created_at,e.updated_at,e.scraped_at,
      v.make,v.model,v.year,v.canonical_make_id,
      -- The source-read clock fields, read here from the row the scan already holds (2026-10-15: a second read of
      -- every candidate by primary key cost 5,416 of the read's ~16,800 buffers for this week's 1,326 BaT rows).
      e.raw_data->>'extractor' AS rd_extractor,e.raw_data#>>'{source_read,clock_version}' AS rd_clock_version,
      e.raw_data#>>'{source_read,basis}' AS rd_basis,e.raw_data#>>'{source_read,at}' AS rd_at,
      e.raw_data->>'listing_url' AS rd_listing_url
    FROM public.auction_events_canonical e JOIN public.vehicles v ON v.id=e.vehicle_id
    WHERE e.source='bat' AND e.auction_end_date>=event_from AND e.auction_end_date<event_to
      AND e.created_at<=cutoff AND e.updated_at<=cutoff
      AND e.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
      AND v.is_public AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    ORDER BY e.auction_end_date,e.id LIMIT 2001
  ), bounded AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY event_at,id LIMIT 2000
  ), relevant_subject AS MATERIALIZED (
    SELECT p.subject_id FROM public.make_model_profiles p
    WHERE scope_kind='supported_subject' AND p.subject_id=scope_id
      AND EXISTS(SELECT 1 FROM bounded b WHERE lower(b.make)=lower(p.canonical_make)
        AND ((p.grain='year' AND b.year=p.year) OR (p.grain<>'year' AND b.year BETWEEN p.year_start AND p.year_end)))
  ), members AS MATERIALIZED (
    SELECT m.vehicle_id FROM relevant_subject p CROSS JOIN LATERAL public.cohort_members(p.subject_id,
      ARRAY(SELECT DISTINCT b.vehicle_id FROM bounded b)) m
  ), make_keys AS MATERIALIZED (
    -- Each make spelling (and its recorded make id) resolves once, not once per candidate row: the lookup reads every
    -- canonical make and its aliases (2026-10-15: 0.8 s of a cold 4.3 s read for one week of BaT, 1,257 rows).
    SELECT DISTINCT lower(b.make) AS make_l,b.canonical_make_id FROM bounded b
  ), make_resolved AS MATERIALIZED (
    SELECT k.make_l,k.canonical_make_id,mk.resolved_make_id FROM make_keys k
    LEFT JOIN LATERAL (
      SELECT CASE WHEN k.canonical_make_id IS NOT NULL AND count(*)=1
          AND min(cm.id::text)::uuid<>k.canonical_make_id THEN NULL
        ELSE COALESCE(k.canonical_make_id,
          CASE WHEN count(*)=1 THEN min(cm.id::text)::uuid END) END AS resolved_make_id
      FROM public.canonical_makes cm
      WHERE lower(cm.canonical_name)=k.make_l
        OR k.make_l=ANY(SELECT lower(a) FROM unnest(cm.aliases) a)
    ) mk ON true
  ), classified AS MATERIALIZED (
    SELECT b.*,mk.resolved_make_id,mdl.model_count,
      CASE WHEN mk.resolved_make_id IS NULL THEN NULL
        WHEN scope_kind='canonical_make' THEN CASE WHEN mk.resolved_make_id=scope_id THEN 'selected' ELSE 'benchmark' END
        WHEN EXISTS(SELECT 1 FROM members m WHERE m.vehicle_id=b.vehicle_id) THEN 'selected'
        WHEN lower(make_entity.canonical_name)<>lower(subject_make) THEN 'benchmark'
        WHEN b.year IS NULL THEN NULL
        WHEN (subject_grain='year' AND b.year<>subject_year)
          OR (subject_grain<>'year' AND b.year NOT BETWEEN subject_year_start AND subject_year_end) THEN 'benchmark'
        WHEN mdl.model_count=1 THEN 'benchmark'
        ELSE NULL END AS assigned_series
    FROM bounded b
    LEFT JOIN make_resolved mk ON mk.make_l IS NOT DISTINCT FROM lower(b.make)
      AND mk.canonical_make_id IS NOT DISTINCT FROM b.canonical_make_id
    LEFT JOIN public.canonical_makes make_entity ON make_entity.id=mk.resolved_make_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS model_count FROM public.canonical_models cm
      WHERE scope_kind='supported_subject'
        AND lower(make_entity.canonical_name)=lower(subject_make)
        AND ((subject_grain='year' AND b.year=subject_year)
          OR (subject_grain<>'year' AND b.year BETWEEN subject_year_start AND subject_year_end))
        AND NOT EXISTS(SELECT 1 FROM members m WHERE m.vehicle_id=b.vehicle_id)
        AND lower(cm.make)=lower(b.make) AND (cm.year_start IS NULL OR b.year>=cm.year_start)
        AND (cm.year_end IS NULL OR b.year<=cm.year_end)
        AND (lower(cm.canonical_model)=lower(b.model)
          OR lower(b.model)=ANY(SELECT lower(a) FROM unnest(cm.aliases) a))
    ) mdl ON scope_kind='supported_subject'
  ), alias_groups AS MATERIALIZED (
    SELECT source_key,count(*) AS alias_rows,
      count(DISTINCT ROW(vehicle_id,event_at,outcome,winning_bid))>1 AS conflict,
      array_agg(id ORDER BY id) AS source_event_ids FROM classified GROUP BY source_key
  ), episodes AS MATERIALIZED (
    SELECT DISTINCT ON(c.source_key) c.*,g.conflict,g.source_event_ids,
      CASE WHEN NOT g.conflict THEN c.assigned_series END AS series,
      CASE WHEN NOT g.conflict AND c.outcome='sold' AND c.winning_bid>0
        AND c.winning_bid<'Infinity'::numeric THEN true ELSE false END AS recorded_sold,
      CASE WHEN c.rd_extractor='extract-bat-core'
        AND c.rd_clock_version='1'
        AND c.rd_basis IN('direct_fetch','cached_snapshot')
        AND c.scraped_at<=cutoff
        AND c.rd_listing_url IN(c.source_key,c.source_key||'/')
        AND to_char(c.scraped_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=c.rd_at
        THEN c.scraped_at END AS source_observed_at,
      CASE WHEN c.rd_extractor='extract-bat-core'
        AND c.rd_clock_version='1'
        AND c.rd_basis IN('direct_fetch','cached_snapshot')
        AND c.scraped_at<=cutoff
        AND c.rd_listing_url IN(c.source_key,c.source_key||'/')
        AND to_char(c.scraped_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=c.rd_at
        THEN c.rd_basis ELSE 'unknown' END AS source_read_basis
    FROM classified c JOIN alias_groups g USING(source_key)
    ORDER BY c.source_key,c.scraped_at DESC NULLS LAST,c.id
  ), buckets AS MATERIALIZED (
    SELECT gs AS bucket_start,GREATEST(gs,event_from) AS window_from,
      LEAST(gs+interval '1 day',event_to) AS window_to
    FROM generate_series(date_trunc('day',event_from),date_trunc('day',event_to-interval '1 microsecond'),interval '1 day') gs
  ), points AS MATERIALIZED (
    SELECT b.*,s.series,count(e.id) AS eligible,
      count(e.id) FILTER(WHERE e.recorded_sold) AS sold,
      count(e.id) FILTER(WHERE NOT e.conflict AND e.outcome IN('reserve_not_met','no_sale','cancelled')) AS explicit_no_sale,
      count(e.id) FILTER(WHERE NOT e.conflict AND e.outcome='bid_to') AS bid_to,
      count(e.id) FILTER(WHERE NOT e.conflict AND e.outcome='sold' AND NOT e.recorded_sold) AS unsupported_sold_amount,
      count(e.id) FILTER(WHERE NOT e.conflict AND (e.outcome IS NULL OR e.outcome IN('live','pending','relisted'))) AS ended_pending,
      count(e.id) FILTER(WHERE e.source_observed_at IS NOT NULL) AS known_clocks,
      min(e.event_at) AS first_event,max(e.event_at) AS last_event,max(e.source_observed_at) AS latest_observed
    FROM buckets b CROSS JOIN(VALUES('selected'::text),('benchmark'::text)) s(series)
    LEFT JOIN episodes e ON e.series=s.series AND e.event_at>=b.window_from AND e.event_at<b.window_to
    GROUP BY b.bucket_start,b.window_from,b.window_to,s.series
  ), evidence AS MATERIALIZED (
    SELECT e.*,row_number() OVER(PARTITION BY event_at::date,series ORDER BY event_at,id) AS position
    FROM episodes e WHERE e.series IS NOT NULL AND NOT e.conflict AND e.recorded_sold
      AND(evidence_day IS NULL OR event_at::date=evidence_day)
      AND(evidence_series IS NULL OR e.series=evidence_series)
  )
  SELECT jsonb_build_object(
    'contract_version',1,'metric_id','recorded_sale_events','state','partial',
    'reason',CASE WHEN (SELECT count(*) FROM candidates)>2000 THEN 'candidate_cap_exceeded' ELSE 'external_capture_and_result_completeness_unverified' END,
    'unit','recorded_sale_episodes','scope',scope_receipt,
    'benchmark',jsonb_build_object('kind','same_platform_excluding_scope','excludes_scope',true),
    'source_registry',jsonb_build_object('id',source_row.id,'slug',source_row.slug,'display_name',source_row.display_name,
      'registry_declared_extractor',source_row.extractor_function,'auction_event_source','bat',
      'observed_writer','extract-bat-core','writer_registry_match',source_row.extractor_function='extract-bat-core',
      'registry_metadata_visibility','public_identity_label_only','registry_declared_extractor_visibility','protected_unavailable',
      'mapping_basis','existing extract-bat-core source bat and exact BaT listing URL; registry label is not writer custody'),
    'knowledge_mode','current_recorded_state','knowledge_cutoff',cutoff,'generated_at',cutoff,
    'event_from',event_from,'event_to',event_to,
    'event_time_basis','recorded auction_events.auction_end_date; not ownership transfer time; legacy resolution can be date-only',
    'method_id','auction_events_source_sold_outcome','method_version',1,
    'grain','one slash-normalized platform listing episode','weighting','one episode one count',
    'candidate_limit',2000,'captured_candidates',(SELECT count(*) FROM candidates),
    'truncated',(SELECT count(*) FROM candidates)>2000,
    'coverage',jsonb_build_object('eligible_recorded_episodes',(SELECT count(*) FROM episodes),
      'unresolved_scope',(SELECT count(*) FROM episodes WHERE series IS NULL),
      'conflicting_alias_episodes',(SELECT count(*) FROM episodes WHERE conflict),
      'complete_external_capture',false,'historical_knowledge_versions_available',false,
      'currency_qualified',false,'ratios_supported',false),
    'series',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'bucket_start',p.bucket_start,'event_from',p.window_from,'event_to',p.window_to,'series',p.series,
      'metric_id','recorded_sale_events','state','partial',
      'value',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN p.sold END,
      'numerator',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN p.sold END,
      'denominator',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN p.eligible END,
      'unit','recorded_sale_episodes','ratio',NULL,'absolute_change',NULL,'relative_change',NULL,
      'knowledge_cutoff',cutoff,'source_observed_at',p.latest_observed,'folded_at',cutoff,
      'fold_basis','query_time_current_recorded_state; no new scheduled fold',
      'method_id','auction_events_source_sold_outcome','method_version',1,
      'grain','platform listing episode','weighting','one episode one count',
      'coverage',jsonb_build_object('captured_eligible',p.eligible,'captured_sold',p.sold,
        'explicit_no_sale',p.explicit_no_sale,'bid_to',p.bid_to,'ended_pending',p.ended_pending,
        'sold_without_supported_amount',p.unsupported_sold_amount,
        'unresolved_scope',(SELECT count(*) FROM episodes u WHERE u.series IS NULL
          AND u.event_at>=p.window_from AND u.event_at<p.window_to),
        'conflicting_aliases',(SELECT count(*) FROM episodes u WHERE u.conflict
          AND u.event_at>=p.window_from AND u.event_at<p.window_to),
        'source_clock_known',p.known_clocks,'source_clock_unknown',p.eligible-p.known_clocks,
        'earliest_event',p.first_event,'latest_event',p.last_event,
        'bucket_elapsed_seconds',extract(epoch FROM p.window_to-p.window_from),'full_bucket_seconds',86400,
        'incomplete_bucket',p.window_from>p.bucket_start OR p.window_to<p.bucket_start+interval '1 day',
        'complete_external_capture',false,'truncated',(SELECT count(*) FROM candidates)>2000)
    ) ORDER BY p.bucket_start,p.series) FROM points p),'[]'::jsonb),
    'evidence',jsonb_build_object('per_bucket_series_limit',evidence_cap,'pagination_supported',false,
      'limitation','bounded current-state contributors; resubmit explicit evidence_bucket and evidence_series for the drill; no immutable snapshot cursor',
      'has_more',EXISTS(SELECT 1 FROM evidence WHERE position>evidence_cap),
      'contributors',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'auction_event_id',e.id,'source_event_ids',e.source_event_ids,'vehicle_id',e.vehicle_id,
        'source_url',e.source_key||'/','event_at',e.event_at,'event_time_basis','recorded_episode_end',
        'latest_source_row_write',e.updated_at,'knowledge_cutoff',cutoff,
        'source_observed_at',e.source_observed_at,'source_read_basis',e.source_read_basis,
        'series',e.series,'bucket_start',date_trunc('day',e.event_at),'contribution',1,
        'method_id','auction_events_source_sold_outcome','method_version',1
      ) ORDER BY e.event_at,e.id) FROM evidence e WHERE position<=evidence_cap),'[]'::jsonb))
  ) INTO result;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_live_auction_health(p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
WITH day_bounds AS MATERIALIZED (
  SELECT coalesce(p_day,(now() AT TIME ZONE 'America/Los_Angeles')::date) AS day,
    coalesce(p_day,(now() AT TIME ZONE 'America/Los_Angeles')::date)::timestamp
      AT TIME ZONE 'America/Los_Angeles' AS starts,
    (coalesce(p_day,(now() AT TIME ZONE 'America/Los_Angeles')::date)+1)::timestamp
      AT TIME ZONE 'America/Los_Angeles' AS ends
), candidates AS MATERIALIZED (
  SELECT m.vehicle_id,rtrim(m.external_auction_url,'/') AS url,m.auction_end_time AS ends,
    nullif(m.stream_state->>'terminal_observation_id','')::uuid AS terminal_id
  FROM public.monitored_auctions m
  JOIN public.live_auction_sources s ON s.id=m.source_id AND s.slug='bat'
  CROSS JOIN day_bounds b
  WHERE m.auction_end_time>=b.starts AND m.auction_end_time<b.ends
  UNION ALL
  SELECT e.vehicle_id,rtrim(e.source_url,'/'),e.ended_at,NULL::uuid
  FROM public.vehicle_events e CROSS JOIN day_bounds b
  WHERE e.source_platform='bat' AND e.event_type='auction'
    AND e.ended_at>=b.starts AND e.ended_at<b.ends
  UNION ALL
  SELECT a.vehicle_id,rtrim(a.source_url,'/'),a.auction_end_date,NULL::uuid
  FROM public.auction_events_canonical a CROSS JOIN day_bounds b
  WHERE a.source='bat' AND a.auction_end_date>=b.starts AND a.auction_end_date<b.ends
), lots AS MATERIALIZED (
  -- One source listing across caches and parent aliases; a missing URL stays
  -- separate by vehicle rather than disappearing from the denominator.
  SELECT url,CASE WHEN nullif(url,'') IS NULL THEN vehicle_id END AS unbound_vehicle,
    array_agg(DISTINCT vehicle_id) AS vehicle_ids,max(ends) AS scheduled_end,
    array_agg(DISTINCT terminal_id) FILTER(WHERE terminal_id IS NOT NULL) AS terminal_ids
  FROM candidates
  GROUP BY url,CASE WHEN nullif(url,'') IS NULL THEN vehicle_id END
), reconciled AS MATERIALIZED (
  SELECT l.*,CASE WHEN cardinality(result.outcomes)=1 THEN coalesce(result.latest_end,l.scheduled_end)
      ELSE greatest(result.latest_end,l.scheduled_end) END AS closes_at,
    coalesce(result.outcomes,ARRAY[]::text[]) AS outcomes,
    receipt.has_native_receipt,receipt.late_native_admission
  FROM lots l
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT a.outcome) FILTER(WHERE a.outcome IN ('sold','reserve_not_met','cancelled')) AS outcomes,
      max(a.auction_end_date) AS latest_end
    FROM public.auction_events_canonical a
    WHERE a.vehicle_id=ANY(l.vehicle_ids) AND a.source='bat'
      AND a.source_url IN (l.url,l.url||'/')
  ) result ON true
  LEFT JOIN LATERAL (
    SELECT count(*)>0 AS has_native_receipt,
      coalesce(bool_or(o.structured_data->>'clock_basis'='native_comment_timestamp'
        AND o.ingested_at>o.observed_at+interval '2 seconds'),false) AS late_native_admission
    FROM public.vehicle_observations o
    WHERE o.id=ANY(l.terminal_ids) AND o.vehicle_id=ANY(l.vehicle_ids)
      AND o.source_url IN (l.url,l.url||'/') AND o.kind='sale_result'
      AND o.extraction_method='bat_public_live_v1'
  ) receipt ON true
), today AS MATERIALIZED (
  -- An extension into tomorrow moves the lot out of today's denominator.
  SELECT r.* FROM reconciled r CROSS JOIN day_bounds b
  WHERE r.closes_at>=b.starts AND r.closes_at<b.ends
), settlement AS MATERIALIZED (
  SELECT jsonb_build_object(
    'date',(SELECT day FROM day_bounds),'timezone','America/Los_Angeles',
    'status',CASE WHEN count(*)=0 THEN 'idle'
      WHEN count(*) FILTER(WHERE cardinality(outcomes)>1 OR
        (closes_at<now()-interval '5 minutes' AND cardinality(outcomes)=0))>0 THEN 'failed'
      WHEN count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=0)>0 THEN 'pending'
      ELSE 'passed' END,
    'expected_known_lots',count(*),
    'due_known_lots',count(*) FILTER(WHERE closes_at<=now()),
    'upcoming_known_lots',count(*) FILTER(WHERE closes_at>now()),
    'confirmed_closed_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1),
    'sold_lots',count(*) FILTER(WHERE closes_at<=now() AND outcomes=ARRAY['sold']::text[]),
    'reserve_not_met_lots',count(*) FILTER(WHERE closes_at<=now() AND outcomes=ARRAY['reserve_not_met']::text[]),
    'cancelled_lots',count(*) FILTER(WHERE closes_at<=now() AND outcomes=ARRAY['cancelled']::text[]),
    'unresolved_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=0),
    'overdue_result_lots',count(*) FILTER(WHERE closes_at<now()-interval '5 minutes' AND cardinality(outcomes)=0),
    'conflicting_result_lots',count(*) FILTER(WHERE cardinality(outcomes)>1),
    'unbound_lots',count(*) FILTER(WHERE nullif(url,'') IS NULL),
    'native_terminal_receipt_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1 AND has_native_receipt),
    'late_native_terminal_admission_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1 AND late_native_admission),
    'closed_without_native_terminal_receipt_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1 AND NOT has_native_receipt),
    'terminal_capture_status',CASE
      WHEN count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1)=0 THEN 'idle'
      WHEN count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1
        AND (NOT has_native_receipt OR late_native_admission))>0 THEN 'failed'
      ELSE 'passed' END,
    'native_event_to_admission_slo_seconds',2,
    'result_grace_seconds',300,
    'inventory_scope','Known BaT listings in Nuke monitors and auction caches, deduplicated by source URL',
    'source_inventory_completeness','unverified',
    'continuous_capture_completeness','unverified; a terminal receipt can be late recovery',
    'checked_at',now()) AS reading
  FROM today
), closing AS MATERIALIZED (
  SELECT m.*, EXISTS(SELECT 1 FROM jsonb_each(coalesce(m.stream_state->'sessions','{}'::jsonb)) session
    WHERE (session.value->>'connected')::boolean
      AND session.value->>'error' IS NULL
      AND (session.value->>'at')::timestamptz>now()-interval '3 seconds'
      AND NOT ((session.value->>'pending')::integer>0
        AND (session.value->>'oldest_received_at')::timestamptz<now()-interval '2 seconds')) AS covered,
    EXISTS(SELECT 1 FROM jsonb_each(coalesce(m.stream_state->'sessions','{}'::jsonb)) session
      WHERE (session.value->>'at')::timestamptz>now()-interval '3 seconds'
        AND (session.value->>'pending')::integer>0
        AND (session.value->>'oldest_received_at')::timestamptz<now()-interval '2 seconds') AS admission_overdue
  FROM public.monitored_auctions m JOIN public.live_auction_sources source ON source.id=m.source_id AND source.slug='bat'
  WHERE m.auction_end_time<=now()+interval '15 minutes' AND m.auction_end_time>now()-interval '24 hours'
    AND NOT (EXISTS(SELECT 1 FROM public.auction_events_canonical a WHERE a.vehicle_id=m.vehicle_id
      AND rtrim(a.source_url,'/')=rtrim(m.external_auction_url,'/') AND a.outcome IN ('sold','reserve_not_met','cancelled')) OR EXISTS (
        SELECT 1 FROM public.vehicle_observations native_receipt
        JOIN public.auction_events_canonical native_lot ON native_lot.vehicle_id=native_receipt.vehicle_id
        JOIN public.vehicles locator ON locator.id=m.vehicle_id
        WHERE native_receipt.id=nullif(m.stream_state->>'terminal_observation_id','')::uuid
          AND locator.deleted_at IS NULL
          AND locator.origin_metadata->>'source'='bat_auctions_page'
          AND locator.origin_metadata->>'external_id'=native_receipt.structured_data->>'native_post_id'
          AND locator.listing_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
          AND native_receipt.kind='sale_result'
          AND native_receipt.extraction_method='bat_public_live_v1'
          AND native_receipt.is_superseded IS NOT TRUE
          AND native_receipt.vehicle_id IS DISTINCT FROM m.vehicle_id
          AND native_receipt.vehicle_match_signals->>'monitor_vehicle_id'=m.vehicle_id::text
          AND native_receipt.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
          AND native_receipt.vehicle_match_signals->>'source_url_match'='true'
          AND native_receipt.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
          AND native_lot.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
          AND native_lot.outcome IN ('sold','reserve_not_met','cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM public.vehicle_events other_event
            WHERE other_event.source_platform='bat'
              AND other_event.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
              AND other_event.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.auction_events_canonical other_lot
            WHERE lower(substring(other_lot.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
              =lower(substring(m.external_auction_url,'bringatrailer\.com/listing/([^/?#]+)'))
              AND other_lot.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
              AND other_lot.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)))
), stream AS (
  SELECT jsonb_build_object('status',CASE WHEN (SELECT reading->>'status'='failed'
      OR reading->>'terminal_capture_status'='failed' FROM settlement) THEN 'failed' WHEN count(*)=0 THEN 'idle'
    WHEN count(*) FILTER(WHERE NOT is_live OR NOT covered OR admission_overdue OR coalesce((stream_state->>'unqualified_frames')::integer,0)>0)>0 THEN 'failed' ELSE 'passed' END,
    'eligible_lots',count(*),'covered_lots',count(*) FILTER(WHERE is_live AND covered),
    'missing_lots',count(*) FILTER(WHERE NOT is_live OR NOT covered),
    'admission_overdue_lots',count(*) FILTER(WHERE admission_overdue),
    'unqualified_lots',count(*) FILTER(WHERE coalesce((stream_state->>'unqualified_frames')::integer,0)>0),
    'receipt_to_admission_slo_seconds',2,'heartbeat_stale_after_seconds',3,
    'source_publication_lag','unknown unless native comment timestamp is present',
    'daily_settlement',(SELECT reading FROM settlement),
    'coverage_scope','current subscriptions and acknowledgement queues; outages can lose non-replayable extension/stat events',
    'checked_at',now()) AS reading FROM closing
)
SELECT jsonb_build_object(
  'total_monitored',(SELECT count(*) FROM public.monitored_auctions WHERE is_live),
  'soft_close_count',(SELECT count(*) FROM public.monitored_auctions WHERE is_live AND is_in_soft_close),
  'overdue_sync',(SELECT count(*) FROM public.monitored_auctions WHERE is_live AND next_poll_at<now()-interval '2 minutes'),
  'avg_bid_dollars',(SELECT round(avg(current_bid_cents)::numeric/100,2) FROM public.monitored_auctions WHERE is_live AND current_bid_cents>0),
  'total_bids',(SELECT sum(bid_count) FROM public.monitored_auctions WHERE is_live),
  'platforms',(SELECT jsonb_agg(jsonb_build_object('slug',s.slug,'active_auctions',s.active_count,'health_status',s.health_status))
    FROM (SELECT source.slug,source.health_status,count(m.id) AS active_count FROM public.live_auction_sources source
      LEFT JOIN public.monitored_auctions m ON m.source_id=source.id AND m.is_live WHERE source.is_active
      GROUP BY source.id,source.slug,source.health_status) s),
  'cron_status',(SELECT jsonb_build_object('job_id',j.jobid,'last_run',d.start_time,'last_status',d.status)
    FROM cron.job j LEFT JOIN LATERAL(SELECT start_time,status FROM cron.job_run_details WHERE jobid=j.jobid ORDER BY runid DESC LIMIT 1)d ON true
    WHERE j.jobname='bat-live-pull'),
  'last_sync',(SELECT max(updated_at) FROM public.monitored_auctions WHERE is_live),
  'closing_stream',(SELECT reading FROM stream),
  'daily_closes',(SELECT reading FROM settlement),'checked_at',now());
$function$;

CREATE OR REPLACE FUNCTION public.identity_vehicle_relation(p_identity_id uuid, p_vehicle_id uuid, p_at timestamp with time zone DEFAULT now(), p_known_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(relation text, provisional boolean, evidence_basis text, valid_from_earliest date, valid_from_latest date, valid_to_earliest date, valid_to_latest date, certain_at boolean, possible_at boolean, evidence_table text, evidence_id uuid, derived_from_id uuid, evidence_at timestamp with time zone, known_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
  WITH sold AS (
    -- The vehicle's recorded sale chain as known at p_known_at.
    SELECT ae.auction_end_date AS at
    FROM public.auction_events_canonical ae
    WHERE ae.vehicle_id = p_vehicle_id AND ae.outcome = 'sold' AND ae.auction_end_date IS NOT NULL
      AND ae.created_at <= p_known_at
  ), ev AS (
    -- Seller of record on a lot: held the vehicle at the close; acquired after the previous recorded sale.
    SELECT 'seller'::text AS rel, false AS prov, 'platform_seller_of_record'::text AS basis,
      (SELECT max(s.at) FROM sold s WHERE s.at < ae.auction_end_date)::date AS vfe,
      ae.auction_end_date::date AS vfl,
      ae.auction_end_date::date AS vte,
      CASE WHEN ae.outcome = 'sold' THEN ae.auction_end_date::date
           ELSE (SELECT min(s.at) FROM sold s WHERE s.at > ae.auction_end_date)::date END AS vtl,
      'auction_events'::text AS tbl, ae.id AS eid, NULL::uuid AS dfrom, ae.auction_end_date AS eat, ae.created_at AS kat
    FROM public.auction_events_canonical ae
    WHERE ae.vehicle_id = p_vehicle_id AND ae.seller_external_identity_id = p_identity_id
      AND ae.auction_end_date IS NOT NULL AND ae.created_at <= p_known_at
    UNION ALL
    -- Winner of a sold lot: held the vehicle from the close until, at the latest, the next recorded sale.
    SELECT 'buyer', false, 'platform_winner_of_record',
      ae.auction_end_date::date, ae.auction_end_date::date, ae.auction_end_date::date,
      (SELECT min(s.at) FROM sold s WHERE s.at > ae.auction_end_date)::date,
      'auction_events', ae.id, NULL::uuid, ae.auction_end_date, ae.created_at
    FROM public.auction_events_canonical ae
    WHERE ae.vehicle_id = p_vehicle_id AND ae.winning_bidder_external_identity_id = p_identity_id
      AND ae.outcome = 'sold' AND ae.auction_end_date IS NOT NULL AND ae.created_at <= p_known_at
    UNION ALL
    -- A transfer of record. Today every row is seeded from a sold lot; derived_from_id names that lot, so the
    -- transfer is not a second witness to it.
    SELECT CASE WHEN ot.from_identity_id = p_identity_id THEN 'transferor' ELSE 'transferee' END,
      false, 'transfer_of_record',
      CASE WHEN ot.from_identity_id = p_identity_id
           THEN (SELECT max(s.at) FROM sold s WHERE s.at < ot.sale_date)::date ELSE ot.sale_date::date END,
      ot.sale_date::date,
      ot.sale_date::date,
      CASE WHEN ot.from_identity_id = p_identity_id
           THEN ot.sale_date::date ELSE (SELECT min(s.at) FROM sold s WHERE s.at > ot.sale_date)::date END,
      'ownership_transfers', ot.id, CASE WHEN ot.trigger_table = 'auction_events' THEN ot.trigger_id END,
      ot.sale_date, ot.created_at
    FROM public.ownership_transfers ot
    WHERE ot.vehicle_id = p_vehicle_id AND p_identity_id IN (ot.from_identity_id, ot.to_identity_id)
      AND ot.sale_date IS NOT NULL AND ot.created_at <= p_known_at
      AND ot.status::text IS DISTINCT FROM 'cancelled'
    UNION ALL
    -- A listing episode keyed to a seller: held the vehicle when the episode ended.
    SELECT 'listing_seller', false, 'listing_seller_of_record',
      (SELECT max(s.at) FROM sold s WHERE s.at < coalesce(ve.sold_at, ve.ended_at))::date,
      coalesce(ve.sold_at, ve.ended_at)::date,
      coalesce(ve.sold_at, ve.ended_at)::date,
      CASE WHEN ve.sold_at IS NOT NULL THEN ve.sold_at::date
           ELSE (SELECT min(s.at) FROM sold s WHERE s.at > ve.ended_at)::date END,
      'vehicle_events', ve.id, NULL::uuid, coalesce(ve.sold_at, ve.ended_at), ve.created_at
    FROM public.vehicle_events ve
    WHERE ve.vehicle_id = p_vehicle_id AND ve.seller_external_identity_id = p_identity_id
      AND coalesce(ve.sold_at, ve.ended_at) IS NOT NULL AND ve.created_at <= p_known_at
    UNION ALL
    -- The identity's own ownership claims: testimony, provisional. A current owner held the vehicle when speaking.
    -- A past owner, shop, dealer or bystander relation had ended by then; a family relation may still hold.
    SELECT 'claimed_' || (o.structured_data->>'ownership_relation'), true,
      'testimony_' || (o.structured_data->>'window_precision'),
      (o.structured_data->>'window_start_earliest')::date,
      (o.structured_data->>'window_start_latest')::date,
      coalesce((o.structured_data->>'window_end_earliest')::date,
               CASE WHEN o.structured_data->>'ownership_relation' = 'owner_current' THEN o.observed_at::date END,
               (o.structured_data->>'window_start_latest')::date),
      coalesce((o.structured_data->>'window_end_latest')::date,
               CASE WHEN o.structured_data->>'ownership_relation' IN ('owner_past', 'shop', 'dealer', 'bystander')
                    THEN o.observed_at::date END),
      'vehicle_observations', o.id, o.source_comment_id, o.observed_at, o.ingested_at
    FROM public.vehicle_observations o
    JOIN public.observation_properties p ON p.id = o.property_id AND p.property_key = 'ownership_relation'
    WHERE o.vehicle_id = p_vehicle_id AND o.observer_id = p_identity_id
      AND o.structured_data->>'claim_contract' = 'ownership_claim_v1'
      AND o.ingested_at <= p_known_at
      AND (coalesce(o.is_superseded, false) = false OR o.superseded_at > p_known_at)
  )
  SELECT rel, prov, basis, vfe, vfl, vte, vtl,
    coalesce(vfl <= vte AND p_at::date BETWEEN vfl AND vte, false),
    (vfe IS NULL OR p_at::date >= vfe) AND (vtl IS NULL OR p_at::date <= vtl),
    tbl, eid, dfrom, eat, kat
  FROM ev
  ORDER BY eat NULLS LAST, tbl, eid
$function$;

CREATE OR REPLACE FUNCTION public.ownership_claim_corroboration(p_observation_id uuid, p_known_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(verdict text, aspect text, rule text, informative boolean, evidence_table text, evidence_id uuid, evidence_at timestamp with time zone, known_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
  WITH c AS (
    SELECT o.vehicle_id, o.observer_id AS who, o.observed_at AS said_at,
      o.structured_data->>'ownership_relation' AS rel,
      o.structured_data->>'relation_detail' AS detail,
      (o.structured_data->>'source_lot_id')::uuid AS lot,
      (o.structured_data->>'window_start_earliest')::date AS se,
      (o.structured_data->>'window_start_latest')::date AS sl,
      (o.structured_data->>'window_end_earliest')::date AS ee,
      (o.structured_data->>'window_end_latest')::date AS el
    FROM public.vehicle_observations o
    JOIN public.observation_properties p ON p.id = o.property_id AND p.property_key = 'ownership_relation'
    WHERE o.id = p_observation_id AND o.structured_data->>'claim_contract' = 'ownership_claim_v1'
      AND o.ingested_at <= p_known_at
  ), lots AS (
    SELECT ae.id, ae.auction_end_date AS at, ae.outcome, ae.created_at AS kat,
      ae.seller_external_identity_id AS seller, ae.winning_bidder_external_identity_id AS winner
    FROM c JOIN public.auction_events_canonical ae ON ae.vehicle_id = c.vehicle_id
    WHERE ae.auction_end_date IS NOT NULL AND ae.created_at <= p_known_at
  )
  -- R1. A seller's tenure claim: the lot keys the speaker as its seller. The admission gate already required the
  -- platform's seller flag, so this agreement is not informative about the speaker.
  SELECT 'corroborates', 'relation', 'own_lot_seller_key', false, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON l.id = c.lot
  WHERE c.rel = 'owner_current' AND c.detail = 'seller' AND l.seller = c.who
  UNION ALL
  SELECT 'contradicts', 'relation', 'own_lot_seller_is_other_identity', true, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON l.id = c.lot
  WHERE c.rel = 'owner_current' AND c.detail = 'seller' AND l.seller IS NOT NULL AND l.seller <> c.who
  UNION ALL
  -- R2. A buyer's claim: the speaker won a sold lot of this vehicle before speaking.
  SELECT 'corroborates', 'relation', 'won_lot_before_statement', true, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON l.winner = c.who AND l.outcome = 'sold' AND l.at <= c.said_at
  WHERE c.rel = 'owner_current' AND c.detail = 'buyer'
  UNION ALL
  -- R3. A past owner's claim: the speaker is a keyed party to a lot of this vehicle, or to a transfer that does not
  -- repeat a lot, before speaking.
  SELECT 'corroborates', 'relation', 'keyed_party_before_statement', true, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON c.who IN (l.seller, l.winner) AND l.at <= c.said_at
  WHERE c.rel = 'owner_past'
  UNION ALL
  SELECT 'corroborates', 'relation', 'keyed_party_before_statement', true, 'ownership_transfers', ot.id, ot.sale_date,
    ot.created_at
  FROM c JOIN public.ownership_transfers ot
    ON ot.vehicle_id = c.vehicle_id AND c.who IN (ot.from_identity_id, ot.to_identity_id)
  WHERE c.rel = 'owner_past' AND ot.sale_date <= c.said_at AND ot.created_at <= p_known_at
    AND ot.trigger_table IS DISTINCT FROM 'auction_events'
  UNION ALL
  -- R4. The stated start: the speaker won a sold lot of this vehicle within 31 days of the start bounds.
  SELECT 'corroborates', 'window_start', 'won_lot_at_window_start', true, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON l.winner = c.who AND l.outcome = 'sold'
  WHERE c.rel IN ('owner_current', 'owner_past') AND c.se IS NOT NULL
    AND l.at::date BETWEEN c.se - 31 AND c.sl + 31
  UNION ALL
  -- R5. The stated end: the speaker sold this vehicle on a lot within 31 days of the end bounds.
  SELECT 'corroborates', 'window_end', 'sold_lot_at_window_end', true, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON l.seller = c.who AND l.outcome = 'sold'
  WHERE c.rel = 'owner_past' AND c.ee IS NOT NULL
    AND l.at::date BETWEEN c.ee - 31 AND c.el + 31
  UNION ALL
  -- R6. Someone else sold the vehicle to a third party more than 31 days inside the stated tenure.
  SELECT 'contradicts', 'window', 'third_party_sale_inside_window', true, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON l.outcome = 'sold' AND l.seller IS NOT NULL AND l.winner IS NOT NULL
    AND l.seller <> c.who AND l.winner <> c.who
  WHERE c.rel IN ('owner_current', 'owner_past') AND c.sl IS NOT NULL
    AND coalesce(c.ee, CASE WHEN c.rel = 'owner_current' THEN c.said_at::date END) IS NOT NULL
    AND l.at::date > c.sl + 31
    AND l.at::date < coalesce(c.ee, CASE WHEN c.rel = 'owner_current' THEN c.said_at::date END) - 31
$function$;

CREATE OR REPLACE FUNCTION public.live_lot_temperature_at(p_auction_event_id uuid, p_bid numeric, p_bidders integer, p_at timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_extensions integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '15s'
 SET lock_timeout TO '2s'
AS $function$
  WITH cfg AS (
    SELECT 9 AS min_n,                        -- fewest comparables for which an 80% order-statistic interval exists
           150 AS cohort_cap,                 -- most recent sold lots read from one cohort
           300 AS pool_cap,                   -- most recent clocked lots read for the minutes regime
           3600 AS hours_from_s,              -- from this many seconds left, a lot's final close is a fair clock for comparables
           120 AS window_s,                   -- BaT soft close: a bid in the last 120 s moves the close to bid time + 120 s
           3 AS min_clock_votes,              -- bid rows that must agree on a lot's scheduled close before it is used
           30 AS min_tier_n,                  -- lots a price tier needs before it stands alone
           interval '1 hour' AS settle,       -- a comparable counts only when it closed this long before p_at
           365 AS cohort_days                 -- and no longer than this many days before it: the late-bid share of the price drifts up year on year
  ),
  lot AS (
    SELECT e.id AS event_id, e.vehicle_id, e.outcome,
           v.make, v.model, v.year, lower(v.normalized_model) AS family,
           substring(e.source_url FROM '/listing/([^/?#]+)') AS slug,
           COALESCE(p_ends_at, e.auction_end_date) AS ends_at,
           CASE WHEN p_ends_at IS NOT NULL THEN 'argument' ELSE 'auction_events.auction_end_date' END AS ends_at_source
    FROM public.auction_events_canonical e
    JOIN vehicles v ON v.id = e.vehicle_id
    WHERE e.id = p_auction_event_id
      AND e.source_url ~ 'bringatrailer\.com/listing/[^/?#]+'
  ),
  st AS (    -- the lot, its clock at p_at, and which comparables clock applies
    SELECT l.*,
           extract(epoch FROM (l.ends_at - p_at)) AS secs,
           CASE WHEN p_at IS NULL THEN 'no_time'
                WHEN l.ends_at IS NULL THEN 'no_close'
                WHEN l.ends_at <= p_at THEN 'ended'
                WHEN p_bid IS NULL OR p_bid <= 0 THEN 'no_bid'
                WHEN extract(epoch FROM (l.ends_at - p_at)) >= (SELECT hours_from_s FROM cfg) THEN 'hours'
                ELSE 'minutes' END AS regime
    FROM lot l
  ),
  own_rows AS (   -- the lot's own bid rows posted at or before p_at (event clock); nothing later is read
    SELECT a.posted_at, a.bid_amount, a.author_username,
           date_trunc('second', a.posted_at + a.hours_until_close * interval '1 hour') AS implied_end
    FROM auction_comments a
    WHERE a.auction_event_id = (SELECT event_id FROM st)
      AND a.comment_type = 'bid' AND a.bid_amount > 0
      AND a.posted_at IS NOT NULL AND a.posted_at <= p_at
  ),
  own AS (
    SELECT count(*) AS n, max(bid_amount) AS bid, count(DISTINCT author_username) AS bidders,
           min(posted_at) AS first_at, max(posted_at) AS last_at,
           count(*) FILTER (WHERE posted_at > p_at - interval '15 minutes') AS n_15,
           mode() WITHIN GROUP (ORDER BY implied_end) AS sched_end
    FROM own_rows
  ),
  own_end AS (   -- the scheduled close the lot's own rows agree on, and how many rows say so
    SELECT o.sched_end, (SELECT count(*) FROM own_rows r WHERE r.implied_end = o.sched_end) AS votes
    FROM own o
  ),
  ext AS (       -- soft-close extensions seen so far: the caller's count, else 0 until the last 120 s, else read from the rows
    SELECT CASE
             WHEN p_extensions IS NOT NULL THEN p_extensions
             WHEN (SELECT secs FROM st) >= (SELECT window_s FROM cfg) THEN 0
             WHEN (SELECT votes FROM own_end) >= (SELECT min_clock_votes FROM cfg) THEN
               CASE WHEN (SELECT ends_at FROM st) > (SELECT sched_end FROM own_end) + interval '3 seconds'
                    THEN greatest(1, (SELECT count(*) FROM own_rows r
                                      WHERE r.posted_at > (SELECT sched_end FROM own_end) - (SELECT window_s FROM cfg) * interval '1 second'))
                    ELSE 0 END
           END AS n,
           CASE WHEN p_extensions IS NOT NULL THEN 'argument'
                WHEN (SELECT secs FROM st) >= (SELECT window_s FROM cfg) THEN '120 s or more left: the close cannot have moved'
                WHEN (SELECT votes FROM own_end) >= (SELECT min_clock_votes FROM cfg) THEN 'the lot''s bid rows (scheduled close from hours_until_close) against the clock given'
                ELSE 'unknown: fewer than 3 bid rows agree on a scheduled close and no count was given' END AS basis
  ),
  frames AS (    -- public live frames held for the lot at p_at (ingested and observed at or before it), last 3 hours
    SELECT count(*) AS n,
           count(*) FILTER (WHERE o.observed_at > p_at - interval '15 minutes') AS n_15,
           count(DISTINCT date_trunc('minute', o.observed_at)) FILTER (WHERE o.observed_at > p_at - interval '15 minutes') AS minutes_15,
           min(o.observed_at) AS first_at, max(o.observed_at) AS last_at
    FROM vehicle_observations o
    WHERE o.vehicle_id = (SELECT vehicle_id FROM st)
      AND o.extraction_method = 'bat_public_live_v1'
      AND o.observed_at <= p_at AND o.observed_at > p_at - interval '3 hours'
      AND o.ingested_at <= p_at
  ),
  prior AS (     -- the stored title-only band (model 31), as it stood at p_at
    SELECT h.predicted_low, h.predicted_hammer, h.predicted_high, h.price_tier, h.comp_count, h.predicted_at
    FROM hammer_predictions h
    WHERE h.vehicle_id = (SELECT vehicle_id FROM st) AND h.model_version = 31 AND h.predicted_at <= p_at
    ORDER BY h.predicted_at DESC
    LIMIT 1
  ),
  -- ---------------------------------------------------------------- hours regime: the lot's own cohort, final close as the clock
  -- Level 1 is the vehicles with this exact make and model text; level 2, used only when level 1 holds fewer than 9 sold lots, is the
  -- vehicles with this make and the same model family (vehicles.normalized_model, "Corvette", "911"). A cohort of up to 6,000
  -- vehicles is read through its vehicles (every lot of theirs, exact counts). A bigger one is read through the lots, newest sold
  -- first, until 170 belong to it (a floor for the denominator): reading 37,000 Corvettes to keep the 150 newest lots took 16 s cold and 0.47 s warm; the lots-first read takes 0.13 s warm.
  l1_veh AS (
    SELECT v.id FROM vehicles v
    WHERE (SELECT regime FROM st) = 'hours'
      AND v.make = (SELECT make FROM st) AND v.model = (SELECT model FROM st)
      AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
    LIMIT 6001
  ),
  l1_big AS (SELECT (SELECT count(*) FROM l1_veh) > 6000 AS big),
  l1_small AS (
    SELECT e.id AS ae_id, e.auction_end_date AS f, e.winning_bid AS hammer,
           (e.outcome = 'sold' AND e.winning_bid > 0) AS sold, e.updated_at,
           substring(e.source_url FROM '/listing/([^/?#]+)') AS slug
    FROM l1_veh fv
    JOIN public.auction_events_canonical e ON e.vehicle_id = fv.id
    WHERE NOT (SELECT big FROM l1_big)
      AND e.source_url ~ 'bringatrailer\.com/listing/[^/?#]+'
      AND e.auction_end_date <= p_at - (SELECT settle FROM cfg)
      AND e.auction_end_date > p_at - (SELECT cohort_days FROM cfg) * interval '1 day'
      AND e.id <> p_auction_event_id
  ),
  l1_recent AS (
    SELECT e.id AS ae_id, e.auction_end_date AS f, e.winning_bid AS hammer, true AS sold, e.updated_at,
           substring(e.source_url FROM '/listing/([^/?#]+)') AS slug
    FROM (SELECT e0.id, e0.vehicle_id, e0.auction_end_date, e0.winning_bid, e0.updated_at, e0.source_url
          FROM public.auction_events_canonical e0
          WHERE (SELECT big FROM l1_big)
            AND e0.source_url ~ 'bringatrailer\.com/listing/[^/?#]+'
            AND e0.outcome = 'sold' AND e0.winning_bid > 0
            AND e0.auction_end_date <= p_at - (SELECT settle FROM cfg)
            AND e0.auction_end_date > p_at - (SELECT cohort_days FROM cfg) * interval '1 day'
          ORDER BY e0.auction_end_date DESC
          LIMIT 12000) e
    -- the vehicle is found by its key; "|| ''" keeps the planner off the make-and-model index, which it cannot size for a parameter
    CROSS JOIN LATERAL (SELECT 1 FROM vehicles v
                        WHERE v.id = e.vehicle_id AND (v.make || '') = (SELECT make FROM st) AND (v.model || '') = (SELECT model FROM st)
                          AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL LIMIT 1) ok
    WHERE e.id <> p_auction_event_id
    LIMIT 170
  ),
  l1 AS (        -- one row per listing slug
    SELECT DISTINCT ON (r.slug) r.*
    FROM (SELECT * FROM l1_small UNION ALL SELECT * FROM l1_recent) r
    WHERE r.slug IS DISTINCT FROM (SELECT slug FROM st)
    ORDER BY r.slug, r.sold DESC, r.updated_at DESC NULLS LAST
  ),
  l1_n AS (SELECT count(*) AS closed, count(*) FILTER (WHERE sold) AS sold, (SELECT big FROM l1_big) AS floor FROM l1),
  l2_veh AS (
    SELECT v.id FROM vehicles v
    WHERE (SELECT regime FROM st) = 'hours'
      AND (SELECT sold FROM l1_n) < (SELECT min_n FROM cfg)
      AND (SELECT family FROM st) IS NOT NULL
      AND lower(v.make) = lower((SELECT make FROM st))
      AND lower(v.normalized_model) = (SELECT family FROM st)
      AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
    LIMIT 6001
  ),
  l2_big AS (SELECT (SELECT count(*) FROM l2_veh) > 6000 AS big),
  l2_small AS (
    SELECT e.id AS ae_id, e.auction_end_date AS f, e.winning_bid AS hammer,
           (e.outcome = 'sold' AND e.winning_bid > 0) AS sold, e.updated_at,
           substring(e.source_url FROM '/listing/([^/?#]+)') AS slug
    FROM l2_veh fv
    JOIN public.auction_events_canonical e ON e.vehicle_id = fv.id
    WHERE NOT (SELECT big FROM l2_big)
      AND e.source_url ~ 'bringatrailer\.com/listing/[^/?#]+'
      AND e.auction_end_date <= p_at - (SELECT settle FROM cfg)
      AND e.auction_end_date > p_at - (SELECT cohort_days FROM cfg) * interval '1 day'
      AND e.id <> p_auction_event_id
  ),
  l2_recent AS (
    SELECT e.id AS ae_id, e.auction_end_date AS f, e.winning_bid AS hammer, true AS sold, e.updated_at,
           substring(e.source_url FROM '/listing/([^/?#]+)') AS slug
    FROM (SELECT e0.id, e0.vehicle_id, e0.auction_end_date, e0.winning_bid, e0.updated_at, e0.source_url
          FROM public.auction_events_canonical e0
          WHERE (SELECT big FROM l2_big)
            AND e0.source_url ~ 'bringatrailer\.com/listing/[^/?#]+'
            AND e0.outcome = 'sold' AND e0.winning_bid > 0
            AND e0.auction_end_date <= p_at - (SELECT settle FROM cfg)
            AND e0.auction_end_date > p_at - (SELECT cohort_days FROM cfg) * interval '1 day'
          ORDER BY e0.auction_end_date DESC
          LIMIT 12000) e
    CROSS JOIN LATERAL (SELECT 1 FROM vehicles v
                        WHERE v.id = e.vehicle_id AND (lower(v.make) || '') = lower((SELECT make FROM st))
                          AND (lower(v.normalized_model) || '') = (SELECT family FROM st)
                          AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL LIMIT 1) ok
    WHERE e.id <> p_auction_event_id
    LIMIT 170
  ),
  l2 AS (
    SELECT DISTINCT ON (r.slug) r.*
    FROM (SELECT * FROM l2_small UNION ALL SELECT * FROM l2_recent) r
    WHERE r.slug IS DISTINCT FROM (SELECT slug FROM st)
    ORDER BY r.slug, r.sold DESC, r.updated_at DESC NULLS LAST
  ),
  l2_n AS (SELECT count(*) AS closed, count(*) FILTER (WHERE sold) AS sold, (SELECT big FROM l2_big) AS floor FROM l2),
  lvl AS (
    SELECT CASE WHEN (SELECT sold FROM l1_n) >= (SELECT min_n FROM cfg) THEN 1
                WHEN (SELECT sold FROM l2_n) >= (SELECT min_n FROM cfg) THEN 2 END AS level
  ),
  cohort_sel AS (   -- the most recent sold lots of the level in use
    SELECT * FROM (
      SELECT * FROM l1 WHERE (SELECT level FROM lvl) = 1
      UNION ALL
      SELECT * FROM l2 WHERE (SELECT level FROM lvl) = 2
    ) c
    WHERE c.sold
    ORDER BY c.f DESC
    LIMIT (SELECT cohort_cap FROM cfg)
  ),
  cohort_state AS ( -- each comparable as it stood the same time before its own close: max bid and bidders posted by then
    SELECT s.ae_id, s.f, s.hammer, x.log_max, x.bid_h, x.bidders_h
    FROM cohort_sel s
    CROSS JOIN LATERAL (
      SELECT max(a.bid_amount) AS log_max,
             max(a.bid_amount) FILTER (WHERE a.posted_at <= s.f - make_interval(secs => (SELECT secs FROM st)::double precision)) AS bid_h,
             count(DISTINCT a.author_username) FILTER (WHERE a.posted_at <= s.f - make_interval(secs => (SELECT secs FROM st)::double precision)) AS bidders_h
      FROM auction_comments a
      WHERE a.auction_event_id = s.ae_id AND a.comment_type = 'bid' AND a.bid_amount > 0 AND a.posted_at IS NOT NULL
    ) x
  ),
  cohort_ok AS (    -- a comparable counts when its bid log reproduces its hammer (no missing last bid, no post-auction sale)
    SELECT * FROM cohort_state WHERE log_max = hammer
  ),
  cohort_n AS (
    SELECT (SELECT count(*) FROM cohort_sel) AS read,
           count(*) AS log_ok,
           count(*) FILTER (WHERE bid_h IS NULL) AS no_bid_yet,
           count(*) FILTER (WHERE bid_h IS NOT NULL) AS n
    FROM cohort_ok
  ),
  cohort_ranked AS (
    SELECT hammer / bid_h AS ratio, bid_h, bidders_h,
           row_number() OVER (ORDER BY hammer / bid_h, ae_id) AS rk
    FROM cohort_ok WHERE bid_h IS NOT NULL
  ),
  cohort_pos AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE bid_h < p_bid) AS below, count(*) FILTER (WHERE bid_h = p_bid) AS same,
           count(*) FILTER (WHERE bidders_h IS NOT NULL AND p_bidders IS NOT NULL AND bidders_h < p_bidders) AS bidders_below,
           count(*) FILTER (WHERE bidders_h IS NOT NULL AND p_bidders IS NOT NULL AND bidders_h = p_bidders) AS bidders_same
    FROM cohort_ranked
  ),
  -- ---------------------------------------------------------------- minutes regime: lots with a recorded clock, scheduled close as the clock
  pool_lots AS (    -- sold lots the public live collector followed, closed before p_at, most recent first
    SELECT e.id AS ae_id, e.auction_end_date AS f, e.winning_bid AS hammer
    FROM monitored_auctions ma
    JOIN public.auction_events_canonical e ON e.vehicle_id = ma.vehicle_id
                         AND substring(e.source_url FROM '/listing/([^/?#]+)') = ma.external_auction_id
    WHERE (SELECT regime FROM st) = 'minutes'
      AND (SELECT n FROM ext) IS NOT NULL
      AND ma.stream_state ? 'last_frame_received_at'
      AND e.outcome = 'sold' AND e.winning_bid > 0
      AND e.auction_end_date <= p_at - (SELECT settle FROM cfg)
      AND e.id <> p_auction_event_id
    ORDER BY e.auction_end_date DESC
    LIMIT (SELECT pool_cap FROM cfg)
  ),
  pool_state AS (   -- each one in the lot's own state: before any extension, the same time before its SCHEDULED close;
                    -- after i extensions, the same time since its i-th bid inside the last 120 s; in both, no later bid yet
    SELECT j.ae_id, j.f, j.hammer, y.sched_end, y.log_max, y.bid_t, y.in_window
    FROM pool_lots j
    CROSS JOIN LATERAL (
      WITH b AS (
        SELECT a.posted_at, a.bid_amount,
               date_trunc('second', a.posted_at + a.hours_until_close * interval '1 hour') AS implied_end
        FROM auction_comments a
        WHERE a.auction_event_id = j.ae_id AND a.comment_type = 'bid' AND a.bid_amount > 0 AND a.posted_at IS NOT NULL
      ), z AS (
        SELECT max(posted_at) AS last_at, max(bid_amount) AS log_max FROM b
      ), o AS (
        -- The scheduled close is the close before any soft-close extension; auction_events keeps only the final one.
        -- Not extended (the last bid is more than 123 s before the stored close): the stored close is it.
        -- Extended: the close that at least 3 bid rows count their hours_until_close to, among values after the row's own
        -- posting and before the stored close (rows written by a later read count to the final close and are left out),
        -- the one most rows agree on.
        SELECT CASE WHEN extract(epoch FROM (j.f - z.last_at)) > 123 THEN j.f
                    ELSE (SELECT c.implied_end
                          FROM (SELECT implied_end, count(*) AS votes
                                FROM b
                                WHERE implied_end IS NOT NULL AND implied_end >= posted_at AND implied_end < j.f - interval '3 seconds'
                                GROUP BY implied_end
                                HAVING count(*) >= (SELECT min_clock_votes FROM cfg)) c
                          ORDER BY c.votes DESC, c.implied_end
                          LIMIT 1) END AS sched_end,
               z.log_max
        FROM z
      ), ch AS (   -- the bids inside the last 120 s of the scheduled close, which is every bid of the extension chain, in order
        SELECT b.posted_at, row_number() OVER (ORDER BY b.posted_at, b.bid_amount) AS rn
        FROM b, o
        WHERE b.posted_at > o.sched_end - (SELECT window_s FROM cfg) * interval '1 second'
      ), an AS (   -- where the state starts: the opening of the last 120 s, or the i-th chain bid
        SELECT CASE WHEN (SELECT n FROM ext) = 0 THEN o.sched_end - (SELECT window_s FROM cfg) * interval '1 second'
                    ELSE (SELECT ch.posted_at FROM ch WHERE ch.rn = (SELECT n FROM ext)) END AS a_at,
               o.sched_end
        FROM o
      ), tt AS (   -- the moment read: i = 0, secs before the scheduled close; i >= 1, 120 - secs after the i-th chain bid
        SELECT an.a_at,
               CASE WHEN (SELECT n FROM ext) = 0 THEN an.sched_end - make_interval(secs => (SELECT secs FROM st)::double precision)
                    ELSE an.a_at + make_interval(secs => greatest(0, (SELECT window_s FROM cfg) - (SELECT secs FROM st))::double precision) END AS t_at
        FROM an
      )
      SELECT o.sched_end, o.log_max,
             (SELECT max(b.bid_amount) FROM b WHERE b.posted_at <= tt.t_at) AS bid_t,
             (SELECT count(*) FROM b WHERE b.posted_at > tt.a_at AND b.posted_at <= tt.t_at) AS in_window
      FROM o, tt
    ) y
  ),
  pool_ok AS (
    SELECT ae_id, hammer, bid_t, hammer / bid_t AS ratio,
           CASE WHEN bid_t < 25000 THEN 'a' WHEN bid_t < 50000 THEN 'b' WHEN bid_t < 100000 THEN 'c' ELSE 'd' END AS tier
    FROM pool_state
    WHERE sched_end IS NOT NULL AND log_max = hammer AND bid_t IS NOT NULL AND in_window = 0
  ),
  pool_tier AS (
    SELECT CASE WHEN p_bid < 25000 THEN 'a' WHEN p_bid < 50000 THEN 'b' WHEN p_bid < 100000 THEN 'c' ELSE 'd' END AS tier
  ),
  pool_use AS (     -- the lot's price tier when it holds enough lots, else every tier
    SELECT p.*,
           (SELECT count(*) FROM pool_ok q WHERE q.tier = (SELECT tier FROM pool_tier)) >= (SELECT min_tier_n FROM cfg) AS tier_alone
    FROM pool_ok p
  ),
  pool_ranked AS (
    SELECT ratio, tier_alone,
           row_number() OVER (ORDER BY ratio, ae_id) AS rk
    FROM pool_use
    WHERE NOT tier_alone OR tier = (SELECT tier FROM pool_tier)
  ),
  pool_n AS (
    SELECT (SELECT count(*) FROM pool_lots) AS read,
           (SELECT count(*) FROM pool_state) AS state_n,
           (SELECT count(*) FROM pool_state WHERE sched_end IS NOT NULL) AS clock_ok,
           (SELECT count(*) FROM pool_state WHERE sched_end IS NOT NULL AND log_max = hammer) AS log_ok,
           (SELECT count(*) FROM pool_ok) AS in_state,
           (SELECT count(*) FROM pool_ranked) AS n,
           COALESCE((SELECT bool_or(tier_alone) FROM pool_ranked), false) AS tier_alone
  ),
  -- ---------------------------------------------------------------- the 80% interval: order statistics of the comparables' hammer / bid ratios
  pick AS (          -- which sample feeds the band
    SELECT CASE (SELECT regime FROM st)
             WHEN 'hours' THEN (SELECT n FROM cohort_n)
             WHEN 'minutes' THEN (SELECT n FROM pool_n) END AS n
  ),
  ords AS (          -- the hammer is never below the standing bid (ratio 1), so only the top needs a rank: the k-th smallest of n,
                     -- k = ceil(0.8 (n + 1)); the new lot's ratio is at or below it with probability k/(n + 1) >= 0.8 when exchangeable
    SELECT n, CASE WHEN n >= (SELECT min_n FROM cfg) THEN ceil((n + 1) * 0.8)::int END AS k
    FROM pick
  ),
  ratios AS (
    SELECT (SELECT ratio FROM (SELECT ratio, rk FROM cohort_ranked UNION ALL SELECT ratio, rk FROM pool_ranked) r WHERE r.rk = (SELECT k FROM ords)) AS hi,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ratio)::numeric FROM (SELECT ratio FROM cohort_ranked UNION ALL SELECT ratio FROM pool_ranked) r) AS mid
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM lot) THEN jsonb_build_object(
      'status', 'unknown_lot', 'as_of', p_at, 'auction_event_id', p_auction_event_id,
      'reason', 'no auction_events row has this id and a Bring a Trailer listing URL')
    WHEN (SELECT regime FROM st) = 'no_time' THEN jsonb_build_object(
      'status', 'no_time', 'auction_event_id', p_auction_event_id,
      'reason', 'no time of the read was given')
    WHEN (SELECT regime FROM st) = 'no_close' THEN jsonb_build_object(
      'status', 'no_close', 'as_of', p_at, 'auction_event_id', p_auction_event_id,
      'reason', 'the lot has no close time and none was given')
    WHEN (SELECT regime FROM st) = 'ended' THEN jsonb_build_object(
      'status', 'ended', 'as_of', p_at, 'auction_event_id', p_auction_event_id,
      'ends_at', (SELECT ends_at FROM st), 'ends_at_source', (SELECT ends_at_source FROM st),
      'reason', 'the close time is at or before the time of the read')
    WHEN (SELECT regime FROM st) = 'no_bid' THEN jsonb_build_object(
      'status', 'no_bid', 'as_of', p_at, 'auction_event_id', p_auction_event_id,
      'reason', 'no current bid was given')
    ELSE (
      SELECT jsonb_build_object(
        'status', 'ok',
        'reader', 'live_lot_temperature_at',
        'as_of', p_at,
        'lot', jsonb_build_object(
          'auction_event_id', st.event_id, 'vehicle_id', st.vehicle_id, 'slug', st.slug,
          'year', st.year, 'make', st.make, 'model', st.model),
        'input', jsonb_build_object('bid', p_bid, 'bidders', p_bidders, 'at', p_at),
        'clock', jsonb_build_object(
          'ends_at', st.ends_at, 'ends_at_source', st.ends_at_source,
          'seconds_left', round(st.secs, 1), 'regime', st.regime,
          'extensions', ext.n, 'extensions_basis', ext.basis,
          'basis', CASE st.regime
                     WHEN 'hours' THEN 'comparables are read the same time before their own final close; the final close of a closed lot includes any soft-close extension, an error of a few minutes that is under 2% of the 90th ratio from 1 h out'
                     ELSE 'comparables are lots with a recorded clock in the same soft-close state: before any extension, read the same time before their scheduled close (the close before any extension); after i extensions, read the same time after their i-th bid inside the last 120 s; in both, with no later bid yet' END),
        'cohort', CASE st.regime
          WHEN 'hours' THEN jsonb_build_object(
            'key', jsonb_build_object('make', st.make, 'model', st.model, 'model_family', st.family),
            'level', (SELECT level FROM lvl),
            'how', CASE (SELECT level FROM lvl)
                     WHEN 1 THEN 'BaT lots whose vehicle has this exact make and model text'
                     WHEN 2 THEN 'BaT lots whose vehicle has this make and the same model family, vehicles.normalized_model (the exact make and model text had fewer than 9 sold lots)'
                     ELSE 'no cohort: neither the exact make and model text nor the make with the model family has 9 sold lots' END
                   || '; one row per listing, closed between ' || (SELECT cohort_days FROM cfg) || ' days and 1 hour before the time of the read, sold with a hammer, most recent 150; a lot counts when its bid rows reproduce its hammer. A cohort of more than 6,000 vehicles is read through its newest lots, so its denominator is a floor',
            'n_comparables', (SELECT n FROM cohort_n),
            'denominator', CASE (SELECT level FROM lvl) WHEN 1 THEN (SELECT sold FROM l1_n) WHEN 2 THEN (SELECT sold FROM l2_n) END,
            'denominator_is_a_floor', CASE (SELECT level FROM lvl) WHEN 1 THEN (SELECT floor FROM l1_n) WHEN 2 THEN (SELECT floor FROM l2_n) END,
            'funnel', jsonb_build_object(
              'closed_lots', CASE (SELECT level FROM lvl) WHEN 1 THEN (SELECT closed FROM l1_n) WHEN 2 THEN (SELECT closed FROM l2_n) ELSE (SELECT closed FROM l1_n) END,
              'sold_with_hammer', CASE (SELECT level FROM lvl) WHEN 1 THEN (SELECT sold FROM l1_n) WHEN 2 THEN (SELECT sold FROM l2_n) ELSE (SELECT sold FROM l1_n) END,
              'read', (SELECT read FROM cohort_n),
              'bid_log_reproduces_hammer', (SELECT log_ok FROM cohort_n),
              'no_bid_yet_at_this_time', (SELECT no_bid_yet FROM cohort_n),
              'with_a_bid_at_this_time', (SELECT n FROM cohort_n)))
          ELSE jsonb_build_object(
            'key', jsonb_build_object('make', st.make, 'model', st.model, 'model_family', st.family),
            'level', NULL, 'n_comparables', NULL, 'denominator', NULL,
            'how', 'not read in the minutes regime: the band comes from lots with a recorded clock, across cohorts (see band.pool)') END,
        'cohort_miss', CASE WHEN st.regime = 'hours' AND (SELECT sold FROM l1_n) < (SELECT min_n FROM cfg) THEN jsonb_build_object(
            'level', 'exact make and model text',
            'reason', CASE WHEN st.make IS NULL OR st.model IS NULL THEN 'the lot''s vehicle has no make or no model'
                           WHEN (SELECT closed FROM l1_n) = 0 THEN 'no closed BaT lot has this make and model text'
                           ELSE 'fewer than 9 sold BaT lots have this make and model text' END,
            'make', st.make, 'model', st.model, 'model_family', st.family,
            'denominator', jsonb_build_object(
              'closed_lots_with_this_text', (SELECT closed FROM l1_n),
              'sold_with_this_text', (SELECT sold FROM l1_n),
              'vehicles_with_this_make_to_10000', CASE WHEN (SELECT level FROM lvl) IS NULL AND st.make IS NOT NULL
                                                       THEN (SELECT count(*) FROM (SELECT 1 FROM vehicles v WHERE v.make = st.make LIMIT 10000) m) END,
              'closed_lots_in_the_model_family', (SELECT closed FROM l2_n),
              'sold_in_the_model_family', (SELECT sold FROM l2_n)),
            'resolved_by', CASE (SELECT level FROM lvl) WHEN 2 THEN 'make and model family (normalized_model)' END,
            'family_note', CASE WHEN st.family IS NULL THEN 'the lot''s vehicle has no normalized_model, so there is no wider level to try' END)
          END,
        'position', CASE WHEN st.regime = 'hours' AND (SELECT n FROM cohort_pos) > 0 THEN jsonb_build_object(
            'basis', 'the lot against the cohort''s comparables the same time before their own close',
            'seconds_left', round(st.secs, 1),
            'price', jsonb_build_object('bid', p_bid, 'n', (SELECT n FROM cohort_pos),
                       'below', (SELECT below FROM cohort_pos), 'same', (SELECT same FROM cohort_pos),
                       'above', (SELECT n - below - same FROM cohort_pos),
                       'percentile', round(((SELECT below FROM cohort_pos) + 0.5 * (SELECT same FROM cohort_pos)) / (SELECT n FROM cohort_pos), 4)),
            'bidders', CASE WHEN p_bidders IS NOT NULL THEN jsonb_build_object('bidders', p_bidders, 'n', (SELECT n FROM cohort_pos),
                       'below', (SELECT bidders_below FROM cohort_pos), 'same', (SELECT bidders_same FROM cohort_pos),
                       'above', (SELECT n - bidders_below - bidders_same FROM cohort_pos),
                       'percentile', round(((SELECT bidders_below FROM cohort_pos) + 0.5 * (SELECT bidders_same FROM cohort_pos)) / (SELECT n FROM cohort_pos), 4)) END)
          END,
        'band', CASE WHEN ords.k IS NOT NULL AND ext.n IS NOT NULL THEN jsonb_build_object(
            'level', 0.8,
            'applies_to', 'the hammer of a lot that sells; every comparable sold, so a lot that ends under its reserve has no hammer to bracket',
            'method', CASE st.regime WHEN 'hours' THEN 'cohort_ratio_upper_order_statistic' ELSE 'clocked_lots_ratio_upper_order_statistic' END,
            'description', 'The hammer is never below the standing bid. The upper end is the k-th smallest of the n comparables'' hammer / bid ratios, read the same time before their close, k = ceil(0.8 (n + 1)); the lot''s ratio is at or below it with probability k/(n + 1), at least 0.8, when the lot is exchangeable with its comparables. No parameter is fitted.',
            'n', ords.n, 'rank_high', ords.k,
            'coverage_if_exchangeable', round(ords.k::numeric / (ords.n + 1), 4),
            'denominator', CASE st.regime
                             WHEN 'hours' THEN CASE (SELECT level FROM lvl) WHEN 1 THEN (SELECT sold FROM l1_n) ELSE (SELECT sold FROM l2_n) END
                             ELSE (SELECT read FROM pool_n) END,
            'denominator_is_a_floor', CASE st.regime
                             WHEN 'hours' THEN CASE (SELECT level FROM lvl) WHEN 1 THEN (SELECT floor FROM l1_n) ELSE (SELECT floor FROM l2_n) END
                             ELSE false END,
            'as_of', p_at, 'seconds_left', round(st.secs, 1),
            'bid', p_bid,
            'ratio_low', 1, 'ratio_mid', round(ratios.mid, 4), 'ratio_high', round(ratios.hi, 4),
            'low', p_bid, 'mid', round(p_bid * ratios.mid), 'high', ceil(p_bid * ratios.hi),
            'pool', CASE st.regime WHEN 'minutes' THEN jsonb_build_object(
                'price_tier', (SELECT tier FROM pool_tier), 'tier_alone', (SELECT tier_alone FROM pool_n),
                'extensions', ext.n,
                'seconds_since_last_bid', CASE WHEN ext.n > 0 THEN greatest(0, 120 - round(st.secs, 1)) END,
                'funnel', jsonb_build_object(
                  'clocked_sold_lots_read', (SELECT read FROM pool_n),
                  'scheduled_close_known', (SELECT clock_ok FROM pool_n),
                  'bid_log_reproduces_hammer', (SELECT log_ok FROM pool_n),
                  'in_the_same_state_with_a_bid', (SELECT in_state FROM pool_n),
                  'in_the_sample', (SELECT n FROM pool_n))) END)
          END,
        'band_unavailable', CASE
          WHEN ords.k IS NOT NULL AND ext.n IS NOT NULL THEN NULL
          WHEN ext.n IS NULL THEN jsonb_build_object(
            'reason', 'the lot''s soft-close state is unknown: fewer than 3 bid rows agree on its scheduled close and no extension count was given',
            'extensions_basis', ext.basis, 'floor', p_bid)
          WHEN st.regime = 'hours' THEN jsonb_build_object(
            'reason', CASE WHEN (SELECT level FROM lvl) IS NULL THEN 'no cohort: see cohort_miss'
                           ELSE 'fewer than 9 comparables had a bid this long before their close' END,
            'n', (SELECT n FROM cohort_n), 'min_n', 9,
            'sold_lots_found', CASE (SELECT level FROM lvl) WHEN 2 THEN (SELECT sold FROM l2_n) ELSE (SELECT sold FROM l1_n) END)
          ELSE jsonb_build_object(
            'reason', CASE WHEN ext.n > 0 THEN 'fewer than 9 lots with a recorded clock reached the same number of extensions and had no later bid by this time'
                           ELSE 'fewer than 9 lots with a recorded clock had a bid at this time to close and no extension yet' END,
            'n', (SELECT n FROM pool_n), 'min_n', 9, 'extensions', ext.n, 'floor', p_bid,
            'funnel', jsonb_build_object('clocked_sold_lots_read', (SELECT read FROM pool_n),
                      'scheduled_close_known', (SELECT clock_ok FROM pool_n),
                      'bid_log_reproduces_hammer', (SELECT log_ok FROM pool_n),
                      'in_the_same_state_with_a_bid', (SELECT in_state FROM pool_n)))
          END,
        'prior', (SELECT jsonb_build_object(
            'model_version', 31, 'method', 'title-only CompBase band, priced once at first sight (scripts/market/live-bands.sql); does not use the live bid',
            'low', pr.predicted_low, 'mid', pr.predicted_hammer, 'high', pr.predicted_high,
            'price_tier', pr.price_tier, 'comp_count', pr.comp_count, 'predicted_at', pr.predicted_at,
            'bid_below_low', p_bid < pr.predicted_low, 'bid_above_high', p_bid > pr.predicted_high)
          FROM prior pr),
        'coverage', jsonb_build_object(
          'as_of', p_at,
          'bid_rows', jsonb_build_object('source', 'auction_comments, comment_type bid, posted at or before as_of',
                        'n', own.n, 'first_posted_at', own.first_at, 'last_posted_at', own.last_at,
                        'max_bid', own.bid, 'bidders', own.bidders, 'rows_in_last_15_min', own.n_15,
                        'agrees_with_input_bid', own.bid IS NOT DISTINCT FROM p_bid),
          'live_frames', jsonb_build_object('source', 'vehicle_observations, bat_public_live_v1, observed and ingested at or before as_of, last 3 hours',
                        'n', frames.n, 'first_observed_at', frames.first_at, 'last_observed_at', frames.last_at,
                        'frames_in_last_15_min', frames.n_15, 'minutes_with_a_frame_of_last_15', frames.minutes_15)))
      FROM st, ext, own, frames, ords, ratios
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.ownership_fold_plan(p_vehicle_ids uuid[])
 RETURNS TABLE(kind text, vehicle_id uuid, owner_identity_id uuid, fold_key text, start_at timestamp with time zone, end_at timestamp with time zone, start_unknown boolean, end_unknown boolean, is_current boolean, start_clock_source text, end_clock_source text, acquired_via_lot_id uuid, disposed_via_lot_id uuid, chain_flag text, chain_peer_lot_id uuid, sale_confirmation text, listed_via_lot_id uuid, fold_hash text, flag_reason text, flag_lot_id uuid, flag_detail jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH raw AS (
  SELECT a.id AS lot_id, a.vehicle_id, a.outcome, (a.outcome = 'sold') AS is_sold,
         coalesce(lower(substring(a.source_url from 'bringatrailer\.com/listing/([^/?#]+)')),
                  a.source || ':' || coalesce(a.source_url, a.id::text)) AS lot_key,
         coalesce(a.auction_end_date, ve.sold_at, ve.ended_at) AS clock,
         CASE WHEN a.auction_end_date IS NOT NULL THEN 'auction_events.auction_end_date'
              WHEN ve.sold_at IS NOT NULL THEN 'vehicle_events.sold_at'
              WHEN ve.ended_at IS NOT NULL THEN 'vehicle_events.ended_at' END AS clock_source,
         public.ownership_fold_party(es.id) AS seller,
         public.ownership_fold_party(ew.id) AS winner,
         a.seller_external_identity_id AS seller_ref, a.winning_bidder_external_identity_id AS winner_ref
    FROM public.auction_events_canonical a
    -- only vehicles that exist (auction_events.vehicle_id has no foreign key: a merged or deleted vehicle leaves lots behind)
    JOIN public.vehicles pv ON pv.id = a.vehicle_id
    -- an identity id that is not in external_identities is an unkeyed party, never an owner
    LEFT JOIN public.external_identities es ON es.id = a.seller_external_identity_id
    LEFT JOIN public.external_identities ew ON ew.id = a.winning_bidder_external_identity_id
    LEFT JOIN LATERAL (
      SELECT v.sold_at, v.ended_at FROM public.vehicle_events v
       WHERE a.auction_end_date IS NULL AND a.source_url IS NOT NULL AND v.source_url = a.source_url
       ORDER BY v.sold_at NULLS LAST, v.ended_at NULLS LAST, v.id LIMIT 1) ve ON true
   WHERE a.vehicle_id = ANY (p_vehicle_ids)
), ranked AS (
  -- one lot recorded twice: the sold copy first, then the earliest
  SELECT r.*, row_number() OVER w AS dup_rn,
         first_value(r.is_sold) OVER w AS first_sold, first_value(r.seller) OVER w AS first_seller,
         first_value(r.winner) OVER w AS first_winner, first_value(r.lot_id) OVER w AS kept_lot
    FROM raw r
  WINDOW w AS (PARTITION BY r.vehicle_id, r.lot_key ORDER BY (NOT r.is_sold), r.clock NULLS LAST, r.lot_id)
), kept AS (
  SELECT k.*, count(*) OVER tc AS same_clock_lots, count(*) FILTER (WHERE k.is_sold) OVER tc AS same_clock_sold
    FROM ranked k WHERE k.dup_rn = 1
  WINDOW tc AS (PARTITION BY k.vehicle_id, k.clock)
), blocks AS (
  SELECT k.vehicle_id, 'duplicate_lot_conflict'::text AS reason, k.lot_id, jsonb_build_object('lot_key', k.lot_key, 'kept_lot', k.kept_lot) AS detail
    FROM ranked k WHERE k.dup_rn > 1 AND k.is_sold AND k.first_sold
     AND (k.seller IS DISTINCT FROM k.first_seller OR k.winner IS DISTINCT FROM k.first_winner)
  UNION ALL
  SELECT k.vehicle_id, 'no_event_clock', k.lot_id, jsonb_build_object('lot_key', k.lot_key) FROM kept k WHERE k.is_sold AND k.clock IS NULL
  UNION ALL
  SELECT k.vehicle_id, 'same_clock', k.lot_id, jsonb_build_object('lot_key', k.lot_key)
    FROM kept k WHERE k.is_sold AND k.clock IS NOT NULL AND k.same_clock_sold > 1
), blocked AS (SELECT DISTINCT b.vehicle_id FROM blocks b),
unordered AS (
  -- an unsold lot with no clock, or on the clock of another lot, cannot be placed: listed, not used as evidence
  SELECT k.vehicle_id, k.lot_id, k.lot_key, k.outcome, (k.clock IS NULL) AS undated
    FROM kept k WHERE NOT k.is_sold AND (k.clock IS NULL OR k.same_clock_lots > 1)
), ok AS (
  SELECT k.* FROM kept k
   WHERE NOT EXISTS (SELECT 1 FROM blocked b WHERE b.vehicle_id = k.vehicle_id)
     AND NOT (NOT k.is_sold AND (k.clock IS NULL OR k.same_clock_lots > 1))
), seq AS (
  -- every ordered lot, sold or not: the next listing is the evidence about what the sale did
  SELECT o.*, lead(o.lot_id) OVER v AS nxt_lot, lead(o.seller) OVER v AS nxt_seller
    FROM ok o
  WINDOW v AS (PARTITION BY o.vehicle_id ORDER BY o.clock, o.lot_id)
), judged AS (
  SELECT s.*,
         -- the same seller lists the vehicle again: the recorded sale did not hand it on
         coalesce(s.is_sold AND s.seller IS NOT NULL AND s.nxt_seller = s.seller AND s.seller IS DISTINCT FROM s.winner, false) AS denied,
         -- the winner lists it next: the sale is confirmed
         coalesce(s.is_sold AND s.winner IS NOT NULL AND s.nxt_seller = s.winner, false) AS confirmed_by_next
    FROM seq s
), sold_seq AS (
  SELECT j.*, row_number() OVER (PARTITION BY j.vehicle_id ORDER BY j.clock, j.lot_id) AS ns FROM judged j WHERE j.is_sold
), eff AS (
  -- the sales that handed the vehicle on, in order
  SELECT d.*, row_number() OVER v AS n,
         lag(d.lot_id) OVER v AS prev_lot, lag(d.winner) OVER v AS prev_winner,
         lead(d.lot_id) OVER v AS next_lot, lead(d.seller) OVER v AS next_seller,
         lead(d.clock) OVER v AS next_clock, lead(d.clock_source) OVER v AS next_clock_source
    FROM sold_seq d WHERE NOT d.denied
  WINDOW v AS (PARTITION BY d.vehicle_id ORDER BY d.clock, d.lot_id)
), last_eff AS (
  SELECT DISTINCT ON (e.vehicle_id) e.vehicle_id, e.lot_id, e.winner, e.ns FROM eff e ORDER BY e.vehicle_id, e.n DESC
), held_open AS (
  -- after the last sale that handed the vehicle on, a seller relisted it: that seller holds it now
  SELECT DISTINCT ON (d.vehicle_id) d.vehicle_id, d.lot_id, d.seller, le.lot_id AS le_lot, le.winner AS le_winner
    FROM sold_seq d LEFT JOIN last_eff le ON le.vehicle_id = d.vehicle_id
   WHERE d.denied AND d.ns > coalesce(le.ns, 0) AND le.winner IS DISTINCT FROM d.seller
   ORDER BY d.vehicle_id, d.ns DESC
), periods AS (
  -- the winner of an effective sale holds from its clock, until the next effective sale when its seller is the same identity
  SELECT s.vehicle_id, s.winner AS owner, 'acq:' || s.lot_id AS fold_key,
         s.clock AS start_at,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller = s.winner THEN s.next_clock END AS end_at,
         false AS start_unknown,
         ((s.next_lot IS NOT NULL AND s.next_seller IS DISTINCT FROM s.winner) OR h.lot_id IS NOT NULL) AS end_unknown,
         (s.next_lot IS NULL AND h.lot_id IS NULL) AS is_current,
         s.clock_source AS start_clock_source,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller = s.winner THEN s.next_clock_source END AS end_clock_source,
         s.lot_id AS acquired_via_lot_id,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller = s.winner THEN s.next_lot END AS disposed_via_lot_id,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller IS DISTINCT FROM s.winner
              THEN CASE WHEN s.next_seller IS NULL THEN 'party_unkeyed' ELSE 'handover_unobserved' END
              WHEN h.lot_id IS NOT NULL THEN 'handover_unobserved' END AS chain_flag,
         CASE WHEN s.next_lot IS NOT NULL AND s.next_seller IS DISTINCT FROM s.winner THEN s.next_lot
              WHEN h.lot_id IS NOT NULL THEN h.lot_id END AS chain_peer_lot_id,
         CASE WHEN s.confirmed_by_next OR (s.next_lot IS NOT NULL AND s.next_seller = s.winner)
              THEN 'confirmed_next_lot' ELSE 'recorded' END AS sale_confirmation,
         NULL::uuid AS listed_via_lot_id
    FROM eff s LEFT JOIN held_open h ON h.vehicle_id = s.vehicle_id AND s.next_lot IS NULL
   WHERE s.winner IS NOT NULL
  UNION ALL
  -- the seller of an effective sale held until its clock; its start is unknown unless it is the previous winner (already a period)
  SELECT s.vehicle_id, s.seller, 'sell:' || s.lot_id,
         NULL::timestamptz, s.clock, true, false, false,
         NULL::text, s.clock_source, NULL::uuid, s.lot_id,
         CASE WHEN s.n > 1 THEN CASE WHEN s.prev_winner IS NULL THEN 'party_unkeyed' ELSE 'handover_unobserved' END END,
         CASE WHEN s.n > 1 THEN s.prev_lot END, NULL::text, NULL::uuid
    FROM eff s WHERE s.seller IS NOT NULL AND (s.n = 1 OR s.prev_winner IS DISTINCT FROM s.seller)
  UNION ALL
  -- a seller who relisted after a sale that did not hand the vehicle on, with no effective sale after it
  SELECT h.vehicle_id, h.seller, 'held:' || h.lot_id,
         NULL::timestamptz, NULL::timestamptz, true, false, true,
         NULL::text, NULL::text, NULL::uuid, NULL::uuid,
         CASE WHEN h.le_lot IS NULL THEN NULL WHEN h.le_winner IS NULL THEN 'party_unkeyed' ELSE 'handover_unobserved' END,
         h.le_lot, NULL::text, h.lot_id
    FROM held_open h
), flags AS (
  SELECT k.vehicle_id, 'duplicate_lot'::text AS reason, k.lot_id, jsonb_build_object('lot_key', k.lot_key, 'kept_lot', k.kept_lot) AS detail
    FROM ranked k WHERE k.dup_rn > 1 AND k.is_sold AND k.first_sold
     AND k.seller IS NOT DISTINCT FROM k.first_seller AND k.winner IS NOT DISTINCT FROM k.first_winner
  UNION ALL SELECT b.vehicle_id, b.reason, b.lot_id, b.detail FROM blocks b
  UNION ALL
  SELECT j.vehicle_id, 'seller_is_winner', j.lot_id, jsonb_build_object('lot_key', j.lot_key)
    FROM judged j WHERE j.is_sold AND j.seller IS NOT NULL AND j.seller = j.winner
  UNION ALL
  SELECT j.vehicle_id, 'relist_same_seller', j.lot_id, jsonb_build_object('lot_key', j.lot_key, 'next_lot', j.nxt_lot)
    FROM judged j WHERE j.denied
  UNION ALL
  SELECT u.vehicle_id, 'unsold_lot_unordered', u.lot_id, jsonb_build_object('lot_key', u.lot_key, 'outcome', u.outcome, 'undated', u.undated)
    FROM unordered u
), skips AS (
  -- reported, never written: lots left behind by a vehicle that no longer exists, and identity ids that are not in external_identities
  SELECT a.vehicle_id, 'vehicle_missing'::text AS reason, a.id AS lot_id, jsonb_build_object('outcome', a.outcome) AS detail
    FROM public.auction_events_canonical a
   WHERE a.vehicle_id = ANY (p_vehicle_ids) AND NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = a.vehicle_id)
  UNION ALL
  SELECT r.vehicle_id, 'identity_missing', r.lot_id, jsonb_build_object('side', 'seller', 'identity', r.seller_ref)
    FROM raw r WHERE r.seller_ref IS NOT NULL AND r.seller IS NULL
  UNION ALL
  SELECT r.vehicle_id, 'identity_missing', r.lot_id, jsonb_build_object('side', 'winner', 'identity', r.winner_ref)
    FROM raw r WHERE r.winner_ref IS NOT NULL AND r.winner IS NULL
), clocked AS (
  SELECT k.vehicle_id, k.lot_id, k.clock, k.seller,
         lag(k.lot_id) OVER c AS p_lot, lag(k.is_sold) OVER c AS p_sold, lag(k.winner) OVER c AS p_winner,
         lag(k.seller) OVER c AS p_seller, lag(k.clock) OVER c AS p_clock
    FROM kept k WHERE k.clock IS NOT NULL
  WINDOW c AS (PARTITION BY k.vehicle_id ORDER BY k.clock, k.lot_id)
), links AS (
  -- how each lot relates to the lot before it, for every lot of every candidate vehicle: reported, never stored
  SELECT c.vehicle_id, c.lot_id,
         CASE WHEN c.p_lot IS NULL THEN 'first'
              WHEN c.p_clock = c.clock THEN 'date_error'
              WHEN NOT c.p_sold THEN 'prev_not_sold'
              WHEN c.p_winner IS NULL OR c.seller IS NULL THEN 'unkeyed'
              WHEN c.seller = c.p_winner THEN 'continuity'
              WHEN c.seller = c.p_seller THEN 'relist_same_seller'
              ELSE 'break' END AS state
    FROM clocked c
  UNION ALL
  SELECT k.vehicle_id, k.lot_id, 'undated' FROM kept k WHERE k.clock IS NULL
)
SELECT 'period'::text, p.vehicle_id, p.owner, p.fold_key, p.start_at, p.end_at, p.start_unknown, p.end_unknown, p.is_current,
       p.start_clock_source, p.end_clock_source, p.acquired_via_lot_id, p.disposed_via_lot_id, p.chain_flag, p.chain_peer_lot_id,
       p.sale_confirmation, p.listed_via_lot_id,
       md5(concat_ws('|', p.vehicle_id, p.owner, p.fold_key,
                     coalesce(extract(epoch FROM p.start_at)::text, '-'), coalesce(extract(epoch FROM p.end_at)::text, '-'),
                     p.start_unknown, p.end_unknown, p.is_current,
                     coalesce(p.start_clock_source, '-'), coalesce(p.end_clock_source, '-'),
                     coalesce(p.acquired_via_lot_id::text, '-'), coalesce(p.disposed_via_lot_id::text, '-'),
                     coalesce(p.chain_flag, '-'), coalesce(p.chain_peer_lot_id::text, '-'),
                     coalesce(p.sale_confirmation, '-'), coalesce(p.listed_via_lot_id::text, '-'))),
       NULL::text, NULL::uuid, NULL::jsonb
  FROM periods p
UNION ALL
SELECT 'flag', f.vehicle_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       f.reason, f.lot_id, f.detail
  FROM flags f
UNION ALL
SELECT 'skip', k.vehicle_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       k.reason, k.lot_id, k.detail
  FROM skips k
UNION ALL
SELECT 'link', l.vehicle_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       l.state, l.lot_id, NULL
  FROM links l
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_evq_shadow_evidence_v2(p uuid, p_asof timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(source_type text, n numeric, eff numeric, tr numeric)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '20s'
AS $function$
with v as (select * from public.vehicles where id = p),
d as (select coalesce(p_asof, now()) t0, p_asof is not null asof),
hl as (select t.source_type st, t.half_life_days h from public.vehicle_evidence_source_types t),
dec as (select 1),
ev as (select e.*, coalesce(e.sold_at, e.ended_at) ts from public.vehicle_events e, d
       where e.vehicle_id = p and (not d.asof or coalesce(e.sold_at, e.ended_at) < d.t0 - interval '1 day'))
select 'core_fields'::text, x, x, null::numeric from (select ((year between 1885 and 2028)::int + (nullif(trim(make),'') is not null)::int + (nullif(trim(model),'') is not null and length(model)<=80)::int)::numeric x from v) a
union all
select 'vin_identity', x, x, null from (select (coalesce(length(trim(vin)) = 17 or (length(trim(vin)) >= 8 and coalesce(year,0) < 1981), false))::int::numeric x from v) a
union all
select 'house_sale', count(*), count(*), null from ev e where coalesce(e.source_url,'') not ilike '%conceptcarz%'
  and cardinality(coalesce(e.source_suspect,'{}')) = 0 and e.event_status in ('sold','ended','unsold','no_sale')
union all
select 'house_lot_attach', count(*), count(*), null from ev e where cardinality(coalesce(e.source_suspect,'{}')) = 0
  and (e.extraction_run_id like 'agg_houselot%' or e.identity_check = 'match')
union all
select 'aggregator_flagged', count(*), count(*), null from ev e where cardinality(coalesce(e.source_suspect,'{}')) > 0
union all
select 'images', count(*), coalesce(sum(power(0.5, greatest(0, extract(epoch from (d.t0 - least(a.ts, d.t0))))/86400/(select h from hl where st='images'))),0), null
  from (select coalesce(i.taken_at, i.created_at) ts from public.vehicle_images i where i.vehicle_id = p and i.is_duplicate is not true and coalesce(i.is_superseded,false) = false limit 300) a, d
union all
select 'receipts', count(*), coalesce(sum(power(0.5, greatest(0, (d.t0::date - coalesce(r.receipt_date, r.transaction_date, r.created_at::date)))/(select h from hl where st='receipts'))),0), null
  from public.receipts r, d where r.vehicle_id = p and coalesce(r.is_superseded,false) = false and r.is_active is not false
   and (not d.asof or coalesce(r.receipt_date, r.transaction_date) is null or coalesce(r.receipt_date, r.transaction_date) <= d.t0::date)
union all
select 'cited_claims', count(*), coalesce(sum(case when g.half_life_days is null then 1 else power(0.5, greatest(0, extract(epoch from (d.t0 - least(coalesce(c.observed_at,c.created_at), d.t0))))/86400/g.half_life_days) end),0), avg(coalesce(g.base_trust,0.5))
  from public.evidence_claims c left join public.evidence_trust_registry g on g.id = c.trust_id, d
  where c.vehicle_id = p and coalesce(c.status,'') not in ('rejected','retired','superseded')
union all
select 'cited_observations', count(*), coalesce(sum(power(0.5, greatest(0, extract(epoch from (d.t0 - least(a.ts, d.t0))))/86400/(select h from hl where st='cited_observations'))),0), null
  from (select coalesce(o.observed_at,o.ingested_at) ts from public.vehicle_observations o where o.vehicle_id = p and coalesce(o.is_superseded,false) = false and o.source_url is not null limit 300) a, d
union all
select 'field_evidence', count(*), count(*), avg(c) from (
  select least(100,greatest(0,coalesce(f.source_confidence,50)))/100.0 c from public.field_evidence f where f.vehicle_id = p and coalesce(f.status,'') not in ('rejected','superseded')
  union all
  select least(100,greatest(0,coalesce(f.confidence_score,50)))/100.0 from public.vehicle_field_evidence f where f.vehicle_id = p and f.flagged_as_incorrect is not true) a
union all
select 'odometer', count(*), coalesce(sum(power(0.5, greatest(0, extract(epoch from (d.t0 - least(o.ts, d.t0))))/86400/(select h from hl where st='odometer'))),0), null
  from (select coalesce(a.auction_end_date, m.created_at) ts from public.auction_events_canonical a join public.auction_event_listing_mileage m on m.auction_event_id = a.id
          where a.vehicle_id = p and m.mileage_at_listing is not null
        union all
        select coalesce(e.sold_at, e.ended_at, m.created_at) from public.vehicle_events e join public.vehicle_event_listing_mileage m on m.vehicle_event_id = e.id
          where e.vehicle_id = p and coalesce(m.validation::text,'') not ilike '%reject%') o, d
  where not d.asof or o.ts <= d.t0 + interval '1 day'
union all
select 'fx_citation', count(*), count(*), null from ev e where upper(coalesce(e.currency_code,'USD')) <> 'USD' and e.fx_to_usd_source is not null
union all
select 'estimate', x, x, null from (select ((nuke_estimate is not null) or (current_value is not null))::int::numeric x from v) a
$function$;

CREATE OR REPLACE FUNCTION public.bat_pending_image_has_listing(p_vehicle_id uuid, p_exif jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.vehicles v
    JOIN public.auction_events_canonical e ON e.vehicle_id=v.id
    WHERE v.id=p_vehicle_id AND v.is_public IS TRUE
      AND e.source::text='bat'
      AND e.source_url ~* '^https://(www\.)?bringatrailer\.com/listing/[^/?#]+/?$'
      AND (
        (jsonb_typeof(p_exif->'listing_urls')='array'
          AND (p_exif->'listing_urls') ? e.source_url)
        OR rtrim(e.source_url,'/')=rtrim(p_exif->>'discovery_url','/')
        OR rtrim(e.source_url,'/')=rtrim(p_exif->>'source_url','/')
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.decayed_confidence(p_observation_id uuid)
 RETURNS TABLE(confidence_at_observation numeric, confidence_now numeric, family text, semantics text, half_life interval, is_open boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with o as (
    select vo.id, vo.source_id, vo.kind::text as kind, vo.extraction_method, vo.confidence_factors,
           vo.citation_document_id, vo.citation_secure_document_id, vo.citation_excerpt, vo.auction_event_id,
           coalesce(vo.source_event_at, vo.observed_at) as event_at
    from vehicle_observations vo where vo.id = p_observation_id
  ), x as (
    select o.*, f.family,
      case
        when o.citation_document_id is not null or o.citation_secure_document_id is not null then 1.00
        when o.citation_excerpt is not null then 0.95
        when o.confidence_factors ? 'agent_inferred_cap' or o.extraction_method ilike any (array['%llm%','%claude%','%byok%']) then 0.60
        when o.kind = 'comment' then 0.40
        else 0.90 end as m,
      -- open = linked auction still running; unlinked listings treated as open for 90 days (no listing-status column)
      case
        when o.kind in ('listing','bid','activity','offer') then
          case when ae.id is not null then (coalesce(ae.auction_end_date, 'infinity'::timestamptz) > now()
                                            and coalesce(ae.outcome,'') not in ('sold','not_sold','no_sale','withdrawn','ended','reserve_not_met'))
               when o.kind in ('listing','offer') then o.event_at > now() - interval '90 days'
               else false end
        else null end as is_open,
      case o.kind
        when 'listing' then (select default_half_life from field_families where family='price_ask')
        when 'offer' then (select default_half_life from field_families where family='price_ask')
        when 'bid' then (select default_half_life from field_families where family='market_live')
        when 'activity' then (select default_half_life from field_families where family='market_live')
        when 'condition' then (select default_half_life from field_families where family='condition')
        when 'sighting' then (select half_life from field_decay_rules where field_name='location')
        else null end as hl
    from o left join field_families f on o.kind = any(f.observation_kinds)
    left join public.auction_events_canonical ae on ae.id = o.auction_event_id
  ), b as (
    select x.*, round(coalesce(ct.trust_lb,0) * x.m, 4) as c0,
      case when x.kind in ('condition','sighting') then 'state'
           when x.is_open then 'open_market'
           else 'event' end as sem
    from x
    left join contributors c on c.source_id = x.source_id
    left join contributor_trust ct on ct.contributor_id = coalesce(c.canonical_contributor_id, c.id) and ct.family = x.family
  )
  select c0,
    case when sem = 'event' or hl is null or event_at is null then c0
         else round(c0 * power(2::numeric, -(extract(epoch from (now() - event_at)) / extract(epoch from hl))::numeric), 4) end,
    family, sem, case when sem = 'event' then null else hl end, is_open
  from b
$function$;

CREATE OR REPLACE FUNCTION public.record_market_source_day()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows integer;
  v_more integer;
  v_has_org_data boolean := (
    to_regclass('public.organization_vehicles') IS NOT NULL
    AND to_regclass('public.organization_seller_stats') IS NOT NULL
  );
  v_has_lots boolean := (
    to_regclass('public.auction_events') IS NOT NULL
    AND to_regclass('public.bat_seller_monitors') IS NOT NULL
    AND to_regclass('public.external_identities') IS NOT NULL
  );
  v_dealer_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_has_org_data THEN
    -- Dealer organizations: those linked to a dealer or shop source row, plus organizations sharing such a source's
    -- website host (a second row for the same dealer), plus the one id folded before hosts were compared.
    SELECT coalesce(array_agg(DISTINCT org_id), ARRAY[]::uuid[])
      INTO v_dealer_ids
      FROM (
        SELECT o.business_id AS org_id
        FROM public.observation_sources o
        WHERE o.business_id IS NOT NULL
          AND o.category::text IN ('dealer', 'shop')
        UNION
        SELECT b2.id
        FROM public.observation_sources o
        JOIN public.organizations b ON b.id = o.business_id
        JOIN public.organizations b2
          ON b2.id <> b.id
         AND lower(regexp_replace(b2.website, '^https?://(www\.)?([^/]+).*$', '\2')) =
             lower(regexp_replace(b.website, '^https?://(www\.)?([^/]+).*$', '\2'))
        WHERE o.business_id IS NOT NULL AND o.category::text IN ('dealer', 'shop')
          AND b.website IS NOT NULL AND b2.website IS NOT NULL
        UNION
        SELECT 'c3aa7ea2-565d-4e08-bf6f-6464dc04fe59'::uuid
        WHERE EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'michaels-motor-cars')
      ) x
     WHERE org_id IS NOT NULL;

    INSERT INTO public.market_source_days (
      day, source_slug, display_name, category, house, landed_lots, landed_at,
      population, population_method, population_confidence, population_at,
      map_sales, map_usd, sales_12m, usd_12m, sales_prior_12m, usd_prior_12m, months, recorded_at,
      venue_lots, venue_slug, members, species
    )
    WITH src AS (
      SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'))
             o.slug, o.display_name, o.category::text AS category,
             regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
             public.market_venue_label(o.slug) AS house,
             o.business_id
      FROM public.observation_sources o
      WHERE o.slug IS NOT NULL AND o.display_name IS NOT NULL
      ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'), (o.market_slug IS NOT NULL), o.created_at, o.slug
    ), d_orgs AS (
      SELECT DISTINCT org_id, nslug
      FROM (
        SELECT s.business_id AS org_id, s.nslug
        FROM src s
        WHERE s.business_id IS NOT NULL AND s.category IN ('dealer', 'shop')
        UNION ALL
        -- a second organization row for a registered dealer (same website host) folds into that dealer
        SELECT b2.id, s.nslug
        FROM src s
        JOIN public.organizations b ON b.id = s.business_id
        JOIN public.organizations b2
          ON b2.id <> b.id
         AND lower(regexp_replace(b2.website, '^https?://(www\.)?([^/]+).*$', '\2')) =
             lower(regexp_replace(b.website, '^https?://(www\.)?([^/]+).*$', '\2'))
        WHERE s.business_id IS NOT NULL AND s.category IN ('dealer', 'shop')
          AND b.website IS NOT NULL AND b2.website IS NOT NULL
        UNION ALL
        SELECT 'c3aa7ea2-565d-4e08-bf6f-6464dc04fe59'::uuid, 'michaelsmotorcars'
        WHERE EXISTS (SELECT 1 FROM src WHERE nslug = 'michaelsmotorcars')
      ) x
      WHERE org_id IS NOT NULL
    ), cen AS (
      SELECT regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
             c.universe_total, c.census_method, c.census_confidence, c.census_at,
             c.census_method IN ('owner_reference', 'catalogue_estimate', 'estimate') AS is_reference
      FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
      WHERE c.census_at < (current_date + 1)::timestamptz
        AND c.census_method NOT IN ('capture_model', 'turnover_model', 'window_extrapolated', 'docket_and_broadcast_census')
        AND NOT (c.census_method = 'unknown' AND c.universe_total IS NULL)
        AND (c.universe_total IS NULL OR c.universe_historical IS NOT NULL
             OR c.census_method IN ('enumerated', 'search_index', 'sitemap', 'bounded', 'api_count',
                                    'owner_reference', 'catalogue_estimate', 'estimate'))
    ), pop_direct AS (
      SELECT DISTINCT ON (nslug) nslug, universe_total, census_method, census_confidence, census_at
      FROM cen
      WHERE NOT is_reference
      ORDER BY nslug, (universe_total IS NOT NULL) DESC, census_at DESC
    ), lan AS (
      SELECT CASE regexp_replace(regexp_replace(lower(source_slug), '^www\.([a-z0-9-]+)\.(com|net|org)$', '\1'), '[^a-z0-9]', '', 'g')
               WHEN 'bringatrailer' THEN 'bat'
               WHEN 'classiccars' THEN 'classiccarscom'
               WHEN 'hagerty' THEN 'hagertymarketplace'
               WHEN 'sbx' THEN 'sbxcars'
               WHEN 'ebay' THEN 'ebaymotors'
               WHEN 'wwwoldcaronlinecom' THEN 'oldcaronline'
               WHEN 'wwwvanguardmotorsalescom' THEN 'vanguardmotorsales'
               WHEN 'wwwgatewayclassiccarscom' THEN 'gatewayclassiccars'
               WHEN 'wwwvelocityrestorationscom' THEN 'velocityrestorations'
               ELSE regexp_replace(regexp_replace(lower(source_slug), '^www\.([a-z0-9-]+)\.(com|net|org)$', '\1'), '[^a-z0-9]', '', 'g')
             END AS nslug,
             sum(landed_lots)::bigint AS landed_lots,
             max(measured_at) AS landed_at
      FROM public.mv_source_target_landed
      WHERE source_slug IS NOT NULL AND source_slug <> 'unknown' AND coalesce(landed_lots, 0) > 0
      GROUP BY 1
    ), dealer_ident AS MATERIALIZED (
      -- a dealer organization's BaT identity: its seller monitor's username, matched to the identity of that handle
      SELECT DISTINCT m.organization_id AS org_id, i.id AS ident_id, lower(i.handle) AS handle_lc
      FROM public.bat_seller_monitors m
      JOIN public.external_identities i ON i.platform = 'bat' AND lower(i.handle) = lower(m.seller_username)
      WHERE m.organization_id = ANY(v_dealer_ids)
    ), lot_keys AS MATERIALIZED (
      -- the lots a dealer identity (or, with no identity, its handle as a seller name) appears on, by listing slug,
      -- read through the seller-identity, open-seller-name and listing-slug indexes
      SELECT lower(substring(a.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) AS lot_key
      FROM public.auction_events_canonical a
      WHERE a.source IN ('bat', 'bringatrailer')
        AND a.seller_external_identity_id IN (SELECT ident_id FROM dealer_ident)
      UNION
      SELECT lower(substring(a.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)'))
      FROM public.auction_events_canonical a
      WHERE a.source IN ('bat', 'bringatrailer')
        AND a.seller_external_identity_id IS NULL AND a.seller_name IS NOT NULL
        AND lower(nullif(trim(a.seller_name), '')) IN (SELECT handle_lc FROM dealer_ident)
    ), lot_rows AS MATERIALIZED (
      -- every copy of those lots: auction_events can hold a lot twice (a url variant, or two vehicle rows folded from
      -- one lot)
      SELECT k.lot_key, a.vehicle_id,
             a.seller_external_identity_id AS sid, lower(nullif(trim(a.seller_name), '')) AS sname,
             a.auction_end_date, a.created_at, a.id
      FROM lot_keys k
      JOIN public.auction_events_canonical a
        ON lower(substring(a.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = k.lot_key
       AND a.source IN ('bat', 'bringatrailer')
    ), bat_lots AS MATERIALIZED (
      -- one row per lot, the copy that names a seller first, then the latest capture (the same rule the cohorts use)
      SELECT DISTINCT ON (lot_key) lot_key, sid, sname
      FROM lot_rows
      ORDER BY lot_key, (sid IS NOT NULL) DESC, (sname IS NOT NULL) DESC, auction_end_date DESC NULLS LAST, created_at DESC, id
    ), venue AS MATERIALIZED (
      -- the dealer's own BaT lots: the lot's seller is the dealer's identity (or, with no identity, its handle as a name)
      SELECT d.nslug, x.lot_key
      FROM (
        SELECT l.lot_key, di.org_id
        FROM bat_lots l JOIN dealer_ident di ON di.ident_id = l.sid
        UNION
        SELECT l.lot_key, di.org_id
        FROM bat_lots l JOIN dealer_ident di ON l.sid IS NULL AND di.handle_lc = l.sname
      ) x
      JOIN d_orgs d ON d.org_id = x.org_id
    ), venue_veh AS (
      -- every vehicle row a dealer lot sits on, so a lot captured on two vehicle rows keeps both out of held
      SELECT DISTINCT v.nslug, r.vehicle_id
      FROM venue v
      JOIN lot_rows r ON r.lot_key = v.lot_key
      WHERE r.vehicle_id IS NOT NULL
    ), venue_lan AS (
      SELECT nslug, count(DISTINCT lot_key)::bigint AS venue_lots FROM venue GROUP BY 1
    ), ov_lan AS (
      SELECT d.nslug,
             count(DISTINCT ov.vehicle_id)::bigint AS own_vehicles,
             count(*) FILTER (WHERE ov.listing_status = 'sold')::bigint AS ov_sold,
             max(ov.created_at) AS ov_at
      FROM d_orgs d
      JOIN public.organization_vehicles ov ON ov.organization_id = d.org_id
      WHERE NOT EXISTS (SELECT 1 FROM venue_veh v WHERE v.nslug = d.nslug AND v.vehicle_id = ov.vehicle_id)
      GROUP BY 1
    ), ss_lan AS (
      SELECT d.nslug,
             sum(ss.total_sold)::bigint AS total_sold,
             sum(ss.total_gross_sales)::numeric AS total_gross_sales,
             max(ss.calculated_at) AS calculated_at
      FROM d_orgs d
      JOIN public.organization_seller_stats ss ON ss.organization_id = d.org_id
      GROUP BY 1
    ), dv AS MATERIALIZED (
      SELECT DISTINCT ov.organization_id, ov.vehicle_id
      FROM public.organization_vehicles ov
      WHERE ov.organization_id = ANY(v_dealer_ids)
    ), dfam_raw AS MATERIALIZED (
      SELECT d.nslug,
             fs.vehicle_id,
             fs.sale_date,
             fs.usd::numeric AS usd
      FROM dv
      JOIN d_orgs d ON d.org_id = dv.organization_id
      JOIN public.mv_family_sales fs ON fs.vehicle_id = dv.vehicle_id
      WHERE fs.usd > 0 AND fs.sale_date <= current_date
    ), dov_sold_raw AS (
      SELECT d.nslug,
             coalesce(ov.sale_date, ov.created_at::date) AS sale_date,
             coalesce(ov.sale_price, 0)::numeric AS usd
      FROM d_orgs d
      CROSS JOIN LATERAL (
        SELECT ov.sale_date, ov.created_at, ov.sale_price
        FROM public.organization_vehicles ov
        WHERE ov.organization_id = d.org_id
          AND ov.listing_status = 'sold'
      ) ov
      WHERE d.nslug IN ('beverlyhillscarclub', 'lartdelautomobile')
    ), d_all_sales AS (
      SELECT nslug, sale_date, usd FROM dfam_raw
      UNION ALL
      SELECT nslug, sale_date, usd FROM dov_sold_raw
    ), dfam AS (
      SELECT nslug,
             count(*)::bigint AS map_sales,
             nullif(sum(usd) FILTER (WHERE usd > 0), 0) AS map_usd,
             count(*) FILTER (WHERE sale_date > current_date - 365)::bigint AS sales_12m,
             nullif(sum(usd) FILTER (WHERE sale_date > current_date - 365 AND usd > 0), 0) AS usd_12m,
             count(*) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365)::bigint AS sales_prior_12m,
             nullif(sum(usd) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365 AND usd > 0), 0) AS usd_prior_12m
      FROM d_all_sales
      WHERE sale_date IS NOT NULL AND sale_date <= current_date
      GROUP BY 1
    ), dmon AS (
      SELECT nslug,
             jsonb_agg(jsonb_build_array(to_char(m, 'YYYY-MM'), n, coalesce(u, 0)) ORDER BY m) AS months
      FROM (
        SELECT nslug,
               date_trunc('month', sale_date)::date AS m,
               count(*) AS n,
               sum(usd) FILTER (WHERE usd > 0) AS u
        FROM d_all_sales
        WHERE sale_date IS NOT NULL
          AND sale_date <= current_date
          AND sale_date >= (date_trunc('month', current_date) - interval '23 months')::date
        GROUP BY 1, 2
      ) x
      GROUP BY 1
    ), mapq AS (
      SELECT source_name AS house,
             count(*) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS sales,
             sum(sold_amount) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS usd
      FROM public.mv_treemap_outcomes
      WHERE source_name IS NOT NULL
      GROUP BY 1
    ), fam AS (
      SELECT source AS house,
             count(*) FILTER (WHERE sale_date > current_date - 365) AS sales_12m,
             sum(usd) FILTER (WHERE sale_date > current_date - 365) AS usd_12m,
             count(*) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS sales_prior_12m,
             sum(usd) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS usd_prior_12m
      FROM public.mv_family_sales
      WHERE source IS NOT NULL AND usd > 0 AND sale_date <= current_date
      GROUP BY 1
    ), mon AS (
      SELECT house, jsonb_agg(jsonb_build_array(to_char(m, 'YYYY-MM'), n, u) ORDER BY m) AS months
      FROM (SELECT source AS house, date_trunc('month', sale_date)::date AS m, count(*) AS n, sum(usd) AS u
            FROM public.mv_family_sales
            WHERE source IS NOT NULL AND usd > 0 AND sale_date <= current_date
              AND sale_date >= (date_trunc('month', current_date) - interval '23 months')::date
            GROUP BY 1, 2) x
      GROUP BY 1
    ), combined AS (
      SELECT s.slug,
             s.display_name,
             s.category,
             s.house,
             s.nslug,
             -- held: the fold's lots, else the vehicles a dealer holds that it did not sell through BaT
             CASE
               WHEN coalesce(l.landed_lots, 0) >= 500 THEN l.landed_lots
               ELSE nullif(GREATEST(coalesce(l.landed_lots, 0), coalesce(ov.own_vehicles, 0)), 0)
             END AS eff_landed_lots,
             coalesce(l.landed_at, ov.ov_at, ss.calculated_at) AS eff_landed_at,
             nullif(GREATEST(coalesce(mq.sales, 0), coalesce(df.map_sales, 0), coalesce(ss.total_sold, 0), coalesce(ov.ov_sold, 0)), 0) AS eff_map_sales,
             coalesce(mq.usd, df.map_usd, nullif(ss.total_gross_sales, 0)) AS eff_map_usd,
             coalesce(f.sales_12m, df.sales_12m) AS eff_sales_12m,
             coalesce(f.usd_12m, df.usd_12m) AS eff_usd_12m,
             coalesce(f.sales_prior_12m, df.sales_prior_12m) AS eff_sales_prior_12m,
             coalesce(f.usd_prior_12m, df.usd_prior_12m) AS eff_usd_prior_12m,
             coalesce(mo.months, dm.months) AS eff_months,
             nullif(vl.venue_lots, 0) AS eff_venue_lots
      FROM src s
      LEFT JOIN lan l ON l.nslug = s.nslug
      LEFT JOIN ov_lan ov ON ov.nslug = s.nslug
      LEFT JOIN venue_lan vl ON vl.nslug = s.nslug
      LEFT JOIN ss_lan ss ON ss.nslug = s.nslug
      LEFT JOIN dfam df ON df.nslug = s.nslug
      LEFT JOIN dmon dm ON dm.nslug = s.nslug
      LEFT JOIN mapq mq ON mq.house = s.house
      LEFT JOIN fam f ON f.house = s.house
      LEFT JOIN mon mo ON mo.house = s.house
    )
    SELECT current_date,
           c.slug,
           c.display_name,
           c.category,
           c.house,
           c.eff_landed_lots,
           c.eff_landed_at,
           coalesce(pd.universe_total, pr.universe_total),
           coalesce(pd.census_method, pr.census_method),
           coalesce(pd.census_confidence, pr.census_confidence)::numeric,
           coalesce(pd.census_at, pr.census_at),
           c.eff_map_sales,
           c.eff_map_usd,
           c.eff_sales_12m,
           c.eff_usd_12m,
           c.eff_sales_prior_12m,
           c.eff_usd_prior_12m,
           c.eff_months,
           now(),
           c.eff_venue_lots,
           CASE WHEN c.eff_venue_lots IS NOT NULL THEN 'bat' END,
           NULL,
           NULL
    FROM combined c
    LEFT JOIN pop_direct pd ON pd.nslug = c.nslug AND pd.universe_total >= coalesce(c.eff_landed_lots, 0)
    LEFT JOIN LATERAL (
      SELECT r.universe_total, r.census_method, r.census_confidence, r.census_at
      FROM cen r
      WHERE pd.nslug IS NULL
        AND r.nslug = c.nslug AND r.is_reference
        AND r.universe_total >= coalesce(c.eff_landed_lots, 0)
      ORDER BY r.census_at DESC
      LIMIT 1
    ) pr ON true
    WHERE coalesce(c.eff_landed_lots, 0) > 0 OR coalesce(c.eff_map_sales, 0) > 0 OR coalesce(c.eff_sales_12m, 0) > 0
       OR coalesce(c.eff_venue_lots, 0) > 0
    ON CONFLICT (day, source_slug) DO UPDATE SET
      display_name = EXCLUDED.display_name, category = EXCLUDED.category, house = EXCLUDED.house,
      landed_lots = EXCLUDED.landed_lots, landed_at = EXCLUDED.landed_at, population = EXCLUDED.population,
      population_method = EXCLUDED.population_method, population_confidence = EXCLUDED.population_confidence,
      population_at = EXCLUDED.population_at, map_sales = EXCLUDED.map_sales, map_usd = EXCLUDED.map_usd,
      sales_12m = EXCLUDED.sales_12m, usd_12m = EXCLUDED.usd_12m, sales_prior_12m = EXCLUDED.sales_prior_12m,
      usd_prior_12m = EXCLUDED.usd_prior_12m, months = EXCLUDED.months, recorded_at = EXCLUDED.recorded_at,
      venue_lots = EXCLUDED.venue_lots, venue_slug = EXCLUDED.venue_slug, members = EXCLUDED.members,
      species = EXCLUDED.species;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  ELSE
    INSERT INTO public.market_source_days (
      day, source_slug, display_name, category, house, landed_lots, landed_at,
      population, population_method, population_confidence, population_at,
      map_sales, map_usd, sales_12m, usd_12m, sales_prior_12m, usd_prior_12m, months, recorded_at
    )
    WITH src AS (
      SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'))
             o.slug, o.display_name, o.category::text AS category,
             regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
             public.market_venue_label(o.slug) AS house
      FROM public.observation_sources o
      WHERE o.slug IS NOT NULL AND o.display_name IS NOT NULL
      ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'), o.created_at, o.slug
    ), cen AS (
      SELECT regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
             c.universe_total, c.census_method, c.census_confidence, c.census_at,
             c.census_method IN ('owner_reference', 'catalogue_estimate', 'estimate') AS is_reference
      FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
      WHERE c.census_at < (current_date + 1)::timestamptz
        AND c.census_method NOT IN ('capture_model', 'turnover_model', 'window_extrapolated', 'docket_and_broadcast_census')
        AND NOT (c.census_method = 'unknown' AND c.universe_total IS NULL)
        AND (c.universe_total IS NULL OR c.universe_historical IS NOT NULL
             OR c.census_method IN ('enumerated', 'search_index', 'sitemap', 'bounded', 'api_count',
                                    'owner_reference', 'catalogue_estimate', 'estimate'))
    ), pop AS (
      SELECT DISTINCT ON (nslug) nslug, universe_total, census_method, census_confidence, census_at
      FROM cen
      WHERE NOT is_reference
      ORDER BY nslug, (universe_total IS NOT NULL) DESC, census_at DESC
    ), lan AS (
      SELECT CASE regexp_replace(regexp_replace(lower(source_slug), '^www\.([a-z0-9-]+)\.(com|net|org)$', '\1'), '[^a-z0-9]', '', 'g')
               WHEN 'bringatrailer' THEN 'bat'
               WHEN 'classiccars' THEN 'classiccarscom'
               WHEN 'hagerty' THEN 'hagertymarketplace'
               WHEN 'sbx' THEN 'sbxcars'
               WHEN 'ebay' THEN 'ebaymotors'
               WHEN 'wwwoldcaronlinecom' THEN 'oldcaronline'
               ELSE regexp_replace(regexp_replace(lower(source_slug), '^www\.([a-z0-9-]+)\.(com|net|org)$', '\1'), '[^a-z0-9]', '', 'g')
             END AS nslug,
             sum(landed_lots)::bigint AS landed_lots,
             max(measured_at) AS landed_at
      FROM public.mv_source_target_landed
      WHERE source_slug IS NOT NULL AND source_slug <> 'unknown' AND coalesce(landed_lots, 0) > 0
      GROUP BY 1
    ), mapq AS (
      SELECT source_name AS house,
             count(*) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS sales,
             sum(sold_amount) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS usd
      FROM public.mv_treemap_outcomes
      WHERE source_name IS NOT NULL
      GROUP BY 1
    ), fam AS (
      SELECT source AS house,
             count(*) FILTER (WHERE sale_date > current_date - 365) AS sales_12m,
             sum(usd) FILTER (WHERE sale_date > current_date - 365) AS usd_12m,
             count(*) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS sales_prior_12m,
             sum(usd) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS usd_prior_12m
      FROM public.mv_family_sales
      WHERE source IS NOT NULL AND usd > 0 AND sale_date <= current_date
      GROUP BY 1
    ), mon AS (
      SELECT house, jsonb_agg(jsonb_build_array(to_char(m, 'YYYY-MM'), n, u) ORDER BY m) AS months
      FROM (SELECT source AS house, date_trunc('month', sale_date)::date AS m, count(*) AS n, sum(usd) AS u
            FROM public.mv_family_sales
            WHERE source IS NOT NULL AND usd > 0 AND sale_date <= current_date
              AND sale_date >= (date_trunc('month', current_date) - interval '23 months')::date
            GROUP BY 1, 2) x
      GROUP BY 1
    )
    SELECT current_date, s.slug, s.display_name, s.category, s.house, l.landed_lots, l.landed_at,
           coalesce(p.universe_total, pr.universe_total),
           coalesce(p.census_method, pr.census_method),
           coalesce(p.census_confidence, pr.census_confidence),
           coalesce(p.census_at, pr.census_at),
           nullif(mq.sales, 0), mq.usd, f.sales_12m, f.usd_12m,
           f.sales_prior_12m, f.usd_prior_12m, mo.months, now()
    FROM src s
    LEFT JOIN lan l USING (nslug)
    LEFT JOIN pop p ON p.nslug = s.nslug AND p.universe_total >= coalesce(l.landed_lots, 0)
    LEFT JOIN LATERAL (
      SELECT r.universe_total, r.census_method, r.census_confidence, r.census_at
      FROM cen r
      WHERE p.nslug IS NULL
        AND r.nslug = s.nslug AND r.is_reference
        AND r.universe_total >= coalesce(l.landed_lots, 0)
      ORDER BY r.census_at DESC
      LIMIT 1
    ) pr ON true
    LEFT JOIN mapq mq ON mq.house = s.house
    LEFT JOIN fam f ON f.house = s.house
    LEFT JOIN mon mo ON mo.house = s.house
    WHERE coalesce(l.landed_lots, 0) > 0 OR coalesce(mq.sales, 0) > 0 OR coalesce(f.sales_12m, 0) > 0
    ON CONFLICT (day, source_slug) DO UPDATE SET
      display_name = EXCLUDED.display_name, category = EXCLUDED.category, house = EXCLUDED.house,
      landed_lots = EXCLUDED.landed_lots, landed_at = EXCLUDED.landed_at, population = EXCLUDED.population,
      population_method = EXCLUDED.population_method, population_confidence = EXCLUDED.population_confidence,
      population_at = EXCLUDED.population_at, map_sales = EXCLUDED.map_sales, map_usd = EXCLUDED.map_usd,
      sales_12m = EXCLUDED.sales_12m, usd_12m = EXCLUDED.usd_12m, sales_prior_12m = EXCLUDED.sales_prior_12m,
      usd_prior_12m = EXCLUDED.usd_prior_12m, months = EXCLUDED.months, recorded_at = EXCLUDED.recorded_at,
      venue_lots = NULL, venue_slug = NULL, members = NULL, species = NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;

  -- Private sellers: BaT sellers not registered as a dealer source, as count-only cohorts by lots. Each lot is read once
  -- from public.auction_events_canonical, the lot row, and its seller is that lot's own: the seller identity, else (only when the lot has
  -- none) its non-blank seller name. A reseller is a seller per lot. The lots with neither are recorded apart so the
  -- board shows how much of BaT names a seller at all. A dealer's lots, found by its monitored handle, stay out. No
  -- handle is written.
  IF v_has_lots THEN
    EXECUTE $cohorts$
      INSERT INTO public.market_source_days (
        day, source_slug, display_name, category, house, landed_lots, landed_at, recorded_at,
        venue_lots, venue_slug, members, species
      )
      WITH dealer_ident AS MATERIALIZED (
        SELECT DISTINCT i.id AS ident_id, lower(i.handle) AS handle_lc
        FROM public.bat_seller_monitors m
        JOIN public.external_identities i ON i.platform = 'bat' AND lower(i.handle) = lower(m.seller_username)
        WHERE m.organization_id = ANY($1)
      ), bat_lots AS MATERIALIZED (
        SELECT DISTINCT ON (lot_key) lot_key, sid, sname
        FROM (
          SELECT coalesce(lower(substring(a.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')), lower(a.source_url), a.id::text) AS lot_key,
                 a.seller_external_identity_id AS sid,
                 lower(nullif(trim(a.seller_name), '')) AS sname,
                 a.auction_end_date, a.created_at, a.id
          FROM public.auction_events_canonical a
          WHERE a.source IN ('bat', 'bringatrailer')
        ) z
        ORDER BY lot_key, (sid IS NOT NULL) DESC, (sname IS NOT NULL) DESC, auction_end_date DESC NULLS LAST, created_at DESC, id
      ), ev AS (
        SELECT CASE WHEN l.sid IS NOT NULL THEN 'id:' || l.sid::text
                    WHEN l.sname IS NOT NULL THEN 'h:' || l.sname END AS seller_key
        FROM bat_lots l
        WHERE NOT coalesce(l.sid IN (SELECT ident_id FROM dealer_ident)
                           OR (l.sid IS NULL AND l.sname IN (SELECT handle_lc FROM dealer_ident)), false)
      ), sellers AS (
        SELECT seller_key, count(*) AS lots
        FROM ev
        WHERE seller_key IS NOT NULL
        GROUP BY 1
      ), bands AS (
        SELECT CASE WHEN lots >= 50 THEN 1 WHEN lots >= 10 THEN 2 WHEN lots >= 2 THEN 3 ELSE 4 END AS band,
               count(*)::int AS members, sum(lots)::bigint AS lots
        FROM sellers GROUP BY 1
      ), rows_ AS (
        SELECT b.band, l.slug, l.name, b.members, b.lots
        FROM bands b
        JOIN (VALUES (1, 'bat-sellers-50-plus', 'Sellers with 50 or more BaT lots'),
                     (2, 'bat-sellers-10-49', 'Sellers with 10 to 49 BaT lots'),
                     (3, 'bat-sellers-2-9', 'Sellers with 2 to 9 BaT lots'),
                     (4, 'bat-sellers-1', 'Sellers with one BaT lot')) l(band, slug, name) ON l.band = b.band
        UNION ALL
        SELECT 5, 'bat-sellers-none', 'BaT lots with no seller recorded', 0, count(*)::bigint
        FROM ev WHERE seller_key IS NULL
      )
      SELECT current_date, r.slug, r.name, 'seller_cohort', NULL, r.lots, now(), now(),
             NULL, 'bat', r.members, 'private_seller'::public.source_species
      FROM rows_ r
      WHERE r.lots > 0
      ON CONFLICT (day, source_slug) DO UPDATE SET
        display_name = EXCLUDED.display_name, category = EXCLUDED.category, house = EXCLUDED.house,
        landed_lots = EXCLUDED.landed_lots, landed_at = EXCLUDED.landed_at, recorded_at = EXCLUDED.recorded_at,
        venue_lots = EXCLUDED.venue_lots, venue_slug = EXCLUDED.venue_slug, members = EXCLUDED.members,
        species = EXCLUDED.species
    $cohorts$ USING v_dealer_ids;
    GET DIAGNOSTICS v_more = ROW_COUNT;
    v_rows := v_rows + v_more;
  END IF;

  -- Owners: each owner_private source with the vehicles its observations cover. Counts only; the observations stay
  -- behind their own reads.
  IF to_regclass('public.vehicle_observations') IS NOT NULL THEN
    EXECUTE $owners$
      INSERT INTO public.market_source_days (
        day, source_slug, display_name, category, house, landed_lots, landed_at, recorded_at
      )
      SELECT current_date, o.slug, o.display_name, o.category::text, NULL, x.vehicles, x.last_at, now()
      FROM public.observation_sources o
      CROSS JOIN LATERAL (
        SELECT count(DISTINCT v.vehicle_id)::bigint AS vehicles, max(v.observed_at) AS last_at
        FROM public.vehicle_observations v WHERE v.source_id = o.id
      ) x
      WHERE o.species::text = 'owner_private' AND x.vehicles > 0
      ON CONFLICT (day, source_slug) DO UPDATE SET
        display_name = EXCLUDED.display_name, category = EXCLUDED.category, house = EXCLUDED.house,
        landed_lots = EXCLUDED.landed_lots, landed_at = EXCLUDED.landed_at, recorded_at = EXCLUDED.recorded_at
    $owners$;
    GET DIAGNOSTICS v_more = ROW_COUNT;
    v_rows := v_rows + v_more;
  END IF;

  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.family_price_index_pairs(p_brand text, p_family_key text, p_limit integer DEFAULT 20000)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH ids AS (
    SELECT vehicle_id FROM public.mv_family_sales
    WHERE brand = p_brand AND family_key = p_family_key AND family_key <> 'other'
      AND sale_date >= date '2016-01-01' AND sale_date <= current_date
  ), ev AS (
    SELECT e.vehicle_id, e.auction_end_date::date AS sale_date, e.winning_bid::numeric AS usd, e.source
    FROM public.auction_events_canonical e JOIN ids ON ids.vehicle_id = e.vehicle_id
    WHERE e.outcome = 'sold' AND e.winning_bid >= 500 AND e.auction_end_date >= date '2016-01-01'
      AND e.auction_end_date::date <= current_date
  ), rep AS (
    SELECT vehicle_id FROM ev GROUP BY vehicle_id HAVING count(*) >= 2
  ), page AS (
    SELECT ev.* FROM ev JOIN rep USING (vehicle_id) ORDER BY ev.vehicle_id, ev.sale_date, ev.usd LIMIT least(greatest(p_limit, 1), 20000)
  )
  SELECT jsonb_build_object(
    'n_vehicles', (SELECT count(*) FROM rep),
    'returned', (SELECT count(*) FROM page),
    'columns', jsonb_build_array('vehicle_id', 'sale_date', 'usd', 'source'),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_array(vehicle_id, sale_date, usd, source) ORDER BY vehicle_id, sale_date, usd) FROM page), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.get_comps_scored(p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 5, p_engine_type text DEFAULT NULL::text, p_transmission text DEFAULT NULL::text, p_drivetrain text DEFAULT NULL::text, p_mileage integer DEFAULT NULL::integer, p_trim text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, similarity_score numeric, score_breakdown jsonb, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  w_year        constant numeric := 15;
  w_model       constant numeric := 25;
  w_engine_cyl  constant numeric := 12;
  w_engine_cfg  constant numeric := 5;
  w_trans       constant numeric := 15;
  w_drivetrain  constant numeric := 10;
  w_mileage     constant numeric := 8;
  w_body        constant numeric := 5;
  w_trim_w      constant numeric := 5;

  ref_trans     text;
  ref_cyls      integer;
  ref_eng_cfg   text;
  ref_drive     text;
BEGIN
  ref_trans    := classify_transmission(p_transmission);
  ref_cyls     := extract_cylinder_count(p_engine_type);
  ref_eng_cfg  := extract_engine_config(p_engine_type);
  ref_drive    := classify_drivetrain(p_drivetrain);

  RETURN QUERY
  WITH auction_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      ae.winning_bid AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ae.source_url,
      ae.source, ae.auction_end_date,
      'auction_event'::text AS src_type,
      ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id)))) v
    JOIN public.auction_events_canonical ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND ae.winning_bid > 0
      AND ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ),
  vehicle_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      v.sale_price AS price, v.mileage, v.color,
      v.primary_image_url, v.location, v.listing_url AS source_url,
      NULL::text AS source,
      -- the sale's own date (UTC midnight), so a comp from 2010 reads as 2010, not as undated
      (COALESCE(v.sale_date, v.bat_sale_date)::timestamp AT TIME ZONE 'UTC') AS auction_end_date,
      'vehicle_record'::text AS src_type,
      COALESCE(v.sale_price_currency, v.currency_code) AS cur, COALESCE(v.sale_date, v.bat_sale_date) AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id)))) v
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND v.sale_price IS NOT NULL AND v.sale_price > 0
      -- price_verification: one shared rule (vehicle_sale_price_untrusted)
      AND NOT public.vehicle_sale_price_untrusted(v.id, v.sale_price)
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.auction_events_canonical ae2
        WHERE ae2.vehicle_id = v.id AND ae2.winning_bid > 0 AND ae2.outcome = 'sold'
      )
  ),
  raw_cands AS (
    SELECT * FROM auction_cands
    UNION ALL
    SELECT * FROM vehicle_cands
  ),
  -- native amount x sale-date USD rate (fx_usd_rate). NULL currency = legacy row, read as reported.
  conv_cands AS (
    SELECT r.*, r.price AS price_native, fx.rate AS fx_rate, fx.rate_date AS fx_rate_date,
      CASE WHEN r.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE fx.source END AS fx_source,
      CASE WHEN r.cur IS NULL THEN r.price::numeric ELSE round(r.price * fx.rate, 2) END AS price_usd
    FROM raw_cands r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  ),
  all_cands AS (
    SELECT * FROM conv_cands c
    WHERE (c.cur IS NULL OR c.fx_rate IS NOT NULL)   -- foreign amount with no rate: excluded, never read as USD
      AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
      AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ),
  scored AS (
    SELECT
      c.id AS vehicle_id,
      c.year AS yr,
      c.make AS mk,
      c.model AS mdl,
      c.trim AS tr,
      c.vin AS vi,
      c.price_usd AS sale_price,
      c.mileage AS miles,
      c.color AS clr,
      c.primary_image_url AS image_url,
      c.location AS loc,
      c.source_url AS listing_url,
      c.source AS platform,
      c.auction_end_date AS sold_date,
      c.src_type AS source_type,
      c.price_native, c.cur, c.fx_rate, c.fx_rate_date, c.fx_source,

      -- Year score
      (CASE WHEN p_year IS NOT NULL AND c.year IS NOT NULL
        THEN w_year * GREATEST(0, 1.0 - ABS(c.year - p_year)::numeric / GREATEST(LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50), 1))
        ELSE w_year * 0.5
      END) AS s_year,

      -- Model score
      (CASE
        WHEN p_model IS NULL THEN w_model * 0.5
        WHEN lower(c.model) = lower(p_model) THEN w_model
        WHEN length(public.model_spelling_key(p_model)) >= 2 AND public.model_spelling_key(c.model) = public.model_spelling_key(p_model) THEN w_model
        WHEN lower(c.model) LIKE '%' || lower(p_model) || '%' THEN w_model * 0.7
        WHEN lower(p_model) LIKE '%' || lower(c.model) || '%' THEN w_model * 0.6
        WHEN lower(c.model) LIKE '%' || lower(split_part(p_model, ' ', 1)) || '%' THEN w_model * 0.4
        ELSE 0
      END) AS s_model,

      -- Engine cylinder score
      (CASE
        WHEN ref_cyls IS NULL OR extract_cylinder_count(c.v_engine) IS NULL THEN w_engine_cyl * 0.3
        WHEN extract_cylinder_count(c.v_engine) = ref_cyls THEN w_engine_cyl
        WHEN ABS(extract_cylinder_count(c.v_engine) - ref_cyls) <= 2 THEN w_engine_cyl * 0.5
        ELSE 0
      END) AS s_engine_cyl,

      -- Engine config score
      (CASE
        WHEN ref_eng_cfg IS NULL OR extract_engine_config(c.v_engine) IS NULL THEN w_engine_cfg * 0.3
        WHEN extract_engine_config(c.v_engine) = ref_eng_cfg THEN w_engine_cfg
        ELSE 0
      END) AS s_engine_cfg,

      -- Transmission score
      (CASE
        WHEN ref_trans IS NULL OR classify_transmission(c.v_trans) IS NULL THEN w_trans * 0.3
        WHEN classify_transmission(c.v_trans) = ref_trans THEN w_trans
        ELSE 0
      END) AS s_trans,

      -- Drivetrain score
      (CASE
        WHEN ref_drive IS NULL OR classify_drivetrain(c.v_drive) IS NULL THEN w_drivetrain * 0.3
        WHEN classify_drivetrain(c.v_drive) = ref_drive THEN w_drivetrain
        WHEN classify_drivetrain(c.v_drive) IN ('4WD','AWD') AND ref_drive IN ('4WD','AWD') THEN w_drivetrain * 0.8
        ELSE 0
      END) AS s_drivetrain,

      -- Mileage score
      (CASE
        WHEN p_mileage IS NULL OR c.mileage IS NULL OR p_mileage = 0 THEN w_mileage * 0.3
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.2 THEN w_mileage
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.5 THEN w_mileage * 0.6
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 1.0 THEN w_mileage * 0.3
        ELSE 0
      END) AS s_mileage,

      -- Body style score
      (CASE
        WHEN p_body_style IS NULL OR c.v_body IS NULL THEN w_body * 0.3
        WHEN lower(c.v_body) = lower(p_body_style) THEN w_body
        WHEN lower(c.v_body) LIKE '%' || lower(p_body_style) || '%' THEN w_body * 0.6
        ELSE 0
      END) AS s_body,

      -- Trim score
      (CASE
        WHEN p_trim IS NULL OR c.trim IS NULL THEN w_trim_w * 0.3
        WHEN lower(c.trim) = lower(p_trim) THEN w_trim_w
        WHEN lower(c.trim) LIKE '%' || lower(p_trim) || '%' THEN w_trim_w * 0.6
        ELSE 0
      END) AS s_trim

    FROM all_cands c
  )
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    ROUND(s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim, 1) AS similarity_score,
    jsonb_build_object(
      'year', ROUND(s.s_year, 1),
      'model', ROUND(s.s_model, 1),
      'engine_cyl', ROUND(s.s_engine_cyl, 1),
      'engine_cfg', ROUND(s.s_engine_cfg, 1),
      'transmission', ROUND(s.s_trans, 1),
      'drivetrain', ROUND(s.s_drivetrain, 1),
      'mileage', ROUND(s.s_mileage, 1),
      'body_style', ROUND(s.s_body, 1),
      'trim', ROUND(s.s_trim, 1)
    ) AS score_breakdown,
    s.price_native::numeric AS sale_price_native, s.cur AS currency_code, s.fx_rate, s.fx_rate_date, s.fx_source
  FROM scored s
  ORDER BY
    (s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim) DESC,
    s.sold_date DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_comps_scored(p_basis price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 5, p_engine_type text DEFAULT NULL::text, p_transmission text DEFAULT NULL::text, p_drivetrain text DEFAULT NULL::text, p_mileage integer DEFAULT NULL::integer, p_trim text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, similarity_score numeric, score_breakdown jsonb, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text, price_basis text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  w_year        constant numeric := 15;
  w_model       constant numeric := 25;
  w_engine_cyl  constant numeric := 12;
  w_engine_cfg  constant numeric := 5;
  w_trans       constant numeric := 15;
  w_drivetrain  constant numeric := 10;
  w_mileage     constant numeric := 8;
  w_body        constant numeric := 5;
  w_trim_w      constant numeric := 5;

  ref_trans     text;
  ref_cyls      integer;
  ref_eng_cfg   text;
  ref_drive     text;
BEGIN
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  ref_trans    := classify_transmission(p_transmission);
  ref_cyls     := extract_cylinder_count(p_engine_type);
  ref_eng_cfg  := extract_engine_config(p_engine_type);
  ref_drive    := classify_drivetrain(p_drivetrain);

  RETURN QUERY
  WITH auction_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ae.source_url,
      ae.source, ae.auction_end_date,
      'auction_event'::text AS src_type,
      ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id))) and id <> all (array(select q.row_id from public.record_quarantine q where q.tbl = 'vehicles' and q.released_at is null))) v
    JOIN public.auction_events_canonical ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) > 0
      AND ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ),
  vehicle_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      (CASE p_basis WHEN 'hammer' THEN ve.hammer_price WHEN 'gross_incl_premium' THEN ve.gross_price WHEN 'net_to_owner' THEN ve.net_to_owner END) AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ve.source_url,
      COALESCE(public.event_resolved_platform(ve.id, ve.source_suspect), ve.source_platform) AS source,
      COALESCE(ve.sold_at, ve.ended_at) AS auction_end_date,
      'vehicle_event'::text AS src_type,
      NULL::text AS cur, COALESCE(ve.sold_at, ve.ended_at)::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id))) and id <> all (array(select q.row_id from public.record_quarantine q where q.tbl = 'vehicles' and q.released_at is null))) v
    JOIN vehicle_events ve ON ve.vehicle_id = v.id
      AND NOT coalesce(ve.sale_outcome is not null and ve.sale_outcome <> 'sold', false)
      AND (ve.source_suspect is null OR NOT public.vehicle_event_comp_excluded(ve.id, ve.source_suspect))
      AND NOT public.vehicle_event_low_trust(ve.id)  -- writer_source_trust: low unless corroborated
      AND ve.id <> all (array(select q.row_id from public.record_quarantine q where q.tbl = 'vehicle_events' and q.released_at is null))
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%')
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND ve.event_status = 'sold'
      AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted'
      AND (CASE p_basis WHEN 'hammer' THEN ve.hammer_price WHEN 'gross_incl_premium' THEN ve.gross_price WHEN 'net_to_owner' THEN ve.net_to_owner END) > 0
      AND v.deleted_at IS NULL
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.auction_events_canonical ae2
        WHERE ae2.vehicle_id = v.id AND ae2.outcome = 'sold' AND (CASE p_basis WHEN 'hammer' THEN ae2.hammer_price WHEN 'gross_incl_premium' THEN ae2.gross_price WHEN 'net_to_owner' THEN ae2.net_to_owner END) > 0
      )
  ),
  raw_cands AS (
    SELECT * FROM auction_cands
    UNION ALL
    SELECT * FROM vehicle_cands
  ),
  -- native amount x sale-date USD rate (fx_usd_rate). NULL currency = legacy row, read as reported.
  conv_cands AS (
    SELECT r.*, r.price AS price_native, fx.rate AS fx_rate, fx.rate_date AS fx_rate_date,
      CASE WHEN r.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE fx.source END AS fx_source,
      CASE WHEN r.cur IS NULL THEN r.price::numeric ELSE round(r.price * fx.rate, 2) END AS price_usd
    FROM raw_cands r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  ),
  all_cands AS (
    SELECT * FROM conv_cands c
    WHERE (c.cur IS NULL OR c.fx_rate IS NOT NULL)   -- foreign amount with no rate: excluded, never read as USD
      AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
      AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ),
  scored AS (
    SELECT
      c.id AS vehicle_id,
      c.year AS yr,
      c.make AS mk,
      c.model AS mdl,
      c.trim AS tr,
      c.vin AS vi,
      c.price_usd AS sale_price,
      c.mileage AS miles,
      c.color AS clr,
      c.primary_image_url AS image_url,
      c.location AS loc,
      c.source_url AS listing_url,
      c.source AS platform,
      c.auction_end_date AS sold_date,
      c.src_type AS source_type,
      c.price_native, c.cur, c.fx_rate, c.fx_rate_date, c.fx_source,

      -- Year score
      (CASE WHEN p_year IS NOT NULL AND c.year IS NOT NULL
        THEN w_year * GREATEST(0, 1.0 - ABS(c.year - p_year)::numeric / GREATEST(LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50), 1))
        ELSE w_year * 0.5
      END) AS s_year,

      -- Model score
      (CASE
        WHEN p_model IS NULL THEN w_model * 0.5
        WHEN lower(c.model) = lower(p_model) THEN w_model
        WHEN length(public.model_spelling_key(p_model)) >= 2 AND public.model_spelling_key(c.model) = public.model_spelling_key(p_model) THEN w_model
        WHEN lower(c.model) LIKE '%' || lower(p_model) || '%' THEN w_model * 0.7
        WHEN lower(p_model) LIKE '%' || lower(c.model) || '%' THEN w_model * 0.6
        WHEN lower(c.model) LIKE '%' || lower(split_part(p_model, ' ', 1)) || '%' THEN w_model * 0.4
        ELSE 0
      END) AS s_model,

      -- Engine cylinder score
      (CASE
        WHEN ref_cyls IS NULL OR extract_cylinder_count(c.v_engine) IS NULL THEN w_engine_cyl * 0.3
        WHEN extract_cylinder_count(c.v_engine) = ref_cyls THEN w_engine_cyl
        WHEN ABS(extract_cylinder_count(c.v_engine) - ref_cyls) <= 2 THEN w_engine_cyl * 0.5
        ELSE 0
      END) AS s_engine_cyl,

      -- Engine config score
      (CASE
        WHEN ref_eng_cfg IS NULL OR extract_engine_config(c.v_engine) IS NULL THEN w_engine_cfg * 0.3
        WHEN extract_engine_config(c.v_engine) = ref_eng_cfg THEN w_engine_cfg
        ELSE 0
      END) AS s_engine_cfg,

      -- Transmission score
      (CASE
        WHEN ref_trans IS NULL OR classify_transmission(c.v_trans) IS NULL THEN w_trans * 0.3
        WHEN classify_transmission(c.v_trans) = ref_trans THEN w_trans
        ELSE 0
      END) AS s_trans,

      -- Drivetrain score
      (CASE
        WHEN ref_drive IS NULL OR classify_drivetrain(c.v_drive) IS NULL THEN w_drivetrain * 0.3
        WHEN classify_drivetrain(c.v_drive) = ref_drive THEN w_drivetrain
        WHEN classify_drivetrain(c.v_drive) IN ('4WD','AWD') AND ref_drive IN ('4WD','AWD') THEN w_drivetrain * 0.8
        ELSE 0
      END) AS s_drivetrain,

      -- Mileage score
      (CASE
        WHEN p_mileage IS NULL OR c.mileage IS NULL OR p_mileage = 0 THEN w_mileage * 0.3
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.2 THEN w_mileage
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.5 THEN w_mileage * 0.6
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 1.0 THEN w_mileage * 0.3
        ELSE 0
      END) AS s_mileage,

      -- Body style score
      (CASE
        WHEN p_body_style IS NULL OR c.v_body IS NULL THEN w_body * 0.3
        WHEN lower(c.v_body) = lower(p_body_style) THEN w_body
        WHEN lower(c.v_body) LIKE '%' || lower(p_body_style) || '%' THEN w_body * 0.6
        ELSE 0
      END) AS s_body,

      -- Trim score
      (CASE
        WHEN p_trim IS NULL OR c.trim IS NULL THEN w_trim_w * 0.3
        WHEN lower(c.trim) = lower(p_trim) THEN w_trim_w
        WHEN lower(c.trim) LIKE '%' || lower(p_trim) || '%' THEN w_trim_w * 0.6
        ELSE 0
      END) AS s_trim

    FROM all_cands c
  )
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    ROUND(s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim, 1) AS similarity_score,
    jsonb_build_object(
      'year', ROUND(s.s_year, 1),
      'model', ROUND(s.s_model, 1),
      'engine_cyl', ROUND(s.s_engine_cyl, 1),
      'engine_cfg', ROUND(s.s_engine_cfg, 1),
      'transmission', ROUND(s.s_trans, 1),
      'drivetrain', ROUND(s.s_drivetrain, 1),
      'mileage', ROUND(s.s_mileage, 1),
      'body_style', ROUND(s.s_body, 1),
      'trim', ROUND(s.s_trim, 1)
    ) AS score_breakdown,
    s.price_native::numeric AS sale_price_native, s.cur AS currency_code, s.fx_rate, s.fx_rate_date, s.fx_source, p_basis::text
  FROM scored s
  ORDER BY
    (s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim) DESC,
    s.sold_date DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_auction_comps(p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '8s'
AS $function$
BEGIN
  RETURN QUERY
  WITH raw AS (
    SELECT v.id, v.year, v.make, v.model, v.trim, v.vin, ae.winning_bid, v.mileage, v.color,
           v.primary_image_url, v.location, ae.source_url, ae.source, ae.auction_end_date,
           ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id)))) v
    JOIN public.auction_events_canonical ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND (p_year_min IS NULL OR v.year >= p_year_min)
      AND (p_year_max IS NULL OR v.year <= p_year_max)
      AND ae.winning_bid > 0
      AND ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ), conv AS (
    SELECT r.*, fx.rate, fx.rate_date, fx.source AS fx_src,
           CASE WHEN r.cur IS NULL THEN r.winning_bid ELSE round(r.winning_bid * fx.rate, 2) END AS price_usd
    FROM raw r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  )
  SELECT c.id, c.year, c.make, c.model, c.trim, c.vin, c.price_usd, c.mileage, c.color,
         c.primary_image_url, c.location, c.source_url, c.source, c.auction_end_date,
         c.winning_bid, c.cur, c.rate, c.rate_date,
         CASE WHEN c.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE c.fx_src END
  FROM conv c
  WHERE (c.cur IS NULL OR c.rate IS NOT NULL)
    AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
    AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ORDER BY c.auction_end_date DESC NULLS LAST
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_auction_comps(p_basis price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text, price_basis text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '8s'
AS $function$
BEGIN
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  RETURN QUERY
  WITH raw AS (
    SELECT v.id, v.year, v.make, v.model, v.trim, v.vin, (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) AS winning_bid, v.mileage, v.color,
           v.primary_image_url, v.location, ae.source_url, ae.source, ae.auction_end_date,
           ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id)))) v
    JOIN public.auction_events_canonical ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND (p_year_min IS NULL OR v.year >= p_year_min)
      AND (p_year_max IS NULL OR v.year <= p_year_max)
      AND (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) > 0
      AND ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ), conv AS (
    SELECT r.*, fx.rate, fx.rate_date, fx.source AS fx_src,
           CASE WHEN r.cur IS NULL THEN r.winning_bid ELSE round(r.winning_bid * fx.rate, 2) END AS price_usd
    FROM raw r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  )
  SELECT c.id, c.year, c.make, c.model, c.trim, c.vin, c.price_usd, c.mileage, c.color,
         c.primary_image_url, c.location, c.source_url, c.source, c.auction_end_date,
         c.winning_bid, c.cur, c.rate, c.rate_date,
         CASE WHEN c.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE c.fx_src END,
         p_basis::text
  FROM conv c
  WHERE (c.cur IS NULL OR c.rate IS NOT NULL)
    AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
    AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ORDER BY c.auction_end_date DESC NULLS LAST
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_mecum_epoch_window_v1(p_run text, p_lo uuid, p_hi uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n_img int; n_ins int; n_amb int; n_zero int;
begin
  drop table if exists _m;
  create temp table _m on commit drop as
  with lots as (
    select a.id, a.vehicle_id, a.source_url, a.auction_end_date::date end_d
      from public.auction_events_canonical a
     where a.vehicle_id >= p_lo and a.vehicle_id < p_hi and a.source_url ilike '%mecum.com/lots/%'
  ), multi as (
    select vehicle_id from lots group by 1 having count(*) > 1 and count(*) filter (where end_d is null) = 0
  ), img as (
    select i.id, i.vehicle_id, i.image_url, substring(i.image_url from '/v(1[4-7]\d{8})/') ep
      from vehicle_images i join multi using (vehicle_id)
     where i.image_url ~* '(res\.cloudinary\.com/mecum/|images\.mecum\.com/)'
       and i.image_url ~ '/v1[4-7]\d{8}/'
       and not exists (select 1 from vehicle_image_listing_links l where l.image_id = i.id)
       and not exists (select 1 from vehicle_image_nonvehicle_flags f where f.image_id = i.id and f.retired_at is null)
  )
  select img.id image_id, img.vehicle_id, img.image_url, img.ep, to_timestamp(img.ep::bigint)::date up_d,
         (select count(*) from lots l where l.vehicle_id = img.vehicle_id) n_lots,
         (select count(*) from lots l where l.vehicle_id = img.vehicle_id and l.end_d between to_timestamp(img.ep::bigint)::date and to_timestamp(img.ep::bigint)::date + 150) hits,
         (select l.id from lots l where l.vehicle_id = img.vehicle_id and l.end_d between to_timestamp(img.ep::bigint)::date and to_timestamp(img.ep::bigint)::date + 150 limit 1) ev
    from img;
  select count(*), count(*) filter (where hits > 1), count(*) filter (where hits = 0) into n_img, n_amb, n_zero from _m;

  with ins as (
    insert into vehicle_image_listing_links (image_id, vehicle_id, auction_event_id, listing_url, method, confidence, cited_image_url,
           upload_month, listing_end_date, days_before_end, candidates, run_id, basis_key)
    select m.image_id, m.vehicle_id, a.id, a.source_url, 'mecum_upload_epoch_window', 'high', m.image_url,
           m.up_d, a.auction_end_date::date, a.auction_end_date::date - m.up_d, m.n_lots, p_run, m.ep
      from _m m join public.auction_events_canonical a on a.id = m.ev
     where m.hits = 1
    on conflict (image_id) do nothing
    returning vehicle_id
  ), q as (
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, p_run from ins on conflict (vehicle_id) do nothing returning 1
  )
  select count(*) into n_ins from ins;
  return jsonb_build_object('candidate_images', n_img, 'linked', n_ins, 'ambiguous', n_amb, 'no_lot_in_window', n_zero);
end $function$;

CREATE OR REPLACE FUNCTION public.link_bat_multi_month_window_v1(p_run text, p_lo uuid, p_hi uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n_img int; n_ins int; n_amb int; n_zero int;
begin
  drop table if exists _b;
  create temp table _b on commit drop as
  with lots as (
    select distinct on (a.vehicle_id, a.canonical_listing_url)
           a.id, a.vehicle_id, a.source_url, a.auction_end_date::date end_d
      from public.auction_events_canonical a
     where a.vehicle_id >= p_lo and a.vehicle_id < p_hi and a.source_url ilike '%bringatrailer.com/listing/%'
     order by a.vehicle_id, a.canonical_listing_url, (a.auction_end_date is null), a.created_at, a.id
  ), multi as (
    select vehicle_id from lots group by 1 having count(*) > 1 and count(*) filter (where end_d is null) = 0
  ), img as (
    select i.id, i.vehicle_id, i.image_url,
           to_date(substring(i.image_url from '/wp-content/uploads/(\d{4}/\d{2})/'), 'YYYY/MM') m
      from vehicle_images i join multi using (vehicle_id)
     where i.image_url ~* 'bringatrailer\.com/wp-content/uploads/\d{4}/\d{2}/'
       and not exists (select 1 from vehicle_image_listing_links l where l.image_id = i.id)
       and not exists (select 1 from vehicle_image_nonvehicle_flags f where f.image_id = i.id and f.retired_at is null)
  )
  select img.id image_id, img.vehicle_id, img.image_url, img.m,
         (select count(*) from lots l where l.vehicle_id = img.vehicle_id) n_lots,
         (select count(*) from lots l where l.vehicle_id = img.vehicle_id and l.end_d between img.m and img.m + 150) hits,
         (select l.id from lots l where l.vehicle_id = img.vehicle_id and l.end_d between img.m and img.m + 150 limit 1) ev
    from img;
  select count(*), count(*) filter (where hits > 1), count(*) filter (where hits = 0) into n_img, n_amb, n_zero from _b;
  with ins as (
    insert into vehicle_image_listing_links (image_id, vehicle_id, auction_event_id, listing_url, method, confidence, cited_image_url,
           upload_month, listing_end_date, days_before_end, candidates, run_id, basis_key)
    select b.image_id, b.vehicle_id, a.id, a.source_url, 'bat_multi_listing_month_window', 'high', b.image_url,
           b.m, a.auction_end_date::date, a.auction_end_date::date - b.m, b.n_lots, p_run, to_char(b.m,'YYYY/MM')
      from _b b join public.auction_events_canonical a on a.id = b.ev
     where b.hits = 1
    on conflict (image_id) do nothing
    returning vehicle_id
  ), q as (
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, p_run from ins on conflict (vehicle_id) do nothing returning 1
  )
  select count(*) into n_ins from ins;
  return jsonb_build_object('candidate_images', n_img, 'linked', n_ins, 'ambiguous', n_amb, 'no_listing_in_window', n_zero);
end $function$;

CREATE OR REPLACE FUNCTION public.read_broadcast_entity_profile(p_organization_id uuid, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'organization_id', org.id,
    'name', org.business_name,
    'slug', org.slug,
    'fold', org.broadcast_evidence_state,
    'proxy_unit', 'USD/nominal media second',
    'accepted_bid_velocity', NULL,
    'excitation', NULL,
    'derived_subject_claims', coalesce((
      WITH derived_claims AS MATERIALIZED (
        SELECT o.id, o.source_id, o.source_identifier, o.subject_organization_id,
               o.observed_at, o.ingested_at, o.structured_data, o.property_id
        FROM public.vehicle_observations o
        WHERE (o.source_id = (SELECT id FROM public.observation_sources WHERE slug = 'youtube')
               OR o.source_id IS NULL)
          AND o.subject_organization_id = org.id
          AND o.structured_data->>'kind_detail' = 'broadcast_profile_derived'
      )
      SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT * FROM derived_claims
        ORDER BY ingested_at DESC
        LIMIT greatest(1, least(p_limit, 100))
      ) x
    ), '[]'::jsonb),
    'presentations', coalesce((
      SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT e.id, e.vehicle_id, e.broadcast_evidence_state, e.broadcast_evidence_last_observation_id,
               public.broadcast_event_display_proxy(e.broadcast_evidence_state) AS sampled_display_regression_proxy
        FROM public.auction_events_canonical e
        WHERE e.broadcast_publisher_organization_id = org.id
          AND e.broadcast_evidence_state IS NOT NULL
        ORDER BY e.id
        LIMIT greatest(1, least(p_limit, 100))
      ) x
    ), '[]'::jsonb)
  )
  FROM public.organizations org
  WHERE org.id = p_organization_id AND org.is_public IS TRUE
$function$;

CREATE OR REPLACE FUNCTION public.actor_profile_read(p_kind text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
DECLARE
  v_now timestamptz := now();
  subject jsonb;
  sections jsonb := '[]'::jsonb;
  items jsonb;
  ids uuid[];
  is_org boolean := p_kind = 'organization';
  venue boolean := false;
  o record; e record; s record; k record; r record;
  -- selling from listing pages
  l_total int := 0; l_sold int := 0; l_unsold int := 0; l_last timestamptz; l_vehicle_ids uuid[];
  -- talking
  t_comments int := 0; t_lots int := 0; t_answers int := 0;
  -- bidding
  b_entered bigint; b_bids bigint; b_wins bigint; b_snap timestamptz;
  -- organization vehicles
  c_links int := 0; c_total int := 0; c_year int := 0; c_make int := 0; c_sold int := 0; c_sold_amt int := 0;
  c_held int := 0; c_held_cost int := 0; c_both int := 0; top_decades jsonb; top_makes jsonb; mkt_n numeric;
BEGIN
  IF p_kind = 'organization' THEN
    SELECT id, business_name, business_type, city, state, zip_code INTO o
      FROM public.organizations WHERE id = p_id AND is_public = true;
    IF NOT FOUND THEN RETURN NULL; END IF;
    venue := coalesce(o.business_type, '') IN ('auction_house', 'marketplace', 'platform');
    SELECT array_agg(DISTINCT ei.id) INTO ids
      FROM public.organization_external_profiles op
      JOIN public.external_identities ei ON ei.platform = 'bat' AND lower(ei.handle) = lower(op.username)
     WHERE op.organization_id = p_id AND op.platform IN ('bringatrailer', 'bat');
    subject := jsonb_build_object('kind', 'organization', 'id', o.id, 'name', o.business_name, 'type', o.business_type,
      'place', nullif(concat_ws(', ', nullif(o.city, ''), nullif(o.state, '')), ''), 'zip', o.zip_code, 'venue', venue,
      'handles', coalesce(array_length(ids, 1), 0));
  ELSIF p_kind = 'identity' THEN
    SELECT id, platform, handle, display_name INTO e FROM public.external_identities WHERE id = p_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT array_agg(id) INTO ids FROM public.external_identities WHERE platform = e.platform AND lower(handle) = lower(e.handle);
    subject := jsonb_build_object('kind', 'identity', 'id', e.id, 'name', coalesce(nullif(e.display_name, ''), e.handle),
      'type', e.platform, 'place', NULL, 'zip', NULL, 'handle', e.handle, 'venue', false,
      'handles', coalesce(array_length(ids, 1), 0));
  ELSE
    RETURN NULL;
  END IF;

  -- 1. Selling from the lot rows, for any actor with identities: one per listing page.
  IF ids IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE sold), count(*) FILTER (WHERE NOT sold AND ended), max(last_at)
      INTO l_total, l_sold, l_unsold, l_last
      FROM (SELECT lower(regexp_replace(regexp_replace(ae.source_url, '[?#].*$', ''), '/+$', '')) AS u,
                   bool_or(ae.outcome = 'sold') AS sold,
                   bool_or(ae.outcome IN ('reserve_not_met', 'bid_to', 'no_sale')) AS ended,
                   max(coalesce(ae.scraped_at, ae.updated_at)) AS last_at
              FROM public.auction_events_canonical ae
             WHERE ae.seller_external_identity_id = ANY (ids) AND ae.source_url IS NOT NULL
             GROUP BY 1) l;
    -- The vehicle records behind those lots (a duplicate record of one car counts as its own), for answers to bidders.
    SELECT array_agg(DISTINCT ae.vehicle_id) FILTER (WHERE ae.vehicle_id IS NOT NULL) INTO l_vehicle_ids
      FROM public.auction_events_canonical ae
     WHERE ae.seller_external_identity_id = ANY (ids) AND ae.source_url IS NOT NULL;
  END IF;

  items := '[]'::jsonb;
  IF l_total > 0 THEN
    items := items || jsonb_build_object(
      'label', 'Listings', 'unit', 'listings', 'value', l_total,
      'method', 'Bring a Trailer lots whose lot row names this actor''s handle as seller, one per listing page; a relist counts as its own listing; live lots count, without an outcome',
      'coverage', jsonb_build_object('n', l_total, 'of', l_total, 'grain', 'listing pages', 'as_of', l_last), 'rank', NULL);
    IF l_sold + l_unsold > 0 THEN
      items := items || jsonb_build_object(
        'label', 'Sell-through', 'unit', '%', 'value', round(100.0 * l_sold / (l_sold + l_unsold), 1),
        'method', 'sold ÷ (sold + ended without a sale: reserve not met, bid to, no sale) on listing pages with a recorded outcome; no peer rank until a per-seller fold exists',
        'coverage', jsonb_build_object('n', l_sold + l_unsold, 'of', l_total, 'grain', 'listings with a recorded outcome', 'as_of', l_last), 'rank', NULL);
    END IF;
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'performance', 'title', 'Selling',
      'coverage', jsonb_build_object('n', l_sold + l_unsold, 'of', l_total, 'grain', 'listings with a recorded outcome', 'as_of', l_last),
      'items', items);
  ELSIF is_org THEN
    -- Fallback for an organization with no linked identity: the organization's seller-stats fold.
    SELECT * INTO s FROM public.organization_seller_stats WHERE organization_id = p_id;
    IF FOUND AND coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0) > 0 THEN
      SELECT count(*) FILTER (WHERE c.st IS NOT NULL) AS n, count(*) FILTER (WHERE c.st < me.st) AS lt,
             bool_or(c.organization_id = p_id) AS in_cohort,
             count(*) FILTER (WHERE c.st IS NOT NULL AND c.bt IN ('', 'other')) AS untyped
        INTO k
        FROM (SELECT ss.organization_id, coalesce(po.business_type, '') AS bt, ss.total_sold::numeric / nullif(coalesce(ss.total_sold, 0) + coalesce(ss.total_unsold, 0), 0) AS st
                FROM public.organization_seller_stats ss
                JOIN public.organizations po ON po.id = ss.organization_id AND po.is_public = true
                     AND coalesce(po.business_type, '') NOT IN ('auction_house', 'marketplace', 'platform')
               WHERE coalesce(ss.total_sold, 0) + coalesce(ss.total_unsold, 0) >= 5) c
        CROSS JOIN (SELECT s.total_sold::numeric / nullif(coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0), 0) AS st) me;
      items := items || jsonb_build_object(
        'label', 'Sell-through', 'unit', '%',
        'value', round(100.0 * s.total_sold / (coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0)), 1),
        'method', 'sold ÷ (sold + unsold) on organization-attributed listings with a recorded outcome (listing_activity_v1); '
                  || coalesce(s.evidence_summary->>'outcome_conflicts', '0') || ' outcome and '
                  || coalesce(s.evidence_summary->>'identity_conflicts', '0') || ' identity conflicts in its inputs; '
                  || CASE WHEN k.in_cohort AND k.n >= 2
                          THEN 'ranked among ' || k.n || ' public selling organizations with five or more recorded outcomes, venues excluded; '
                               || k.untyped || ' of the ' || k.n || ' carry no business type, so this is not a dealer-only peer group'
                          ELSE 'not ranked: fewer than five recorded outcomes' END,
        'coverage', jsonb_build_object('n', coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0), 'of', coalesce(s.total_listings, 0),
                                       'grain', 'listings with a recorded outcome',
                                       'as_of', coalesce(s.evidence_summary->>'latest_input_extracted_at', s.calculated_at::text)),
        'rank', CASE WHEN k.in_cohort AND k.n >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt / (k.n - 1), 1), 'n', k.n) END);
    END IF;
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'performance', 'title', 'Selling',
      'coverage', jsonb_build_object('n', coalesce(s.total_sold, 0) + coalesce(s.total_unsold, 0), 'of', coalesce(s.total_listings, 0),
                                     'grain', 'listings with a recorded outcome',
                                     'as_of', coalesce(s.evidence_summary->>'latest_input_extracted_at', s.calculated_at::text)),
      'items', items);
  ELSE
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'performance', 'title', 'Selling',
      'coverage', jsonb_build_object('n', 0, 'of', 0, 'grain', 'listings', 'as_of', NULL), 'items', '[]'::jsonb);
  END IF;

  -- 2. Bidding (identity only): the dated snapshot, values without a percentile.
  IF NOT is_org THEN
    items := '[]'::jsonb;
    SELECT max(last_seen) INTO b_snap FROM public.mv_bidder_profiles;
    SELECT sum(auctions_entered), sum(total_bids), sum(wins) INTO b_entered, b_bids, b_wins
      FROM public.mv_bidder_profiles WHERE e.platform = 'bat' AND lower(bat_username) = lower(e.handle);
    IF coalesce(b_entered, 0) > 0 THEN
      SELECT count(*) AS n,
             count(*) FILTER (WHERE c.entered < b_entered) AS lt_entered,
             count(*) FILTER (WHERE c.wins < coalesce(b_wins, 0)) AS lt_wins,
             count(*) FILTER (WHERE c.wins::numeric / c.entered < coalesce(b_wins, 0)::numeric / b_entered) AS lt_rate
        INTO k
        FROM (SELECT sum(auctions_entered) AS entered, sum(wins) AS wins
                FROM public.mv_bidder_profiles GROUP BY lower(bat_username) HAVING sum(auctions_entered) >= 5) c;
      items := items || jsonb_build_object(
        'label', 'Auctions entered', 'unit', 'auctions', 'value', b_entered,
        'method', 'auctions the handle bid in, from the bidder profile snapshot, ranked among handles with five or more',
        'coverage', jsonb_build_object('n', b_entered, 'of', b_entered, 'grain', 'auctions entered', 'as_of', b_snap),
        'rank', CASE WHEN b_entered >= 5 AND k.n >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt_entered / (k.n - 1), 1), 'n', k.n) END);
      items := items || jsonb_build_object(
        'label', 'Wins', 'unit', 'auctions', 'value', coalesce(b_wins, 0),
        'method', 'auctions the handle won, from the bidder profile snapshot, ranked among handles with five or more auctions',
        'coverage', jsonb_build_object('n', b_entered, 'of', b_entered, 'grain', 'auctions entered', 'as_of', b_snap),
        'rank', CASE WHEN b_entered >= 5 AND k.n >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt_wins / (k.n - 1), 1), 'n', k.n) END);
      items := items || jsonb_build_object(
        'label', 'Win rate', 'unit', '%', 'value', round(100.0 * coalesce(b_wins, 0) / b_entered, 1),
        'method', 'wins ÷ auctions entered, from the bidder profile snapshot, ranked among handles with five or more auctions',
        'coverage', jsonb_build_object('n', b_entered, 'of', b_entered, 'grain', 'auctions entered', 'as_of', b_snap),
        'rank', CASE WHEN b_entered >= 5 AND k.n >= 2 THEN jsonb_build_object('p', round(100.0 * k.lt_rate / (k.n - 1), 1), 'n', k.n) END);
    END IF;
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'bidding', 'title', 'Bidding',
      'coverage', jsonb_build_object('n', coalesce(b_entered, 0), 'of', coalesce(b_entered, 0), 'grain', 'auctions entered in the bidder snapshot', 'as_of', b_snap),
      'items', items);
  END IF;

  -- 3. Talking: comments by the actor's identities; answers to bidders counted on its own listings only.
  IF ids IS NOT NULL THEN
    SELECT count(*), count(DISTINCT vehicle_id),
           count(*) FILTER (WHERE comment_type = 'seller_response' AND vehicle_id = ANY (coalesce(l_vehicle_ids, '{}'::uuid[])))
      INTO t_comments, t_lots, t_answers
      FROM public.auction_comments WHERE author_external_identity_id = ANY (ids);
    items := '[]'::jsonb;
    IF t_comments > 0 THEN
      items := items || jsonb_build_object(
        'label', 'Comments', 'unit', 'comments', 'value', t_comments,
        'method', 'auction comments attributed to this actor''s handle',
        'coverage', jsonb_build_object('n', t_lots, 'of', t_lots, 'grain', 'lots commented on', 'as_of', v_now), 'rank', NULL);
      IF l_total > 0 THEN
        items := items || jsonb_build_object(
          'label', 'Answers to bidders per listing', 'unit', 'answers', 'value', round(t_answers::numeric / l_total, 1),
          'method', 'seller responses on the actor''s own listed vehicles ÷ its listings',
          'coverage', jsonb_build_object('n', t_answers, 'of', t_comments, 'grain', 'comments that answer bidders on its listings', 'as_of', v_now), 'rank', NULL);
      END IF;
    END IF;
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'talking', 'title', 'Talking',
      'coverage', jsonb_build_object('n', t_comments, 'of', t_comments, 'grain', 'attributed comments', 'as_of', v_now),
      'items', items);
  END IF;

  IF NOT is_org THEN
    RETURN jsonb_build_object('subject', subject, 'viewer', 'anon', 'read_at', v_now, 'sections', sections);
  END IF;

  -- 4. Organization vehicles: specialization, open books, roles. A venue or a very large organization is not
  -- aggregated at read time.
  SELECT count(*) INTO c_links FROM public.organization_vehicles WHERE organization_id = p_id;
  IF venue OR c_links > 5000 THEN
    sections := sections || jsonb_build_object(
      'kind', 'measures', 'stack', 'specialization', 'title', 'What they handle',
      'coverage', jsonb_build_object('n', 0, 'of', c_links,
                                     'grain', CASE WHEN venue THEN 'vehicle links; a venue lists other sellers'' vehicles, not aggregated'
                                                   ELSE 'vehicle links; more than 5,000, not aggregated at read time' END,
                                     'as_of', v_now),
      'items', '[]'::jsonb);
    RETURN jsonb_build_object('subject', subject, 'viewer', 'anon', 'read_at', v_now, 'sections', sections);
  END IF;

  WITH av AS (
    SELECT ve.id,
           CASE WHEN ve.year BETWEEN 1885 AND 2100 THEN (ve.year / 10) * 10 END AS decade,
           nullif(lower(btrim(ve.make)), '') AS make,
           bool_or(ov.relationship_type = 'sold_by' OR ov.status IN ('sold', 'past')) AS sold,
           (coalesce(ve.sale_price, 0) > 0 OR coalesce(ve.sold_price, 0) > 0 OR coalesce(ve.bat_sold_price, 0) > 0) AS has_amount,
           coalesce(ve.purchase_price, 0) > 0 AS has_cost
      FROM public.organization_vehicles ov
      JOIN public.vehicles ve ON ve.id = ov.vehicle_id
     WHERE ov.organization_id = p_id
       AND ov.relationship_type IN ('owner', 'sold_by', 'consigner')
       AND ve.is_public = true AND ve.deleted_at IS NULL
     GROUP BY ve.id, ve.year, ve.make, ve.sale_price, ve.sold_price, ve.bat_sold_price, ve.purchase_price),
  dec AS (SELECT decade, count(*) AS n FROM av WHERE decade IS NOT NULL GROUP BY decade ORDER BY count(*) DESC, decade LIMIT 3),
  mk AS (SELECT make, count(*) AS n FROM av WHERE make IS NOT NULL GROUP BY make ORDER BY count(*) DESC, make LIMIT 3)
  SELECT count(*), count(decade), count(make),
         count(*) FILTER (WHERE sold), count(*) FILTER (WHERE sold AND has_amount),
         count(*) FILTER (WHERE NOT sold), count(*) FILTER (WHERE NOT sold AND has_cost),
         count(*) FILTER (WHERE has_amount AND has_cost),
         (SELECT jsonb_agg(jsonb_build_object('key', decade, 'n', n) ORDER BY n DESC, decade) FROM dec),
         (SELECT jsonb_agg(jsonb_build_object('key', make, 'n', n) ORDER BY n DESC, make) FROM mk)
    INTO c_total, c_year, c_make, c_sold, c_sold_amt, c_held, c_held_cost, c_both, top_decades, top_makes
    FROM av;

  items := '[]'::jsonb;
  IF top_decades IS NOT NULL THEN
    SELECT sum(count) INTO mkt_n FROM public.market_pulse('year', 300) WHERE name ~ '^[0-9]{4}$' AND name::int BETWEEN 1885 AND 2100;
    FOR r IN
      SELECT (d->>'key')::int AS decade, (d->>'n')::int AS n,
             (SELECT sum(count) FROM public.market_pulse('year', 300) m
               WHERE m.name ~ '^[0-9]{4}$' AND (m.name::int / 10) * 10 = (d->>'key')::int) AS mkt
        FROM jsonb_array_elements(top_decades) d
    LOOP
      IF coalesce(r.mkt, 0) > 0 AND coalesce(mkt_n, 0) > 0 THEN
        items := items || jsonb_build_object(
          'label', r.decade::text || 's', 'unit', '× market', 'value', round((r.n::numeric / c_year) / (r.mkt / mkt_n), 1),
          'method', 'share of the organization''s public vehicles from the decade ÷ the decade''s share of public vehicle records (market_pulse year counts)',
          'coverage', jsonb_build_object('n', r.n, 'of', c_year, 'grain', 'vehicles with a year', 'as_of', v_now), 'rank', NULL);
      END IF;
    END LOOP;
  END IF;
  IF top_makes IS NOT NULL THEN
    SELECT sum(count) INTO mkt_n FROM public.market_pulse('make', 400) WHERE lower(btrim(name)) <> 'unresolved';
    FOR r IN
      SELECT d->>'key' AS make, (d->>'n')::int AS n,
             (SELECT sum(count) FROM public.market_pulse('make', 400) m WHERE lower(btrim(m.name)) = d->>'key') AS mkt
        FROM jsonb_array_elements(top_makes) d
    LOOP
      IF coalesce(r.mkt, 0) > 0 AND coalesce(mkt_n, 0) > 0 THEN
        items := items || jsonb_build_object(
          'label', initcap(r.make), 'unit', '× market', 'value', round((r.n::numeric / c_make) / (r.mkt / mkt_n), 1),
          'method', 'share of the organization''s public vehicles of the make ÷ the make''s share of public vehicle records (market_pulse make counts)',
          'coverage', jsonb_build_object('n', r.n, 'of', c_make, 'grain', 'vehicles with a make', 'as_of', v_now), 'rank', NULL);
      END IF;
    END LOOP;
  END IF;
  sections := sections || jsonb_build_object(
    'kind', 'measures', 'stack', 'specialization', 'title', 'What they handle',
    'coverage', jsonb_build_object('n', c_year, 'of', c_total, 'grain', 'public vehicles linked as owner, seller or consigner', 'as_of', v_now),
    'items', items);

  items := '[]'::jsonb;
  IF c_sold > 0 THEN
    items := items || jsonb_build_object(
      'label', 'Sales with a recorded amount', 'unit', '%', 'value', round(100.0 * c_sold_amt / c_sold, 1),
      'method', 'sold vehicles whose record carries a sale amount (sale, sold or auction result price); amounts are not shown',
      'coverage', jsonb_build_object('n', c_sold_amt, 'of', c_sold, 'grain', 'sold vehicles', 'as_of', v_now), 'rank', NULL);
  END IF;
  IF c_held > 0 THEN
    items := items || jsonb_build_object(
      'label', 'Holdings with a recorded cost', 'unit', '%', 'value', round(100.0 * c_held_cost / c_held, 1),
      'method', 'held vehicles whose record carries an acquisition cost; amounts are not shown',
      'coverage', jsonb_build_object('n', c_held_cost, 'of', c_held, 'grain', 'held vehicles', 'as_of', v_now), 'rank', NULL);
  END IF;
  IF c_total > 0 THEN
    items := items || jsonb_build_object(
      'label', 'Return computable', 'unit', 'vehicles', 'value', c_both,
      'method', 'vehicles whose record carries both an acquisition cost and a sale amount',
      'coverage', jsonb_build_object('n', c_both, 'of', c_total, 'grain', 'public vehicles', 'as_of', v_now), 'rank', NULL);
  END IF;
  sections := sections || jsonb_build_object(
    'kind', 'measures', 'stack', 'open_books', 'title', 'Open books',
    'coverage', jsonb_build_object('n', c_sold_amt + c_held_cost, 'of', c_total, 'grain', 'public vehicles with money recorded', 'as_of', v_now),
    'items', items);

  SELECT coalesce(jsonb_agg(jsonb_build_array(
           jsonb_build_object('value', t.role, 'source', jsonb_build_object('kind', 'legacy', 'label', 'organization_vehicles'), 'observed_at', NULL, 'trust', 1),
           jsonb_build_object('value', t.active, 'source', jsonb_build_object('kind', 'legacy', 'label', 'organization_vehicles'), 'observed_at', NULL, 'trust', 1),
           jsonb_build_object('value', t.other, 'source', jsonb_build_object('kind', 'legacy', 'label', 'organization_vehicles'), 'observed_at', NULL, 'trust', 1))
           ORDER BY t.active + t.other DESC, t.role), '[]'::jsonb),
         coalesce(sum(t.active + t.other), 0)
    INTO items, c_links
    FROM (SELECT ov.relationship_type AS role,
                 count(*) FILTER (WHERE ov.status = 'active') AS active,
                 count(*) FILTER (WHERE ov.status IS DISTINCT FROM 'active') AS other
            FROM public.organization_vehicles ov
            JOIN public.vehicles ve ON ve.id = ov.vehicle_id AND ve.is_public = true AND ve.deleted_at IS NULL
           WHERE ov.organization_id = p_id
           GROUP BY ov.relationship_type) t;
  sections := sections || jsonb_build_object(
    'kind', 'table', 'title', 'Vehicles by role',
    'coverage', jsonb_build_object('n', c_links, 'of', c_links, 'grain', 'links to public vehicles', 'as_of', v_now),
    'columns', jsonb_build_array('Role', 'Active', 'Past or sold'),
    'rows', items);

  RETURN jsonb_build_object('subject', subject, 'viewer', 'anon', 'read_at', v_now, 'sections', sections);
END;
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_lot_chain(p_vehicle_id uuid)
 RETURNS TABLE(seq integer, lot_id uuid, source_url text, ended_at timestamp with time zone, ended_at_source text, outcome text, winner_identity_id uuid, seller_identity_id uuid, same_lot_rows integer, link text, evidence_kind text, equivalence_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH raw AS (
    SELECT ae.id, ae.source_url,
           coalesce(lower(substring(ae.source_url from 'bringatrailer\.com/listing/([^/?#]+)')), ae.source_url) AS lot_key,
           ae.outcome, ae.winning_bidder_external_identity_id AS win_id, ae.seller_external_identity_id AS sel_id,
           coalesce(ae.auction_end_date, ve.ended_at, ve.sold_at) AS end_at,
           CASE WHEN ae.auction_end_date IS NOT NULL THEN 'auction_events'
                WHEN ve.ended_at IS NOT NULL OR ve.sold_at IS NOT NULL THEN 'vehicle_events' END AS end_src
      FROM public.auction_events_canonical ae
      LEFT JOIN LATERAL (
        SELECT e.ended_at, e.sold_at FROM public.vehicle_events e
         WHERE ae.auction_end_date IS NULL AND e.source_url = ae.source_url AND e.source_platform = 'bat' LIMIT 1) ve ON true
     WHERE ae.vehicle_id = p_vehicle_id AND ae.source = 'bat'),
  lots AS (
    SELECT DISTINCT ON (lot_key) r.*, count(*) OVER (PARTITION BY lot_key)::integer AS n_rows
      FROM raw r
     ORDER BY lot_key, (win_id IS NOT NULL)::int + (sel_id IS NOT NULL)::int DESC, id),
  ord AS (
    SELECT l.*, row_number() OVER w AS rn,
           lag(id) OVER w AS prev_id, lag(end_at) OVER w AS prev_end, lag(outcome) OVER w AS prev_outcome,
           lag(win_id) OVER w AS prev_win, lag(sel_id) OVER w AS prev_sel
      FROM lots l WINDOW w AS (ORDER BY end_at, id)),
  cls AS (
    SELECT o.*, CASE
      WHEN o.prev_id IS NULL THEN 'first'
      WHEN o.end_at IS NULL OR o.prev_end IS NULL THEN 'undated'
      WHEN o.end_at <= o.prev_end THEN 'date_error'
      WHEN o.prev_outcome IS DISTINCT FROM 'sold' THEN 'prev_not_sold'
      WHEN o.prev_win IS NULL THEN 'prev_winner_unkeyed'
      WHEN o.sel_id IS NULL THEN 'seller_unkeyed'
      WHEN o.prev_win = o.sel_id THEN 'continuity'
      WHEN o.prev_sel = o.sel_id THEN 'relist_same_seller'
      ELSE 'break' END AS link
      FROM ord o)
  SELECT c.rn::integer, c.id, c.source_url, c.end_at, c.end_src, c.outcome, c.win_id, c.sel_id, c.n_rows, c.link,
         CASE c.link
           WHEN 'relist_same_seller' THEN 'same_seller_relist'
           WHEN 'break' THEN coalesce(q.evidence_kind, 'unexplained') END,
         q.id
    FROM cls c
    LEFT JOIN LATERAL (
      SELECT e.id, e.evidence_kind FROM public.identity_equivalences e
       WHERE c.link = 'break' AND e.superseded_by IS NULL
         AND e.identity_a = least(c.prev_win, c.sel_id) AND e.identity_b = greatest(c.prev_win, c.sel_id)
       ORDER BY array_position(ARRAY['claimed_user', 'monitor_organization', 'lot_text_purchase', 'buyer_comment'], e.evidence_kind),
                e.recorded_at
       LIMIT 1) q ON true
   ORDER BY c.rn
$function$;
