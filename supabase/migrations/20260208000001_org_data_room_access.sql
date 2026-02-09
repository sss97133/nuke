-- Org-scoped data room / investor materials access (NDA + phone verification).
-- Anyone can record their own signature; org owners can list signatories.
-- organization_id is businesses.id (org profile uses business id from URL).

CREATE TABLE IF NOT EXISTS org_data_room_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('user', 'phone')),
  identifier_value TEXT NOT NULL,
  signed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  nda_version TEXT DEFAULT '2026-01',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_org_data_room_access_org ON org_data_room_access(organization_id);
CREATE INDEX idx_org_data_room_access_identifier ON org_data_room_access(organization_id, identifier_type, identifier_value);

ALTER TABLE org_data_room_access ENABLE ROW LEVEL SECURITY;

-- Anyone (anon or authenticated) may insert their own access record (app validates before calling).
CREATE POLICY org_data_room_access_insert ON org_data_room_access
  FOR INSERT WITH CHECK (true);

-- Org owners may read access records for their org (to see who signed).
CREATE POLICY org_data_room_access_select_org_member ON org_data_room_access
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM business_ownership bo
      WHERE bo.business_id = org_data_room_access.organization_id
        AND bo.owner_id = auth.uid()
        AND bo.status = 'active'
    )
  );

-- Authenticated user may read their own record (identifier_type = 'user').
CREATE POLICY org_data_room_access_select_own_user ON org_data_room_access
  FOR SELECT USING (
    identifier_type = 'user' AND identifier_value = auth.uid()::text
  );

-- RPC: check if an identifier already has access (for "already signed" / session grant). Callable by anon with phone or by auth with user.
CREATE OR REPLACE FUNCTION check_org_data_room_access(p_org_id UUID, p_identifier_type TEXT, p_identifier_value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_identifier_type NOT IN ('user', 'phone') THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM org_data_room_access
    WHERE organization_id = p_org_id
      AND identifier_type = p_identifier_type
      AND identifier_value = p_identifier_value
  );
END;
$$;

COMMENT ON TABLE org_data_room_access IS 'NDA/data room access per org: sign-in by user or phone OTP then signature.';
