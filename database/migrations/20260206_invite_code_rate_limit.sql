-- Rate limiting for invite code generation and usage
-- Prevents spam/abuse of invite code system

-- 1. Create table to track invite code usage attempts (for brute force prevention)
CREATE TABLE IF NOT EXISTS invite_code_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id bigint NOT NULL,
    code_attempted text NOT NULL,
    attempted_at timestamptz DEFAULT now(),
    success boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_invite_code_attempts_telegram ON invite_code_attempts(telegram_id, attempted_at DESC);

-- 2. Replace generate_invite_code with rate-limited version
CREATE OR REPLACE FUNCTION generate_invite_code(
    p_business_id uuid,
    p_created_by uuid DEFAULT NULL,
    p_role_type text DEFAULT 'technician',
    p_max_uses int DEFAULT 10,
    p_expires_days int DEFAULT 30
) RETURNS text AS $$
DECLARE
    v_code text;
    v_codes_last_24h int;
    v_rate_limit int := 20;
BEGIN
    -- Check rate limit: max 20 codes per business per 24 hours
    SELECT COUNT(*) INTO v_codes_last_24h
    FROM business_invite_codes
    WHERE business_id = p_business_id
      AND created_at > now() - interval '24 hours';

    IF v_codes_last_24h >= v_rate_limit THEN
        RAISE EXCEPTION 'Rate limit exceeded: You can only generate % invite codes per 24 hours. Please try again later.', v_rate_limit;
    END IF;

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

-- 3. Replace use_invite_code with rate-limited version
CREATE OR REPLACE FUNCTION use_invite_code(
    p_code text,
    p_telegram_id bigint
) RETURNS jsonb AS $$
DECLARE
    v_invite business_invite_codes%ROWTYPE;
    v_tech telegram_technicians%ROWTYPE;
    v_result jsonb;
    v_attempts_last_hour int;
    v_rate_limit int := 10;
BEGIN
    -- Check rate limit: max 10 attempts per telegram_id per hour
    SELECT COUNT(*) INTO v_attempts_last_hour
    FROM invite_code_attempts
    WHERE telegram_id = p_telegram_id
      AND attempted_at > now() - interval '1 hour';

    IF v_attempts_last_hour >= v_rate_limit THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Too many attempts. Please wait an hour before trying again.'
        );
    END IF;

    -- Log the attempt
    INSERT INTO invite_code_attempts (telegram_id, code_attempted, success)
    VALUES (p_telegram_id, upper(p_code), false);

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

    -- Mark the attempt as successful
    UPDATE invite_code_attempts
    SET success = true
    WHERE telegram_id = p_telegram_id
      AND code_attempted = upper(p_code)
      AND attempted_at = (
          SELECT MAX(attempted_at) FROM invite_code_attempts
          WHERE telegram_id = p_telegram_id
      );

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

-- 4. Add RLS policy for invite_code_attempts (service role only)
ALTER TABLE invite_code_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON invite_code_attempts
    USING (true) WITH CHECK (true);

-- 5. Add cleanup function for old attempts (optional, run via cron)
CREATE OR REPLACE FUNCTION cleanup_old_invite_code_attempts()
RETURNS int AS $$
DECLARE
    v_deleted int;
BEGIN
    DELETE FROM invite_code_attempts
    WHERE attempted_at < now() - interval '7 days';

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE invite_code_attempts IS 'Tracks invite code usage attempts for rate limiting and brute force prevention';
COMMENT ON FUNCTION generate_invite_code IS 'Generate invite code with rate limit: max 20 per business per 24 hours';
COMMENT ON FUNCTION use_invite_code IS 'Use invite code with rate limit: max 10 attempts per telegram_id per hour';
COMMENT ON FUNCTION cleanup_old_invite_code_attempts IS 'Cleanup function for old invite code attempts - run via cron if desired';
