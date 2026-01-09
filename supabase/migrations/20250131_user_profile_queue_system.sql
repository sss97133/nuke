-- ==========================================================================
-- USER PROFILE QUEUE SYSTEM
-- ==========================================================================
-- Purpose: Automatically queue user profile URLs for extraction when we
--          encounter them in comments, sellers, or other sources
-- ==========================================================================

-- Create user_profile_queue table
CREATE TABLE IF NOT EXISTS user_profile_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Profile identification
  profile_url TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'bat' CHECK (platform IN ('bat', 'cars_and_bids', 'pcarmarket', 'ebay', 'other')),
  username TEXT, -- Extracted from URL or provided
  external_identity_id UUID REFERENCES external_identities(id) ON DELETE SET NULL,
  
  -- Queue management
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  priority INTEGER NOT NULL DEFAULT 50, -- Higher = more important (0-100)
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  
  -- Source tracking
  discovered_via TEXT, -- 'comment', 'seller', 'buyer', 'manual', 'trigger'
  source_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  source_comment_id UUID, -- Could be from auction_comments or bat_comments
  source_listing_id UUID, -- Could be from bat_listings
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  last_processed_at TIMESTAMPTZ,
  
  -- Locking for concurrent processing
  locked_at TIMESTAMPTZ,
  locked_by TEXT -- Process identifier
);

-- Indexes for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_user_profile_queue_status_priority 
  ON user_profile_queue(status, priority DESC, created_at) 
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_user_profile_queue_platform 
  ON user_profile_queue(platform, status);

CREATE INDEX IF NOT EXISTS idx_user_profile_queue_external_identity 
  ON user_profile_queue(external_identity_id) 
  WHERE external_identity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_profile_queue_locked 
  ON user_profile_queue(locked_at) 
  WHERE locked_at IS NOT NULL;

