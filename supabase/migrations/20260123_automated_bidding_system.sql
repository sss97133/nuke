-- AUTOMATED PROXY BIDDING SYSTEM
-- Enables N-Zero to automatically execute bids on external auction platforms
-- Stores encrypted credentials, manages sessions, and executes sniper bids

-- ============================================================
-- PLATFORM CREDENTIALS
-- Encrypted storage for user credentials on external platforms
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Platform identifier
  platform TEXT NOT NULL CHECK (platform IN (
    'bat',              -- Bring a Trailer
    'cars_and_bids',    -- Cars & Bids
    'pcarmarket',       -- PCarMarket
    'collecting_cars',  -- Collecting Cars
    'broad_arrow',      -- Broad Arrow Auctions
    'rmsothebys',       -- RM Sotheby's
    'gooding',          -- Gooding & Company
    'sbx',              -- SBX Cars
    'ebay_motors'       -- eBay Motors
  )),

  -- AES-256-GCM encrypted credentials
  -- Contains JSON blob: { "username": "...", "password": "..." }
  encrypted_credentials BYTEA NOT NULL,
  encryption_iv BYTEA NOT NULL,        -- 12 bytes for AES-GCM
  encryption_tag BYTEA NOT NULL,       -- 16 bytes authentication tag

  -- Session management (also encrypted)
  session_token_encrypted BYTEA,
  session_expires_at TIMESTAMPTZ,
  cookies_encrypted BYTEA,             -- Serialized cookie jar

  -- 2FA configuration
  requires_2fa BOOLEAN DEFAULT false,
  totp_secret_encrypted BYTEA,         -- For automated TOTP generation
  last_2fa_method TEXT,                -- 'totp', 'sms', 'email', etc.

  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',          -- Credentials added, not yet validated
    'validating',       -- Currently attempting login
    'active',           -- Validated and ready to use
    'expired',          -- Session expired, needs re-auth
    '2fa_required',     -- Waiting for 2FA code
    'invalid',          -- Credentials are incorrect
    'suspended'         -- Account suspended on platform
  )),
  last_validated_at TIMESTAMPTZ,
  validation_error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each user can only have one credential set per platform
  UNIQUE(user_id, platform)
);

-- Indexes for credential lookups
CREATE INDEX IF NOT EXISTS idx_platform_credentials_user
  ON platform_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_credentials_status
  ON platform_credentials(status) WHERE status IN ('active', '2fa_required', 'expired');
CREATE INDEX IF NOT EXISTS idx_platform_credentials_platform_active
  ON platform_credentials(platform, status) WHERE status = 'active';

-- ============================================================
-- PENDING 2FA REQUESTS
-- Manual 2FA code input when automated TOTP is not available
-- ============================================================

CREATE TABLE IF NOT EXISTS pending_2fa_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID NOT NULL REFERENCES platform_credentials(id) ON DELETE CASCADE,

  -- 2FA method being used
  method TEXT NOT NULL CHECK (method IN (
    'totp',              -- Time-based OTP (Google Authenticator, etc.)
    'sms',               -- SMS code
    'email',             -- Email code
    'security_question', -- Security question challenge
    'push'               -- Push notification
  )),

  -- Challenge data (if applicable)
  challenge_data JSONB,               -- e.g., masked phone number, security question

  -- User-provided code
  user_code TEXT,
  submitted_at TIMESTAMPTZ,

  -- Expiration (usually 2-5 minutes)
  expires_at TIMESTAMPTZ NOT NULL,

  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',    -- Waiting for user to enter code
    'submitted',  -- Code submitted, attempting verification
    'verified',   -- 2FA successful
    'expired',    -- Timed out
    'failed'      -- Code was incorrect
  )),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding pending requests
