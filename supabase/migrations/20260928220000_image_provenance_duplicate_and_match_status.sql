-- correct_image_provenance: two more fields, duplicate_of and image_vehicle_match_status (2026-09-28).
--
-- duplicate_of: three pcarmarket listings carried another car's BaT photos (a 1965 356SC's lead photo was the
-- lot 1999-porsche-boxster-42 photo). Those lots are now their own vehicles holding the same photos, so the copies
-- are duplicates; vehicle_images rows cascade into ~30 analysis tables, so a copy is marked (is_duplicate +
-- duplicate_of, which get_vehicle_profile_data already filters), never deleted.
-- image_vehicle_match_status: owner decision 2 (Skylar 2026-09-28) resets ~1.27M 'ambiguous' verdicts written by
-- a vision call that never ran (0.2% sample: 2,530 of 2,530 with no ai_detected_vehicle) back to NULL (unchecked).
-- Both are set-based (one UPDATE per call) and keep the per-row audit the taken_at path keeps
-- (ai_scan_metadata.provenance_corrections). The taken_at path is unchanged; the diff against the live definition
-- is the field check and these two branches.

CREATE OR REPLACE FUNCTION public.correct_image_provenance(p_image_ids uuid[], p_field text, p_value text, p_source jsonb, p_asserted_by text DEFAULT 'agent'::text, p_kind text DEFAULT NULL::text, p_maker_name text DEFAULT NULL::text, p_maker_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_img        record;
  v_audit      jsonb;
  v_corrected  int := 0;
  v_credits    int := 0;
BEGIN
  IF p_field IS NULL OR p_field NOT IN ('taken_at', 'duplicate_of', 'image_vehicle_match_status') THEN
    RAISE EXCEPTION 'correct_image_provenance: unsupported field % (supported: taken_at, duplicate_of, image_vehicle_match_status)', p_field;
  END IF;
  IF p_source IS NULL OR p_source = '{}'::jsonb THEN
    RAISE EXCEPTION 'correct_image_provenance: a source document (p_source) is required -- corrections must be cited, never guessed';
  END IF;

  -- duplicate_of: the images are copies of image p_value; mark them, keep them
  IF p_field = 'duplicate_of' THEN
    IF p_value IS NULL OR NOT EXISTS (SELECT 1 FROM vehicle_images WHERE id = p_value::uuid) THEN
      RAISE EXCEPTION 'correct_image_provenance: duplicate_of needs an existing original image id (got %)', p_value;
    END IF;
    WITH t AS (
      SELECT id, is_duplicate AS o_dup, duplicate_of AS o_of FROM vehicle_images
      WHERE id = ANY(p_image_ids) AND id <> p_value::uuid
        AND (is_duplicate IS DISTINCT FROM true OR duplicate_of IS DISTINCT FROM p_value::uuid))
    UPDATE vehicle_images vi SET
      is_duplicate = true,
      duplicate_of = p_value::uuid,
      ai_scan_metadata = COALESCE(vi.ai_scan_metadata, '{}'::jsonb) || jsonb_build_object('provenance_corrections',
        COALESCE(vi.ai_scan_metadata -> 'provenance_corrections', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'field', 'duplicate_of', 'original', jsonb_build_object('is_duplicate', t.o_dup, 'duplicate_of', t.o_of),
          'corrected', p_value, 'source', p_source, 'asserted_by', p_asserted_by, 'asserted_at', now())))
    FROM t WHERE vi.id = t.id;
    GET DIAGNOSTICS v_corrected = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'field', p_field, 'value', p_value, 'images_corrected', v_corrected,
      'source', p_source, 'asserted_by', p_asserted_by);
  END IF;

  -- image_vehicle_match_status: reset a verdict (NULL = unchecked) or set a known one
  IF p_field = 'image_vehicle_match_status' THEN
    IF p_value IS NOT NULL AND p_value NOT IN ('confirmed', 'mismatch', 'ambiguous', 'unrelated') THEN
      RAISE EXCEPTION 'correct_image_provenance: image_vehicle_match_status % not allowed', p_value;
    END IF;
    WITH t AS (
      SELECT id, image_vehicle_match_status AS o FROM vehicle_images
      WHERE id = ANY(p_image_ids) AND image_vehicle_match_status IS DISTINCT FROM p_value)
    UPDATE vehicle_images vi SET
      image_vehicle_match_status = p_value,
      ai_scan_metadata = COALESCE(vi.ai_scan_metadata, '{}'::jsonb) || jsonb_build_object('provenance_corrections',
        COALESCE(vi.ai_scan_metadata -> 'provenance_corrections', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'field', 'image_vehicle_match_status', 'original', t.o, 'corrected', p_value, 'source', p_source,
          'asserted_by', p_asserted_by, 'asserted_at', now())))
    FROM t WHERE vi.id = t.id;
    GET DIAGNOSTICS v_corrected = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'field', p_field, 'value', p_value, 'images_corrected', v_corrected,
      'source', p_source, 'asserted_by', p_asserted_by);
  END IF;

  FOR v_img IN
    SELECT id, image_identity_id, taken_at, ai_scan_metadata
    FROM vehicle_images WHERE id = ANY(p_image_ids)
  LOOP
    v_audit := jsonb_build_object(
      'field','taken_at', 'original', v_img.taken_at::text, 'corrected', p_value,
      'source', p_source, 'asserted_by', p_asserted_by, 'asserted_at', now(),
      'kind', p_kind, 'maker', p_maker_name);

    UPDATE vehicle_images SET
      taken_at = p_value::timestamptz,
      ai_scan_metadata = COALESCE(ai_scan_metadata,'{}'::jsonb) || jsonb_build_object(
        'provenance_corrections',
          COALESCE(ai_scan_metadata->'provenance_corrections','[]'::jsonb) || jsonb_build_array(v_audit),
        'kind', COALESCE(p_kind, ai_scan_metadata->>'kind'))
    WHERE id = v_img.id;
    v_corrected := v_corrected + 1;

    IF v_img.image_identity_id IS NOT NULL THEN
      UPDATE image_identities SET
        taken_at = p_value::timestamptz,
        photographer_name = COALESCE(p_maker_name, photographer_name),
        credit_line = COALESCE(
          CASE WHEN p_maker_name IS NOT NULL THEN COALESCE(p_kind,'work')||' by '||p_maker_name END,
          credit_line),
        updated_at = now()
      WHERE id = v_img.image_identity_id;

      IF p_maker_name IS NOT NULL THEN
        INSERT INTO nuke_production_credits (image_identity_id, person_name, role, source, confidence, owner_id)
        SELECT v_img.image_identity_id, p_maker_name, COALESCE(p_maker_role,'creator'),
               COALESCE(p_source->>'ref','correct_image_provenance'), 1.0,
               '0b9f107a-d124-49de-9ded-94698f63c1c4'
        WHERE NOT EXISTS (SELECT 1 FROM nuke_production_credits c
          WHERE c.image_identity_id = v_img.image_identity_id
            AND c.person_name = p_maker_name AND c.role = COALESCE(p_maker_role,'creator'));
        v_credits := v_credits + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'field', p_field, 'value', p_value,
    'images_corrected', v_corrected, 'credits_written', v_credits,
    'source', p_source, 'asserted_by', p_asserted_by);
END;
$function$;
