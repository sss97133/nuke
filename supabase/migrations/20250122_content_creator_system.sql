-- ============================================================
-- User Content Ingestion System
-- ============================================================
-- Purpose:
-- - Track content from users/organizations across platforms (YouTube, TikTok, Instagram, etc.)
-- - Link content to specific vehicles featured in that content
-- - Enable automatic and manual vehicle-content linking
--
-- Design:
-- - Users and organizations are the source of content (no separate creator profiles)
-- - `user_content` stores individual content items (videos, posts, etc.) linked to users or organizations
-- - `content_vehicle_links` links content to vehicles with confidence scoring
-- - Uses existing `external_identities` table to track platform accounts
--
-- Notes:
-- - Idempotent: uses IF NOT EXISTS and guarded constraints/indexes
-- - Content is a data source for vehicles, like receipts, listings, etc.

-- ============================================
-- 1) user_content
-- ============================================

CREATE TABLE IF NOT EXISTS user_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Source: User or Organization (one must be set)
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  external_identity_id UUID REFERENCES external_identities(id) ON DELETE SET NULL, -- Platform account
  
  -- Content Metadata
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'twitter', 'facebook', 'other')),
  content_type TEXT NOT NULL CHECK (content_type IN ('video', 'post', 'story', 'reel', 'tweet', 'other')),
  external_content_id TEXT NOT NULL, -- Platform's unique ID
  content_url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  
  -- Engagement Metrics
  view_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  
  -- Timing
  published_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  
  -- Vehicle Linkage (nullable - content may not feature specific vehicle)
  primary_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  
  -- Detection Metadata
  vehicle_detection_confidence NUMERIC(3,2) DEFAULT 0.0 CHECK (vehicle_detection_confidence >= 0.0 AND vehicle_detection_confidence <= 1.0),
  detection_method TEXT CHECK (detection_method IN (
    'title_parse', 'description_parse', 'image_recognition', 'transcript', 
    'manual', 'fuzzy_match', 'license_plate', 'vin_detection', 'other'
  )),
  detected_vehicle_data JSONB DEFAULT '{}'::jsonb, -- Raw detection results
  
  -- Status
  status TEXT DEFAULT 'pending_review' CHECK (status IN (
    'pending_review', -- Needs human verification
    'verified',       -- Vehicle link confirmed
    'no_vehicle',     -- Content doesn't feature specific vehicle
    'unclear',        -- Couldn't determine vehicle
    'archived'        -- Old/inactive content
  )),
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT user_content_source_check CHECK (
    (user_id IS NOT NULL AND organization_id IS NULL) OR
    (user_id IS NULL AND organization_id IS NOT NULL)
  ),
  UNIQUE(platform, external_content_id)
);

