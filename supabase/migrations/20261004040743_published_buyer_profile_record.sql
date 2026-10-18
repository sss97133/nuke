-- Repair existing account refresh and qualify the public profile metric reader.
-- Live PG17.6, 2026-10-04: refresh_bat_user_profile wrongly counts each user's
-- own maximum bid on a sold vehicle as a win, without reading the buyer.
-- Indexed first-1,000-username sample: 997 NULL win_rate/first_seen, 997 default
-- zero wins, 1,000 default zero expertise. A bounded source-URL match for three
-- refreshed profiles found 202 sold bid-comment matches, all missing buyers.
-- Missing winner evidence cannot establish a win or a loss.
-- Replace only the existing account refresh, not its forward INSERT trigger.
-- No call/replay/backfill is run by this migration; no source testimony DML.
-- Publication outcome is an award claim, not proof of payment or transfer.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.refresh_bat_user_profile(p_username text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '30s'
AS $$
DECLARE
  v_stats record;
  v_record record;
  v_strategy text;
  v_wins integer;
  v_rate numeric;
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
    username, total_comments, total_bids, total_wins, total_questions,
    avg_bid_amount, max_bid_amount, min_bid_amount, win_rate,
    bidding_strategy, typical_price_range, community_trust_score, avg_likes_received,
    first_seen, last_seen, updated_at, metadata
  ) VALUES (
    p_username, v_stats.total_comments, v_stats.total_bids, v_wins, v_stats.total_questions,
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
    metadata = COALESCE(profile.metadata, '{}'::jsonb) || EXCLUDED.metadata;
  -- Existing canonical identity key, claims and opaque expertise fields are
  -- neither overwritten nor guessed by the replay owner.
END;
$$;

COMMENT ON FUNCTION public.refresh_bat_user_profile(text) IS
  'Replay one exact BaT handle from captured comments. Published award numerator and eligible closed bidding-presentation denominator at canonical listing-URL grain; metadata carries coverage. Lifetime current state, never historical as-of feature or paid-transfer proof. Preserves the forward fold identity key and unrelated metadata.';
COMMENT ON COLUMN public.bat_user_profiles.total_wins IS
  'Count of captured bidding presentations whose sold BaT listing explicitly names this exact handle as published buyer, deduped by terminal-slash-normalized listing URL; not paid transfers. NULL if no eligible closed presentation. Historical rows without metadata.bat_bidder_record.method=published_buyer_v1 are unassayed legacy values.';
COMMENT ON COLUMN public.bat_user_profiles.win_rate IS
  'Unit: fraction 0..1. Published buyer matches / observed bid presentations with a known sold buyer or explicit no_sale. Missing buyer/outcome/linkage excluded, not losses; denominator/coverage and refresh time in metadata.bat_bidder_record. Lifetime capture, not a historical cutoff feature. Legacy values without method are unassayed.';
COMMENT ON COLUMN public.bat_user_profiles.total_questions IS
  'Count of captured platform=bat, exact-handle comments with has_question=true when refresh_bat_user_profile last replayed. May be older than incremental comment/bid counts; no inferred missing questions.';
COMMENT ON COLUMN public.bat_user_profiles.avg_bid_amount IS
  'Unit: parsed BaT source monetary amount; currency is not independently carried by this profile. Rounded arithmetic mean of positive amounts on captured comment_type=bid rows for this exact handle when last replayed. NULL means no positive amount observed. Not paid purchase price or spending.';
COMMENT ON COLUMN public.bat_user_profiles.max_bid_amount IS
  'Unit: parsed BaT source monetary amount; currency is not independently carried by this profile. Maximum positive captured comment_type=bid amount at last account replay. Not an accepted final purchase or account budget; NULL if amount unobserved.';
COMMENT ON COLUMN public.bat_user_profiles.min_bid_amount IS
  'Unit: parsed BaT source monetary amount; currency is not independently carried by this profile. Minimum positive captured comment_type=bid amount at last account replay. NULL if amount unobserved.';
COMMENT ON COLUMN public.bat_user_profiles.typical_price_range IS
  'JSON p25/p50/p75: rounded empirical quartiles of positive parsed source amounts on captured bid comments at last replay; profile does not independently carry currency. Repeated bids each enter the distribution; not vehicle prices, spending or a calibrated prediction interval.';
COMMENT ON COLUMN public.bat_user_profiles.avg_likes_received IS
  'Legacy name: average of positive auction_comments.author_total_likes source snapshots at last replay, not likes received by an individual comment. Repeated snapshots are repeated observations; NULL if no positive source snapshot.';
COMMENT ON COLUMN public.bat_user_profiles.community_trust_score IS
  'Legacy points = min(100, round(max captured bat_author_likes / 10)) at last replay. An uncalibrated transform of source likes, not trust/confidence/expertise; NULL if no source-like count. Historical/default zero may be unmeasured.';
COMMENT ON COLUMN public.bat_user_profiles.expertise_score IS
  'Unassayed legacy numeric field with schema default zero; no canonical computation identified in current live SQL owners or current source writers. Zero does not establish absent expertise. Not a calibrated ranking or prediction feature.';
COMMENT ON COLUMN public.bat_user_profiles.bidding_strategy IS
  'Legacy heuristic labels observer/sniper/early_aggressive/steady from captured bid-comment hours_until_close shares at last replay. Uncalibrated; hours_until_close has known historical clock defects. Not bidding skill or advice.';
COMMENT ON COLUMN public.bat_user_profiles.metadata IS
  'bat_bidder_record holds method, presentation grain, cumulative-capture scope, account-replay transaction refresh time and excluded/unlinked coverage counts. Other metadata preserved. Rows without the method retain known defective legacy count/clock baselines. Refresh time is not an event cutoff; profile fields need not share a computation time.';
COMMENT ON COLUMN public.bat_user_profiles.total_comments IS
  'Count of identifiable exact-handle BaT comment rows: incremental INSERT maintenance and account replay share this recipe. Source-key conflicts add nothing. Known defective historical baseline remains until metadata.bat_bidder_record records a replay; cumulative captured history, not all-platform activity or an as-of feature.';
COMMENT ON COLUMN public.bat_user_profiles.total_bids IS
  'Count of identifiable exact-handle BaT comment_type=bid rows, including NULL bid amounts; incremental INSERT and account replay share this recipe. Result summaries are excluded. Known defective historical baseline remains until declared replay; captured bidding acts, not paid purchases.';
COMMENT ON COLUMN public.bat_user_profiles.first_seen IS
  'Source event time, earliest captured posted_at for identifiable exact-handle BaT comments. INSERT widens bounds; replay recomputes the BaT minimum. Known defective legacy baseline remains until declared replay. NULL means event time unobserved, not account creation.';
COMMENT ON COLUMN public.bat_user_profiles.last_seen IS
  'Source event time, latest captured posted_at for identifiable exact-handle BaT comments. INSERT widens bounds; replay recomputes the BaT maximum. Known defective legacy baseline remains until declared replay. NULL means event time unobserved, not a current online status.';
COMMENT ON COLUMN public.bat_user_profiles.updated_at IS
  'Transaction refresh time of the latest incremental comment INSERT or account replay, not a shared computation time for every field. Use metadata.bat_bidder_record.refreshed_at for award/coverage refresh age; neither timestamp is a historical event cutoff.';

INSERT INTO public.pipeline_registry
  (table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES
  ('bat_user_profiles','total_wins','refresh_bat_user_profile',
   'Published buyer evidence at canonical BaT source-listing grain; NULL without eligible closed participation.',true,'refresh_bat_user_profile'),
  ('bat_user_profiles','win_rate','refresh_bat_user_profile',
   'Published awards / eligible captured closed bidding presentations; metadata carries exclusions. Not historical as-of.',true,'refresh_bat_user_profile'),
  ('bat_user_profiles','community_trust_score','refresh_bat_user_profile',
   'Legacy uncalibrated source-like transform; NULL without measured source count.',true,'refresh_bat_user_profile')
ON CONFLICT (table_name,column_name) DO NOTHING;

-- Preserve the existing canonical INSERT owner. One-account refresh is the
-- sanctioned replay mode, using the identical comment_type=bid recipe.
INSERT INTO public.pipeline_registry
  (table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES
  ('bat_user_profiles','total_comments','update_user_profile_from_comment',
   'Exact identifiable BaT handle comment count; defective pre-replay baseline is declared by missing bat_bidder_record method.',true,'update_user_profile_from_comment; replay via refresh_bat_user_profile'),
  ('bat_user_profiles','total_bids','update_user_profile_from_comment',
   'Exact identifiable BaT handle comments with comment_type=bid; same INSERT/replay recipe, defective pre-replay baseline declared by missing method.',true,'update_user_profile_from_comment; replay via refresh_bat_user_profile'),
  ('bat_user_profiles','first_seen','update_user_profile_from_comment',
   'Source posted_at minimum; INSERT widens event bounds, replay rebuilds the BaT source minimum. Legacy baseline is defective until replay.',true,'update_user_profile_from_comment; replay via refresh_bat_user_profile'),
  ('bat_user_profiles','last_seen','update_user_profile_from_comment',
   'Source posted_at maximum; INSERT widens event bounds, replay rebuilds the BaT source maximum. Legacy baseline is defective until replay.',true,'update_user_profile_from_comment; replay via refresh_bat_user_profile')
ON CONFLICT (table_name,column_name) DO NOTHING;

-- Existing external_identity_id owner registration remains unchanged.

COMMIT;
