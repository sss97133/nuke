-- Data room access codes: shared passwords (1025, 0915, 1129), max 2 uses per user (email) per org.

CREATE TABLE IF NOT EXISTS data_room_access_code_uses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  identifier TEXT NOT NULL,
  used_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_data_room_access_code_uses_org_id ON data_room_access_code_uses(organization_id);
CREATE INDEX idx_data_room_access_code_uses_org_identifier ON data_room_access_code_uses(organization_id, identifier);

ALTER TABLE data_room_access_code_uses ENABLE ROW LEVEL SECURITY;

-- Only the RPC can insert (it sets a session flag). No direct anon/auth access.
CREATE POLICY data_room_access_code_uses_insert_via_rpc ON data_room_access_code_uses
  FOR INSERT WITH CHECK (current_setting('app.data_room_code_rpc', true) = '1');

CREATE POLICY data_room_access_code_uses_select_deny ON data_room_access_code_uses
  FOR SELECT USING (false);

-- RPC: validate code and record use. Returns { ok, reason? }. Callable by anon.
CREATE OR REPLACE FUNCTION validate_data_room_access_code(
  p_organization_id UUID,
  p_email TEXT,
  p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identifier TEXT;
  v_count INT;
  v_valid_codes TEXT[] := ARRAY['1025', '0915', '1129'];
BEGIN
  v_identifier := lower(trim(p_email));
  IF v_identifier = '' OR v_identifier NOT LIKE '%@%' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_email');
  END IF;
  IF trim(p_code) IS NULL OR trim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  IF trim(p_code) != ALL(v_valid_codes) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  SELECT count(*)::int INTO v_count
  FROM data_room_access_code_uses
  WHERE organization_id = p_organization_id AND identifier = v_identifier;

  IF v_count >= 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'limit_reached');
  END IF;

  PERFORM set_config('app.data_room_code_rpc', '1', true);
  INSERT INTO data_room_access_code_uses (organization_id, identifier)
  VALUES (p_organization_id, v_identifier);

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON TABLE data_room_access_code_uses IS 'Tracks data room access code uses: 2 per (org, email). Codes 1025, 0915, 1129.';
