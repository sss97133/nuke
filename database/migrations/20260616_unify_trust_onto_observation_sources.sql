-- ============================================================
-- SUBTRACTIVE UNIFY — ONE TRUST REGISTRY (observation_sources)
--
-- Doctrine: docs/library/intellectual/contemplations/habitus-and-the-exchange.md
-- Strategy: "subtractive first" + "literal unify" (Skylar, 2026-06-16).
--
-- Retires the field-provenance trust island. The field-provenance engine
-- (vehicle_field_provenance + field_evidence + view vehicle_field_source_map)
-- resolved trust from data_source_trust_hierarchy (source_type -> trust_level),
-- but that table's vocabulary (auction_result_bat, nhtsa_vin_decode...) barely
-- matches what field_evidence actually stores (~95% publisher slugs like
-- bat_listing, mecum_listing) -- so the join produced ~all NULL today.
--
-- This repoints trust onto the canonical registry observation_sources via the
-- normalization  {slug}_listing -> slug  (strip _listing, '_' -> '-').
-- Trust for FIELD BELIEF = VERACITY (believability), not consecration
-- (consecration is for worth-ranking in valuation, a different question).
-- Coverage rises from ~0% to ~88% of field_evidence rows.
--
-- Retire surface verified: 1 view + 1 function reference the dropped table.
-- Also drops two confirmed-dead, zero-reference curated shells whose content
-- is superseded by observation_sources:
--   curated_sources       (10 premier auction houses -- all present as auction slugs w/ consecration 0.90)
--   data_source_registry  (8 truck-domain parts/forum sources -- parts catalog, not trust)
-- ============================================================

-- 1. Rebuild the view to read observation_sources (de-conflated: exposes both axes) ----
CREATE OR REPLACE VIEW vehicle_field_source_map AS
SELECT v.id AS vehicle_id,
    (((v.year || ' '::text) || v.make) || ' '::text) || v.model AS vehicle_identity,
    vfp.field_name,
    vfp.current_value,
    vfp.total_confidence,
        CASE
            WHEN vfp.total_confidence >= 90 THEN 'HIGH'::text
            WHEN vfp.total_confidence >= 70 THEN 'MEDIUM'::text
            WHEN vfp.total_confidence >= 50 THEN 'LOW'::text
            ELSE 'VERY_LOW'::text
        END AS confidence_rating,
    vfp.primary_source,
    COALESCE(round(os.veracity * 100)::int, 50) AS primary_trust_level,
    COALESCE(os.display_name || ' (' || os.category || ')', 'unmapped source'::text) AS source_description,
    vfp.supporting_sources,
    vfp.factory_original_value,
        CASE
            WHEN vfp.modified_value IS NOT NULL THEN 'MODIFIED'::text
            WHEN vfp.factory_original_value IS NOT NULL AND vfp.current_value = vfp.factory_original_value THEN 'FACTORY_ORIGINAL'::text
            WHEN vfp.factory_original_value IS NULL THEN 'NO_VIN_DATA'::text
            ELSE 'UNKNOWN'::text
        END AS modification_status,
    vfp.modification_date,
    ( SELECT jsonb_agg(jsonb_build_object('source', field_evidence.source_type, 'value', field_evidence.proposed_value, 'confidence', field_evidence.source_confidence, 'status', field_evidence.status, 'context', "substring"(field_evidence.extraction_context, 1, 100)) ORDER BY field_evidence.source_confidence DESC) AS jsonb_agg
           FROM field_evidence
          WHERE field_evidence.vehicle_id = vfp.vehicle_id AND field_evidence.field_name = vfp.field_name) AS evidence_trail,
    vfp.last_verified_at,
    vfp.last_verified_by,
    -- NEW: the de-conflated axes, now available because trust comes from observation_sources
    round(os.veracity * 100)::int     AS primary_veracity,
    round(os.consecration * 100)::int AS primary_consecration
   FROM vehicle_field_provenance vfp
     JOIN vehicles v ON vfp.vehicle_id = v.id
     LEFT JOIN observation_sources os
       ON os.slug = replace(regexp_replace(lower(vfp.primary_source), '_listing$', ''), '_', '-');

