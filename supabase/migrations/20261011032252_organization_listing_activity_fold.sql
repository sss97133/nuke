-- Extend the existing seller-stat owner. This is a current retained-evidence
-- cache, not corporate revenue or a point-in-time historical reconstruction.
SET statement_timeout = '10s';
SET lock_timeout = '3s';

ALTER TABLE public.organization_seller_stats ADD COLUMN IF NOT EXISTS evidence_summary jsonb;
COMMENT ON TABLE public.organization_seller_stats IS
  'Current organization-attributed listing cache, one organization per row, owner compute-org-seller-stats. Qualified listing_activity_v1 receipts retain input clocks, identity/outcome exclusions and separate observed currencies. Legacy rows without this receipt are not qualified profile evidence. This cache does not establish company revenue or historical replay.';
COMMENT ON COLUMN public.organization_seller_stats.evidence_summary IS
  'Current organization-attributed listing activity, listing_activity_v1. Owner: compute-org-seller-stats. Grain: platform and exact source URL, or native listing ID when URL absent. Retains identity, outcome and currency exclusions. Clock: calculated_at; input clocks retained in summary. Does not establish complete market coverage, legal seller role or corporate revenue.';

CREATE OR REPLACE FUNCTION public.compute_organization_listing_activity(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
SET statement_timeout = '10s' SET lock_timeout = '3s' AS $$
DECLARE summary jsonb; previous_writer text := current_setting('app.writer', true);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'organization_not_found';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('organization_listing_activity:' || p_org_id::text, 0)) THEN
    RAISE EXCEPTION 'organization_fold_busy';
  END IF;
  PERFORM set_config('app.writer', 'compute-org-seller-stats', true);
  WITH raw AS MATERIALIZED (
    SELECT *, nullif(btrim(source_platform), '') AS platform,
      CASE WHEN nullif(btrim(source_url), '') IS NOT NULL THEN 'url:' || btrim(source_url)
        WHEN nullif(btrim(source_listing_id), '') IS NOT NULL THEN 'id:' || btrim(source_listing_id) END AS episode_key,
      CASE WHEN upper(btrim(metadata->>'currency')) ~ '^[A-Z]{3}$'
        THEN upper(btrim(metadata->>'currency')) END AS currency,
      CASE WHEN event_status = 'sold' THEN 'sold'
        WHEN event_status = 'ended' AND metadata->>'reserve_status' = 'reserve_not_met' THEN 'unsold'
        WHEN event_status IN ('active', 'pending') THEN 'active'
        ELSE 'unknown' END AS outcome
    FROM public.vehicle_events WHERE source_organization_id = p_org_id
  ), episodes AS MATERIALIZED (
    SELECT platform, episode_key, count(*) AS input_rows,
      count(DISTINCT vehicle_id) > 1 OR count(DISTINCT nullif(btrim(source_listing_id), '')) > 1 AS identity_conflict,
      count(DISTINCT outcome) > 1 AS outcome_conflict,
      count(DISTINCT final_price) FILTER (WHERE final_price > 0) > 1 AS price_conflict,
      count(DISTINCT currency) > 1 AS currency_conflict,
      min(outcome) AS outcome, min(currency) AS currency,
      min(final_price) FILTER (WHERE final_price > 0) AS price,
      max(bid_count) FILTER (WHERE bid_count >= 0) AS bids,
      max(comment_count) FILTER (WHERE comment_count >= 0) AS comments,
      max(view_count) FILTER (WHERE view_count >= 0) AS views,
      min(started_at) AS first_started_at
    FROM raw WHERE platform IS NOT NULL AND episode_key IS NOT NULL
    GROUP BY platform, episode_key
  ), qualified AS MATERIALIZED (
    SELECT *, NOT identity_conflict AND NOT outcome_conflict AS outcome_eligible,
      NOT identity_conflict AND NOT outcome_conflict AND outcome = 'sold'
        AND NOT price_conflict AND NOT currency_conflict AND price IS NOT NULL AND currency IS NOT NULL AS price_eligible
    FROM episodes
  ), amounts AS (
    SELECT currency, count(*) AS listings, sum(price) AS total, avg(price) AS average,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median,
      min(price) AS lowest, max(price) AS highest
    FROM qualified WHERE price_eligible GROUP BY currency
  ), totals AS (
    SELECT count(*) AS listings,
      count(*) FILTER (WHERE outcome_eligible AND outcome = 'sold') AS sold,
      count(*) FILTER (WHERE outcome_eligible AND outcome = 'unsold') AS unsold,
      count(*) FILTER (WHERE outcome_eligible AND outcome = 'active') AS active,
      count(*) FILTER (WHERE NOT outcome_eligible OR outcome = 'unknown') AS unknown_outcomes,
      count(*) FILTER (WHERE identity_conflict) AS identity_conflicts,
      count(*) FILTER (WHERE outcome_conflict) AS outcome_conflicts,
      count(*) FILTER (WHERE outcome_eligible AND outcome = 'sold' AND NOT price_eligible) AS unpriced_sold,
      count(*) FILTER (WHERE outcome_eligible AND outcome = 'sold' AND currency IS NULL) AS unknown_currency_sold,
      count(*) FILTER (WHERE price_conflict OR currency_conflict) AS amount_conflicts,
      count(*) FILTER (WHERE price_eligible) AS priced_sold,
      avg(bids) FILTER (WHERE NOT identity_conflict) AS avg_bids,
      avg(comments) FILTER (WHERE NOT identity_conflict) AS avg_comments,
      avg(views) FILTER (WHERE NOT identity_conflict) AS avg_views,
      min(first_started_at) AS first_started_at, max(first_started_at) AS last_started_at,
      count(first_started_at) AS dated_listings
    FROM qualified
  ) SELECT jsonb_build_object(
    'contract', 'listing_activity_v1', 'organization_id', p_org_id,
    'calculated_at', statement_timestamp(), 'scope', 'retained_organization_attributed_listings',
    'population_complete', true, 'input_rows', (SELECT count(*) FROM raw),
    'unresolved_identity_rows', (SELECT count(*) FROM raw WHERE platform IS NULL OR episode_key IS NULL),
    'latest_input_created_at', (SELECT max(created_at) FROM raw),
    'latest_input_extracted_at', (SELECT max(extracted_at) FROM raw),
    'total_listings', t.listings, 'total_sold', t.sold, 'total_unsold', t.unsold, 'active_listings', t.active,
    'unknown_outcomes', t.unknown_outcomes, 'identity_conflicts', t.identity_conflicts,
    'outcome_conflicts', t.outcome_conflicts, 'unpriced_sold', t.unpriced_sold,
    'unknown_currency_sold', t.unknown_currency_sold, 'amount_conflicts', t.amount_conflicts,
    'priced_sold', t.priced_sold, 'dated_listings', t.dated_listings,
    'first_listing_date', t.first_started_at, 'last_listing_date', t.last_started_at,
    'avg_bid_count', t.avg_bids, 'avg_comment_count', t.avg_comments, 'avg_view_count', t.avg_views,
    'sell_through_rate', CASE WHEN t.unknown_outcomes = 0 AND NOT EXISTS (
      SELECT 1 FROM raw WHERE platform IS NULL OR episode_key IS NULL)
      THEN round(100.0 * t.sold / nullif(t.sold + t.unsold, 0), 2) END,
    'currencies', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY currency) FROM amounts a), '[]'::jsonb),
    'counter_method', 'maximum_retained_native_counter_per_episode_known_values_only'
  ) INTO summary FROM totals t;

  INSERT INTO public.organization_seller_stats AS s (
    organization_id, total_listings, total_sold, total_unsold, active_listings, sell_through_rate,
    total_gross_sales, avg_sale_price, median_sale_price, highest_sale_price, lowest_sale_price,
    avg_bid_count, avg_comment_count, avg_view_count, first_listing_date, last_listing_date, calculated_at, evidence_summary)
  VALUES (p_org_id, (summary->>'total_listings')::int, (summary->>'total_sold')::int,
    (summary->>'total_unsold')::int, (summary->>'active_listings')::int,
    (summary->>'sell_through_rate')::numeric,
    NULL, NULL, NULL, NULL, NULL,
    (summary->>'avg_bid_count')::numeric, (summary->>'avg_comment_count')::numeric,
    (summary->>'avg_view_count')::numeric, (summary->>'first_listing_date')::timestamptz,
    (summary->>'last_listing_date')::timestamptz, (summary->>'calculated_at')::timestamptz, summary)
  ON CONFLICT (organization_id) DO UPDATE SET
    total_listings = EXCLUDED.total_listings, total_sold = EXCLUDED.total_sold,
    total_unsold = EXCLUDED.total_unsold, active_listings = EXCLUDED.active_listings,
    sell_through_rate = EXCLUDED.sell_through_rate,
    total_gross_sales = NULL, avg_sale_price = NULL, median_sale_price = NULL,
    highest_sale_price = NULL, lowest_sale_price = NULL,
    avg_bid_count = EXCLUDED.avg_bid_count, avg_comment_count = EXCLUDED.avg_comment_count,
    avg_view_count = EXCLUDED.avg_view_count, avg_auction_duration_hours = NULL,
    first_listing_date = (summary->>'first_listing_date')::timestamptz,
    last_listing_date = (summary->>'last_listing_date')::timestamptz,
    listing_frequency_days = NULL, primary_categories = NULL, primary_makes = NULL,
    avg_sentiment_score = NULL, common_concerns = NULL, common_praise = NULL,
    calculated_at = EXCLUDED.calculated_at, evidence_summary = EXCLUDED.evidence_summary;
  PERFORM set_config('app.writer', coalesce(previous_writer, ''), true);
  RETURN summary;
