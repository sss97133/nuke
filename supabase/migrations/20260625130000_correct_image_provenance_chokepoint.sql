-- correct_image_provenance: the ONE sanctioned path to correct an image's
-- provenance from a SOURCE DOCUMENT.
--
-- WHY (the convergence problem): there is no function for "this date is wrong,
-- here's the real one, cited to a document." So every agent that hits a bad
-- date writes its own UPDATE -- a new fork each time (same disease as the
-- ai_scan_metadata fork and the parallel estimates). Agents converge on exactly
-- one thing: a function they can find and call. This is that function.
--
-- It is supersession-safe (preserves the original -- nothing lost, per the trust
-- invariant), citation-required (refuses a correction with no source), and it
-- attributes the maker as service provenance (a production credit on the identity).
-- The corrected value is the projection the timeline reads; the original + the
-- source live in ai_scan_metadata.provenance_corrections, recoverable forever.
--
-- This is the data/identity/provenance layer -- NOT the image-analysis pipeline.
-- First caller: the Andrew Gomes Blazer renders (fabricated 2016 -> real 2024-12-17).

CREATE OR REPLACE FUNCTION public.correct_image_provenance(
  p_image_ids   uuid[],
  p_field       text,                 -- supported: 'taken_at'
  p_value       text,                 -- corrected value (cast per field)
  p_source      jsonb,                -- REQUIRED: the citing document {type,ref,...}
  p_asserted_by text DEFAULT 'agent',
  p_kind        text DEFAULT NULL,    -- optional reclassification, e.g. 'render'
  p_maker_name  text DEFAULT NULL,    -- optional maker (service provenance)
  p_maker_role  text DEFAULT NULL     -- optional maker role, e.g. 'digital_painter'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_img        record;
  v_audit      jsonb;
  v_corrected  int := 0;
  v_credits    int := 0;
BEGIN
  IF p_field <> 'taken_at' THEN
    RAISE EXCEPTION 'correct_image_provenance: unsupported field % (supported: taken_at)', p_field;
  END IF;
  IF p_source IS NULL OR p_source = '{}'::jsonb THEN
    RAISE EXCEPTION 'correct_image_provenance: a source document (p_source) is required -- corrections must be cited, never guessed';
  END IF;

  FOR v_img IN
    SELECT id, image_identity_id, taken_at, ai_scan_metadata
    FROM vehicle_images WHERE id = ANY(p_image_ids)
  LOOP
    -- 1. preserve the original + the citation (supersession; recoverable forever)
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

    -- 2. carry the correction to the content identity + attribute the maker
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
$fn$;

GRANT EXECUTE ON FUNCTION public.correct_image_provenance(uuid[],text,text,jsonb,text,text,text,text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.correct_image_provenance(uuid[],text,text,jsonb,text,text,text,text) IS
  'Sanctioned image-provenance correction chokepoint. Supersedes a field (taken_at) from a REQUIRED source document: preserves the original in ai_scan_metadata.provenance_corrections (nothing lost), updates the projection the timeline reads, carries the date to the content identity, and attributes the maker as a nuke_production_credits service credit. Every agent and the app correct dates through THIS, never a raw UPDATE -- so corrections converge instead of forking. Refuses an uncited correction.';