-- 2. Repoint the forensic assignment function's trust lookup -> observation_sources.veracity ----
CREATE OR REPLACE FUNCTION public.assign_field_forensically(p_vehicle_id uuid, p_field_name text, p_value text, p_context text DEFAULT NULL::text, p_source text DEFAULT 'user_input_unverified'::text, p_existing_vehicle_data jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_vehicle_data JSONB;
  v_trust_level INTEGER;
  v_normalized_value TEXT;
  v_confidence INTEGER;
  v_reasoning TEXT;
  v_evidence_id UUID;
BEGIN
  IF p_existing_vehicle_data IS NULL THEN
    SELECT to_jsonb(v.*) INTO v_vehicle_data FROM public.vehicles v WHERE id = p_vehicle_id;
  ELSE
    v_vehicle_data := p_existing_vehicle_data;
  END IF;

  -- Trust = VERACITY from the canonical registry (was data_source_trust_hierarchy.trust_level).
  SELECT round(veracity * 100)::int INTO v_trust_level
  FROM public.observation_sources
  WHERE slug = replace(regexp_replace(lower(p_source), '_listing$', ''), '_', '-');

  IF v_trust_level IS NULL THEN
    v_trust_level := 50;
  END IF;

  SELECT canonical_value INTO v_normalized_value
  FROM public.normalization_rules
  WHERE field_type = p_field_name
    AND LOWER(p_value) = ANY(SELECT LOWER(v) FROM unnest(variants) v)
  LIMIT 1;

  IF v_normalized_value IS NULL THEN
    v_normalized_value := p_value;
  END IF;

  v_confidence := v_trust_level;
  v_reasoning := 'Source: ' || p_source || ' (trust: ' || v_trust_level || ')';

  IF p_context IS NOT NULL THEN
    CASE p_field_name
      WHEN 'drivetrain' THEN
        IF p_context ~* '4x4|4×4|four wheel|4wd|k-series|k10|k20|k1500' THEN
          v_confidence := LEAST(100, v_confidence + 10);
          v_reasoning := v_reasoning || '; Context: drivetrain keywords found';
        END IF;
      WHEN 'engine_displacement_cid' THEN
        IF p_context ~* 'engine|motor|displacement|V8|V6' THEN
          v_confidence := LEAST(100, v_confidence + 10);
          v_reasoning := v_reasoning || '; Context: engine keywords found';
        END IF;
      WHEN 'horsepower' THEN
        IF p_context ~* 'HP|horsepower|power|bhp' THEN
          v_confidence := LEAST(100, v_confidence + 10);
          v_reasoning := v_reasoning || '; Context: power keywords found';
        END IF;
      ELSE
        NULL;
    END CASE;
  END IF;

  IF p_value ~ '^L[A-Z0-9]{2,3}$' THEN
    v_confidence := LEAST(100, v_confidence + 15);
    v_reasoning := v_reasoning || '; Format: GM RPO code pattern (Lxx)';
  END IF;

  IF p_value ~ '^M[0-9]{2}$' THEN
    v_confidence := LEAST(100, v_confidence + 15);
    v_reasoning := v_reasoning || '; Format: Transmission RPO pattern (Mxx)';
  END IF;

  IF p_field_name = 'drivetrain' AND v_normalized_value = '4WD' THEN
    IF (v_vehicle_data->>'model') ~ '^K[0-9]' OR (v_vehicle_data->>'series') ~ '^K[0-9]' THEN
      v_confidence := LEAST(100, v_confidence + 20);
      v_reasoning := v_reasoning || '; Cross-ref: K-series confirms 4WD';
    ELSIF (v_vehicle_data->>'model') ~ '^C[0-9]' OR (v_vehicle_data->>'series') ~ '^C[0-9]' THEN
      v_confidence := GREATEST(0, v_confidence - 30);
      v_reasoning := v_reasoning || '; Cross-ref: C-series contradicts 4WD (possible conversion)';
    END IF;
  END IF;

  INSERT INTO public.field_evidence (
    vehicle_id, field_name, proposed_value, source_type, source_confidence,
    extraction_context, supporting_signals, status
  ) VALUES (
    p_vehicle_id, p_field_name, v_normalized_value, p_source, v_confidence, p_context,
    jsonb_build_object(
      'normalized', v_normalized_value != p_value,
      'context_clues', p_context IS NOT NULL,
      'format_pattern', p_value ~ '^[LM][A-Z0-9]{2,3}$'
    ),
    'pending'
  )
  ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO UPDATE
    SET source_confidence = GREATEST(public.field_evidence.source_confidence, EXCLUDED.source_confidence),
        extraction_context = COALESCE(public.field_evidence.extraction_context, EXCLUDED.extraction_context)
  RETURNING id INTO v_evidence_id;

  RETURN jsonb_build_object(
    'evidence_id', v_evidence_id,
    'field', p_field_name,
    'value', v_normalized_value,
    'confidence', v_confidence,
    'reasoning', v_reasoning,
    'source', p_source,
    'normalized', v_normalized_value != p_value
  );
END;
$function$;

-- 3. Retire the island + the two dead curated shells -----------------------
DROP TABLE IF EXISTS data_source_trust_hierarchy;
DROP TABLE IF EXISTS curated_sources;
DROP TABLE IF EXISTS data_source_registry;
