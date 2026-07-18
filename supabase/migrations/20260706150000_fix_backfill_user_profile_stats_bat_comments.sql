-- Fix backfill_user_profile_stats(uuid): referenced a nonexistent `bat_comments`
-- table in two places, which threw before either comment-count query ran,
-- so profiles.total_comments/total_listings/total_bids/total_auction_wins
-- could never be backfilled for ANY user (e.g. Skylar's claimed bat/skylarwilliams
-- identity always showed total_listings=0).
--
-- Root cause + fix sketch already filed: .claude/ISSUES.md
-- "[MEDIUM] `backfill_user_profile_stats(uuid)` references nonexistent `bat_comments`"
-- (Source: PROFILE-FIX session 2026-05-26)
--
-- Also fixes a second, latent bug in the same function: the old comment-count
-- block did `SELECT COUNT(*) INTO v_comments FROM bat_comments ... UNION ALL
-- SELECT COUNT(*) FROM auction_comments ...` — a plain (non-STRICT) SELECT INTO
-- against a 2-row UNION ALL silently keeps only the FIRST row, so even if
-- bat_comments existed the auction_comments count would never have counted.
-- Replaced with a single COUNT(*) against auction_comments (the only comment
-- table that actually carries entity-claim linkage via external_identity_id).
--
-- Verified before this migration: bat_comments does NOT exist in
-- information_schema.tables; auction_comments does, with columns
-- external_identity_id (uuid) and posted_at (timestamptz).

CREATE OR REPLACE FUNCTION public.backfill_user_profile_stats(p_user_id uuid)
 RETURNS TABLE(total_listings integer, total_bids integer, total_comments integer, total_wins integer, total_success_stories integer, member_since timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_listings INTEGER := 0;
  v_bids INTEGER := 0;
  v_comments INTEGER := 0;
  v_wins INTEGER := 0;
  v_stories INTEGER := 0;
  v_member_since TIMESTAMPTZ;
  v_external_identity_ids UUID[];
BEGIN
  -- Get all external identities claimed by this user
  SELECT ARRAY_AGG(id) INTO v_external_identity_ids
  FROM external_identities
  WHERE claimed_by_user_id = p_user_id;

  -- Count listings (vehicles sold by this user on BaT)
  SELECT COUNT(*) INTO v_listings
  FROM bat_listings bl
  WHERE bl.seller_external_identity_id = ANY(v_external_identity_ids)
     OR EXISTS (
       SELECT 1 FROM external_identities ei
       WHERE ei.id = bl.seller_external_identity_id
         AND ei.claimed_by_user_id = p_user_id
     );

  -- Count bids (from bat_bids table - all bids placed)
  SELECT COUNT(*) INTO v_bids
  FROM bat_bids bb
  WHERE bb.external_identity_id = ANY(v_external_identity_ids)
     OR EXISTS (
       SELECT 1 FROM external_identities ei
       WHERE ei.id = bb.external_identity_id
         AND ei.claimed_by_user_id = p_user_id
     );

  -- Count comments (auction_comments — bat_comments table does not exist)
  SELECT COUNT(*) INTO v_comments
  FROM auction_comments ac
  WHERE ac.external_identity_id = ANY(v_external_identity_ids);

  -- Count auction wins (BaT listings where user is buyer)
  SELECT COUNT(*) INTO v_wins
  FROM bat_listings bl
  WHERE (bl.buyer_external_identity_id = ANY(v_external_identity_ids)
     OR EXISTS (
       SELECT 1 FROM external_identities ei
       WHERE ei.id = bl.buyer_external_identity_id
         AND ei.claimed_by_user_id = p_user_id
     ))
    AND bl.listing_status = 'sold';

  -- Count success stories
  SELECT COUNT(*) INTO v_stories
  FROM success_stories
  WHERE user_id = p_user_id;

  -- Find earliest activity (member since)
  SELECT LEAST(
    (SELECT MIN(created_at) FROM profiles WHERE id = p_user_id),
    (SELECT MIN(first_seen_at) FROM external_identities WHERE claimed_by_user_id = p_user_id),
    (SELECT MIN(created_at) FROM vehicles WHERE uploaded_by = p_user_id),
    (SELECT MIN(ac.posted_at) FROM auction_comments ac
     JOIN external_identities ei ON ei.id = ac.external_identity_id
     WHERE ei.claimed_by_user_id = p_user_id),
    (SELECT MIN(bid_timestamp) FROM bat_bids bb
     JOIN external_identities ei ON ei.id = bb.external_identity_id
     WHERE ei.claimed_by_user_id = p_user_id)
  ) INTO v_member_since;

  -- Update profiles table
  UPDATE profiles
  SET
    total_listings = v_listings,
    total_bids = v_bids,
    total_comments = v_comments,
    total_auction_wins = v_wins,
    total_success_stories = v_stories,
    member_since = v_member_since,
    updated_at = NOW()
  WHERE id = p_user_id;

  RETURN QUERY SELECT v_listings, v_bids, v_comments, v_wins, v_stories, v_member_since;
END;
$function$
;
