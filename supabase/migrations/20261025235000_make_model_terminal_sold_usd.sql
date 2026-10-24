-- get_make_model_terminal: comps/price/flow/points count SOLD events only (bid-goes-on / unsold high bids are
-- not comps) and report prices in USD (non-USD events via vehicle_events.fx_to_usd; rows without a rate are
-- left out rather than mixed in as if USD). Rollback: supabase/rollbacks/20261025233000_make_model_terminal_sold_usd_down.sql
CREATE OR REPLACE FUNCTION public.get_make_model_terminal(p_make text, p_model text, p_year integer DEFAULT NULL::integer, p_grain text DEFAULT 'year'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_subject uuid; v_ids uuid[]; v_count int; v_canon_model text;
  v_price jsonb; v_flow jsonb; v_sentiment jsonb; v_production jsonb;
  v_survival jsonb; v_comps jsonb; v_dealers jsonb; v_cited jsonb; v_points jsonb;
BEGIN
  SELECT cm.canonical_model INTO v_canon_model FROM public.canonical_models cm
  WHERE lower(cm.make) = lower(p_make)
    AND (lower(cm.canonical_model) = lower(p_model) OR lower(p_model) = ANY (SELECT lower(a) FROM unnest(cm.aliases) a))
  LIMIT 1;
  v_canon_model := COALESCE(v_canon_model, p_model);

  SELECT subject_id INTO v_subject FROM public.make_model_profiles
   WHERE lower(canonical_make) = lower(p_make) AND lower(canonical_model) = lower(v_canon_model)
     AND grain = p_grain AND (p_grain <> 'year' OR year = p_year) LIMIT 1;
  IF v_subject IS NULL THEN
    RETURN jsonb_build_object('resolved', false,
      'note', 'No make_model subject registered yet — call register_make_model_subject(). Absence is an intake gap, not a market verdict.');
  END IF;

  -- definer: the cohort is what a visitor may see (public, not deleted), stated here instead of left to row
  -- security, whose per-row checks on vehicles pushed the visitor call past the 15 s limit (2026-09-28)
  SELECT array_agg(cm.vehicle_id) INTO v_ids
  FROM public.cohort_members(v_subject) cm JOIN public.vehicles v ON v.id = cm.vehicle_id
  WHERE v.is_public AND v.deleted_at IS NULL;
  v_count := COALESCE(array_length(v_ids, 1), 0);

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events.final_price (sold, USD via fx_to_usd)',
           'method', 'cohort_aggregate', 'n', count(*),
           'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY (CASE WHEN coalesce(upper(ve.currency_code), 'USD') = 'USD' THEN ve.final_price ELSE round(ve.final_price * ve.fx_to_usd) END)),
           'p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY (CASE WHEN coalesce(upper(ve.currency_code), 'USD') = 'USD' THEN ve.final_price ELSE round(ve.final_price * ve.fx_to_usd) END)),
           'p75', percentile_cont(0.75) WITHIN GROUP (ORDER BY (CASE WHEN coalesce(upper(ve.currency_code), 'USD') = 'USD' THEN ve.final_price ELSE round(ve.final_price * ve.fx_to_usd) END)),
           'min', min((CASE WHEN coalesce(upper(ve.currency_code), 'USD') = 'USD' THEN ve.final_price ELSE round(ve.final_price * ve.fx_to_usd) END)), 'max', max((CASE WHEN coalesce(upper(ve.currency_code), 'USD') = 'USD' THEN ve.final_price ELSE round(ve.final_price * ve.fx_to_usd) END)), 'currency', 'USD', 'observed_at', now())
    INTO v_price FROM public.vehicle_events ve
  WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0
    AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted' AND ve.sale_truth_role IS DISTINCT FROM 'duplicate'
    -- sold only (a high bid on an unsold lot is not a comp); non-USD only when it has an fx_to_usd rate
    AND ve.event_status = 'sold' AND (coalesce(upper(ve.currency_code), 'USD') = 'USD' OR ve.fx_to_usd IS NOT NULL);

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events', 'method', 'quarterly_flow',
           'series', COALESCE(jsonb_agg(jsonb_build_object('quarter', q, 'sales', n, 'median_price', med) ORDER BY q), '[]'::jsonb))
    INTO v_flow FROM (
    SELECT date_trunc('quarter', COALESCE(ve.sold_at, ve.ended_at)) AS q, count(*) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY (CASE WHEN coalesce(upper(ve.currency_code), 'USD') = 'USD' THEN ve.final_price ELSE round(ve.final_price * ve.fx_to_usd) END)) AS med
    FROM public.vehicle_events ve WHERE ve.vehicle_id = ANY (v_ids)
      AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL AND ve.final_price IS NOT NULL AND ve.final_price > 0
    AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted' AND ve.sale_truth_role IS DISTINCT FROM 'duplicate'
    -- sold only (a high bid on an unsold lot is not a comp); non-USD only when it has an fx_to_usd rate
    AND ve.event_status = 'sold' AND (coalesce(upper(ve.currency_code), 'USD') = 'USD' OR ve.fx_to_usd IS NOT NULL)
    GROUP BY 1) s;

  -- price_points: the HONEST full set — every priced cohort sale, UNCAPPED, source + date(-exact?).
  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events.final_price (uncapped per-sale)',
           'n', count(*), 'n_dated', count(*) FILTER (WHERE date_exact),
           'points', COALESCE(jsonb_agg(jsonb_build_object('vehicle_id', vehicle_id, 'price', price, 'date', d,
                       'date_exact', date_exact, 'source', source, 'miles', miles, 'url', url) ORDER BY price), '[]'::jsonb))
    INTO v_points FROM (
    SELECT ve.vehicle_id, (CASE WHEN coalesce(upper(ve.currency_code), 'USD') = 'USD' THEN ve.final_price ELSE round(ve.final_price * ve.fx_to_usd) END) AS price,
           COALESCE(ve.sold_at, ve.ended_at, ve.created_at)::date AS d,
           (ve.sold_at IS NOT NULL OR ve.ended_at IS NOT NULL) AS date_exact,
           ve.source_platform AS source, v.mileage AS miles, ve.source_url AS url
    FROM public.vehicle_events ve JOIN public.vehicles v ON v.id = ve.vehicle_id
    WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0
    AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted' AND ve.sale_truth_role IS DISTINCT FROM 'duplicate'
    -- sold only (a high bid on an unsold lot is not a comp); non-USD only when it has an fx_to_usd rate
    AND ve.event_status = 'sold' AND (coalesce(upper(ve.currency_code), 'USD') = 'USD' OR ve.fx_to_usd IS NOT NULL)
    ORDER BY 2) pts;

  SELECT jsonb_build_object('populated', count(cd.sentiment_score) > 0, 'source', 'comment_discoveries',
           'method', 'cohort_avg', 'avg_sentiment_score', avg(cd.sentiment_score), 'n', count(cd.sentiment_score), 'observed_at', now())
    INTO v_sentiment FROM public.comment_discoveries cd WHERE cd.vehicle_id = ANY (v_ids);

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events.seller_identifier', 'method', 'top_sellers_in_cohort',
           'top', COALESCE(jsonb_agg(jsonb_build_object('seller', seller_identifier, 'events', n, 'median_price', med) ORDER BY n DESC), '[]'::jsonb))
    INTO v_dealers FROM (
    SELECT ve.seller_identifier, count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY (CASE WHEN coalesce(upper(ve.currency_code), 'USD') = 'USD' THEN ve.final_price ELSE round(ve.final_price * ve.fx_to_usd) END)) FILTER (WHERE ve.event_status = 'sold') AS med
    FROM public.vehicle_events ve WHERE ve.vehicle_id = ANY (v_ids) AND ve.seller_identifier IS NOT NULL AND ve.seller_identifier <> ''
    GROUP BY ve.seller_identifier ORDER BY count(*) DESC LIMIT 10) d;

  SELECT jsonb_build_object(
           'populated', count(*) FILTER (WHERE cited) > 0,
           'source', 'vehicle_production_data',
           'total_produced', max(total_produced) FILTER (WHERE cited),
           'min_produced', min(total_produced) FILTER (WHERE cited),
           'max_produced', max(total_produced) FILTER (WHERE cited),
           'rarity_level', (array_agg(rarity_level ORDER BY total_produced DESC) FILTER (WHERE cited))[1],
           'verified', bool_or(cited),
           'source_url', (array_agg(source_url ORDER BY total_produced DESC) FILTER (WHERE cited))[1],
           'n_cited', count(*) FILTER (WHERE cited),
           'has_uncited_claims', COALESCE(bool_or(NOT cited), false))
    INTO v_production FROM (
      SELECT vp.total_produced, vp.rarity_level, vp.source_url,
             (vp.source_url IS NOT NULL AND COALESCE(vp.quarantined, false) = false) AS cited
      FROM public.vehicle_production_data vp
      WHERE lower(vp.make) = lower(p_make)
        AND (lower(vp.model) = lower(v_canon_model) OR lower(vp.model) = lower(p_model))
        AND vp.year = p_year
    ) q;

  SELECT jsonb_build_object('populated', sre.survival_rate IS NOT NULL, 'source', 'survival_rate_estimates',
           'survival_rate', sre.survival_rate, 'estimated_surviving', sre.estimated_surviving,
           'confidence', sre.confidence_score, 'floor_known_members', v_count,
           'note', 'survival_rate_estimates is sparse; member count is a lower-bound floor, not the estimate.')
    INTO v_survival FROM public.survival_rate_estimates sre
  WHERE lower(sre.make) = lower(p_make) AND lower(sre.model) = lower(p_model)
    AND COALESCE(p_year, sre.year_start) BETWEEN sre.year_start AND sre.year_end LIMIT 1;

  -- comps: full cohort sold set (UNCAPPED), priciest first. The client paginates/virtualizes.
  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events (cohort sold)', 'n', count(*),
           'rows', COALESCE(jsonb_agg(jsonb_build_object('vehicle_id', vehicle_id, 'year', yr, 'make', mk, 'model', mdl, 'trim', tr,
                     'sale_price', sale_price, 'miles', miles, 'platform', platform, 'sold_date', sold_date,
                     'listing_url', listing_url, 'image_url', image_url) ORDER BY sale_price DESC NULLS LAST), '[]'::jsonb))
    INTO v_comps FROM (
    SELECT ve.vehicle_id, v.year AS yr, v.make AS mk, v.model AS mdl, v.trim AS tr, (CASE WHEN coalesce(upper(ve.currency_code), 'USD') = 'USD' THEN ve.final_price ELSE round(ve.final_price * ve.fx_to_usd) END) AS sale_price,
           v.mileage AS miles, ve.source_platform AS platform, COALESCE(ve.sold_at, ve.ended_at) AS sold_date,
           ve.source_url AS listing_url, v.primary_image_url AS image_url
    FROM public.vehicle_events ve JOIN public.vehicles v ON v.id = ve.vehicle_id
    WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0
    AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted' AND ve.sale_truth_role IS DISTINCT FROM 'duplicate'
    -- sold only (a high bid on an unsold lot is not a comp); non-USD only when it has an fx_to_usd rate
    AND ve.event_status = 'sold' AND (coalesce(upper(ve.currency_code), 'USD') = 'USD' OR ve.fx_to_usd IS NOT NULL)
      AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL ORDER BY 6 DESC NULLS LAST) c;

  -- projection_event has no read policy: only the service role (and direct database sessions) ever saw these
  -- rows. Running as definer must not widen that, so cited fields stay empty for everyone else.
  IF coalesce(auth.role(), 'service_role') = 'service_role' THEN
    SELECT jsonb_agg(public.project_attribute(v_subject, attr) ORDER BY attr) INTO v_cited FROM (
      SELECT DISTINCT request_envelope->>'attribute' AS attr FROM public.projection_event
      WHERE request_envelope->>'subject_id' = v_subject::text AND request_envelope->>'subject_kind' = 'make_model' AND retracted_at IS NULL) a;
  END IF;

  RETURN jsonb_build_object('resolved', true, 'subject_id', v_subject,
    'cohort', jsonb_build_object('make', p_make, 'model', COALESCE(v_canon_model, p_model), 'year', p_year, 'grain', p_grain),
    'cohort_count', jsonb_build_object('populated', v_count > 0, 'value', v_count, 'source', 'cohort_members'),
    'price_distribution', COALESCE(v_price, jsonb_build_object('populated', false)),
    'price_points', COALESCE(v_points, jsonb_build_object('populated', false)),
    'market_flow', COALESCE(v_flow, jsonb_build_object('populated', false)),
    'sentiment', COALESCE(v_sentiment, jsonb_build_object('populated', false)),
    'dealer_flow', COALESCE(v_dealers, jsonb_build_object('populated', false)),
    'production', COALESCE(v_production, jsonb_build_object('populated', false)),
    'survival', COALESCE(v_survival, jsonb_build_object('populated', false, 'floor_known_members', v_count)),
    'comps', COALESCE(v_comps, jsonb_build_object('populated', false)),
    'cited_fields', COALESCE(v_cited, '[]'::jsonb),
    'note', 'Cohort terminal: live aggregates ASSEMBLED from substrate + curated fields PROJECTED. populated=false is an intake gap.');
END;
$function$;
