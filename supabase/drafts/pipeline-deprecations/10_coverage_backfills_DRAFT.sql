-- DRAFT. NOT APPLIED. Free coverage backfills: project answers that are already stored in
-- vehicle_images.ai_scan_metadata into the columns and tables meant to hold them. No model call, no new
-- reader, no new vocabulary (AGENTS.md "Reading photos"). Each block counts first. The write is commented
-- out and must run in id-range batches (66M-row table; a03 photo-land triggers fire on ai_scan_metadata only,
-- and these writes do not touch ai_scan_metadata).
-- Estimates: 0.5% TABLESAMPLE on 2026-11-23, scaled x200.1.

-- G1. image_type -> image_category (~9.06M). The classifier's routing label; category is left alone because
--     idx_vehicle_images_category and galleries depend on its current values.
select count(*) from public.vehicle_images tablesample system (0.5)
where image_category is null and ai_scan_metadata->'classification'->>'image_type' is not null
  and coalesce((ai_scan_metadata->'classification'->>'classifier_ok')::boolean, true);
-- update public.vehicle_images set image_category = ai_scan_metadata->'classification'->>'image_type'
-- where id between $lo and $hi and image_category is null
--   and ai_scan_metadata->'classification'->>'image_type' is not null
--   and coalesce((ai_scan_metadata->'classification'->>'classifier_ok')::boolean, true);
-- No CHECK constraint on image_category (verified 2026-11-23). Its 7 existing values (e.g. exterior_body) are a
-- different vocabulary: agree a mapping with the photo-keys owner before running, or key it through observation_properties.

-- G6. receipt_document but not is_document (~7.2k): galleries filter on is_document, so these leak today.
--     Same rule persistV98Columns uses: confidence >= 0.85.
select count(*) from public.vehicle_images tablesample system (0.5)
where ai_scan_metadata->'classification'->>'image_type' = 'receipt_document' and is_document is not true
  and (ai_scan_metadata->'classification'->>'confidence')::numeric >= 0.85;
-- update public.vehicle_images set is_document = true
-- where id between $lo and $hi and is_document is not true
--   and ai_scan_metadata->'classification'->>'image_type' = 'receipt_document'
--   and (ai_scan_metadata->'classification'->>'confidence')::numeric >= 0.85;

-- G3. coarse angle from image_type (~465k): only where the type names the view unambiguously. ai_detected_angle
--     keeps the v98 vocabulary; confidence is capped at 0.5 so a later v98 read (>= 0.6) wins.
--     vehicle_interior -> interior_dashboard is NOT derivable (interior is broader), so it is left out.
-- update public.vehicle_images set ai_detected_angle = case ai_scan_metadata->'classification'->>'image_type'
--          when 'vehicle_exterior' then 'exterior' when 'engine_bay' then 'engine_bay' when 'undercarriage' then 'undercarriage' end,
--        ai_detected_angle_confidence = 0.5, angle_source = 'image_type_projection'
-- where id between $lo and $hi and ai_detected_angle is null and angle is null
--   and ai_scan_metadata->'classification'->>'image_type' in ('vehicle_exterior','engine_bay','undercarriage');

-- G4. vehicle_hints -> ai_detected_vehicle (~358k with make). These are uncited guesses (the legacy prompt allowed
--     shape inference that v98 forbids), so they land only in the guess column, never in vehicles or photo_extracted_fields.
-- update public.vehicle_images set ai_detected_vehicle = jsonb_build_object('hints', ai_scan_metadata->'classification'->'vehicle_hints',
--        'source', 'legacy_classifier_vehicle_hints', 'cited', false)
-- where id between $lo and $hi and ai_detected_vehicle is null
--   and nullif(ai_scan_metadata->'classification'->'vehicle_hints'->>'make', '') is not null;

-- G7. vin_detected -> vehicle_vin (~2.4k): needs the same admission as the orchestrator (qualifyVinRead: checksum for
--     modern VINs, rule table for pre-1981). Do it from the edge function (re-use qualifyVinRead), not in SQL.

-- G2 (description -> image_descriptions, ~9.07M) and G5 (detected_text -> photo_text_lines, ~327k) write to existing
--     tables whose writers carry provenance columns. Route them through those writers' functions; do not insert raw.

-- G8/G9/G10 deep read (~20k / ~16.8k / ~4.4k): call the existing projector after each reviewed projection:
-- select public.promote_image_depth_to_columns(p_vehicle_id => $vehicle, p_user_id => null);  -- nothing calls it today.