CREATE INDEX IF NOT EXISTS idx_user_content_user ON user_content(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_content_organization ON user_content(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_content_external_identity ON user_content(external_identity_id) WHERE external_identity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_content_vehicle ON user_content(primary_vehicle_id) WHERE primary_vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_content_platform ON user_content(platform, external_content_id);
CREATE INDEX IF NOT EXISTS idx_user_content_status ON user_content(status) WHERE status = 'pending_review';
CREATE INDEX IF NOT EXISTS idx_user_content_published ON user_content(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_content_confidence ON user_content(vehicle_detection_confidence DESC) WHERE vehicle_detection_confidence > 0.5;

COMMENT ON TABLE user_content IS 'Content items (videos, posts) from users or organizations. Content is a data source for vehicles.';
COMMENT ON COLUMN user_content.user_id IS 'User who created/published this content.';
COMMENT ON COLUMN user_content.organization_id IS 'Organization that published this content (if applicable).';
COMMENT ON COLUMN user_content.external_identity_id IS 'Platform account (YouTube channel, Instagram account, etc.) via external_identities.';
COMMENT ON COLUMN user_content.primary_vehicle_id IS 'Main vehicle featured (if any). Use content_vehicle_links for multiple vehicles.';

-- ============================================
-- 2) content_vehicle_links
-- ============================================

CREATE TABLE IF NOT EXISTS content_vehicle_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES user_content(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Link Details
  link_type TEXT NOT NULL CHECK (link_type IN (
    'primary',      -- Main vehicle featured
    'secondary',    -- Vehicle appears but not focus
    'mentioned',    -- Vehicle mentioned in text
    'related'       -- Related vehicle (same owner, similar model)
  )),
  
  -- Detection Info
  confidence NUMERIC(3,2) DEFAULT 0.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  detection_method TEXT,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Verification
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,
  verification_notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(content_id, vehicle_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_content_vehicle_links_content ON content_vehicle_links(content_id);
CREATE INDEX IF NOT EXISTS idx_content_vehicle_links_vehicle ON content_vehicle_links(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_content_vehicle_links_type ON content_vehicle_links(link_type);
CREATE INDEX IF NOT EXISTS idx_content_vehicle_links_confidence ON content_vehicle_links(confidence DESC);

COMMENT ON TABLE content_vehicle_links IS 'Links between creator content and vehicles. Supports multiple vehicles per content.';

-- ============================================
-- 3) Extend existing tables
-- ============================================

-- Add creator_stats to external_identities metadata (optional enhancement)
-- The metadata JSONB field can already store this, but we can add a helper column if needed
-- For now, we'll use the metadata field

-- Extend content_extraction_queue to support user content
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_extraction_queue') THEN
    ALTER TABLE content_extraction_queue 
    ADD COLUMN IF NOT EXISTS user_content_id UUID REFERENCES user_content(id) ON DELETE CASCADE;
    
    CREATE INDEX IF NOT EXISTS idx_content_extraction_queue_user_content 
    ON content_extraction_queue(user_content_id) WHERE user_content_id IS NOT NULL;
  END IF;
END $$;

-- ============================================
-- 4) RLS Policies
-- ============================================

ALTER TABLE user_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_vehicle_links ENABLE ROW LEVEL SECURITY;

-- Public read (for indexing and discovery)
DROP POLICY IF EXISTS "Public read user content" ON user_content;
CREATE POLICY "Public read user content"
  ON user_content
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Public read content vehicle links" ON content_vehicle_links;
CREATE POLICY "Public read content vehicle links"
  ON content_vehicle_links
  FOR SELECT
  USING (true);

-- Service role can manage all
DROP POLICY IF EXISTS "Service role manages user content" ON user_content;
CREATE POLICY "Service role manages user content"
  ON user_content
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS "Service role manages content vehicle links" ON content_vehicle_links;
CREATE POLICY "Service role manages content vehicle links"
  ON content_vehicle_links
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Users can manage their own content
DROP POLICY IF EXISTS "Users manage own content" ON user_content;
CREATE POLICY "Users manage own content"
  ON user_content
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Organization members can manage organization content
-- (via organization_contributors or business_user_roles)
DROP POLICY IF EXISTS "Organization members manage org content" ON user_content;
CREATE POLICY "Organization members manage org content"
  ON user_content
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_contributors 
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager', 'employee')
      UNION
      SELECT business_entity_id FROM business_team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_contributors 
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager', 'employee')
      UNION
      SELECT business_entity_id FROM business_team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Authenticated users can create vehicle links (for manual linking)
DROP POLICY IF EXISTS "Users create content vehicle links" ON content_vehicle_links;
CREATE POLICY "Users create content vehicle links"
  ON content_vehicle_links
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users update own content vehicle links" ON content_vehicle_links;
CREATE POLICY "Users update own content vehicle links"
  ON content_vehicle_links
  FOR UPDATE
  USING (verified_by = auth.uid() OR auth.jwt() ->> 'role' = 'service_role');

-- ============================================
-- 5) Helper Functions
-- ============================================

-- Store platform stats in external_identities.metadata if needed
-- (No separate creator profile table - stats go in external_identities.metadata)

-- Link content to vehicle with confidence
CREATE OR REPLACE FUNCTION link_content_to_vehicle(
  p_content_id UUID,
  p_vehicle_id UUID,
  p_link_type TEXT DEFAULT 'primary',
  p_confidence NUMERIC DEFAULT 0.5,
  p_detection_method TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link_id UUID;
BEGIN
  -- Allow service role or authenticated users
  IF auth.uid() IS NULL AND (auth.jwt() ->> 'role') != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO content_vehicle_links (
    content_id,
    vehicle_id,
    link_type,
    confidence,
    detection_method,
    verified_by
  )
  VALUES (
    p_content_id,
    p_vehicle_id,
    p_link_type,
    p_confidence,
    p_detection_method,
    CASE WHEN auth.uid() IS NOT NULL THEN auth.uid() ELSE NULL END
  )
  ON CONFLICT (content_id, vehicle_id, link_type)
  DO UPDATE SET
    confidence = GREATEST(content_vehicle_links.confidence, EXCLUDED.confidence),
    detection_method = COALESCE(EXCLUDED.detection_method, content_vehicle_links.detection_method),
    updated_at = NOW()
  RETURNING id INTO v_link_id;

  -- Update primary_vehicle_id if this is a primary link with high confidence
  IF p_link_type = 'primary' AND p_confidence >= 0.8 THEN
    UPDATE user_content
    SET primary_vehicle_id = p_vehicle_id,
        vehicle_detection_confidence = p_confidence,
        status = 'verified',
        updated_at = NOW()
    WHERE id = p_content_id AND (primary_vehicle_id IS NULL OR vehicle_detection_confidence < p_confidence);
  END IF;

  RETURN v_link_id;
END;
$$;

GRANT EXECUTE ON FUNCTION link_content_to_vehicle(UUID, UUID, TEXT, NUMERIC, TEXT) TO authenticated, service_role;

-- ============================================
-- 7) Auto-Create Timeline Events from Content
-- ============================================

-- Function to create timeline events when content is linked to vehicles
CREATE OR REPLACE FUNCTION create_timeline_from_content()
RETURNS TRIGGER AS $$
DECLARE
  v_content RECORD;
  v_org_name TEXT;
  v_user_name TEXT;
BEGIN
  -- Only create timeline events for high-confidence primary links
  IF NEW.confidence >= 0.8 AND NEW.link_type = 'primary' THEN
    -- Get content details
    SELECT * INTO v_content
    FROM user_content
    WHERE id = NEW.content_id;
    
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
    
    -- Get organization or user name
    IF v_content.organization_id IS NOT NULL THEN
      SELECT business_name INTO v_org_name
      FROM businesses
      WHERE id = v_content.organization_id;
    ELSIF v_content.user_id IS NOT NULL THEN
      SELECT full_name INTO v_user_name
      FROM profiles
      WHERE id = v_content.user_id;
    END IF;
    
    -- Create timeline event
    INSERT INTO vehicle_timeline_events (
      vehicle_id,
      event_type,
      event_date,
      title,
      description,
      metadata,
      created_by
    )
    VALUES (
      NEW.vehicle_id,
      'content_featured',
      COALESCE(v_content.published_at, NOW()),
      COALESCE(
        v_content.title,
        'Featured in ' || INITCAP(v_content.platform) || ' content'
      ),
      v_content.description,
      jsonb_build_object(
        'content_id', v_content.id,
        'content_url', v_content.content_url,
        'platform', v_content.platform,
        'content_type', v_content.content_type,
        'thumbnail_url', v_content.thumbnail_url,
        'engagement', jsonb_build_object(
          'views', COALESCE(v_content.view_count, 0),
          'likes', COALESCE(v_content.like_count, 0),
          'comments', COALESCE(v_content.comment_count, 0),
          'shares', COALESCE(v_content.share_count, 0)
        ),
        'source_organization_id', v_content.organization_id,
        'source_organization_name', v_org_name,
        'source_user_id', v_content.user_id,
        'source_user_name', v_user_name,
        'detection_confidence', NEW.confidence,
        'detection_method', NEW.detection_method,
        'link_id', NEW.id
      ),
      COALESCE(
        v_content.user_id,
        (SELECT discovered_by FROM businesses WHERE id = v_content.organization_id)
      )
    )
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to auto-create timeline events
DROP TRIGGER IF EXISTS auto_timeline_from_content ON content_vehicle_links;
CREATE TRIGGER auto_timeline_from_content
  AFTER INSERT ON content_vehicle_links
  FOR EACH ROW
  WHEN (NEW.confidence >= 0.8 AND NEW.link_type = 'primary')
  EXECUTE FUNCTION create_timeline_from_content();

COMMENT ON FUNCTION create_timeline_from_content() IS 'Automatically creates timeline events when content is linked to vehicles with high confidence.';

-- ============================================
-- 6) Views for Analytics
-- ============================================

-- View: Content by vehicle
CREATE OR REPLACE VIEW vehicle_content_summary AS
SELECT 
  v.id as vehicle_id,
  v.make,
  v.model,
  v.year,
  COUNT(DISTINCT cvl.content_id) as content_count,
  COUNT(DISTINCT cvl.content_id) FILTER (WHERE cvl.link_type = 'primary') as primary_content_count,
  MAX(uc.published_at) as latest_content_date,
  SUM(uc.view_count) as total_content_views,
  SUM(uc.like_count) as total_content_likes
FROM vehicles v
LEFT JOIN content_vehicle_links cvl ON v.id = cvl.vehicle_id
LEFT JOIN user_content uc ON cvl.content_id = uc.id
GROUP BY v.id, v.make, v.model, v.year;

COMMENT ON VIEW vehicle_content_summary IS 'Summary of content linked to each vehicle.';

-- View: User/Organization content stats
CREATE OR REPLACE VIEW user_content_stats AS
SELECT 
  COALESCE(uc.user_id, uc.organization_id) as source_id,
  CASE WHEN uc.user_id IS NOT NULL THEN 'user' ELSE 'organization' END as source_type,
  p.full_name as user_name,
  b.business_name as organization_name,
  ei.platform,
  ei.handle,
  COUNT(uc.id) as content_count,
  COUNT(DISTINCT cvl.vehicle_id) as vehicles_featured,
  SUM(uc.view_count) as total_views,
  SUM(uc.like_count) as total_likes,
  MAX(uc.published_at) as latest_content_date
FROM user_content uc
LEFT JOIN profiles p ON uc.user_id = p.id
LEFT JOIN businesses b ON uc.organization_id = b.id
LEFT JOIN external_identities ei ON uc.external_identity_id = ei.id
LEFT JOIN content_vehicle_links cvl ON uc.id = cvl.content_id
GROUP BY 
  COALESCE(uc.user_id, uc.organization_id),
  CASE WHEN uc.user_id IS NOT NULL THEN 'user' ELSE 'organization' END,
  p.full_name,
  b.business_name,
  ei.platform,
  ei.handle;

COMMENT ON VIEW user_content_stats IS 'Summary statistics for content from users and organizations.';

