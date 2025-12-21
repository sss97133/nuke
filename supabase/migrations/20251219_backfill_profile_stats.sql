-- ============================================================
-- BACKFILL PROFILE STATS
-- Populates profile stats from existing BaT data
-- ============================================================

-- Function to backfill a single user's profile stats
CREATE OR REPLACE FUNCTION backfill_user_profile_stats(p_user_id UUID)
RETURNS void AS $$
DECLARE
  v_listings INTEGER := 0;
  v_bids INTEGER := 0;
  v_comments INTEGER := 0;
  v_wins INTEGER := 0;
  v_stories INTEGER := 0;
  v_member_since TIMESTAMPTZ;
  v_external_identity_ids UUID[];
BEGIN
  -- Get external identities for this user
  SELECT ARRAY_AGG(id) INTO v_external_identity_ids
  FROM external_identities
  WHERE claimed_by_user_id = p_user_id;

  -- Count listings (BaT listings where user is seller)
  SELECT COUNT(*) INTO v_listings
  FROM bat_listings bl
  WHERE bl.seller_external_identity_id = ANY(v_external_identity_ids)
     OR EXISTS (
       SELECT 1 FROM external_identities ei
       WHERE ei.id = bl.seller_external_identity_id
         AND ei.claimed_by_user_id = p_user_id
     );

  -- Count bids (auction bids + BaT listings where user is buyer)
  SELECT COUNT(*) INTO v_bids
  FROM auction_bids
  WHERE bidder_id = p_user_id
  UNION ALL
  SELECT COUNT(*)
  FROM bat_listings bl
  WHERE bl.buyer_external_identity_id = ANY(v_external_identity_ids)
     OR EXISTS (
       SELECT 1 FROM external_identities ei
       WHERE ei.id = bl.buyer_external_identity_id
         AND ei.claimed_by_user_id = p_user_id
     );

  -- Count comments (BaT comments + auction comments)
  SELECT COUNT(*) INTO v_comments
  FROM bat_comments bc
  WHERE bc.external_identity_id = ANY(v_external_identity_ids)
  UNION ALL
  SELECT COUNT(*)
  FROM auction_comments ac
  WHERE ac.external_identity_id = ANY(v_external_identity_ids);

  -- Count auction wins
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
    (SELECT MIN(created_at) FROM vehicles WHERE user_id = p_user_id),
    (SELECT MIN(comment_timestamp) FROM bat_comments bc
     JOIN external_identities ei ON ei.id = bc.external_identity_id
     WHERE ei.claimed_by_user_id = p_user_id),
    (SELECT MIN(created_at) FROM auction_bids WHERE bidder_id = p_user_id)
  ) INTO v_member_since;

  -- Update profile
  UPDATE profiles
  SET 
    total_listings = v_listings,
    total_bids = v_bids,
    total_comments = v_comments,
    total_auction_wins = v_wins,
    total_success_stories = v_stories,
    member_since = COALESCE(v_member_since, created_at),
    updated_at = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to backfill a single organization's profile stats
CREATE OR REPLACE FUNCTION backfill_organization_profile_stats(p_org_id UUID)
RETURNS void AS $$
DECLARE
  v_listings INTEGER := 0;
  v_bids INTEGER := 0;
  v_comments INTEGER := 0;
  v_wins INTEGER := 0;
  v_stories INTEGER := 0;
  v_member_since TIMESTAMPTZ;
  v_contributor_ids UUID[];
