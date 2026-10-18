-- =============================================================================
-- VAULT PRIVACY TABLES
-- =============================================================================
-- Three-tier privacy system for vehicle document processing:
-- 1. QUICK (Tier 1): Server processes document (current flow)
-- 2. PRIVATE (Tier 2): PWA processes on-device, sends text only
-- 3. VAULT (Tier 3): Native app, full on-device, sends attestation only
--
-- Design Principles:
-- 1. PRIVACY FIRST: User controls where their data lives
-- 2. PROGRESSIVE: Users can upgrade privacy at any time
-- 3. AUDITABLE: All access requests logged
-- 4. CRYPTOGRAPHIC: Tier 3 uses device attestation + signatures
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ENUM TYPES
-- -----------------------------------------------------------------------------

-- Privacy tier levels
DO $$ BEGIN
    CREATE TYPE vault_privacy_tier AS ENUM (
        'quick',      -- Server processes (fastest, least private)
        'private',    -- PWA on-device processing (medium)
        'vault'       -- Native app vault (maximum privacy)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Document types for vault
DO $$ BEGIN
    CREATE TYPE vault_document_type AS ENUM (
        'title',           -- Certificate of Title
        'registration',    -- Vehicle Registration
        'bill_of_sale',    -- Bill of Sale
        'insurance',       -- Insurance Card
        'inspection',      -- Inspection Certificate
        'lien_release',    -- Lien Release Document
        'power_of_attorney', -- POA for title transfer
        'odometer',        -- Odometer Disclosure
        'other'            -- Other document
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Access request status
DO $$ BEGIN
    CREATE TYPE vault_access_status AS ENUM (
        'pending',    -- Awaiting user response
        'approved',   -- User approved access
        'denied',     -- User denied access
        'expired'     -- Request expired without response
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SMS session states for vault flow
DO $$ BEGIN
    CREATE TYPE vault_sms_state AS ENUM (
        'awaiting_image',           -- Waiting for document image
        'awaiting_tier_selection',  -- Image received, waiting for tier choice
        'processing_quick',         -- Tier 1: server processing
        'awaiting_pwa_completion',  -- Tier 2: PWA link sent, waiting
        'awaiting_app_submission',  -- Tier 3: app link sent, waiting
        'completed',                -- Flow complete
        'expired'                   -- Session expired
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- USER PRIVACY PREFERENCES
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vault_user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Privacy defaults
    default_tier vault_privacy_tier DEFAULT 'quick',
    always_ask BOOLEAN DEFAULT true,  -- Ask every time vs use default

    -- Notification preferences
    notify_on_access_request BOOLEAN DEFAULT true,
    notify_via_sms BOOLEAN DEFAULT true,
    notify_via_push BOOLEAN DEFAULT true,

    -- Retention
    auto_delete_days INTEGER DEFAULT NULL,  -- NULL = never auto-delete

    -- Push notification token (for native app)
    push_token TEXT,
    push_token_platform TEXT CHECK (push_token_platform IN ('ios', 'android', 'web')),
    push_token_updated_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_vault_preferences_per_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_prefs_user ON vault_user_preferences(user_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_vault_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_vault_preferences_updated_at ON vault_user_preferences;
CREATE TRIGGER trigger_vault_preferences_updated_at
    BEFORE UPDATE ON vault_user_preferences
    FOR EACH ROW EXECUTE FUNCTION update_vault_preferences_updated_at();

-- -----------------------------------------------------------------------------
-- VAULT ATTESTATIONS (What we store from Tier 3 - no original documents!)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vault_attestations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,

    -- Extracted non-sensitive data
    vin TEXT NOT NULL,
    document_type vault_document_type NOT NULL,
    state TEXT,  -- US state code

    -- Masked/hashed data (privacy-preserving)
    title_number_masked TEXT,      -- e.g., "****7842"
    owner_name_hash TEXT,          -- SHA-256 for matching without revealing

    -- Cryptographic attestation proof
    document_hash TEXT NOT NULL,   -- SHA-256 of original document
    device_attestation TEXT,       -- Apple DeviceCheck / Google SafetyNet token
    device_attestation_type TEXT CHECK (device_attestation_type IN ('apple_device_check', 'google_play_integrity', 'google_safety_net')),
    signature TEXT NOT NULL,       -- Ed25519 signature of attestation package
    public_key TEXT,               -- Public key for signature verification

    -- Redacted preview
    redacted_thumbnail TEXT,       -- Base64 encoded blurred/redacted image

    -- Access control
    vault_token TEXT UNIQUE NOT NULL,  -- Token for access requests

    -- Verification
    vin_verified BOOLEAN DEFAULT false,
    vin_verification_source TEXT,  -- 'nmvtis', 'carfax', 'manual', etc.
    vin_verification_at TIMESTAMPTZ,

    -- Metadata
    device_info JSONB DEFAULT '{}',  -- {model, os_version, app_version}
    extraction_metadata JSONB DEFAULT '{}',  -- {ml_model_version, confidence_scores}

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_attestations_user ON vault_attestations(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_attestations_vin ON vault_attestations(vin);
CREATE INDEX IF NOT EXISTS idx_vault_attestations_vehicle ON vault_attestations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vault_attestations_token ON vault_attestations(vault_token);
CREATE INDEX IF NOT EXISTS idx_vault_attestations_doc_hash ON vault_attestations(document_hash);

-- -----------------------------------------------------------------------------
-- ACCESS REQUEST WORKFLOW
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vault_access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attestation_id UUID NOT NULL REFERENCES vault_attestations(id) ON DELETE CASCADE,

    -- Who is requesting
    requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    request_reason TEXT NOT NULL,
    request_context JSONB DEFAULT '{}',  -- {dispute_id, transaction_id, etc.}

    -- Status
    status vault_access_status DEFAULT 'pending',

    -- Response details (if approved)
    approved_at TIMESTAMPTZ,
    approved_duration_hours INTEGER DEFAULT 24,  -- How long access is granted
    temporary_url TEXT,  -- Signed URL to document (set when user uploads)
    url_expires_at TIMESTAMPTZ,

    -- Response details (if denied)
    denied_at TIMESTAMPTZ,
    denial_reason TEXT,

    -- Expiration
    expires_at TIMESTAMPTZ NOT NULL,  -- When request auto-expires

    -- Notification tracking
    notification_sent_at TIMESTAMPTZ,
    notification_channel TEXT,  -- 'sms', 'push', 'both'
    reminder_sent_at TIMESTAMPTZ,

    -- Audit
    responded_at TIMESTAMPTZ,
    response_ip TEXT,
    response_user_agent TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_access_attestation ON vault_access_requests(attestation_id);
CREATE INDEX IF NOT EXISTS idx_vault_access_requested_by ON vault_access_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_vault_access_status ON vault_access_requests(status);
CREATE INDEX IF NOT EXISTS idx_vault_access_expires ON vault_access_requests(expires_at) WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- SMS SESSION STATE MACHINE
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vault_sms_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- State machine
    state vault_sms_state DEFAULT 'awaiting_image',

    -- Image tracking (for Tier 1 only - deleted after processing)
    last_image_url TEXT,
    last_image_received_at TIMESTAMPTZ,

    -- Tier selection
    selected_tier vault_privacy_tier,
    tier_selected_at TIMESTAMPTZ,

    -- PWA linking (Tier 2)
    pwa_session_token TEXT UNIQUE,
    pwa_link_sent_at TIMESTAMPTZ,
    pwa_completed_at TIMESTAMPTZ,

    -- App linking (Tier 3)
    app_link_sent_at TIMESTAMPTZ,
    app_submission_received_at TIMESTAMPTZ,

    -- Results
    result_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    result_attestation_id UUID REFERENCES vault_attestations(id) ON DELETE SET NULL,

    -- Context
    context JSONB DEFAULT '{}',  -- {extraction_result, error_message, etc.}
    message_history JSONB DEFAULT '[]',  -- Recent messages for context

    -- Expiration
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 hour'),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_sms_phone ON vault_sms_sessions(phone_number);
CREATE INDEX IF NOT EXISTS idx_vault_sms_user ON vault_sms_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_sms_state ON vault_sms_sessions(state);
CREATE INDEX IF NOT EXISTS idx_vault_sms_pwa_token ON vault_sms_sessions(pwa_session_token);
CREATE INDEX IF NOT EXISTS idx_vault_sms_expires ON vault_sms_sessions(expires_at) WHERE state NOT IN ('completed', 'expired');
CREATE INDEX IF NOT EXISTS idx_vault_sms_active ON vault_sms_sessions(phone_number, created_at DESC) WHERE state NOT IN ('completed', 'expired');

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_vault_sms_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.last_message_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_vault_sms_session_updated_at ON vault_sms_sessions;
CREATE TRIGGER trigger_vault_sms_session_updated_at
    BEFORE UPDATE ON vault_sms_sessions
    FOR EACH ROW EXECUTE FUNCTION update_vault_sms_session_updated_at();

-- -----------------------------------------------------------------------------
-- AUDIT LOG EXTENSION
-- -----------------------------------------------------------------------------

-- Add vault-specific action types to pii_audit_log (if not already extensible)
-- The existing pii_audit_log table should already handle this with its TEXT action column
-- We'll use action prefixes: 'vault_' for all vault-related actions

-- Example vault actions:
-- 'vault_tier_selected' - User chose privacy tier
-- 'vault_attestation_created' - New attestation submitted
-- 'vault_access_requested' - Admin requested access
-- 'vault_access_approved' - User approved access
-- 'vault_access_denied' - User denied access
-- 'vault_document_uploaded' - User uploaded original for access request
-- 'vault_signed_url_generated' - Temporary URL created
-- 'vault_signed_url_accessed' - Document accessed via signed URL

-- -----------------------------------------------------------------------------
-- HELPER FUNCTIONS
-- -----------------------------------------------------------------------------

-- Generate a cryptographically secure vault token
CREATE OR REPLACE FUNCTION generate_vault_token()
RETURNS TEXT AS $$
BEGIN
    RETURN 'vault_' || encode(gen_random_bytes(24), 'base64');
END;
$$ LANGUAGE plpgsql;

-- Generate a PWA session token
CREATE OR REPLACE FUNCTION generate_pwa_session_token()
RETURNS TEXT AS $$
BEGIN
    RETURN 'pwa_' || encode(gen_random_bytes(16), 'base64');
END;
$$ LANGUAGE plpgsql;

-- Get or create active SMS session for a phone number
CREATE OR REPLACE FUNCTION get_or_create_vault_sms_session(
    p_phone_number TEXT
) RETURNS vault_sms_sessions AS $$
DECLARE
    v_session vault_sms_sessions;
BEGIN
    -- Try to find existing active session
    SELECT * INTO v_session
    FROM vault_sms_sessions
    WHERE phone_number = p_phone_number
      AND state NOT IN ('completed', 'expired')
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1;

    -- If found, return it
    IF v_session.id IS NOT NULL THEN
        RETURN v_session;
    END IF;

    -- Create new session
    INSERT INTO vault_sms_sessions (phone_number, pwa_session_token)
    VALUES (p_phone_number, generate_pwa_session_token())
    RETURNING * INTO v_session;

    RETURN v_session;
END;
$$ LANGUAGE plpgsql;

-- Update SMS session state
CREATE OR REPLACE FUNCTION update_vault_sms_session_state(
    p_session_id UUID,
    p_new_state vault_sms_state,
    p_context JSONB DEFAULT NULL
) RETURNS vault_sms_sessions AS $$
DECLARE
    v_session vault_sms_sessions;
BEGIN
    UPDATE vault_sms_sessions
    SET
        state = p_new_state,
        context = CASE
            WHEN p_context IS NOT NULL THEN context || p_context
            ELSE context
        END
    WHERE id = p_session_id
    RETURNING * INTO v_session;

    RETURN v_session;
END;
$$ LANGUAGE plpgsql;

-- Check if user has vault preferences, create defaults if not
CREATE OR REPLACE FUNCTION get_or_create_vault_preferences(
    p_user_id UUID
) RETURNS vault_user_preferences AS $$
DECLARE
    v_prefs vault_user_preferences;
BEGIN
    SELECT * INTO v_prefs
    FROM vault_user_preferences
    WHERE user_id = p_user_id;

    IF v_prefs.id IS NULL THEN
        INSERT INTO vault_user_preferences (user_id)
        VALUES (p_user_id)
        RETURNING * INTO v_prefs;
    END IF;

    RETURN v_prefs;
END;
$$ LANGUAGE plpgsql;

-- Create access request with proper expiration
CREATE OR REPLACE FUNCTION create_vault_access_request(
    p_attestation_id UUID,
    p_requested_by UUID,
    p_reason TEXT,
    p_context JSONB DEFAULT '{}',
    p_expires_in_hours INTEGER DEFAULT 72
) RETURNS vault_access_requests AS $$
DECLARE
    v_request vault_access_requests;
BEGIN
    INSERT INTO vault_access_requests (
        attestation_id,
        requested_by,
        request_reason,
        request_context,
        expires_at
    )
    VALUES (
        p_attestation_id,
        p_requested_by,
        p_reason,
        p_context,
        NOW() + (p_expires_in_hours || ' hours')::INTERVAL
    )
    RETURNING * INTO v_request;

    RETURN v_request;
END;
$$ LANGUAGE plpgsql;

-- Approve access request and generate signed URL placeholder
CREATE OR REPLACE FUNCTION approve_vault_access_request(
    p_request_id UUID,
    p_duration_hours INTEGER DEFAULT 24
) RETURNS vault_access_requests AS $$
DECLARE
    v_request vault_access_requests;
BEGIN
    UPDATE vault_access_requests
    SET
        status = 'approved',
        approved_at = NOW(),
        responded_at = NOW(),
        approved_duration_hours = p_duration_hours,
        url_expires_at = NOW() + (p_duration_hours || ' hours')::INTERVAL
    WHERE id = p_request_id
      AND status = 'pending'
    RETURNING * INTO v_request;

    IF v_request.id IS NULL THEN
        RAISE EXCEPTION 'Access request not found or not pending';
    END IF;

    RETURN v_request;
END;
$$ LANGUAGE plpgsql;

-- Deny access request
CREATE OR REPLACE FUNCTION deny_vault_access_request(
    p_request_id UUID,
    p_reason TEXT DEFAULT NULL
) RETURNS vault_access_requests AS $$
DECLARE
    v_request vault_access_requests;
BEGIN
    UPDATE vault_access_requests
    SET
        status = 'denied',
        denied_at = NOW(),
        responded_at = NOW(),
        denial_reason = p_reason
    WHERE id = p_request_id
      AND status = 'pending'
    RETURNING * INTO v_request;

    IF v_request.id IS NULL THEN
        RAISE EXCEPTION 'Access request not found or not pending';
    END IF;

    RETURN v_request;
END;
$$ LANGUAGE plpgsql;

-- Expire old pending requests
CREATE OR REPLACE FUNCTION expire_vault_access_requests()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    WITH expired AS (
        UPDATE vault_access_requests
        SET status = 'expired'
        WHERE status = 'pending'
          AND expires_at < NOW()
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM expired;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Expire old SMS sessions
CREATE OR REPLACE FUNCTION expire_vault_sms_sessions()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    WITH expired AS (
        UPDATE vault_sms_sessions
        SET state = 'expired'
        WHERE state NOT IN ('completed', 'expired')
          AND expires_at < NOW()
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM expired;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------

-- Enable RLS
ALTER TABLE vault_user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_sms_sessions ENABLE ROW LEVEL SECURITY;

-- Vault User Preferences: Users can manage their own preferences
DROP POLICY IF EXISTS vault_prefs_user_policy ON vault_user_preferences;
CREATE POLICY vault_prefs_user_policy ON vault_user_preferences
    FOR ALL USING (auth.uid() = user_id);

-- Vault Attestations: Users can see their own, admins can see all
DROP POLICY IF EXISTS vault_attestations_user_policy ON vault_attestations;
CREATE POLICY vault_attestations_user_policy ON vault_attestations
    FOR SELECT USING (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.user_type IN ('admin', 'moderator')
        )
    );

DROP POLICY IF EXISTS vault_attestations_insert_policy ON vault_attestations;
CREATE POLICY vault_attestations_insert_policy ON vault_attestations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Vault Access Requests: Users can see requests for their attestations, admins can see/create all
DROP POLICY IF EXISTS vault_access_select_policy ON vault_access_requests;
CREATE POLICY vault_access_select_policy ON vault_access_requests
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vault_attestations
            WHERE vault_attestations.id = attestation_id
              AND vault_attestations.user_id = auth.uid()
        )
        OR auth.uid() = requested_by
        OR EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.user_type IN ('admin', 'moderator')
        )
    );

DROP POLICY IF EXISTS vault_access_insert_policy ON vault_access_requests;
CREATE POLICY vault_access_insert_policy ON vault_access_requests
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.user_type IN ('admin', 'moderator')
        )
    );

DROP POLICY IF EXISTS vault_access_update_policy ON vault_access_requests;
CREATE POLICY vault_access_update_policy ON vault_access_requests
    FOR UPDATE USING (
        -- Owner of attestation can approve/deny
        EXISTS (
            SELECT 1 FROM vault_attestations
            WHERE vault_attestations.id = attestation_id
              AND vault_attestations.user_id = auth.uid()
        )
        -- Admins can update anything
        OR EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.user_type IN ('admin', 'moderator')
        )
    );

-- SMS Sessions: Tied to phone, accessible by system (service role only for most ops)
DROP POLICY IF EXISTS vault_sms_user_policy ON vault_sms_sessions;
CREATE POLICY vault_sms_user_policy ON vault_sms_sessions
    FOR SELECT USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.user_type IN ('admin', 'moderator')
        )
    );

