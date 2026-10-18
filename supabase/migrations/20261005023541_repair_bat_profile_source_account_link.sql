-- Extend the sanctioned one-account replay with its forward owner's exact source key.
-- One known unlinked source-account fold is repaired through this sanctioned
-- replay owner. No testimony DML, person claim, bulk replay or processing activation.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE FUNCTION public.refresh_bat_user_profile(p_username text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_stats record;
  v_record record;
  v_strategy text;
  v_wins integer;
  v_rate numeric;
  v_identity_id uuid;
BEGIN
  IF p_username IS NULL OR btrim(p_username) = '' OR p_username = 'Unknown' THEN
    RETURN;
  END IF;

  SELECT INTO v_stats
    count(*) AS total_comments,
    count(*) FILTER (WHERE comment_type = 'bid') AS total_bids,
    count(*) FILTER (WHERE has_question) AS total_questions,
    round(avg(bid_amount) FILTER (WHERE comment_type = 'bid' AND bid_amount > 0)) AS avg_bid,
    max(bid_amount) FILTER (WHERE comment_type = 'bid' AND bid_amount > 0) AS max_bid,
    min(bid_amount) FILTER (WHERE comment_type = 'bid' AND bid_amount > 0) AS min_bid,
    count(*) FILTER (WHERE comment_type = 'bid' AND hours_until_close < 2) AS bids_2h,
    count(*) FILTER (WHERE comment_type = 'bid' AND hours_until_close < 24) AS bids_24h,
    round(avg(author_total_likes) FILTER (WHERE author_total_likes > 0)::numeric, 1) AS avg_likes,
    -- Preserve the existing uncalibrated source-like transformation. A missing
    -- source count is NULL, not zero community trust.
    CASE WHEN max(bat_author_likes) IS NULL THEN NULL
      ELSE LEAST(100, round(max(bat_author_likes)::numeric / 10)) END AS trust,
    jsonb_build_object(
      'p25', round((percentile_cont(0.25) WITHIN GROUP (ORDER BY bid_amount)
        FILTER (WHERE comment_type = 'bid' AND bid_amount > 0))::numeric),
      'p50', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY bid_amount)
        FILTER (WHERE comment_type = 'bid' AND bid_amount > 0))::numeric),
      'p75', round((percentile_cont(0.75) WITHIN GROUP (ORDER BY bid_amount)
        FILTER (WHERE comment_type = 'bid' AND bid_amount > 0))::numeric)
    ) AS price_range,
    min(posted_at) AS first_seen,
    max(posted_at) AS last_seen,
    count(*) FILTER (WHERE comment_type = 'bid'
      AND NULLIF(btrim(source_url), '') IS NULL) AS unkeyed_bid_comments
  FROM public.auction_comments
  WHERE platform = 'bat' AND author_username = p_username
    AND (lower(p_username) <> 'anonymous' OR COALESCE(bat_author_id, 0) > 0);

  IF v_stats.total_comments = 0 THEN RETURN; END IF;

  -- Same exact platform/handle lookup as the forward INSERT owner.
  -- This binds a source account, never a person or a claimed account.
  SELECT id INTO v_identity_id FROM public.external_identities
  WHERE platform = 'bat' AND handle = p_username;

  -- Bid participation is keyed by a source presentation, not just a chassis.
  -- Only the publisher's terminal-slash URL aliases are coalesced. Distinct
  -- listings of the same vehicle remain distinct presentations. Exact URL and
  -- vehicle agreement are both required; no fallback from an unrelated sale.
  WITH presentations AS MATERIALIZED (
    SELECT DISTINCT rtrim(source_url, '/') AS source_key, vehicle_id
    FROM public.auction_comments
    WHERE platform = 'bat' AND author_username = p_username AND comment_type = 'bid'
      AND NULLIF(btrim(source_url), '') IS NOT NULL
      AND (lower(p_username) <> 'anonymous' OR COALESCE(bat_author_id, 0) > 0)
  ), outcomes AS (
    SELECT p.source_key,
      min(l.buyer_handle) AS buyer,
      CASE
        WHEN count(l.id) = 0 THEN 'unlinked'
        WHEN bool_and(l.listing_status IS NOT DISTINCT FROM 'sold') FILTER (WHERE l.id IS NOT NULL)
          AND count(DISTINCT l.buyer_handle) = 1
          THEN 'sold_with_buyer'
        WHEN bool_and(l.listing_status IS NOT DISTINCT FROM 'no_sale') FILTER (WHERE l.id IS NOT NULL)
          AND count(DISTINCT l.buyer_handle) = 0
          THEN 'no_sale'
        ELSE 'outcome_or_buyer_unknown'
      END AS evidence
    FROM presentations p
    LEFT JOIN LATERAL (
      SELECT bl.id, bl.listing_status,
        CASE WHEN NULLIF(btrim(bl.buyer_username), '') IS NOT NULL
          AND bl.buyer_username <> 'Unknown'
          AND lower(bl.buyer_username) <> 'anonymous'
          THEN bl.buyer_username END AS buyer_handle
      FROM public.bat_listings bl
      WHERE bl.bat_listing_url IN (p.source_key, p.source_key || '/')
        AND bl.vehicle_id = p.vehicle_id
    ) l ON true
    GROUP BY p.source_key
  )
  SELECT INTO v_record
    count(*) AS observed_presentations,
    count(*) FILTER (WHERE evidence IN ('sold_with_buyer', 'no_sale')) AS eligible_presentations,
    count(*) FILTER (WHERE evidence = 'sold_with_buyer' AND buyer = p_username) AS published_wins,
    count(*) FILTER (WHERE evidence = 'unlinked') AS unlinked_presentations,
    count(*) FILTER (WHERE evidence = 'outcome_or_buyer_unknown') AS unknown_outcomes
  FROM outcomes;

  v_wins := CASE WHEN v_record.eligible_presentations > 0 THEN v_record.published_wins ELSE NULL END;
  v_rate := CASE WHEN v_record.eligible_presentations > 0
    THEN round(v_record.published_wins::numeric / v_record.eligible_presentations, 4) ELSE NULL END;

  -- Preserve legacy strategy vocabulary; it remains uncalibrated and its
  -- hours_until_close input is a separately known clock defect (case C5).
  IF v_stats.total_bids = 0 THEN v_strategy := 'observer';
  ELSIF v_stats.bids_2h::float / v_stats.total_bids > 0.5 THEN v_strategy := 'sniper';
  ELSIF v_stats.bids_24h::float / v_stats.total_bids < 0.4 THEN v_strategy := 'early_aggressive';
  ELSE v_strategy := 'steady'; END IF;

  INSERT INTO public.bat_user_profiles AS profile (
    username, external_identity_id, total_comments, total_bids, total_wins, total_questions,
    avg_bid_amount, max_bid_amount, min_bid_amount, win_rate,
    bidding_strategy, typical_price_range, community_trust_score, avg_likes_received,
    first_seen, last_seen, updated_at, metadata
  ) VALUES (
    p_username, v_identity_id, v_stats.total_comments, v_stats.total_bids, v_wins, v_stats.total_questions,
    v_stats.avg_bid, v_stats.max_bid, v_stats.min_bid, v_rate,
    v_strategy, v_stats.price_range, v_stats.trust, v_stats.avg_likes,
    v_stats.first_seen, v_stats.last_seen, now(),
    jsonb_build_object('bat_bidder_record', jsonb_build_object(
      'method', 'published_buyer_v1', 'grain', 'canonical_bat_listing_url',
      'scope', 'cumulative_captured_history', 'refreshed_at', now(),
      'observed_bid_presentations', v_record.observed_presentations,
      'eligible_closed_presentations', v_record.eligible_presentations,
      'unlinked_presentations', v_record.unlinked_presentations,
      'unknown_outcome_presentations', v_record.unknown_outcomes,
      'unkeyed_bid_comments', v_stats.unkeyed_bid_comments))
  ) ON CONFLICT (username) DO UPDATE SET
    external_identity_id = COALESCE(profile.external_identity_id, EXCLUDED.external_identity_id),
    total_comments = EXCLUDED.total_comments,
    total_bids = EXCLUDED.total_bids,
    total_wins = EXCLUDED.total_wins,
    total_questions = EXCLUDED.total_questions,
    avg_bid_amount = EXCLUDED.avg_bid_amount,
    max_bid_amount = EXCLUDED.max_bid_amount,
    min_bid_amount = EXCLUDED.min_bid_amount,
    win_rate = EXCLUDED.win_rate,
    bidding_strategy = EXCLUDED.bidding_strategy,
    typical_price_range = EXCLUDED.typical_price_range,
    community_trust_score = EXCLUDED.community_trust_score,
    avg_likes_received = EXCLUDED.avg_likes_received,
    first_seen = EXCLUDED.first_seen,
    last_seen = EXCLUDED.last_seen,
    updated_at = EXCLUDED.updated_at,
    metadata = COALESCE(profile.metadata, '{}'::jsonb) || EXCLUDED.metadata
  WHERE profile.external_identity_id IS NULL OR EXCLUDED.external_identity_id IS NULL
     OR profile.external_identity_id = EXCLUDED.external_identity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Existing BaT source-account key conflicts with exact handle' USING ERRCODE='23514';
  END IF;
  -- Non-NULL keys cannot be replaced. Claims and opaque expertise are preserved.
END;
$function$;

COMMENT ON FUNCTION public.refresh_bat_user_profile(text) IS
 'Replay one exact BaT handle from captured comments, resolving the canonical platform=bat/handle source account exactly as the forward INSERT owner. Fill a missing key, preserve established keys, reject canonical-key conflicts. Published buyer/eligible-presentation metrics retain their existing contract. No person claim or paid-transfer proof.';
UPDATE public.pipeline_registry
SET write_via='auction_comments INSERT -> update_user_profile_from_comment; exact source-account replay via refresh_bat_user_profile'
WHERE table_name='bat_user_profiles' AND column_name='external_identity_id'
  AND owned_by='update_user_profile_from_comment';
DO $repair$ BEGIN
  IF EXISTS (SELECT 1 FROM public.external_identities
             WHERE id='7f021030-ada8-4f76-84ab-18b2c2a4bda6'
               AND platform='bat' AND handle='skylarwilliams')
     AND EXISTS (SELECT 1 FROM public.bat_user_profiles
                 WHERE username='skylarwilliams' AND external_identity_id IS NULL) THEN
    PERFORM public.refresh_bat_user_profile('skylarwilliams');
  END IF;
END $repair$;
NOTIFY pgrst,'reload schema';
COMMIT;
