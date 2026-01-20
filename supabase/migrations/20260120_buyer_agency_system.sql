-- BUYER AGENCY SYSTEM
-- Enables N-Zero to bid on external auctions on behalf of users
-- Requires legal agreements, deposit authorization, and commission tracking

-- ============================================================
-- BUYER AGENCY AGREEMENTS
-- Legal agreements authorizing N-Zero to bid on user's behalf
-- ============================================================

CREATE TABLE IF NOT EXISTS buyer_agency_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who is the buyer
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Agreement status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',              -- User started but hasn't signed
    'pending_signature',  -- Ready for signature
    'active',             -- Signed and in effect
    'expired',            -- Past expiration date
    'cancelled'           -- User or admin cancelled
  )),

  -- Commission structure
  commission_rate DECIMAL(5,2) NOT NULL DEFAULT 4.00, -- Percentage (e.g., 4.00 = 4%)

  -- Spending limits
  max_authorized_bid_cents BIGINT,           -- Max single bid authorized
  monthly_spending_limit_cents BIGINT,       -- Total monthly limit

  -- Digital signature
  signature_data JSONB,                       -- Signature image/hash
  signed_at TIMESTAMPTZ,
  signed_ip_address INET,
  signed_user_agent TEXT,

  -- Legal identity
  legal_name TEXT NOT NULL,
  legal_address JSONB,                        -- { street, city, state, zip, country }

  -- Agreement document
  agreement_pdf_url TEXT,                     -- Signed PDF URL
  agreement_version TEXT NOT NULL DEFAULT '1.0',

  -- Effective dates
  effective_date DATE DEFAULT CURRENT_DATE,
  expiration_date DATE DEFAULT (CURRENT_DATE + INTERVAL '1 year'),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick user lookup
CREATE INDEX IF NOT EXISTS idx_buyer_agency_agreements_user
  ON buyer_agency_agreements(user_id, status);

-- ============================================================
-- PROXY BID REQUESTS
-- Individual bid requests from users
-- ============================================================

CREATE TABLE IF NOT EXISTS proxy_bid_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who is bidding
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_agreement_id UUID REFERENCES buyer_agency_agreements(id),

  -- What they're bidding on
  external_listing_id UUID REFERENCES external_listings(id),
  vehicle_id UUID REFERENCES vehicles(id),
  platform TEXT NOT NULL,
  external_auction_url TEXT NOT NULL,

  -- Bid parameters
  max_bid_cents BIGINT NOT NULL,             -- Maximum authorized bid
  bid_strategy TEXT NOT NULL DEFAULT 'proxy_auto' CHECK (bid_strategy IN (
    'snipe_last_minute',    -- Bid in final minutes
    'proxy_auto',           -- Standard proxy bidding
    'manual_approval'       -- User must approve each increment
  )),
  bid_increment_cents BIGINT,                -- Custom increment (optional)

  -- Deposit authorization
  deposit_payment_intent_id TEXT,            -- Stripe PaymentIntent ID
  deposit_amount_cents BIGINT,               -- Deposit amount (typically 10%)
  deposit_status TEXT CHECK (deposit_status IN (
    'pending',              -- Not yet authorized
    'authorized',           -- Authorized, not captured
    'captured',             -- Captured (user won)
    'released',             -- Released (user lost or cancelled)
    'failed'                -- Authorization failed
  )),

  -- Bid status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',              -- Awaiting processing
    'active',               -- Actively bidding
    'outbid',               -- Currently not winning
    'winning',              -- Currently winning
    'won',                  -- Won the auction
    'lost',                 -- Lost the auction
    'cancelled',            -- User cancelled
    'expired'               -- Auction ended without us
  )),

  -- Execution tracking
  execution_log JSONB DEFAULT '[]'::jsonb,   -- Array of bid actions taken
  current_bid_cents BIGINT,                  -- Our current bid on the auction

  -- Outcome
  final_bid_cents BIGINT,                    -- Final winning bid (if won)
  final_price_cents BIGINT,                  -- Total price including fees
  won_at TIMESTAMPTZ,

  -- Commission
  commission_rate DECIMAL(5,2),              -- Rate at time of bid
  commission_cents BIGINT,                   -- Calculated commission (if won)
  commission_invoice_id TEXT,                -- Stripe Invoice ID

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for proxy bid queries
CREATE INDEX IF NOT EXISTS idx_proxy_bid_requests_user
  ON proxy_bid_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_proxy_bid_requests_listing
  ON proxy_bid_requests(external_listing_id);
CREATE INDEX IF NOT EXISTS idx_proxy_bid_requests_active
  ON proxy_bid_requests(status) WHERE status IN ('pending', 'active', 'winning', 'outbid');

