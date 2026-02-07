-- Fix overly permissive RLS policies in Restoration Intake schema
-- The original migration at 20260205_telegram_restoration_intake.sql had policies
-- using USING (true) WITH CHECK (true) which grants access to ALL users, not just service role.
--
-- This migration drops those policies and creates proper ones that:
-- 1. Allow service role full access
-- 2. Allow authenticated users to read their own business's data
-- 3. Allow business owners/managers to manage invite codes

-- ============================================================
-- DROP OVERLY PERMISSIVE POLICIES
-- ============================================================

DROP POLICY IF EXISTS "Service role full access" ON telegram_work_submissions;
DROP POLICY IF EXISTS "Service role full access" ON business_invite_codes;

-- ============================================================
-- TELEGRAM_WORK_SUBMISSIONS POLICIES
-- ============================================================

-- Service role has full access (for edge functions and background jobs)
CREATE POLICY "Service role full access on submissions"
ON telegram_work_submissions
FOR ALL
USING (auth.jwt() ->> 'role' = 'service_role')
WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Business members can view their business's submissions
-- Uses organization_contributors which links user_id to businesses via organization_id
CREATE POLICY "Business members can view submissions"
ON telegram_work_submissions
FOR SELECT
USING (
    business_id IN (
        SELECT organization_id
        FROM organization_contributors
        WHERE user_id = auth.uid()
        AND status = 'active'
    )
    OR
    business_id IN (
        SELECT business_id
        FROM business_user_roles
        WHERE user_id = auth.uid()
        AND status = 'active'
    )
);

-- ============================================================
-- BUSINESS_INVITE_CODES POLICIES
-- ============================================================

-- Service role has full access (for edge functions)
CREATE POLICY "Service role full access on invite codes"
ON business_invite_codes
FOR ALL
USING (auth.jwt() ->> 'role' = 'service_role')
WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Business owners and managers can view and manage their invite codes
-- Must have 'owner', 'co_founder', or 'manager' role in organization_contributors
-- OR 'owner' or 'manager' role_type in business_user_roles
CREATE POLICY "Business owners can view invite codes"
ON business_invite_codes
FOR SELECT
USING (
    business_id IN (
        SELECT organization_id
        FROM organization_contributors
        WHERE user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner', 'co_founder', 'manager')
    )
    OR
    business_id IN (
        SELECT business_id
        FROM business_user_roles
        WHERE user_id = auth.uid()
        AND status = 'active'
        AND role_type IN ('owner', 'manager')
    )
);

CREATE POLICY "Business owners can create invite codes"
ON business_invite_codes
FOR INSERT
WITH CHECK (
    business_id IN (
        SELECT organization_id
        FROM organization_contributors
        WHERE user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner', 'co_founder', 'manager')
    )
    OR
    business_id IN (
        SELECT business_id
        FROM business_user_roles
        WHERE user_id = auth.uid()
        AND status = 'active'
        AND role_type IN ('owner', 'manager')
    )
);

CREATE POLICY "Business owners can update invite codes"
ON business_invite_codes
FOR UPDATE
USING (
    business_id IN (
        SELECT organization_id
        FROM organization_contributors
        WHERE user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner', 'co_founder', 'manager')
    )
    OR
    business_id IN (
        SELECT business_id
        FROM business_user_roles
        WHERE user_id = auth.uid()
        AND status = 'active'
        AND role_type IN ('owner', 'manager')
    )
)
WITH CHECK (
    business_id IN (
        SELECT organization_id
        FROM organization_contributors
        WHERE user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner', 'co_founder', 'manager')
    )
    OR
    business_id IN (
        SELECT business_id
        FROM business_user_roles
        WHERE user_id = auth.uid()
        AND status = 'active'
        AND role_type IN ('owner', 'manager')
    )
);

CREATE POLICY "Business owners can delete invite codes"
ON business_invite_codes
FOR DELETE
USING (
    business_id IN (
        SELECT organization_id
        FROM organization_contributors
        WHERE user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner', 'co_founder', 'manager')
    )
    OR
    business_id IN (
        SELECT business_id
        FROM business_user_roles
        WHERE user_id = auth.uid()
        AND status = 'active'
        AND role_type IN ('owner', 'manager')
    )
);

-- ============================================================
-- Also fix the "Business members view submissions" policy from original migration
-- which referenced business_user_roles (correct) but may conflict
-- ============================================================

DROP POLICY IF EXISTS "Business members view submissions" ON telegram_work_submissions;
DROP POLICY IF EXISTS "Business owners manage invite codes" ON business_invite_codes;

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON POLICY "Service role full access on submissions" ON telegram_work_submissions
IS 'Edge functions and background jobs can manage all submission records';

COMMENT ON POLICY "Business members can view submissions" ON telegram_work_submissions
IS 'Users can view submissions for businesses they are actively affiliated with';

COMMENT ON POLICY "Service role full access on invite codes" ON business_invite_codes
IS 'Edge functions can manage invite codes for onboarding flow';

COMMENT ON POLICY "Business owners can view invite codes" ON business_invite_codes
IS 'Owners, co-founders, and managers can view their business invite codes';
