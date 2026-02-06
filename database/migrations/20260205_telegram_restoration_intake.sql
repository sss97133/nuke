-- Telegram Restoration Company Photo Intake
-- Enables: Boss → Invite → Technician → Photos → Business → Vehicle → API

-- 1. Add business_id to telegram_technicians (link techs to companies)
ALTER TABLE telegram_technicians
ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS invite_code_used text,
ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_telegram_techs_business ON telegram_technicians(business_id);

-- 2. Business invite codes for onboarding
CREATE TABLE IF NOT EXISTS business_invite_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    code text NOT NULL UNIQUE,
    created_by uuid REFERENCES auth.users(id),
    role_type text DEFAULT 'technician' CHECK (role_type IN ('technician', 'manager', 'viewer')),
    max_uses int DEFAULT 10,
    uses_count int DEFAULT 0,
    expires_at timestamptz DEFAULT now() + interval '30 days',
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    metadata jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_business ON business_invite_codes(business_id);
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON business_invite_codes(code) WHERE is_active = true;

-- 3. Telegram work submissions (parallel to sms_work_submissions)
CREATE TABLE IF NOT EXISTS telegram_work_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source identification
    telegram_technician_id uuid NOT NULL REFERENCES telegram_technicians(id),
    telegram_message_id bigint,
    telegram_chat_id bigint,

    -- Content
    message_text text,
    photo_urls text[] DEFAULT ARRAY[]::text[],
    storage_paths text[] DEFAULT ARRAY[]::text[],

    -- Timestamps
    received_at timestamptz DEFAULT now(),

    -- AI Processing
    ai_processed_at timestamptz,
    ai_interpretation jsonb,
    confidence_score numeric(3,2),

    -- Detection results
    detected_vehicle_id uuid REFERENCES vehicles(id),
    detected_vehicle_hints jsonb,
    detected_work_type text,
    detected_description text,

    -- Linkage to outputs
    timeline_event_id uuid,
    observation_id uuid REFERENCES vehicle_observations(id),

    -- Payout tracking (if paying per submission)
    payout_amount numeric(10,2),
    payout_status text DEFAULT 'pending' CHECK (payout_status IN ('pending', 'approved', 'paid', 'disputed')),

    -- Workflow
    processing_status text DEFAULT 'received' CHECK (processing_status IN (
        'received',      -- Just came in
        'processing',    -- AI working on it
        'needs_context', -- Asked tech for clarification
        'processed',     -- AI done, pending human review
        'logged',        -- Written to vehicle timeline
        'failed'         -- Couldn't process
    )),

    -- Follow-up conversation
    follow_up_question text,
    follow_up_response text,

    -- Denormalized for faster queries
    business_id uuid REFERENCES businesses(id),

    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tg_work_tech ON telegram_work_submissions(telegram_technician_id);