CREATE INDEX IF NOT EXISTS idx_pending_2fa_requests_credential
  ON pending_2fa_requests(credential_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_2fa_requests_pending
  ON pending_2fa_requests(status, expires_at) WHERE status = 'pending';

-- ============================================================
-- BID EXECUTION QUEUE
-- Scheduled bid execution with priority and retry logic
-- ============================================================

CREATE TABLE IF NOT EXISTS bid_execution_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proxy_bid_request_id UUID NOT NULL REFERENCES proxy_bid_requests(id) ON DELETE CASCADE,

  -- Scheduling
  scheduled_for TIMESTAMPTZ NOT NULL,        -- When to execute the bid
  execution_window_seconds INTEGER DEFAULT 30, -- Acceptable window for execution
  priority INTEGER DEFAULT 50,                -- 1-100, lower = higher priority

  -- Execution status
  status TEXT DEFAULT 'queued' CHECK (status IN (
    'queued',      -- Waiting to be executed
    'locked',      -- Picked up by executor
    'executing',   -- Currently placing bid
    'completed',   -- Bid successfully placed
    'failed',      -- Bid failed (may retry)
    'cancelled'    -- Cancelled by user or system
  )),

  -- Distributed locking
  locked_by TEXT,                    -- Executor instance ID
  locked_at TIMESTAMPTZ,

  -- Retry handling
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,

  -- Results
  result_data JSONB,                 -- { success, bid_amount, new_high_bid, etc. }
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for queue processing
CREATE INDEX IF NOT EXISTS idx_bid_execution_queue_scheduled
  ON bid_execution_queue(scheduled_for, priority)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_bid_execution_queue_proxy_bid
  ON bid_execution_queue(proxy_bid_request_id);
CREATE INDEX IF NOT EXISTS idx_bid_execution_queue_locked
  ON bid_execution_queue(locked_by, status)
  WHERE status IN ('locked', 'executing');

-- ============================================================
-- AUCTION STATE CACHE
-- Real-time auction state for active monitoring
-- ============================================================

CREATE TABLE IF NOT EXISTS auction_state_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_listing_id UUID NOT NULL REFERENCES external_listings(id) ON DELETE CASCADE,

  -- Current auction state
  current_bid_cents BIGINT,
  bid_count INTEGER,
  high_bidder_username TEXT,

  -- Timing
  auction_end_time TIMESTAMPTZ,
  server_time_offset_ms INTEGER,     -- Our clock vs platform clock

  -- Soft-close tracking
  last_extension_at TIMESTAMPTZ,
  extension_count INTEGER DEFAULT 0,
  is_soft_close_active BOOLEAN DEFAULT false,
  soft_close_window_seconds INTEGER DEFAULT 120, -- BaT uses 2 minutes

  -- Sync metadata
  last_synced_at TIMESTAMPTZ,
  sync_source TEXT,                  -- 'api', 'scrape', 'websocket'
  sync_latency_ms INTEGER,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One cache entry per listing
  UNIQUE(external_listing_id)
);

-- Index for active auction monitoring
CREATE INDEX IF NOT EXISTS idx_auction_state_cache_end_time
  ON auction_state_cache(auction_end_time)
  WHERE auction_end_time > NOW();
CREATE INDEX IF NOT EXISTS idx_auction_state_cache_sync
  ON auction_state_cache(last_synced_at);

-- ============================================================
-- SECURITY AUDIT LOG
-- Track all credential access for security compliance
-- ============================================================

CREATE TABLE IF NOT EXISTS credential_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID REFERENCES platform_credentials(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Action performed
  action TEXT NOT NULL CHECK (action IN (
    'created',        -- Credentials added
    'validated',      -- Login attempted
    'refreshed',      -- Session refreshed
    'decrypted',      -- Credentials decrypted for use
    'bid_placed',     -- Used to place a bid
    '2fa_requested',  -- 2FA flow initiated
    '2fa_completed',  -- 2FA completed
    'deleted',        -- Credentials removed
    'failed'          -- Action failed
  )),

  -- Context
  platform TEXT,
  ip_address INET,
  user_agent TEXT,
  executor_instance TEXT,

  -- Result
  success BOOLEAN NOT NULL,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_credential_access_log_credential
  ON credential_access_log(credential_id, created_at);
CREATE INDEX IF NOT EXISTS idx_credential_access_log_user
  ON credential_access_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_credential_access_log_action
  ON credential_access_log(action, created_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE platform_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_2fa_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_execution_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_state_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_access_log ENABLE ROW LEVEL SECURITY;

-- Platform credentials: users can only access their own
CREATE POLICY "Users can view their own platform credentials"
  ON platform_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own platform credentials"
  ON platform_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own platform credentials"
  ON platform_credentials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own platform credentials"
  ON platform_credentials FOR DELETE
  USING (auth.uid() = user_id);

-- Pending 2FA requests: users can only see their own
CREATE POLICY "Users can view their own 2FA requests"
  ON pending_2fa_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM platform_credentials pc
      WHERE pc.id = pending_2fa_requests.credential_id
      AND pc.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can submit codes to their own 2FA requests"
  ON pending_2fa_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM platform_credentials pc
      WHERE pc.id = pending_2fa_requests.credential_id
      AND pc.user_id = auth.uid()
    )
  );

