-- Accept "915" as well as "0915" for the access code.

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
BEGIN
  v_identifier := lower(trim(p_email));
  IF v_identifier = '' OR v_identifier NOT LIKE '%@%' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_email');
  END IF;
  IF trim(p_code) IS NULL OR trim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  IF trim(p_code) NOT IN ('1025', '0915', '1129', '915') THEN
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