END $$;
COMMENT ON FUNCTION public.compute_organization_listing_activity(uuid) IS
  'Service-only bounded full-cohort fold for compute-org-seller-stats; existing source_organization_id index, one transaction, no testimony mutation. Exact source identity, conservative conflicts, explicit currency groups; current knowledge only. Missing units never default to USD. Counters are maximum retained native values per episode. Ten-second budget fails atomically.';
REVOKE ALL ON FUNCTION public.compute_organization_listing_activity(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_organization_listing_activity(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.organization_listing_activity_candidates(p_limit int DEFAULT 50)
RETURNS TABLE (organization_id uuid) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
SET statement_timeout = '5s' AS $$
  SELECT o.id FROM public.organizations o
  LEFT JOIN public.organization_seller_stats s ON s.organization_id = o.id
  WHERE EXISTS (SELECT 1 FROM public.vehicle_events e WHERE e.source_organization_id = o.id)
  ORDER BY s.calculated_at ASC NULLS FIRST, o.id
  LIMIT greatest(1, least(coalesce(p_limit, 50), 50));
$$;
COMMENT ON FUNCTION public.organization_listing_activity_candidates(int) IS
  'Existing compute-org-seller-stats batch selector: at most 50 organization keys with indexed attributed listing evidence, oldest cache first. Does not mint organizations or sample a first page of vehicle events.';
REVOKE ALL ON FUNCTION public.organization_listing_activity_candidates(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organization_listing_activity_candidates(int) TO service_role;

INSERT INTO public.pipeline_registry(table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES ('organization_seller_stats', 'evidence_summary', 'compute-org-seller-stats',
  'Current organization-attributed listing cache with unresolved identity/outcome/currency coverage. No corporate revenue inference.', true,
  'compute_organization_listing_activity(uuid)')
ON CONFLICT (table_name, column_name) DO UPDATE SET owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description, do_not_write_directly = true, write_via = EXCLUDED.write_via;
RESET statement_timeout;
RESET lock_timeout;
NOTIFY pgrst, 'reload schema';
