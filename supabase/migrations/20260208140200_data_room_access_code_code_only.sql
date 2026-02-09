-- Code-only access: no email required. Pass p_identifier (e.g. IP) for "2 uses per user"; p_email kept for backward compat but optional.

CREATE OR REPLACE FUNCTION validate_data_room_access_code(
  p_organization_id UUID,
  p_email TEXT DEFAULT NULL,
  p_code TEXT DEFAULT NULL,
  p_identifier TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identifier TEXT;
  v_count INT;
  v_code TEXT;
BEGIN
  v_code := coalesce(trim(p_code), '');
  IF v_code = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  IF v_code NOT IN ('1025', '0915', '1129', '915') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  IF p_identifier IS NOT NULL AND trim(p_identifier) != '' THEN
    v_identifier := trim(p_identifier);
  ELSIF p_email IS NOT NULL AND trim(p_email) LIKE '%@%' THEN
    v_identifier := lower(trim(p_email));
  ELSE
    v_identifier := 'unknown';
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