-- ============================================================
-- PROXY BID ASSIGNMENTS (for human-in-loop execution)
-- ============================================================

CREATE TABLE IF NOT EXISTS proxy_bid_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to bid request
  proxy_bid_request_id UUID NOT NULL REFERENCES proxy_bid_requests(id) ON DELETE CASCADE,

  -- Who is executing
  assigned_operator_id UUID REFERENCES auth.users(id),

  -- Assignment status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',              -- Not yet assigned
    'assigned',             -- Assigned to operator
    'in_progress',          -- Operator is working on it
    'completed',            -- Bid execution complete
    'failed'                -- Failed to execute
  )),

  -- Priority
  priority INTEGER DEFAULT 5,                -- 1-10, lower = higher priority
  auction_end_time TIMESTAMPTZ,              -- For priority sorting

  -- Execution tracking
  actions_taken JSONB DEFAULT '[]'::jsonb,   -- Array of actions taken
  screenshot_urls TEXT[],                    -- Evidence screenshots
  notes TEXT,                                -- Operator notes

  -- Timestamps
  assigned_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for operator queue
CREATE INDEX IF NOT EXISTS idx_proxy_bid_assignments_queue
  ON proxy_bid_assignments(status, priority, auction_end_time)
  WHERE status IN ('pending', 'assigned', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_proxy_bid_assignments_operator
  ON proxy_bid_assignments(assigned_operator_id, status);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS
ALTER TABLE buyer_agency_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxy_bid_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxy_bid_assignments ENABLE ROW LEVEL SECURITY;

-- Buyer agency agreements: users can view/manage their own
CREATE POLICY "Users can view their own agency agreements"
  ON buyer_agency_agreements FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own agency agreements"
  ON buyer_agency_agreements FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own draft agreements"
  ON buyer_agency_agreements FOR UPDATE
  USING (auth.uid() = user_id AND status = 'draft');

-- Proxy bid requests: users can view/manage their own
CREATE POLICY "Users can view their own proxy bid requests"
  ON proxy_bid_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own proxy bid requests"
  ON proxy_bid_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can cancel their own pending requests"
  ON proxy_bid_requests FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending');

-- Proxy bid assignments: only admins/operators can access
-- (Service role will be used for admin operations)
CREATE POLICY "Operators can view their assignments"
  ON proxy_bid_assignments FOR SELECT
  USING (
    auth.uid() = assigned_operator_id
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.is_admin = true
    )
  );

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Function to check if user has active agency agreement
CREATE OR REPLACE FUNCTION has_active_agency_agreement(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM buyer_agency_agreements
    WHERE user_id = p_user_id
    AND status = 'active'
    AND expiration_date >= CURRENT_DATE
  );
END;
$$;

-- Function to get user's spending this month
CREATE OR REPLACE FUNCTION get_monthly_proxy_spending(p_user_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total BIGINT;
BEGIN
  SELECT COALESCE(SUM(final_price_cents), 0) INTO total
  FROM proxy_bid_requests
  WHERE user_id = p_user_id
  AND status = 'won'
  AND won_at >= date_trunc('month', CURRENT_DATE);

  RETURN total;
END;
$$;

-- Trigger to update timestamps
CREATE OR REPLACE FUNCTION update_buyer_agency_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_buyer_agency_agreements_timestamp
  BEFORE UPDATE ON buyer_agency_agreements
  FOR EACH ROW EXECUTE FUNCTION update_buyer_agency_timestamp();

CREATE TRIGGER tr_proxy_bid_requests_timestamp
  BEFORE UPDATE ON proxy_bid_requests
  FOR EACH ROW EXECUTE FUNCTION update_buyer_agency_timestamp();

CREATE TRIGGER tr_proxy_bid_assignments_timestamp
  BEFORE UPDATE ON proxy_bid_assignments
  FOR EACH ROW EXECUTE FUNCTION update_buyer_agency_timestamp();

-- ============================================================
-- NOTIFICATIONS INTEGRATION
-- ============================================================

-- Add proxy bidding notification types to existing table (if exists)
DO $$
BEGIN
  -- Check if user_notifications exists and add new types
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'user_notifications'
  ) THEN
    -- The notification_type CHECK constraint will need to be updated
    -- For now, we'll rely on application logic for new notification types
    NULL;
  END IF;
END;
$$;

-- Comment for documentation
COMMENT ON TABLE buyer_agency_agreements IS 'Legal agreements authorizing N-Zero to bid on external auctions on behalf of users';
COMMENT ON TABLE proxy_bid_requests IS 'Individual proxy bid requests from users for external auctions';
COMMENT ON TABLE proxy_bid_assignments IS 'Operator assignments for executing proxy bids (human-in-loop)';