BEGIN
  -- Get contributor user IDs
  SELECT ARRAY_AGG(user_id) INTO v_contributor_ids
  FROM organization_contributors
  WHERE organization_id = p_org_id AND status = 'active';

  -- Count listings (BaT listings + auction events)
  SELECT COUNT(*) INTO v_listings
  FROM bat_listings
  WHERE organization_id = p_org_id
  UNION ALL
  SELECT COUNT(*)
  FROM auction_events ae
  JOIN organization_vehicles ov ON ov.vehicle_id = ae.vehicle_id
  WHERE ov.organization_id = p_org_id;

  -- Count bids (from organization members)
  SELECT COUNT(*) INTO v_bids
  FROM auction_bids ab
  WHERE ab.bidder_id = ANY(v_contributor_ids);

  -- Count comments (from organization members via external identities)
  SELECT COUNT(*) INTO v_comments
  FROM bat_comments bc
  WHERE bc.external_identity_id IN (
    SELECT id FROM external_identities
    WHERE claimed_by_user_id = ANY(v_contributor_ids)
  )
  UNION ALL
  SELECT COUNT(*)
  FROM auction_comments ac
  WHERE ac.external_identity_id IN (
    SELECT id FROM external_identities
    WHERE claimed_by_user_id = ANY(v_contributor_ids)
  );

  -- Count auction wins
  SELECT COUNT(*) INTO v_wins
  FROM bat_listings
  WHERE organization_id = p_org_id
    AND listing_status = 'sold';

  -- Count success stories
  SELECT COUNT(*) INTO v_stories
  FROM success_stories
  WHERE organization_id = p_org_id;

  -- Find earliest activity (member since)
  SELECT LEAST(
    (SELECT MIN(created_at) FROM businesses WHERE id = p_org_id),
    (SELECT MIN(created_at) FROM organization_vehicles WHERE organization_id = p_org_id),
    (SELECT MIN(auction_start_date) FROM bat_listings WHERE organization_id = p_org_id),
    (SELECT MIN(created_at) FROM organization_contributors WHERE organization_id = p_org_id)
  ) INTO v_member_since;

  -- Update organization
  UPDATE businesses
  SET 
    total_listings = v_listings,
    total_bids = v_bids,
    total_comments = v_comments,
    total_auction_wins = v_wins,
    total_success_stories = v_stories,
    member_since = COALESCE(v_member_since, created_at),
    updated_at = NOW()
  WHERE id = p_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to backfill all user profiles
CREATE OR REPLACE FUNCTION backfill_all_user_profile_stats()
RETURNS TABLE(user_id UUID, listings INTEGER, bids INTEGER, comments INTEGER, wins INTEGER, stories INTEGER) AS $$
DECLARE
  v_user RECORD;
BEGIN
  FOR v_user IN SELECT id FROM profiles LOOP
    BEGIN
      PERFORM backfill_user_profile_stats(v_user.id);
      
      RETURN QUERY
      SELECT 
        v_user.id,
        (SELECT total_listings FROM profiles WHERE id = v_user.id),
        (SELECT total_bids FROM profiles WHERE id = v_user.id),
        (SELECT total_comments FROM profiles WHERE id = v_user.id),
        (SELECT total_auction_wins FROM profiles WHERE id = v_user.id),
        (SELECT total_success_stories FROM profiles WHERE id = v_user.id);
    EXCEPTION
      WHEN OTHERS THEN
        -- Log error but continue
        RAISE WARNING 'Failed to backfill stats for user %: %', v_user.id, SQLERRM;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to backfill all organization profiles
CREATE OR REPLACE FUNCTION backfill_all_organization_profile_stats()
RETURNS TABLE(org_id UUID, listings INTEGER, bids INTEGER, comments INTEGER, wins INTEGER, stories INTEGER) AS $$
DECLARE
  v_org RECORD;
BEGIN
  FOR v_org IN SELECT id FROM businesses LOOP
    BEGIN
      PERFORM backfill_organization_profile_stats(v_org.id);
      
      RETURN QUERY
      SELECT 
        v_org.id,
        (SELECT total_listings FROM businesses WHERE id = v_org.id),
        (SELECT total_bids FROM businesses WHERE id = v_org.id),
        (SELECT total_comments FROM businesses WHERE id = v_org.id),
        (SELECT total_auction_wins FROM businesses WHERE id = v_org.id),
        (SELECT total_success_stories FROM businesses WHERE id = v_org.id);
    EXCEPTION
      WHEN OTHERS THEN
        -- Log error but continue
        RAISE WARNING 'Failed to backfill stats for org %: %', v_org.id, SQLERRM;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION backfill_user_profile_stats IS 'Backfill profile stats for a single user from existing BaT data';
COMMENT ON FUNCTION backfill_organization_profile_stats IS 'Backfill profile stats for a single organization from existing BaT data';
COMMENT ON FUNCTION backfill_all_user_profile_stats IS 'Backfill profile stats for all users (use with caution on large datasets)';
COMMENT ON FUNCTION backfill_all_organization_profile_stats IS 'Backfill profile stats for all organizations (use with caution on large datasets)';

