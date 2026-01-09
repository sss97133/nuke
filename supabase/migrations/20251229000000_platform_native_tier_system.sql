-- Platform-Native Tier System
-- Adds tier calculation based on daily documentation, platform engagement, and build quality
-- Extends existing commercial tier system with platform-native metrics

-- =====================================================
-- EXTEND TIER TABLES WITH PLATFORM METRICS
-- =====================================================

-- Add platform tier columns to seller_tiers
ALTER TABLE seller_tiers 
  ADD COLUMN IF NOT EXISTS platform_tier TEXT CHECK (platform_tier IN ('F', 'E', 'D', 'C', 'B', 'A')),
  ADD COLUMN IF NOT EXISTS platform_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_tier_breakdown JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS platform_tier_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS s_tier_eligibility_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS s_tier_invitation_status TEXT DEFAULT 'not_eligible' 
    CHECK (s_tier_invitation_status IN ('not_eligible', 'tracking', 'eligible', 'invited', 'declined')),
  ADD COLUMN IF NOT EXISTS s_tier_eligibility_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eligibility_tracks JSONB DEFAULT '{}'::jsonb;

-- Add platform tier columns to buyer_tiers
ALTER TABLE buyer_tiers 
  ADD COLUMN IF NOT EXISTS platform_tier TEXT CHECK (platform_tier IN ('F', 'E', 'D', 'C', 'B', 'A')),
  ADD COLUMN IF NOT EXISTS platform_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_tier_breakdown JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS platform_tier_updated_at TIMESTAMPTZ;