-- -----------------------------------------------------------------------------
-- VIEWS
-- -----------------------------------------------------------------------------

-- Active SMS sessions overview
CREATE OR REPLACE VIEW vault_active_sms_sessions AS
SELECT
    s.id,
    s.phone_number,
    s.state,
    s.selected_tier,
    s.created_at,
    s.last_message_at,
    s.expires_at,
    s.expires_at < NOW() AS is_expired,
    p.full_name AS user_name,
    v.year || ' ' || v.make || ' ' || v.model AS vehicle_info
FROM vault_sms_sessions s
LEFT JOIN profiles p ON s.user_id = p.id
LEFT JOIN vehicles v ON s.result_vehicle_id = v.id
WHERE s.state NOT IN ('completed', 'expired')
ORDER BY s.last_message_at DESC;

-- Pending access requests overview
CREATE OR REPLACE VIEW vault_pending_access_requests AS
SELECT
    r.id AS request_id,
    r.request_reason,
    r.status,
    r.created_at,
    r.expires_at,
    a.vin,
    a.document_type,
    a.title_number_masked,
    owner.full_name AS document_owner_name,
    requester.full_name AS requester_name,
    a.redacted_thumbnail IS NOT NULL AS has_preview
FROM vault_access_requests r
JOIN vault_attestations a ON r.attestation_id = a.id
LEFT JOIN profiles owner ON a.user_id = owner.id
LEFT JOIN profiles requester ON r.requested_by = requester.id
WHERE r.status = 'pending'
ORDER BY r.created_at DESC;