-- Unique constraint: one pending entry per profile URL (partial index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profile_queue_unique_pending 
  ON user_profile_queue(profile_url, platform) 
  WHERE status = 'pending';

-- Function to claim a batch of queue items (similar to bat_extraction_queue)
CREATE OR REPLACE FUNCTION claim_user_profile_queue_batch(
  p_batch_size INTEGER DEFAULT 1,
  p_lock_duration_minutes INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  profile_url TEXT,
  platform TEXT,
  username TEXT,
  external_identity_id UUID,
  priority INTEGER,
  attempts INTEGER,
  max_attempts INTEGER,
  metadata JSONB
) AS $$
DECLARE
  v_lock_expiry TIMESTAMPTZ;
BEGIN
  v_lock_expiry := NOW() + (p_lock_duration_minutes || ' minutes')::INTERVAL;
  
  RETURN QUERY
  UPDATE user_profile_queue
  SET 
    status = 'processing',
    locked_at = NOW(),
    locked_by = 'process-user-profile-queue',
    last_processed_at = NOW(),
    attempts = attempts + 1,
    updated_at = NOW()
  WHERE id IN (
    SELECT q.id
    FROM user_profile_queue q
    WHERE q.status = 'pending'
      AND (q.locked_at IS NULL OR q.locked_at < NOW() - (p_lock_duration_minutes || ' minutes')::INTERVAL)
      AND q.attempts < q.max_attempts
    ORDER BY q.priority DESC, q.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING 
    user_profile_queue.id,
    user_profile_queue.profile_url,
    user_profile_queue.platform,
    user_profile_queue.username,
    user_profile_queue.external_identity_id,
    user_profile_queue.priority,
    user_profile_queue.attempts,
    user_profile_queue.max_attempts,
    user_profile_queue.metadata;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-queue user profile from comment author
CREATE OR REPLACE FUNCTION queue_user_profile_from_comment()
RETURNS TRIGGER AS $$
DECLARE
  v_profile_url TEXT;
  v_platform TEXT;
  v_username TEXT;
BEGIN
  -- Extract username and platform from comment
  v_username := COALESCE(NEW.author_username, NEW.bat_username);
  v_platform := COALESCE(NEW.platform, 'bat');
  
  -- Skip if no username
  IF v_username IS NULL OR v_username = '' THEN
    RETURN NEW;
  END IF;
  
  -- Build profile URL based on platform
  CASE v_platform
    WHEN 'bat' THEN
      v_profile_url := 'https://bringatrailer.com/member/' || encode_uri_component(v_username) || '/';
    WHEN 'cars_and_bids' THEN
      v_profile_url := 'https://carsandbids.com/users/' || encode_uri_component(v_username);
    WHEN 'pcarmarket' THEN
      v_profile_url := 'https://www.pcarmarket.com/author/' || encode_uri_component(v_username) || '/';
    ELSE
      -- Unknown platform, skip
      RETURN NEW;
  END CASE;
  
  -- Queue the profile URL (idempotent - won't duplicate pending entries)
  INSERT INTO user_profile_queue (
    profile_url,
    platform,
    username,
    external_identity_id,
    discovered_via,
    source_vehicle_id,
    source_comment_id,
    priority
  )
  VALUES (
    v_profile_url,
    v_platform,
    v_username,
    NEW.external_identity_id,
    'comment',
    NEW.vehicle_id,
    NEW.id::TEXT,
    50 -- Medium priority for comment authors
  )
  ON CONFLICT (profile_url, platform) 
  WHERE status = 'pending'
  DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-queue user profile from seller/buyer
CREATE OR REPLACE FUNCTION queue_user_profile_from_listing()
RETURNS TRIGGER AS $$
DECLARE
  v_profile_url TEXT;
  v_username TEXT;
  v_identity_id UUID;
BEGIN
  -- Queue seller profile
  IF NEW.seller_external_identity_id IS NOT NULL THEN
    SELECT handle, profile_url INTO v_username, v_profile_url
    FROM external_identities
    WHERE id = NEW.seller_external_identity_id;
    
    IF v_profile_url IS NOT NULL THEN
      INSERT INTO user_profile_queue (
        profile_url,
        platform,
        username,
        external_identity_id,
        discovered_via,
        source_vehicle_id,
        source_listing_id,
        priority
      )
      VALUES (
        v_profile_url,
        'bat',
        v_username,
        NEW.seller_external_identity_id,
        'seller',
        NEW.vehicle_id,
        NEW.id::TEXT,
        70 -- Higher priority for sellers
      )
      ON CONFLICT (profile_url, platform) 
      WHERE status = 'pending'
      DO NOTHING;
    END IF;
  END IF;
  
  -- Queue buyer profile
  IF NEW.buyer_external_identity_id IS NOT NULL THEN
    SELECT handle, profile_url INTO v_username, v_profile_url
    FROM external_identities
    WHERE id = NEW.buyer_external_identity_id;
    
    IF v_profile_url IS NOT NULL THEN
      INSERT INTO user_profile_queue (
        profile_url,
        platform,
        username,
        external_identity_id,
        discovered_via,
        source_vehicle_id,
        source_listing_id,
        priority
      )
      VALUES (
        v_profile_url,
        'bat',
        v_username,
        NEW.buyer_external_identity_id,
        'buyer',
        NEW.vehicle_id,
        NEW.id::TEXT,
        60 -- High priority for buyers
      )
      ON CONFLICT (profile_url, platform) 
      WHERE status = 'pending'
      DO NOTHING;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-queue when external_identity is created/updated with profile_url
CREATE OR REPLACE FUNCTION queue_user_profile_from_identity()
RETURNS TRIGGER AS $$
BEGIN
  -- Only queue if we have a profile_url and it's new or changed
  IF NEW.profile_url IS NOT NULL AND NEW.profile_url != '' THEN
    -- For UPDATE, only queue if profile_url changed
    IF TG_OP = 'UPDATE' AND OLD.profile_url IS NOT DISTINCT FROM NEW.profile_url THEN
      RETURN NEW;
    END IF;
    
    INSERT INTO user_profile_queue (
      profile_url,
      platform,
      username,
      external_identity_id,
      discovered_via,
      priority
    )
    VALUES (
      NEW.profile_url,
      NEW.platform,
      NEW.handle,
      NEW.id,
      'trigger',
      40 -- Lower priority for auto-discovered
    )
    ON CONFLICT (profile_url, platform) 
    WHERE status = 'pending'
    DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_queue_profile_from_auction_comment ON auction_comments;
CREATE TRIGGER trigger_queue_profile_from_auction_comment
  AFTER INSERT ON auction_comments
  FOR EACH ROW
  WHEN (NEW.author_username IS NOT NULL AND NEW.author_username != '')
  EXECUTE FUNCTION queue_user_profile_from_comment();

DROP TRIGGER IF EXISTS trigger_queue_profile_from_bat_comment ON bat_comments;
CREATE TRIGGER trigger_queue_profile_from_bat_comment
  AFTER INSERT ON bat_comments
  FOR EACH ROW
  WHEN (NEW.bat_username IS NOT NULL AND NEW.bat_username != '')
  EXECUTE FUNCTION queue_user_profile_from_comment();

DROP TRIGGER IF EXISTS trigger_queue_profile_from_listing ON bat_listings;
CREATE TRIGGER trigger_queue_profile_from_listing
  AFTER INSERT OR UPDATE ON bat_listings
  FOR EACH ROW
  WHEN (
    (NEW.seller_external_identity_id IS NOT NULL) OR
    (NEW.buyer_external_identity_id IS NOT NULL)
  )
  EXECUTE FUNCTION queue_user_profile_from_listing();

DROP TRIGGER IF EXISTS trigger_queue_profile_from_identity ON external_identities;
CREATE TRIGGER trigger_queue_profile_from_identity
  AFTER INSERT OR UPDATE ON external_identities
  FOR EACH ROW
  WHEN (NEW.profile_url IS NOT NULL AND NEW.profile_url != '')
  EXECUTE FUNCTION queue_user_profile_from_identity();

-- Helper function to encode URI component (handles common cases)
-- Note: For full RFC 3986 encoding, use JavaScript encodeURIComponent in Edge Functions
CREATE OR REPLACE FUNCTION encode_uri_component(text)
RETURNS TEXT AS $$
  SELECT replace(replace(replace(replace(replace(replace(replace(replace(
    $1,
    ' ', '%20'),
    '!', '%21'),
    '#', '%23'),
    '$', '%24'),
    '&', '%26'),
    '''', '%27'),
    '(', '%28'),
    ')', '%29');
$$ LANGUAGE sql IMMUTABLE;

-- Comments
COMMENT ON TABLE user_profile_queue IS 'Queue for extracting user profile data from external platforms (BaT, Cars & Bids, etc.)';
COMMENT ON FUNCTION claim_user_profile_queue_batch IS 'Claims a batch of pending profile URLs for processing (with locking)';
COMMENT ON FUNCTION queue_user_profile_from_comment IS 'Automatically queues user profiles when comments are created';
COMMENT ON FUNCTION queue_user_profile_from_listing IS 'Automatically queues seller/buyer profiles when listings are created/updated';
COMMENT ON FUNCTION queue_user_profile_from_identity IS 'Automatically queues profiles when external_identities are created/updated with profile URLs';