-- Indexes for platform tiers
CREATE INDEX IF NOT EXISTS idx_seller_tiers_platform_tier ON seller_tiers(platform_tier);
CREATE INDEX IF NOT EXISTS idx_seller_tiers_platform_score ON seller_tiers(platform_score DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_tiers_platform_tier ON buyer_tiers(platform_tier);
CREATE INDEX IF NOT EXISTS idx_buyer_tiers_platform_score ON buyer_tiers(platform_score DESC);

-- =====================================================
-- LAYER 1: DAILY DOCUMENTATION ENGAGEMENT (0-25 points)
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_daily_engagement_layer(
  p_user_id UUID,
  p_vehicle_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_daily_frequency_score INTEGER := 0;
  v_velocity_score INTEGER := 0;
  v_total_score INTEGER := 0;
  v_upload_dates DATE[];
  v_max_consecutive INTEGER := 0;
  v_items_per_day DECIMAL;
  v_days_in_30 INTEGER;
  v_days_per_week DECIMAL;
  v_recent_activity INTEGER;
  v_old_activity INTEGER;
BEGIN
  -- Get all upload dates from images, timeline events, and receipts
  WITH all_activity AS (
    SELECT DISTINCT DATE(created_at) as activity_date
    FROM vehicle_images
    WHERE user_id = p_user_id
    UNION
    SELECT DISTINCT DATE(created_at) as activity_date
    FROM vehicle_timeline_events
    WHERE user_id = p_user_id
    UNION
    SELECT DISTINCT DATE(created_at) as activity_date
    FROM vehicle_receipts
    WHERE user_id = p_user_id
  )
  SELECT array_agg(activity_date ORDER BY activity_date) INTO v_upload_dates
  FROM all_activity
  WHERE activity_date >= CURRENT_DATE - INTERVAL '90 days';
  
  -- Calculate consecutive days
  IF v_upload_dates IS NOT NULL AND array_length(v_upload_dates, 1) > 0 THEN
    v_max_consecutive := calculate_max_consecutive_days(v_upload_dates);
    
    -- Daily frequency score (0-15 points)
    IF v_max_consecutive >= 30 THEN
      v_daily_frequency_score := 15;
    ELSIF v_max_consecutive >= 14 THEN
      v_daily_frequency_score := 12;
    ELSIF v_max_consecutive >= 7 THEN
      v_daily_frequency_score := 8;
    ELSE
      -- Calculate days per week
      v_days_in_30 := array_length(
        (SELECT array_agg(DISTINCT activity_date) 
         FROM unnest(v_upload_dates) activity_date 
         WHERE activity_date >= CURRENT_DATE - INTERVAL '30 days'),
        1
      );
      v_days_per_week := COALESCE((v_days_in_30::DECIMAL / 4.33), 0);
      
      IF v_days_per_week >= 5 THEN
        v_daily_frequency_score := 6;
      ELSIF v_days_per_week >= 3 THEN
        v_daily_frequency_score := 4;
      ELSIF v_days_per_week >= 1 THEN
        v_daily_frequency_score := 2;
      END IF;
    END IF;
  END IF;
  
  -- Calculate documentation velocity (items per day)
  WITH activity_counts AS (
    SELECT 
      DATE(created_at) as activity_date,
      COUNT(*) as items
    FROM (
      SELECT created_at FROM vehicle_images WHERE user_id = p_user_id
      UNION ALL
      SELECT created_at FROM vehicle_timeline_events WHERE user_id = p_user_id
      UNION ALL
      SELECT created_at FROM vehicle_receipts WHERE user_id = p_user_id
    ) all_activity
    WHERE DATE(created_at) >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY DATE(created_at)
  )
  SELECT COALESCE(AVG(items), 0) INTO v_items_per_day
  FROM activity_counts;
  
  -- Velocity score (0-10 points)
  IF v_items_per_day >= 10 THEN
    v_velocity_score := 10;
  ELSIF v_items_per_day >= 5 THEN
    v_velocity_score := 8;
  ELSIF v_items_per_day >= 3 THEN
    v_velocity_score := 6;
  ELSIF v_items_per_day >= 1 THEN
    v_velocity_score := 4;
  ELSIF v_items_per_day > 0 THEN
    v_velocity_score := 2;
  END IF;
  
  -- Apply temporal decay (weight recent activity more)
  SELECT COUNT(DISTINCT DATE(created_at)) INTO v_recent_activity
  FROM (
    SELECT created_at FROM vehicle_images WHERE user_id = p_user_id
    UNION
    SELECT created_at FROM vehicle_timeline_events WHERE user_id = p_user_id
  ) activity
  WHERE DATE(created_at) >= CURRENT_DATE - INTERVAL '7 days';
  
  SELECT COUNT(DISTINCT DATE(created_at)) INTO v_old_activity
  FROM (
    SELECT created_at FROM vehicle_images WHERE user_id = p_user_id
    UNION
    SELECT created_at FROM vehicle_timeline_events WHERE user_id = p_user_id
  ) activity
  WHERE DATE(created_at) < CURRENT_DATE - INTERVAL '7 days'
    AND DATE(created_at) >= CURRENT_DATE - INTERVAL '90 days';
  
  -- If no recent activity, apply decay
  IF v_recent_activity = 0 AND v_old_activity > 0 THEN
    v_daily_frequency_score := LEAST(10, v_daily_frequency_score * 0.5)::INTEGER;
    v_velocity_score := LEAST(5, v_velocity_score * 0.5)::INTEGER;
  END IF;
  
  v_total_score := v_daily_frequency_score + v_velocity_score;
  
  RETURN LEAST(25, v_total_score);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Helper function to calculate max consecutive days
CREATE OR REPLACE FUNCTION calculate_max_consecutive_days(date_array DATE[])
RETURNS INTEGER AS $$
DECLARE
  v_max_consecutive INTEGER := 0;
  v_current_consecutive INTEGER := 1;
  v_prev_date DATE;
  v_current_date DATE;
  i INTEGER;
BEGIN
  IF date_array IS NULL OR array_length(date_array, 1) IS NULL OR array_length(date_array, 1) = 0 THEN
    RETURN 0;
  END IF;
  
  -- Sort and process dates
  FOR i IN 1..array_length(date_array, 1) LOOP
    v_current_date := date_array[i];
    
    IF i > 1 THEN
      IF v_current_date = v_prev_date + 1 THEN
        v_current_consecutive := v_current_consecutive + 1;
      ELSE
        v_max_consecutive := GREATEST(v_max_consecutive, v_current_consecutive);
        v_current_consecutive := 1;
      END IF;
    END IF;
    
    v_prev_date := v_current_date;
  END LOOP;
  
  v_max_consecutive := GREATEST(v_max_consecutive, v_current_consecutive);
  
  RETURN v_max_consecutive;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- LAYER 2: DOCUMENTATION QUALITY & DEPTH (0-20 points)
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_doc_quality_layer(
  p_user_id UUID,
  p_vehicle_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_visual_score INTEGER := 0;
  v_receipt_score INTEGER := 0;
  v_timeline_score INTEGER := 0;
  v_total_score INTEGER := 0;
  v_image_count INTEGER;
  v_receipt_count INTEGER;
  v_event_count INTEGER;
  v_tag_count INTEGER;
  v_receipts_with_events INTEGER;
  v_receipts_with_parts INTEGER;
  v_vehicle_filter TEXT;
  v_events_with_dates INTEGER;
BEGIN
  -- Build vehicle filter
  IF p_vehicle_id IS NOT NULL THEN
    v_vehicle_filter := format('AND vehicle_id = %L', p_vehicle_id);
  ELSE
    v_vehicle_filter := '';
  END IF;
  
  -- Get counts for user's vehicles
  EXECUTE format('
    SELECT 
      COUNT(DISTINCT vi.id),
      COUNT(DISTINCT vr.id),
      COUNT(DISTINCT vte.id),
      COUNT(DISTINCT it.id)
    FROM vehicles v
    LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
    LEFT JOIN vehicle_receipts vr ON v.id = vr.vehicle_id
    LEFT JOIN vehicle_timeline_events vte ON v.id = vte.vehicle_id
    LEFT JOIN image_tags it ON v.id = it.vehicle_id
    WHERE v.user_id = %L %s
  ', p_user_id, v_vehicle_filter)
  INTO v_image_count, v_receipt_count, v_event_count, v_tag_count;
  
  -- Visual documentation score (0-8 points)
  IF v_image_count >= 300 THEN
    v_visual_score := 8;
  ELSIF v_image_count >= 200 THEN
    v_visual_score := 6;
  ELSIF v_image_count >= 100 THEN
    v_visual_score := 4;
  ELSIF v_image_count >= 50 THEN
    v_visual_score := 2;
  END IF;
  
  -- Receipt documentation score (0-6 points)
  IF v_receipt_count >= 50 THEN
    v_receipt_score := 6;
  ELSIF v_receipt_count >= 30 THEN
    v_receipt_score := 5;
  ELSIF v_receipt_count >= 20 THEN
    v_receipt_score := 4;
  ELSIF v_receipt_count >= 10 THEN
    v_receipt_score := 3;
  ELSIF v_receipt_count >= 5 THEN
    v_receipt_score := 2;
  END IF;
  
  -- Check receipt quality (linked to events, part numbers)
  IF v_receipt_count > 0 THEN
    EXECUTE format('
      SELECT 
        COUNT(DISTINCT vr.id) FILTER (WHERE vte.id IS NOT NULL),
        COUNT(DISTINCT vr.id) FILTER (WHERE vr.part_number IS NOT NULL OR vr.metadata->>''part_number'' IS NOT NULL)
      FROM vehicle_receipts vr
      LEFT JOIN vehicle_timeline_events vte ON vr.timeline_event_id = vte.id
      JOIN vehicles v ON vr.vehicle_id = v.id
      WHERE v.user_id = %L %s
    ', p_user_id, v_vehicle_filter)
    INTO v_receipts_with_events, v_receipts_with_parts;
    
    -- Quality multiplier
    IF v_receipts_with_events::DECIMAL / v_receipt_count >= 0.8 THEN
      v_receipt_score := LEAST(6, v_receipt_score + 1);  -- +1 for linked receipts
    END IF;
    
    IF v_receipts_with_parts::DECIMAL / v_receipt_count >= 0.8 THEN
      v_receipt_score := LEAST(6, v_receipt_score + 1);  -- +1 for part numbers
    END IF;
  END IF;
  
  -- Timeline completeness score (0-6 points)
  IF v_event_count >= 150 THEN
    v_timeline_score := 6;
  ELSIF v_event_count >= 100 THEN
    v_timeline_score := 5;
  ELSIF v_event_count >= 50 THEN
    v_timeline_score := 4;
  ELSIF v_event_count >= 20 THEN
    v_timeline_score := 2;
  END IF;
  
  -- Bonus for temporal consistency (events with EXIF dates)
  IF v_event_count > 0 THEN
    IF p_vehicle_id IS NOT NULL THEN
      SELECT COUNT(*) FILTER (WHERE event_date IS NOT NULL OR metadata->>'exif_date' IS NOT NULL)
      INTO v_events_with_dates
      FROM vehicle_timeline_events vte
      WHERE vte.vehicle_id = p_vehicle_id;
    ELSE
      SELECT COUNT(*) FILTER (WHERE event_date IS NOT NULL OR metadata->>'exif_date' IS NOT NULL)
      INTO v_events_with_dates
      FROM vehicle_timeline_events vte
      JOIN vehicles v ON vte.vehicle_id = v.id
      WHERE v.user_id = p_user_id;
    END IF;
    
    IF (v_events_with_dates::DECIMAL / NULLIF(v_event_count, 0)) >= 0.8 THEN
      v_timeline_score := LEAST(6, v_timeline_score + 1);  -- +1 for EXIF dates
    END IF;
  END IF;
  
  v_total_score := v_visual_score + v_receipt_score + v_timeline_score;
  
  RETURN LEAST(20, v_total_score);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- LAYER 3: TEMPORAL VALUE & BUILD RECENCY (0-15 points)
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_temporal_value_layer(
  p_user_id UUID,
  p_vehicle_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_recency_score INTEGER := 0;
  v_realtime_score INTEGER := 0;
  v_total_score INTEGER := 0;
  v_oldest_event_date DATE;
  v_newest_event_date DATE;
  v_build_duration_months DECIMAL;
  v_recent_build BOOLEAN := FALSE;
  v_docs_during_build INTEGER := 0;
  v_docs_after_build INTEGER := 0;
  v_daily_docs INTEGER;
  v_exif_matches INTEGER;
  v_total_images INTEGER;
BEGIN
  -- Get build timeframe from timeline events
  IF p_vehicle_id IS NOT NULL THEN
    SELECT 
      MIN(event_date),
      MAX(event_date)
    INTO v_oldest_event_date, v_newest_event_date
    FROM vehicle_timeline_events vte
    WHERE vte.vehicle_id = p_vehicle_id
      AND event_date IS NOT NULL;
  ELSE
    SELECT 
      MIN(event_date),
      MAX(event_date)
    INTO v_oldest_event_date, v_newest_event_date
    FROM vehicle_timeline_events vte
    JOIN vehicles v ON vte.vehicle_id = v.id
    WHERE v.user_id = p_user_id
      AND event_date IS NOT NULL;
  END IF;
  
  -- Calculate build duration
  IF v_oldest_event_date IS NOT NULL AND v_newest_event_date IS NOT NULL THEN
    v_build_duration_months := EXTRACT(EPOCH FROM (v_newest_event_date - v_oldest_event_date)) / 2592000.0;
    
    -- Check if build is recent (within last 2 years)
    IF v_newest_event_date >= CURRENT_DATE - INTERVAL '2 years' THEN
      v_recent_build := TRUE;
    END IF;
  END IF;
  
  -- Recency score (0-10 points)
  IF v_recent_build AND v_build_duration_months IS NOT NULL AND v_build_duration_months > 0 THEN
    -- Recent build with documentation - check if documented daily during build
    IF p_vehicle_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT DATE(vi.created_at))
      INTO v_daily_docs
      FROM vehicle_images vi
      WHERE vi.vehicle_id = p_vehicle_id
        AND DATE(vi.created_at) BETWEEN v_oldest_event_date AND v_newest_event_date;
    ELSE
      SELECT COUNT(DISTINCT DATE(vi.created_at))
      INTO v_daily_docs
      FROM vehicle_images vi
      JOIN vehicles v ON vi.vehicle_id = v.id
      WHERE v.user_id = p_user_id
        AND DATE(vi.created_at) BETWEEN v_oldest_event_date AND v_newest_event_date;
    END IF;
    
    IF v_daily_docs >= (v_build_duration_months * 20)::INTEGER THEN  -- ~20 days per month = daily
      v_recency_score := 10;  -- Recent build, documented daily
    ELSIF v_daily_docs >= (v_build_duration_months * 10)::INTEGER THEN
      v_recency_score := 8;   -- Recent build, documented regularly
    ELSE
      v_recency_score := 6;   -- Recent build, documented
    END IF;
  ELSIF v_newest_event_date IS NOT NULL THEN
    IF v_newest_event_date >= CURRENT_DATE - INTERVAL '5 years' THEN
      v_recency_score := 6;  -- Build within 5 years
    ELSIF v_newest_event_date >= CURRENT_DATE - INTERVAL '10 years' THEN
      v_recency_score := 4;  -- Build 5-10 years ago
    ELSIF v_newest_event_date >= CURRENT_DATE - INTERVAL '20 years' THEN
      v_recency_score := 2;  -- Build 10-20 years ago
    ELSE
      v_recency_score := 1;  -- Build 20+ years ago, but documented
    END IF;
  END IF;
  
  -- Real-time documentation score (0-5 points)
  -- Check if documentation happened DURING build vs. AFTER
  IF v_oldest_event_date IS NOT NULL AND v_newest_event_date IS NOT NULL THEN
    -- Count docs during build period
    IF p_vehicle_id IS NOT NULL THEN
      SELECT COUNT(*)
      INTO v_docs_during_build
      FROM (
        SELECT created_at FROM vehicle_images WHERE vehicle_id = p_vehicle_id
        UNION ALL
        SELECT created_at FROM vehicle_timeline_events WHERE vehicle_id = p_vehicle_id
      ) docs
      WHERE DATE(created_at) BETWEEN v_oldest_event_date AND v_newest_event_date;
      
      -- Count docs after build
      SELECT COUNT(*)
      INTO v_docs_after_build
      FROM (
        SELECT created_at FROM vehicle_images WHERE vehicle_id = p_vehicle_id
        UNION ALL
        SELECT created_at FROM vehicle_timeline_events WHERE vehicle_id = p_vehicle_id
      ) docs
      WHERE DATE(created_at) > v_newest_event_date;
    ELSE
      SELECT COUNT(*)
      INTO v_docs_during_build
      FROM (
        SELECT vi.created_at FROM vehicle_images vi JOIN vehicles v ON vi.vehicle_id = v.id WHERE v.user_id = p_user_id
        UNION ALL
        SELECT vte.created_at FROM vehicle_timeline_events vte JOIN vehicles v ON vte.vehicle_id = v.id WHERE v.user_id = p_user_id
      ) docs
      WHERE DATE(created_at) BETWEEN v_oldest_event_date AND v_newest_event_date;
      
      -- Count docs after build
      SELECT COUNT(*)
      INTO v_docs_after_build
      FROM (
        SELECT vi.created_at FROM vehicle_images vi JOIN vehicles v ON vi.vehicle_id = v.id WHERE v.user_id = p_user_id
        UNION ALL
        SELECT vte.created_at FROM vehicle_timeline_events vte JOIN vehicles v ON vte.vehicle_id = v.id WHERE v.user_id = p_user_id
      ) docs
      WHERE DATE(created_at) > v_newest_event_date;
    END IF;
    
    -- Real-time score
    IF v_docs_during_build > 0 THEN
      IF (v_docs_after_build::DECIMAL / NULLIF((v_docs_during_build + v_docs_after_build), 0)) < 0.2 THEN
        v_realtime_score := 5;  -- Most docs during build (real-time)
      ELSIF (v_docs_after_build::DECIMAL / NULLIF((v_docs_during_build + v_docs_after_build), 0)) < 0.5 THEN
        v_realtime_score := 3;  -- Mix of during and after
      ELSE
        v_realtime_score := 1;  -- Most docs after build (retroactive)
      END IF;
      
      -- Check EXIF dates match event dates (authentic timing)
      IF p_vehicle_id IS NOT NULL THEN
        SELECT 
          COUNT(*) FILTER (WHERE DATE(vi.taken_at) = vte.event_date),
          COUNT(*)
        INTO v_exif_matches, v_total_images
        FROM vehicle_images vi
        JOIN vehicle_timeline_events vte ON vi.timeline_event_id = vte.id
        WHERE vi.vehicle_id = p_vehicle_id
          AND vi.taken_at IS NOT NULL
          AND vte.event_date IS NOT NULL;
      ELSE
        SELECT 
          COUNT(*) FILTER (WHERE DATE(vi.taken_at) = vte.event_date),
          COUNT(*)
        INTO v_exif_matches, v_total_images
        FROM vehicle_images vi
        JOIN vehicle_timeline_events vte ON vi.timeline_event_id = vte.id
        JOIN vehicles v ON vi.vehicle_id = v.id
        WHERE v.user_id = p_user_id
          AND vi.taken_at IS NOT NULL
          AND vte.event_date IS NOT NULL;
      END IF;
      
      IF v_total_images > 0 AND (v_exif_matches::DECIMAL / v_total_images) >= 0.8 THEN
        v_realtime_score := LEAST(5, v_realtime_score + 2);  -- +2 for EXIF matches
      END IF;
    END IF;
  END IF;
  
  v_total_score := v_recency_score + v_realtime_score;
  
  RETURN LEAST(15, v_total_score);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- LAYER 4: MATERIAL QUALITY & PARTS PROVENANCE (0-15 points)
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_material_quality_layer(
  p_vehicle_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_parts_quality_score INTEGER := 0;
  v_verification_score INTEGER := 0;
  v_receipt_quality_score INTEGER := 0;
  v_total_score INTEGER := 0;
  v_oem_count INTEGER := 0;
  v_total_parts INTEGER := 0;
  v_oem_percentage DECIMAL;
  v_tag_count INTEGER;
  v_receipts_with_parts INTEGER;
  v_total_receipts INTEGER;
  v_vehicle_filter TEXT;
BEGIN
  -- Build vehicle filter
  IF p_vehicle_id IS NOT NULL THEN
    v_vehicle_filter := format('WHERE vehicle_id = %L', p_vehicle_id);
  ELSE
    v_vehicle_filter := '';
  END IF;
  
  -- Calculate OEM percentage from image_tags
  EXECUTE format('
    SELECT 
      COUNT(*) FILTER (WHERE 
        tag_name ILIKE ''%OEM%'' OR 
        tag_name ILIKE ''%original%'' OR
        oem_part_number IS NOT NULL OR
        metadata->>''part_type'' = ''OEM''
      ),
      COUNT(*)
    FROM image_tags
    %s
  ', v_vehicle_filter)
  INTO v_oem_count, v_total_parts;
  
  -- Parts quality score (0-8 points)
  IF v_total_parts > 0 THEN
    v_oem_percentage := (v_oem_count::DECIMAL / v_total_parts) * 100;
    
    IF v_oem_percentage >= 80 THEN
      v_parts_quality_score := 8;
    ELSIF v_oem_percentage >= 60 THEN
      v_parts_quality_score := 6;
    ELSIF v_oem_percentage >= 40 THEN
      v_parts_quality_score := 4;
    ELSIF v_oem_percentage >= 20 THEN
      v_parts_quality_score := 2;
    END IF;
  ELSE
    -- No parts tagged - can only get visual assessment score
    -- This would require AI analysis, for now return minimal score
    v_parts_quality_score := 2;
  END IF;
  
  -- Parts verification score (0-4 points)
  EXECUTE format('
    SELECT COUNT(DISTINCT id)
    FROM image_tags
    %s
  ', v_vehicle_filter)
  INTO v_tag_count;
  
  IF v_tag_count >= 75 THEN
    v_verification_score := 4;
  ELSIF v_tag_count >= 50 THEN
    v_verification_score := 3;
  ELSIF v_tag_count >= 25 THEN
    v_verification_score := 2;
  ELSIF v_tag_count >= 10 THEN
    v_verification_score := 1;
  END IF;
  
  -- Receipt quality for parts (0-3 points)
  EXECUTE format('
    SELECT 
      COUNT(*) FILTER (WHERE part_number IS NOT NULL OR metadata->>''part_number'' IS NOT NULL),
      COUNT(*)
    FROM vehicle_receipts
    %s
  ', v_vehicle_filter)
  INTO v_receipts_with_parts, v_total_receipts;
  
  IF v_total_receipts > 0 THEN
    IF (v_receipts_with_parts::DECIMAL / v_total_receipts) >= 0.8 THEN
      v_receipt_quality_score := 3;
    ELSIF (v_receipts_with_parts::DECIMAL / v_total_receipts) >= 0.5 THEN
      v_receipt_quality_score := 2;
    ELSIF (v_receipts_with_parts::DECIMAL / v_total_receipts) >= 0.2 THEN
      v_receipt_quality_score := 1;
    END IF;
  END IF;
  
  v_total_score := v_parts_quality_score + v_verification_score + v_receipt_quality_score;
  
  RETURN LEAST(15, v_total_score);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- LAYER 5: RESTORER/BUILDER VERIFICATION (0-10 points)
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_verification_layer(
  p_user_id UUID,
  p_vehicle_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_verification_status_score INTEGER := 0;
  v_track_record_score INTEGER := 0;
  v_platform_integration_score INTEGER := 0;
  v_total_score INTEGER := 0;
  v_is_verified BOOLEAN := FALSE;
  v_organization_id UUID;
  v_other_builds INTEGER;
  v_avg_quality DECIMAL;
BEGIN
  -- Check if user is linked to verified organization via business_ownership
  -- Handle both organizations table and businesses table
  SELECT 
    bo.business_id,
    COALESCE(
      EXISTS(SELECT 1 FROM organizations o WHERE o.id = bo.business_id AND o.is_verified = TRUE),
      EXISTS(SELECT 1 FROM businesses b WHERE b.id = bo.business_id AND b.is_verified = TRUE),
      FALSE
    )
  INTO v_organization_id, v_is_verified
  FROM business_ownership bo
  WHERE bo.owner_id = p_user_id
  LIMIT 1;
  
  -- Also check organization_contributors (which references organizations or businesses)
  IF NOT v_is_verified THEN
    SELECT 
      oc.organization_id,
      COALESCE(
        EXISTS(SELECT 1 FROM organizations o WHERE o.id = oc.organization_id AND o.is_verified = TRUE),
        EXISTS(SELECT 1 FROM businesses b WHERE b.id = oc.organization_id AND b.is_verified = TRUE),
        FALSE
      )
    INTO v_organization_id, v_is_verified
    FROM organization_contributors oc
    WHERE oc.user_id = p_user_id
      AND oc.role IN ('owner', 'manager', 'employee')
    LIMIT 1;
  END IF;
  
  -- Verification status score (0-5 points)
  IF v_is_verified THEN
    v_verification_status_score := 5;
  ELSIF v_organization_id IS NOT NULL THEN
    v_verification_status_score := 3;
  ELSE
    -- Check if user has other builds
    SELECT COUNT(*) INTO v_other_builds
    FROM vehicles
    WHERE user_id = p_user_id
      AND id != COALESCE(p_vehicle_id, '00000000-0000-0000-0000-000000000000'::UUID);
    
    IF v_other_builds >= 1 THEN
      v_verification_status_score := 2;
    END IF;
  END IF;
  
  -- Builder track record score (0-5 points)
  SELECT 
    COUNT(*),
    COALESCE(AVG(vqs.overall_score), 0)
  INTO v_other_builds, v_avg_quality
  FROM vehicles v
  LEFT JOIN vehicle_quality_scores vqs ON v.id = vqs.vehicle_id
  WHERE v.user_id = p_user_id
    AND v.id != COALESCE(p_vehicle_id, '00000000-0000-0000-0000-000000000000'::UUID);
  
  IF v_other_builds >= 10 AND v_avg_quality >= 80 THEN
    v_track_record_score := 5;
  ELSIF v_other_builds >= 5 AND v_avg_quality >= 80 THEN
    v_track_record_score := 4;
  ELSIF v_other_builds >= 3 AND v_avg_quality >= 70 THEN
    v_track_record_score := 3;
  ELSIF v_other_builds >= 1 AND v_avg_quality >= 70 THEN
    v_track_record_score := 2;
  END IF;
  
  -- Platform integration bonus (0-2 points)
  IF v_other_builds >= 5 THEN
    v_platform_integration_score := 2;
  ELSIF v_other_builds >= 1 THEN
    v_platform_integration_score := 1;
  END IF;
  
  v_total_score := v_verification_status_score + v_track_record_score + v_platform_integration_score;
  
  RETURN LEAST(10, v_total_score);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- LAYER 6: EXTERNAL INTEGRATION & STREAMING (0-10 points)
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_integration_layer(
  p_user_id UUID,
  p_vehicle_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_instagram_score INTEGER := 0;
  v_streaming_score INTEGER := 0;
  v_total_score INTEGER := 0;
  v_has_instagram BOOLEAN := FALSE;
  v_instagram_auto_sync BOOLEAN := FALSE;
  v_instagram_posts INTEGER := 0;
  v_has_streaming BOOLEAN := FALSE;
  v_daily_insta_posts INTEGER;
  v_streaming_sessions INTEGER;
  v_video_count INTEGER;
BEGIN
  -- Check Instagram integration
  SELECT 
    EXISTS(SELECT 1 FROM external_identities WHERE user_id = p_user_id AND platform = 'instagram'),
    EXISTS(SELECT 1 
           FROM vehicle_timeline_events vte
           JOIN vehicles v ON vte.vehicle_id = v.id
           WHERE v.user_id = p_user_id
             AND vte.metadata->>'instagram_post_id' IS NOT NULL
             AND vte.metadata->>'auto_synced' = 'true')
  INTO v_has_instagram, v_instagram_auto_sync;
  
  -- Count Instagram posts in timeline
  IF v_has_instagram THEN
    IF p_vehicle_id IS NOT NULL THEN
      SELECT COUNT(*)
      INTO v_instagram_posts
      FROM vehicle_timeline_events vte
      WHERE vte.vehicle_id = p_vehicle_id
        AND (vte.metadata->>'instagram_post_id' IS NOT NULL
         OR vte.metadata->>'source' = 'instagram');
    ELSE
      SELECT COUNT(*)
      INTO v_instagram_posts
      FROM vehicle_timeline_events vte
      JOIN vehicles v ON vte.vehicle_id = v.id
      WHERE v.user_id = p_user_id
        AND (vte.metadata->>'instagram_post_id' IS NOT NULL
         OR vte.metadata->>'source' = 'instagram');
    END IF;
    
    -- Instagram integration score (0-6 points)
    IF v_instagram_auto_sync AND v_instagram_posts >= 30 THEN
      v_instagram_score := 6;  -- Auto-sync enabled, many posts
    ELSIF v_instagram_auto_sync THEN
      v_instagram_score := 5;  -- Auto-sync enabled
    ELSIF v_instagram_posts >= 20 THEN
      v_instagram_score := 4;  -- Manual linking, many posts
    ELSIF v_instagram_posts >= 1 THEN
      v_instagram_score := 3;  -- Manual linking, some posts
    ELSIF v_has_instagram THEN
      v_instagram_score := 1;  -- Account linked but not used
    END IF;
    
    -- Bonus for daily Instagram posts during build
    IF p_vehicle_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT DATE(created_at))
      INTO v_daily_insta_posts
      FROM vehicle_timeline_events vte
      WHERE vte.vehicle_id = p_vehicle_id
        AND (vte.metadata->>'instagram_post_id' IS NOT NULL
         OR vte.metadata->>'source' = 'instagram')
        AND vte.created_at >= CURRENT_DATE - INTERVAL '30 days';
    ELSE
      SELECT COUNT(DISTINCT DATE(created_at))
      INTO v_daily_insta_posts
      FROM vehicle_timeline_events vte
      JOIN vehicles v ON vte.vehicle_id = v.id
      WHERE v.user_id = p_user_id
        AND (vte.metadata->>'instagram_post_id' IS NOT NULL
         OR vte.metadata->>'source' = 'instagram')
        AND vte.created_at >= CURRENT_DATE - INTERVAL '30 days';
    END IF;
    
    IF v_daily_insta_posts >= 20 THEN
      v_instagram_score := LEAST(6, v_instagram_score + 2);  -- +2 for daily posts
    ELSIF v_daily_insta_posts >= 10 THEN
      v_instagram_score := LEAST(6, v_instagram_score + 1);  -- +1 for regular posts
    END IF;
  END IF;
  
  -- Check for streaming/video documentation
  IF p_vehicle_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1
      FROM vehicle_timeline_events vte
      WHERE vte.vehicle_id = p_vehicle_id
        AND (
          vte.event_type IN ('live_stream', 'video_documentation', 'time_lapse')
          OR vte.metadata->>'has_video' = 'true'
          OR vte.metadata->>'streaming_session_id' IS NOT NULL
        )
    )
    INTO v_has_streaming;
  ELSE
    SELECT EXISTS(
      SELECT 1
      FROM vehicle_timeline_events vte
      JOIN vehicles v ON vte.vehicle_id = v.id
      WHERE v.user_id = p_user_id
        AND (
          vte.event_type IN ('live_stream', 'video_documentation', 'time_lapse')
          OR vte.metadata->>'has_video' = 'true'
          OR vte.metadata->>'streaming_session_id' IS NOT NULL
        )
    )
    INTO v_has_streaming;
  END IF;
  
  -- Streaming score (0-4 points)
  IF v_has_streaming THEN
    IF p_vehicle_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT vte.metadata->>'streaming_session_id')
      INTO v_streaming_sessions
      FROM vehicle_timeline_events vte
      WHERE vte.vehicle_id = p_vehicle_id
        AND vte.event_type = 'live_stream';
    ELSE
      SELECT COUNT(DISTINCT vte.metadata->>'streaming_session_id')
      INTO v_streaming_sessions
      FROM vehicle_timeline_events vte
      JOIN vehicles v ON vte.vehicle_id = v.id
      WHERE v.user_id = p_user_id
        AND vte.event_type = 'live_stream';
    END IF;
    
    IF v_streaming_sessions >= 5 THEN
      v_streaming_score := 4;  -- Multiple streaming sessions
    ELSIF v_streaming_sessions >= 1 THEN
      v_streaming_score := 3;  -- Some streaming
    ELSE
      -- Check for video documentation
      IF p_vehicle_id IS NOT NULL THEN
        SELECT COUNT(*)
        INTO v_video_count
        FROM vehicle_timeline_events vte
        WHERE vte.vehicle_id = p_vehicle_id
          AND (vte.event_type = 'video_documentation'
           OR vte.metadata->>'has_video' = 'true');
      ELSE
        SELECT COUNT(*)
        INTO v_video_count
        FROM vehicle_timeline_events vte
        JOIN vehicles v ON vte.vehicle_id = v.id
        WHERE v.user_id = p_user_id
          AND (vte.event_type = 'video_documentation'
           OR vte.metadata->>'has_video' = 'true');
      END IF;
      
      IF v_video_count >= 10 THEN
        v_streaming_score := 3;  -- Time-lapse videos
      ELSIF v_video_count >= 1 THEN
        v_streaming_score := 2;  -- Video documentation
      ELSE
        v_streaming_score := 1;  -- Photo-only
      END IF;
    END IF;
  END IF;
  
  v_total_score := v_instagram_score + v_streaming_score;
  
  RETURN LEAST(10, v_total_score);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- MAIN PLATFORM TIER CALCULATION FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_platform_tier_score(
  p_user_id UUID,
  p_vehicle_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_daily_engagement INTEGER;
  v_doc_quality INTEGER;
  v_temporal_value INTEGER;
  v_material_quality INTEGER;
  v_verification INTEGER;
  v_integration INTEGER;
  v_total_score INTEGER;
  v_tier TEXT;
  v_breakdown JSONB;
BEGIN
  -- Calculate each layer
  v_daily_engagement := calculate_daily_engagement_layer(p_user_id, p_vehicle_id);
  v_doc_quality := calculate_doc_quality_layer(p_user_id, p_vehicle_id);
  v_temporal_value := calculate_temporal_value_layer(p_user_id, p_vehicle_id);
  v_material_quality := calculate_material_quality_layer(p_vehicle_id);
  v_verification := calculate_verification_layer(p_user_id, p_vehicle_id);
  v_integration := calculate_integration_layer(p_user_id, p_vehicle_id);
  
  -- Sum all layers (capped at 100)
  v_total_score := LEAST(100, 
    v_daily_engagement + 
    v_doc_quality + 
    v_temporal_value + 
    v_material_quality + 
    v_verification + 
    v_integration
  );
  
  -- Determine tier
  IF v_total_score >= 80 THEN
    v_tier := 'A';
  ELSIF v_total_score >= 65 THEN
    v_tier := 'B';
  ELSIF v_total_score >= 50 THEN
    v_tier := 'C';
  ELSIF v_total_score >= 35 THEN
    v_tier := 'D';
  ELSIF v_total_score >= 20 THEN
    v_tier := 'E';
  ELSE
    v_tier := 'F';
  END IF;
  
  -- Build breakdown JSONB
  v_breakdown := jsonb_build_object(
    'daily_engagement', v_daily_engagement,
    'doc_quality', v_doc_quality,
    'temporal_value', v_temporal_value,
    'material_quality', v_material_quality,
    'verification', v_verification,
    'integration', v_integration,
    'total_score', v_total_score,
    'tier', v_tier
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'platform_score', v_total_score,
    'platform_tier', v_tier,
    'breakdown', v_breakdown
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- MAIN PLATFORM TIER REFRESH FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION refresh_platform_tier(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_platform_score INTEGER;
  v_platform_tier TEXT;
  v_breakdown JSONB;
BEGIN
  -- Calculate platform tier score
  SELECT calculate_platform_tier_score(p_user_id) INTO v_result;
  
  v_platform_score := (v_result->>'platform_score')::INTEGER;
  v_platform_tier := v_result->>'platform_tier';
  v_breakdown := v_result->'breakdown';
  
  -- Update seller_tiers (users can be sellers)
  INSERT INTO seller_tiers (
    seller_id,
    platform_tier,
    platform_score,
    platform_tier_breakdown,
    platform_tier_updated_at
  ) VALUES (
    p_user_id,
    v_platform_tier,
    v_platform_score,
    v_breakdown,
    NOW()
  )
  ON CONFLICT (seller_id) DO UPDATE SET
    platform_tier = EXCLUDED.platform_tier,
    platform_score = EXCLUDED.platform_score,
    platform_tier_breakdown = EXCLUDED.platform_tier_breakdown,
    platform_tier_updated_at = NOW();
  
  -- Update buyer_tiers (users can be buyers too)
  INSERT INTO buyer_tiers (
    buyer_id,
    platform_tier,
    platform_score,
    platform_tier_breakdown,
    platform_tier_updated_at
  ) VALUES (
    p_user_id,
    v_platform_tier,
    v_platform_score,
    v_breakdown,
    NOW()
  )
  ON CONFLICT (buyer_id) DO UPDATE SET
    platform_tier = EXCLUDED.platform_tier,
    platform_score = EXCLUDED.platform_score,
    platform_tier_breakdown = EXCLUDED.platform_tier_breakdown,
    platform_tier_updated_at = NOW();
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- PLATFORM ACTIVITY TRIGGERS (WITH DEBOUNCING)
-- =====================================================

-- Trigger function with debouncing (max once per 5 minutes per user)
CREATE OR REPLACE FUNCTION trigger_refresh_platform_tier()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_last_refresh TIMESTAMPTZ;
BEGIN
  -- Determine user_id from the trigger context
  IF TG_TABLE_NAME = 'vehicle_images' THEN
    v_user_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'vehicle_timeline_events' THEN
    v_user_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'vehicle_receipts' THEN
    -- vehicle_receipts might not have user_id, get from vehicle
    SELECT user_id INTO v_user_id
    FROM vehicles
    WHERE id = NEW.vehicle_id;
  END IF;
  
  IF v_user_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Check last refresh time (debouncing - max once per 5 minutes)
  SELECT platform_tier_updated_at INTO v_last_refresh
  FROM seller_tiers
  WHERE seller_id = v_user_id;
  
  -- Only refresh if last refresh was more than 5 minutes ago, or never refreshed
  IF v_last_refresh IS NULL OR v_last_refresh < NOW() - INTERVAL '5 minutes' THEN
    PERFORM refresh_platform_tier(v_user_id);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger on vehicle_images upload
DROP TRIGGER IF EXISTS refresh_tier_on_image_upload ON vehicle_images;
CREATE TRIGGER refresh_tier_on_image_upload
  AFTER INSERT ON vehicle_images
  FOR EACH ROW
  WHEN (user_id IS NOT NULL)
  EXECUTE FUNCTION trigger_refresh_platform_tier();

-- Trigger on vehicle_timeline_events creation
DROP TRIGGER IF EXISTS refresh_tier_on_timeline_event ON vehicle_timeline_events;
CREATE TRIGGER refresh_tier_on_timeline_event
  AFTER INSERT ON vehicle_timeline_events
  FOR EACH ROW
  WHEN (user_id IS NOT NULL)
  EXECUTE FUNCTION trigger_refresh_platform_tier();

-- Trigger on vehicle_receipts upload
DROP TRIGGER IF EXISTS refresh_tier_on_receipt_upload ON vehicle_receipts;
CREATE TRIGGER refresh_tier_on_receipt_upload
  AFTER INSERT ON vehicle_receipts
  FOR EACH ROW
  WHEN (vehicle_id IS NOT NULL)
  EXECUTE FUNCTION trigger_refresh_platform_tier();

-- =====================================================
-- BULK REFRESH FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION refresh_all_platform_tiers()
RETURNS JSONB AS $$
DECLARE
  v_user RECORD;
  v_refreshed INTEGER := 0;
  v_errors INTEGER := 0;
  v_result JSONB;
BEGIN
  -- Refresh tiers for all users who have vehicles
  FOR v_user IN 
    SELECT DISTINCT user_id 
    FROM vehicles
    WHERE user_id IS NOT NULL
  LOOP
    BEGIN
      v_result := refresh_platform_tier(v_user.user_id);
      IF (v_result->>'success')::BOOLEAN THEN
        v_refreshed := v_refreshed + 1;
      ELSE
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'Error refreshing platform tier for user %: %', v_user.user_id, SQLERRM;
    END;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'refreshed', v_refreshed,
    'errors', v_errors,
    'total_processed', v_refreshed + v_errors
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- GRANTS
-- =====================================================

GRANT EXECUTE ON FUNCTION calculate_platform_tier_score(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_platform_tier(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_all_platform_tiers() TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_daily_engagement_layer(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_doc_quality_layer(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_temporal_value_layer(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_material_quality_layer(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_verification_layer(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_integration_layer(UUID, UUID) TO authenticated;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON FUNCTION calculate_platform_tier_score(UUID, UUID) IS 'Calculates platform-native tier score based on 6 analysis layers (daily engagement, doc quality, temporal value, material quality, verification, integration)';
COMMENT ON FUNCTION refresh_platform_tier(UUID) IS 'Refreshes and updates platform tier for a user based on platform-native metrics';
COMMENT ON FUNCTION refresh_all_platform_tiers() IS 'Bulk refresh all user platform tiers (use sparingly, can be expensive)';
COMMENT ON FUNCTION calculate_daily_engagement_layer(UUID, UUID) IS 'Layer 1: Calculates daily documentation engagement score (0-25 points)';
COMMENT ON FUNCTION calculate_doc_quality_layer(UUID, UUID) IS 'Layer 2: Calculates documentation quality and depth score (0-20 points)';
COMMENT ON FUNCTION calculate_temporal_value_layer(UUID, UUID) IS 'Layer 3: Calculates build recency and temporal value score (0-15 points)';
COMMENT ON FUNCTION calculate_material_quality_layer(UUID) IS 'Layer 4: Calculates material quality and parts provenance score (0-15 points)';
COMMENT ON FUNCTION calculate_verification_layer(UUID, UUID) IS 'Layer 5: Calculates restorer/builder verification score (0-10 points)';
COMMENT ON FUNCTION calculate_integration_layer(UUID, UUID) IS 'Layer 6: Calculates external integration and streaming score (0-10 points)';