-- User's vault document summary
CREATE OR REPLACE VIEW vault_user_documents AS
SELECT
    a.id AS attestation_id,
    a.user_id,
    a.vin,
    a.document_type,
    a.state,
    a.title_number_masked,
    a.vin_verified,
    a.created_at,
    v.year,
    v.make,
    v.model,
    v.id AS vehicle_id,
    (SELECT COUNT(*) FROM vault_access_requests WHERE attestation_id = a.id) AS total_access_requests,
    (SELECT COUNT(*) FROM vault_access_requests WHERE attestation_id = a.id AND status = 'pending') AS pending_requests
FROM vault_attestations a
LEFT JOIN vehicles v ON a.vehicle_id = v.id
ORDER BY a.created_at DESC;

-- -----------------------------------------------------------------------------
-- COMMENTS
-- -----------------------------------------------------------------------------

COMMENT ON TABLE vault_user_preferences IS
'User privacy preferences for the vault system. Controls default tier, notifications, and retention settings.';

COMMENT ON TABLE vault_attestations IS
'Cryptographic attestations from Tier 3 (native app) submissions. Contains only extracted/hashed data, never the original document.';

COMMENT ON TABLE vault_access_requests IS
'Workflow for requesting access to original documents in user vaults. Requires explicit user approval.';

COMMENT ON TABLE vault_sms_sessions IS
'State machine for SMS-based vault document submission flow. Tracks tier selection and links to PWA/app sessions.';

COMMENT ON TYPE vault_privacy_tier IS
'Privacy levels: quick (server), private (PWA on-device), vault (native app max privacy)';

COMMENT ON FUNCTION get_or_create_vault_sms_session IS
'Gets existing active SMS session for phone or creates new one. Used by vault-sms-webhook.';

COMMENT ON FUNCTION generate_vault_token IS
'Generates cryptographically secure token for access request linking.';
