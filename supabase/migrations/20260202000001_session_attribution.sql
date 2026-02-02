/**
 * Session-Based Attribution System
 *
 * Captures anonymous contributions BEFORE user signup.
 * When user registers, all their session contributions transfer to their account.
 *
 * This is the bridge between "random visitor" and "registered user".
 * Without it, we lose all pre-signup data attribution.
 */

-- Anonymous sessions (browser fingerprint + session ID)
CREATE TABLE anonymous_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Client-generated session identifier (stored in localStorage)
  session_token TEXT NOT NULL UNIQUE,

  -- Browser fingerprint components (for cross-session linking)
  fingerprint_hash TEXT, -- Hash of: user_agent + screen + timezone + language
  user_agent TEXT,
  screen_resolution TEXT,
  timezone TEXT,
  language TEXT,

  -- Network info (for fraud detection, not primary matching)
  ip_address INET,
  ip_country TEXT,
  ip_region TEXT,

  -- Lifecycle
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- If claimed by user
  claimed_by UUID REFERENCES auth.users(id),
  claimed_at TIMESTAMPTZ,

  -- Stats (denormalized for quick display)
  contribution_count INT DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for token lookup (main query path)
CREATE INDEX idx_anonymous_sessions_token ON anonymous_sessions(session_token);

-- Index for fingerprint matching (secondary linking)
CREATE INDEX idx_anonymous_sessions_fingerprint ON anonymous_sessions(fingerprint_hash)
  WHERE fingerprint_hash IS NOT NULL AND claimed_by IS NULL;

-- Index for unclaimed sessions with contributions (conversion funnel)
CREATE INDEX idx_anonymous_sessions_unclaimed ON anonymous_sessions(contribution_count DESC)
  WHERE claimed_by IS NULL AND contribution_count > 0;


-- Session contributions - tracks what each session did
CREATE TABLE session_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES anonymous_sessions(id) ON DELETE CASCADE,

  -- What type of contribution
  contribution_type TEXT NOT NULL CHECK (contribution_type IN (
    'vehicle_view',           -- Viewed a vehicle page
    'marketplace_import',     -- Imported FB/CL listing
    'image_upload',           -- Uploaded an image
    'document_upload',        -- Uploaded a document
    'sale_report',            -- Reported a sale outcome
    'vehicle_edit',           -- Edited vehicle data
    'comment',                -- Left a comment
    'watchlist_add',          -- Added to watchlist
    'search',                 -- Performed a search (for analytics)
    'other'
  )),

  -- What entity was affected
  vehicle_id UUID REFERENCES vehicles(id),
  marketplace_listing_id UUID, -- References marketplace_listings if exists
  image_id UUID,

  -- The actual data contributed (varies by type)
  contributed_data JSONB DEFAULT '{}',

  -- Quality signals
  confidence NUMERIC(3,2) DEFAULT 1.0,

  -- Transferred to user on claim
  transferred_to UUID REFERENCES auth.users(id),
  transferred_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for session lookup
CREATE INDEX idx_session_contributions_session ON session_contributions(session_id);

-- Index for untransferred contributions (claim query)
CREATE INDEX idx_session_contributions_untransferred ON session_contributions(session_id)
  WHERE transferred_to IS NULL;

-- Index by type for analytics
CREATE INDEX idx_session_contributions_type ON session_contributions(contribution_type, created_at DESC);