CREATE INDEX IF NOT EXISTS idx_tg_work_business ON telegram_work_submissions(business_id);
CREATE INDEX IF NOT EXISTS idx_tg_work_vehicle ON telegram_work_submissions(detected_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_tg_work_status ON telegram_work_submissions(processing_status);
CREATE INDEX IF NOT EXISTS idx_tg_work_received ON telegram_work_submissions(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_work_needs_processing ON telegram_work_submissions(processing_status)
    WHERE processing_status IN ('received', 'processing');

-- Unique constraint on telegram message to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_work_msg_unique
    ON telegram_work_submissions(telegram_chat_id, telegram_message_id)
    WHERE telegram_message_id IS NOT NULL;

-- 4. Function to generate invite codes
CREATE OR REPLACE FUNCTION generate_invite_code(
    p_business_id uuid,
    p_created_by uuid DEFAULT NULL,
    p_role_type text DEFAULT 'technician',
    p_max_uses int DEFAULT 10,
    p_expires_days int DEFAULT 30
) RETURNS text AS $$
DECLARE
    v_code text;
BEGIN
    -- Generate 8-char uppercase code
    v_code := upper(substr(md5(random()::text), 1, 8));

    INSERT INTO business_invite_codes (
        business_id, code, created_by, role_type, max_uses, expires_at
    ) VALUES (
        p_business_id, v_code, p_created_by, p_role_type, p_max_uses,
        now() + (p_expires_days || ' days')::interval
    );

    RETURN v_code;
END;
$$ LANGUAGE plpgsql;

-- 5. Function to use invite code (called during onboarding)
CREATE OR REPLACE FUNCTION use_invite_code(
    p_code text,
    p_telegram_id bigint
) RETURNS jsonb AS $$
DECLARE
    v_invite business_invite_codes%ROWTYPE;
    v_tech telegram_technicians%ROWTYPE;
    v_result jsonb;
BEGIN
    -- Find and validate invite code
    SELECT * INTO v_invite
    FROM business_invite_codes
    WHERE code = upper(p_code)
      AND is_active = true
      AND uses_count < max_uses
      AND (expires_at IS NULL OR expires_at > now());

    IF v_invite.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid or expired invite code'
        );
    END IF;

    -- Find or create telegram technician
    SELECT * INTO v_tech FROM telegram_technicians WHERE telegram_id = p_telegram_id;

    IF v_tech.id IS NULL THEN
        INSERT INTO telegram_technicians (telegram_id, business_id, invite_code_used, onboarded_at)
        VALUES (p_telegram_id, v_invite.business_id, p_code, now())
        RETURNING * INTO v_tech;
    ELSE
        -- Update existing tech with business
        UPDATE telegram_technicians
        SET business_id = v_invite.business_id,
            invite_code_used = p_code,
            onboarded_at = now()
        WHERE id = v_tech.id
        RETURNING * INTO v_tech;
    END IF;

    -- Increment uses
    UPDATE business_invite_codes SET uses_count = uses_count + 1 WHERE id = v_invite.id;

    -- Get business name for confirmation
    RETURN jsonb_build_object(
        'success', true,
        'business_id', v_invite.business_id,
        'business_name', (SELECT business_name FROM businesses WHERE id = v_invite.business_id),
        'role_type', v_invite.role_type,
        'technician_id', v_tech.id
    );
END;
$$ LANGUAGE plpgsql;

-- 6. View for business to see their submissions
CREATE OR REPLACE VIEW business_telegram_submissions AS
SELECT
    tws.id,
    tws.business_id,
    b.business_name,
    tt.display_name as technician_name,
    tt.telegram_username,
    tws.message_text,
    tws.photo_urls,
    tws.storage_paths,
    tws.received_at,
    tws.processing_status,
    tws.detected_vehicle_id,
    v.year,
    v.make,
    v.model,
    v.vin,
    tws.detected_work_type,
    tws.detected_description,
    tws.confidence_score,
    tws.ai_interpretation
FROM telegram_work_submissions tws
JOIN telegram_technicians tt ON tws.telegram_technician_id = tt.id
JOIN businesses b ON tws.business_id = b.id
LEFT JOIN vehicles v ON tws.detected_vehicle_id = v.id;

-- 7. RLS policies
ALTER TABLE telegram_work_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_invite_codes ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access" ON telegram_work_submissions
    USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON business_invite_codes
    USING (true) WITH CHECK (true);

-- Business owners/managers can see their submissions
CREATE POLICY "Business members view submissions" ON telegram_work_submissions FOR SELECT
    USING (
        business_id IN (
            SELECT business_id FROM business_user_roles
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

-- Business owners can manage invite codes
CREATE POLICY "Business owners manage invite codes" ON business_invite_codes
    USING (
        business_id IN (
            SELECT business_id FROM business_user_roles
            WHERE user_id = auth.uid()
              AND role_type IN ('owner', 'manager')
              AND status = 'active'
        )
    );

COMMENT ON TABLE telegram_work_submissions IS 'Work photos and updates submitted by technicians via Telegram';
COMMENT ON TABLE business_invite_codes IS 'Invite codes for technicians to join a business via Telegram';
