-- Production integrity: cited figures WIN; contamination is quarantined, not deleted.
--
-- Found 2026-06-23: vehicle_production_data carried 19 contaminated rows — 15
-- data_source='manufacturer' with NO source_url (round-number 2020 fabrications:
-- F-150 = 8000/180000/200000) + 4 data_source='registry' with conflicting uncited
-- numbers (K5 Blazer 1977 = 30000 AND 15000). The terminal's production block used
-- max(total_produced) across ALL rows, so a fabrication could set the headline.
--
-- Fix: (1) a quarantine flag (non-destructive — we never DELETE reference data),
-- (2) flag every currently-uncited row, (3) rewrite the read path so the headline
-- production figure is drawn ONLY from cited (source_url present) + non-quarantined
-- rows. Uncited claims stay visible in the provenance drill (the spectrum), never on
-- the calm face, and are signalled via has_uncited_claims. Cited-or-it-doesn't-count.

ALTER TABLE public.vehicle_production_data
  ADD COLUMN IF NOT EXISTS quarantined boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quarantine_reason text;

UPDATE public.vehicle_production_data
   SET quarantined = true,
       quarantine_reason = 'uncited seed (no source_url) — fabricated or conflicting; superseded by cohort-research cited figures (2026-06-23)'
 WHERE source_url IS NULL AND quarantined = false;

CREATE OR REPLACE FUNCTION public.get_make_model_terminal(p_make text, p_model text, p_year integer DEFAULT NULL::integer, p_grain text DEFAULT 'year'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
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

  SELECT array_agg(vehicle_id) INTO v_ids FROM public.cohort_members(v_subject);
  v_count := COALESCE(array_length(v_ids, 1), 0);

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events.final_price',
           'method', 'cohort_aggregate', 'n', count(*),
           'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price),
           'p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY ve.final_price),
           'p75', percentile_cont(0.75) WITHIN GROUP (ORDER BY ve.final_price),
           'min', min(ve.final_price), 'max', max(ve.final_price), 'observed_at', now())
    INTO v_price FROM public.vehicle_events ve
  WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0;

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events', 'method', 'quarterly_flow',
           'series', COALESCE(jsonb_agg(jsonb_build_object('quarter', q, 'sales', n, 'median_price', med) ORDER BY q), '[]'::jsonb))
    INTO v_flow FROM (
    SELECT date_trunc('quarter', COALESCE(ve.sold_at, ve.ended_at)) AS q, count(*) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price) AS med
    FROM public.vehicle_events ve WHERE ve.vehicle_id = ANY (v_ids)
      AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL AND ve.final_price IS NOT NULL AND ve.final_price > 0
    GROUP BY 1) s;

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events.final_price (uncapped per-sale)',
           'n', count(*), 'n_dated', count(*) FILTER (WHERE date_exact),
           'points', COALESCE(jsonb_agg(jsonb_build_object('vehicle_id', vehicle_id, 'price', price, 'date', d,
                       'date_exact', date_exact, 'source', source, 'miles', miles, 'url', url) ORDER BY price), '[]'::jsonb))
    INTO v_points FROM (
    SELECT ve.vehicle_id, ve.final_price AS price,
           COALESCE(ve.sold_at, ve.ended_at, ve.created_at)::date AS d,
           (ve.sold_at IS NOT NULL OR ve.ended_at IS NOT NULL) AS date_exact,
           ve.source_platform AS source, v.mileage AS miles, ve.source_url AS url
    FROM public.vehicle_events ve JOIN public.vehicles v ON v.id = ve.vehicle_id
    WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0
    ORDER BY ve.final_price LIMIT 1000) pts;

  SELECT jsonb_build_object('populated', count(cd.sentiment_score) > 0, 'source', 'comment_discoveries',
           'method', 'cohort_avg', 'avg_sentiment_score', avg(cd.sentiment_score), 'n', count(cd.sentiment_score), 'observed_at', now())
    INTO v_sentiment FROM public.comment_discoveries cd WHERE cd.vehicle_id = ANY (v_ids);

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events.seller_identifier', 'method', 'top_sellers_in_cohort',
           'top', COALESCE(jsonb_agg(jsonb_build_object('seller', seller_identifier, 'events', n, 'median_price', med) ORDER BY n DESC), '[]'::jsonb))
    INTO v_dealers FROM (
    SELECT ve.seller_identifier, count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price) AS med
    FROM public.vehicle_events ve WHERE ve.vehicle_id = ANY (v_ids) AND ve.seller_identifier IS NOT NULL AND ve.seller_identifier <> ''
    GROUP BY ve.seller_identifier ORDER BY count(*) DESC LIMIT 10) d;

  -- PRODUCTION (cited-wins): the headline number is drawn ONLY from cited
  -- (source_url present) + non-quarantined rows. Uncited/quarantined rows never set
  -- the figure — they surface as has_uncited_claims so the UI routes to the
  -- provenance drill (where the full spectrum, including uncited, is shown).
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

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events (cohort sold)', 'n', count(*),
           'rows', COALESCE(jsonb_agg(jsonb_build_object('vehicle_id', vehicle_id, 'year', yr, 'make', mk, 'model', mdl, 'trim', tr,
                     'sale_price', sale_price, 'miles', miles, 'platform', platform, 'sold_date', sold_date,
                     'listing_url', listing_url, 'image_url', image_url) ORDER BY sale_price DESC NULLS LAST), '[]'::jsonb))
    INTO v_comps FROM (
    SELECT ve.vehicle_id, v.year AS yr, v.make AS mk, v.model AS mdl, v.trim AS tr, ve.final_price AS sale_price,
           v.mileage AS miles, ve.source_platform AS platform, COALESCE(ve.sold_at, ve.ended_at) AS sold_date,
           ve.source_url AS listing_url, v.primary_image_url AS image_url
    FROM public.vehicle_events ve JOIN public.vehicles v ON v.id = ve.vehicle_id
    WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0
      AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL ORDER BY ve.final_price DESC LIMIT 24) c;

  SELECT jsonb_agg(public.project_attribute(v_subject, attr) ORDER BY attr) INTO v_cited FROM (
    SELECT DISTINCT request_envelope->>'attribute' AS attr FROM public.projection_event
    WHERE request_envelope->>'subject_id' = v_subject::text AND request_envelope->>'subject_kind' = 'make_model' AND retracted_at IS NULL) a;

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

NOTIFY pgrst, 'reload schema';
