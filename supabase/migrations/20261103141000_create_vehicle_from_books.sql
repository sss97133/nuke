BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- A vehicle the books cite that has no profile (a car the owner sold or brokered before Nuke held it) gets a private
-- profile through this writer, never a raw insert. The profile is the owner's, not public, and carries the citation
-- (document, source key, evidence) in provenance_metadata.created_from_books. An existing live vehicle with the same VIN
-- is returned unchanged. Facts about the car (purchase, sale) then arrive through link_books_to_vehicles.
CREATE OR REPLACE FUNCTION public.create_vehicle_from_books(p_owner_id uuid, p_vin text, p_year integer, p_make text, p_model text, p_source jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_vin text := upper(btrim(p_vin)); v_id uuid; v_existing uuid;
BEGIN
  IF p_owner_id IS NULL OR NOT EXISTS (SELECT 1 FROM financial_documents d WHERE d.owner_id = p_owner_id LIMIT 1) THEN
    RAISE EXCEPTION 'create_vehicle_from_books: % has no books', p_owner_id;
  END IF;
  IF p_source IS NULL OR (p_source ->> 'ref') IS NULL THEN
    RAISE EXCEPTION 'create_vehicle_from_books: a vehicle created from the books needs a cited source with a ref';
  END IF;
  IF v_vin !~ '^[A-Z0-9]{5,17}$' OR p_make IS NULL OR p_model IS NULL OR p_year IS NULL OR p_year NOT BETWEEN 1885 AND 2100 THEN
    RAISE EXCEPTION 'create_vehicle_from_books: VIN, year, make and model are required';
  END IF;
  SELECT id INTO v_existing FROM vehicles WHERE vin = v_vin AND deleted_at IS NULL AND merged_into_vehicle_id IS NULL ORDER BY created_at LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'exists', 'vehicle_id', v_existing);
  END IF;
  INSERT INTO vehicles (year, make, model, vin, owner_id, uploaded_by, is_public, provenance_metadata)
  VALUES (p_year, p_make, p_model, v_vin, p_owner_id, p_owner_id, false,
          jsonb_build_object('created_from_books', p_source || jsonb_build_object('created_at', now())))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('status', 'created', 'vehicle_id', v_id);
END
$$;
REVOKE ALL ON FUNCTION public.create_vehicle_from_books(uuid, text, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_vehicle_from_books(uuid, text, integer, text, text, jsonb) TO service_role;
COMMENT ON FUNCTION public.create_vehicle_from_books(uuid, text, integer, text, text, jsonb) IS
  'Private vehicle profile for a car the owner''s books cite and Nuke does not hold; cited, idempotent on VIN, service role only.';
COMMIT;