-- Bid execution queue: users can view their own bid executions
CREATE POLICY "Users can view their own bid executions"
  ON bid_execution_queue FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM proxy_bid_requests pbr
      WHERE pbr.id = bid_execution_queue.proxy_bid_request_id
      AND pbr.user_id = auth.uid()
    )
  );

-- Auction state cache: readable by all authenticated users
CREATE POLICY "Authenticated users can view auction state"
  ON auction_state_cache FOR SELECT
  USING (auth.role() = 'authenticated');

-- Credential access log: users can only see logs for their credentials
CREATE POLICY "Users can view their own credential access logs"
  ON credential_access_log FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Function to check if user has valid platform credentials
CREATE OR REPLACE FUNCTION has_active_platform_credentials(p_user_id UUID, p_platform TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM platform_credentials
    WHERE user_id = p_user_id
    AND platform = p_platform
    AND status = 'active'
  );
END;
$$;

-- Function to get pending 2FA request for a user/platform
CREATE OR REPLACE FUNCTION get_pending_2fa_request(p_user_id UUID, p_platform TEXT)
RETURNS TABLE (
  request_id UUID,
  method TEXT,
  challenge_data JSONB,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p2fa.id,
    p2fa.method,
    p2fa.challenge_data,
    p2fa.expires_at
  FROM pending_2fa_requests p2fa
  JOIN platform_credentials pc ON pc.id = p2fa.credential_id
  WHERE pc.user_id = p_user_id
  AND pc.platform = p_platform
  AND p2fa.status = 'pending'
  AND p2fa.expires_at > NOW()
  ORDER BY p2fa.created_at DESC
  LIMIT 1;
END;
$$;

-- Function to get next bid execution from queue
CREATE OR REPLACE FUNCTION claim_next_bid_execution(p_executor_id TEXT)
RETURNS TABLE (
  execution_id UUID,
  proxy_bid_request_id UUID,
  scheduled_for TIMESTAMPTZ,
  priority INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_execution_id UUID;
BEGIN
  -- Lock and claim the next execution
  UPDATE bid_execution_queue
  SET
    status = 'locked',
    locked_by = p_executor_id,
    locked_at = NOW(),
    updated_at = NOW()
  WHERE id = (
    SELECT id FROM bid_execution_queue
    WHERE status = 'queued'
    AND scheduled_for <= NOW() + INTERVAL '5 seconds'
    AND attempts < max_attempts
    ORDER BY priority ASC, scheduled_for ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING id INTO v_execution_id;

  IF v_execution_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    beq.id,
    beq.proxy_bid_request_id,
    beq.scheduled_for,
    beq.priority
  FROM bid_execution_queue beq
  WHERE beq.id = v_execution_id;
END;
$$;

-- Function to update auction state cache
CREATE OR REPLACE FUNCTION upsert_auction_state(
  p_external_listing_id UUID,
  p_current_bid_cents BIGINT,
  p_bid_count INTEGER,
  p_high_bidder_username TEXT,
  p_auction_end_time TIMESTAMPTZ,
  p_server_time_offset_ms INTEGER DEFAULT NULL,
  p_sync_source TEXT DEFAULT 'scrape'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
  v_previous_end_time TIMESTAMPTZ;
BEGIN
  -- Get previous end time to detect extensions
  SELECT auction_end_time INTO v_previous_end_time
  FROM auction_state_cache
  WHERE external_listing_id = p_external_listing_id;

  INSERT INTO auction_state_cache (
    external_listing_id,
    current_bid_cents,
    bid_count,
    high_bidder_username,
    auction_end_time,
    server_time_offset_ms,
    last_synced_at,
    sync_source,
    last_extension_at,
    extension_count,
    is_soft_close_active,
    updated_at
  )
  VALUES (
    p_external_listing_id,
    p_current_bid_cents,
    p_bid_count,
    p_high_bidder_username,
    p_auction_end_time,
    p_server_time_offset_ms,
    NOW(),
    p_sync_source,
    CASE WHEN v_previous_end_time IS NOT NULL AND p_auction_end_time > v_previous_end_time THEN NOW() ELSE NULL END,
    CASE WHEN v_previous_end_time IS NOT NULL AND p_auction_end_time > v_previous_end_time THEN 1 ELSE 0 END,
    CASE WHEN p_auction_end_time - NOW() < INTERVAL '2 minutes' THEN true ELSE false END,
    NOW()
  )
  ON CONFLICT (external_listing_id)
  DO UPDATE SET
    current_bid_cents = EXCLUDED.current_bid_cents,
    bid_count = EXCLUDED.bid_count,
    high_bidder_username = EXCLUDED.high_bidder_username,
    auction_end_time = EXCLUDED.auction_end_time,
    server_time_offset_ms = COALESCE(EXCLUDED.server_time_offset_ms, auction_state_cache.server_time_offset_ms),
    last_synced_at = NOW(),
    sync_source = EXCLUDED.sync_source,
    last_extension_at = CASE
      WHEN auction_state_cache.auction_end_time IS NOT NULL
        AND EXCLUDED.auction_end_time > auction_state_cache.auction_end_time
      THEN NOW()
      ELSE auction_state_cache.last_extension_at
    END,
    extension_count = CASE
      WHEN auction_state_cache.auction_end_time IS NOT NULL
        AND EXCLUDED.auction_end_time > auction_state_cache.auction_end_time
      THEN auction_state_cache.extension_count + 1
      ELSE auction_state_cache.extension_count
    END,
    is_soft_close_active = CASE
      WHEN EXCLUDED.auction_end_time - NOW() < INTERVAL '2 minutes'
      THEN true
      ELSE false
    END,
    updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Trigger to update timestamps
CREATE OR REPLACE FUNCTION update_bidding_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_platform_credentials_timestamp
  BEFORE UPDATE ON platform_credentials
  FOR EACH ROW EXECUTE FUNCTION update_bidding_timestamp();

CREATE TRIGGER tr_bid_execution_queue_timestamp
  BEFORE UPDATE ON bid_execution_queue
  FOR EACH ROW EXECUTE FUNCTION update_bidding_timestamp();

CREATE TRIGGER tr_auction_state_cache_timestamp
  BEFORE UPDATE ON auction_state_cache
  FOR EACH ROW EXECUTE FUNCTION update_bidding_timestamp();

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE platform_credentials IS 'Encrypted storage for user login credentials on external auction platforms';
COMMENT ON TABLE pending_2fa_requests IS 'Pending 2FA code requests when manual user input is required';
COMMENT ON TABLE bid_execution_queue IS 'Scheduled bid executions with retry logic and distributed locking';
COMMENT ON TABLE auction_state_cache IS 'Real-time auction state cache for active monitoring and sniper timing';
COMMENT ON TABLE credential_access_log IS 'Security audit log for all credential access events';

COMMENT ON COLUMN platform_credentials.encrypted_credentials IS 'AES-256-GCM encrypted JSON containing username and password';
COMMENT ON COLUMN platform_credentials.encryption_iv IS '12-byte initialization vector for AES-GCM';
COMMENT ON COLUMN platform_credentials.encryption_tag IS '16-byte authentication tag for AES-GCM integrity verification';
COMMENT ON COLUMN platform_credentials.totp_secret_encrypted IS 'Encrypted TOTP secret for automated 2FA code generation';

COMMENT ON COLUMN bid_execution_queue.execution_window_seconds IS 'Acceptable window for bid execution, allows for slight timing variations';
COMMENT ON COLUMN bid_execution_queue.locked_by IS 'Executor instance ID for distributed locking';

COMMENT ON COLUMN auction_state_cache.server_time_offset_ms IS 'Offset between our server time and platform server time for accurate snipe timing';
COMMENT ON COLUMN auction_state_cache.soft_close_window_seconds IS 'Duration of soft-close window (BaT uses 120 seconds)';