-- Function: Record or update session
CREATE OR REPLACE FUNCTION upsert_anonymous_session(
  p_session_token TEXT,
  p_fingerprint_hash TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_screen_resolution TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT NULL,
  p_language TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  -- Try to find existing session
  SELECT id INTO v_session_id
  FROM anonymous_sessions
  WHERE session_token = p_session_token;

  IF v_session_id IS NOT NULL THEN
    -- Update last seen
    UPDATE anonymous_sessions
    SET
      last_seen_at = NOW(),
      -- Update fingerprint if we have better data
      fingerprint_hash = COALESCE(p_fingerprint_hash, fingerprint_hash),
      user_agent = COALESCE(p_user_agent, user_agent),
      ip_address = COALESCE(p_ip_address, ip_address)
    WHERE id = v_session_id;

    RETURN v_session_id;
  END IF;

  -- Create new session
  INSERT INTO anonymous_sessions (
    session_token,
    fingerprint_hash,
    user_agent,
    screen_resolution,
    timezone,
    language,
    ip_address
  ) VALUES (
    p_session_token,
    p_fingerprint_hash,
    p_user_agent,
    p_screen_resolution,
    p_timezone,
    p_language,
    p_ip_address
  )
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;


-- Function: Record a contribution from a session
CREATE OR REPLACE FUNCTION record_session_contribution(
  p_session_token TEXT,
  p_contribution_type TEXT,
  p_vehicle_id UUID DEFAULT NULL,
  p_marketplace_listing_id UUID DEFAULT NULL,
  p_image_id UUID DEFAULT NULL,
  p_contributed_data JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_id UUID;
  v_contribution_id UUID;
BEGIN
  -- Get or create session
  SELECT id INTO v_session_id
  FROM anonymous_sessions
  WHERE session_token = p_session_token;

  IF v_session_id IS NULL THEN
    -- Auto-create minimal session
    INSERT INTO anonymous_sessions (session_token)
    VALUES (p_session_token)
    RETURNING id INTO v_session_id;
  END IF;

  -- Record contribution
  INSERT INTO session_contributions (
    session_id,
    contribution_type,
    vehicle_id,
    marketplace_listing_id,
    image_id,
    contributed_data
  ) VALUES (
    v_session_id,
    p_contribution_type,
    p_vehicle_id,
    p_marketplace_listing_id,
    p_image_id,
    p_contributed_data
  )
  RETURNING id INTO v_contribution_id;

  -- Update session stats
  UPDATE anonymous_sessions
  SET
    contribution_count = contribution_count + 1,
    last_seen_at = NOW()
  WHERE id = v_session_id;

  RETURN v_contribution_id;
END;
$$;


-- Function: Claim session contributions when user signs up
CREATE OR REPLACE FUNCTION claim_session_contributions(
  p_user_id UUID,
  p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_id UUID;
  v_contribution_count INT;
  v_transferred_count INT := 0;
BEGIN
  -- Find the session
  SELECT id, contribution_count
  INTO v_session_id, v_contribution_count
  FROM anonymous_sessions
  WHERE session_token = p_session_token
    AND claimed_by IS NULL;  -- Not already claimed

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session not found or already claimed',
      'transferred_count', 0
    );
  END IF;

  -- Transfer all contributions
  UPDATE session_contributions
  SET
    transferred_to = p_user_id,
    transferred_at = NOW()
  WHERE session_id = v_session_id
    AND transferred_to IS NULL;

  GET DIAGNOSTICS v_transferred_count = ROW_COUNT;

  -- Mark session as claimed
  UPDATE anonymous_sessions
  SET
    claimed_by = p_user_id,
    claimed_at = NOW()
  WHERE id = v_session_id;

  -- Transfer specific entity attributions
  -- Update marketplace listings
  UPDATE marketplace_listings
  SET contributed_by = p_user_id
  WHERE id IN (
    SELECT marketplace_listing_id
    FROM session_contributions
    WHERE session_id = v_session_id
      AND marketplace_listing_id IS NOT NULL
  )
  AND contributed_by IS NULL;

  -- Update vehicle images
  UPDATE vehicle_images
  SET uploaded_by = p_user_id
  WHERE id IN (
    SELECT image_id
    FROM session_contributions
    WHERE session_id = v_session_id
      AND image_id IS NOT NULL
  )
  AND uploaded_by IS NULL;

  -- Award discovery points for contributions
  IF v_transferred_count > 0 THEN
    PERFORM award_discovery_points(
      p_user_id,
      'session_claim',
      LEAST(v_transferred_count * 2, 50)  -- 2 points per contribution, max 50
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'transferred_count', v_transferred_count,
    'points_awarded', LEAST(v_transferred_count * 2, 50)
  );
END;
$$;


-- Function: Try to link sessions by fingerprint (for users who clear localStorage)
CREATE OR REPLACE FUNCTION find_matching_sessions(
  p_fingerprint_hash TEXT
)
RETURNS TABLE (
  session_id UUID,
  contribution_count INT,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    id,
    contribution_count,
    first_seen_at,
    last_seen_at
  FROM anonymous_sessions
  WHERE fingerprint_hash = p_fingerprint_hash
    AND claimed_by IS NULL
    AND contribution_count > 0
  ORDER BY last_seen_at DESC;
$$;


-- Function: Merge multiple sessions (same person, different browsers/devices)
CREATE OR REPLACE FUNCTION merge_anonymous_sessions(
  p_target_session_id UUID,
  p_source_session_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_merged_count INT := 0;
  v_source_id UUID;
BEGIN
  FOREACH v_source_id IN ARRAY p_source_session_ids
  LOOP
    -- Move contributions to target
    UPDATE session_contributions
    SET session_id = p_target_session_id
    WHERE session_id = v_source_id;

    GET DIAGNOSTICS v_merged_count = v_merged_count + ROW_COUNT;

    -- Delete source session
    DELETE FROM anonymous_sessions WHERE id = v_source_id;
  END LOOP;

  -- Update target stats
  UPDATE anonymous_sessions
  SET contribution_count = (
    SELECT COUNT(*) FROM session_contributions WHERE session_id = p_target_session_id
  )
  WHERE id = p_target_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'merged_contributions', v_merged_count,
    'target_session', p_target_session_id
  );
END;
$$;


-- View: Sessions ready for conversion (have contributions, not claimed)
CREATE VIEW anonymous_sessions_for_conversion AS
SELECT
  s.id,
  s.session_token,
  s.fingerprint_hash,
  s.contribution_count,
  s.first_seen_at,
  s.last_seen_at,
  s.last_seen_at - s.first_seen_at AS session_duration,

  -- Contribution breakdown
  (SELECT COUNT(*) FROM session_contributions sc
   WHERE sc.session_id = s.id AND sc.contribution_type = 'marketplace_import') AS marketplace_imports,
  (SELECT COUNT(*) FROM session_contributions sc
   WHERE sc.session_id = s.id AND sc.contribution_type = 'image_upload') AS image_uploads,
  (SELECT COUNT(*) FROM session_contributions sc
   WHERE sc.session_id = s.id AND sc.contribution_type = 'sale_report') AS sale_reports

FROM anonymous_sessions s
WHERE s.claimed_by IS NULL
  AND s.contribution_count > 0
ORDER BY s.contribution_count DESC, s.last_seen_at DESC;


-- RLS Policies
ALTER TABLE anonymous_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_contributions ENABLE ROW LEVEL SECURITY;

-- Sessions: Anyone can create (for their own token), only owner can read their own
CREATE POLICY "Anyone can create session" ON anonymous_sessions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can read their claimed sessions" ON anonymous_sessions
  FOR SELECT USING (claimed_by = auth.uid());

-- Service role can do everything
CREATE POLICY "Service role full access sessions" ON anonymous_sessions
  FOR ALL USING (auth.role() = 'service_role');

-- Contributions: Service role only (frontend calls functions, not direct)
CREATE POLICY "Service role full access contributions" ON session_contributions
  FOR ALL USING (auth.role() = 'service_role');


-- Grant execute on functions
GRANT EXECUTE ON FUNCTION upsert_anonymous_session TO anon, authenticated;
GRANT EXECUTE ON FUNCTION record_session_contribution TO anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_session_contributions TO authenticated;
GRANT EXECUTE ON FUNCTION find_matching_sessions TO authenticated;


-- Stats for monitoring
CREATE OR REPLACE FUNCTION get_session_attribution_stats()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'total_sessions', (SELECT COUNT(*) FROM anonymous_sessions),
    'sessions_with_contributions', (SELECT COUNT(*) FROM anonymous_sessions WHERE contribution_count > 0),
    'unclaimed_sessions', (SELECT COUNT(*) FROM anonymous_sessions WHERE claimed_by IS NULL AND contribution_count > 0),
    'claimed_sessions', (SELECT COUNT(*) FROM anonymous_sessions WHERE claimed_by IS NOT NULL),
    'total_contributions', (SELECT COUNT(*) FROM session_contributions),
    'transferred_contributions', (SELECT COUNT(*) FROM session_contributions WHERE transferred_to IS NOT NULL),
    'pending_contributions', (SELECT COUNT(*) FROM session_contributions WHERE transferred_to IS NULL),
    'contribution_breakdown', (
      SELECT jsonb_object_agg(contribution_type, cnt)
      FROM (
        SELECT contribution_type, COUNT(*) as cnt
        FROM session_contributions
        GROUP BY contribution_type
      ) t
    ),
    'avg_contributions_per_session', (
      SELECT ROUND(AVG(contribution_count)::numeric, 2)
      FROM anonymous_sessions
      WHERE contribution_count > 0
    )
  );
$$;

GRANT EXECUTE ON FUNCTION get_session_attribution_stats TO authenticated;
