-- vehicle_image_findings: the Image analysis card's read, in one pass over a vehicle's frames.
--
-- Measured 2026-10-14. VehicleFindingsCard (a section of every vehicle profile) read a vehicle's frames with 26 arrow
-- projections of ai_scan_metadata (classifier, vin, engine, scene_class, byok_deep_analysis->scene_type, ...) and
-- aggregated them in the browser. pg_stat_statements since 2026-09-29, anon: 1,309 calls (1,199 + 110), means 893 and
-- 1,081 ms, max 8.8 s, 1,190 s of database time; edge logs 24 h: 264 calls, mean 1.3 s, 149 over 1 s. EXPLAIN as anon on
-- the K5 (3,716 frames): 534-624 ms and 239,000 buffer hits.
--
-- Cause: every `ai_scan_metadata->'x'` is a separate function call on a TOASTed jsonb datum, and a function call
-- detoasts its argument afresh. 26 projections detoast each frame's blob 26 times (the K5's blobs average 2 KB on disk,
-- up to 6 KB, 3,716 of 3,716 frames carry one). jsonb_to_record() detoasts it once and reads all the keys in one pass:
-- the same K5 read costs 99-141 ms and 56,000 buffer hits, row policy included.
--
-- A blob that is not a JSON object (jsonb_to_record would refuse it and fail the whole read) counts in total and
-- reports nothing, as it contributed nothing before.
--
-- What it returns: {"total": <frames the caller can read, capped at 5,000 as the browser's read was>, "rows": [...]}.
-- Each row is the object PostgREST used to deliver for that frame (same keys, same JSON values, byok_scene_type /
-- byok_build_phase_guess / byok_confidence flat), minus the keys that were null; a frame with nothing to report is not
-- sent, and total keeps counting it. The card's own aggregation is unchanged (it reads total and rows).
--
-- SECURITY INVOKER: the frames are read under the caller's row policies on vehicle_images, so a stranger's total and
-- rows are the frames a stranger may read (not sensitive, not superseded, not rejected or held by the vision gate),
-- an owner's are all of theirs. Nothing is written. Contract: supabase/sql/test_vehicle_image_findings.sql
-- (CI job vehicle-image-findings-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.vehicle_image_findings(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH frames AS (
    SELECT j.*, vi.vision_analyzed_at
      FROM public.vehicle_images vi
      LEFT JOIN LATERAL jsonb_to_record(CASE WHEN jsonb_typeof(vi.ai_scan_metadata) = 'object' THEN vi.ai_scan_metadata END) AS j(
             classifier jsonb, error jsonb, vin jsonb, license_plate jsonb, engine jsonb, engine_guess jsonb, engine_badge jsonb,
             transmission jsonb, color_visible jsonb, interior_trim jsonb, odometer jsonb, mileage_at_listing jsonb, source jsonb,
             part_number jsonb, critical jsonb, privacy_concern jsonb, attribution_concern jsonb, phase jsonb, scene_class jsonb,
             make_guess jsonb, model_guess jsonb, year_guess jsonb, confidence jsonb, byok_deep_analysis jsonb) ON true
     WHERE vi.vehicle_id = p_vehicle_id
     LIMIT 5000
  ),
  reported AS (
    SELECT o.row
      FROM frames f
      CROSS JOIN LATERAL (
        SELECT coalesce(jsonb_object_agg(t.k, t.v), '{}'::jsonb) AS row
          FROM (VALUES
                 ('classifier', f.classifier), ('error', f.error), ('vin', f.vin), ('license_plate', f.license_plate),
                 ('engine', f.engine), ('engine_guess', f.engine_guess), ('engine_badge', f.engine_badge),
                 ('transmission', f.transmission), ('color_visible', f.color_visible), ('interior_trim', f.interior_trim),
                 ('odometer', f.odometer), ('mileage_at_listing', f.mileage_at_listing), ('source', f.source),
                 ('part_number', f.part_number), ('critical', f.critical), ('privacy_concern', f.privacy_concern),
                 ('attribution_concern', f.attribution_concern), ('phase', f.phase), ('scene_class', f.scene_class),
                 ('make_guess', f.make_guess), ('model_guess', f.model_guess), ('year_guess', f.year_guess),
                 ('confidence', f.confidence),
                 ('byok_scene_type', f.byok_deep_analysis -> 'scene_type'),
                 ('byok_build_phase_guess', f.byok_deep_analysis -> 'build_phase_guess'),
                 ('byok_confidence', f.byok_deep_analysis -> 'confidence'),
                 ('vision_analyzed_at', to_jsonb(f.vision_analyzed_at))
               ) AS t(k, v)
         WHERE t.v IS NOT NULL AND t.v <> 'null'::jsonb
      ) o
     WHERE o.row <> '{}'::jsonb
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM frames),
           'rows', coalesce((SELECT jsonb_agg(row) FROM reported), '[]'::jsonb));
$function$;

REVOKE ALL ON FUNCTION public.vehicle_image_findings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_findings(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_image_findings(uuid) IS
  'The Image analysis card''s read: {total, rows} for the frames of one vehicle that the caller may read (SECURITY INVOKER, so the vehicle_images row policies apply), at most 5,000. rows holds, per frame with anything to report, the non-null scalar keys of ai_scan_metadata the card aggregates plus vision_analyzed_at; total counts every frame read. One jsonb_to_record pass per frame instead of 26 arrow projections, each of which detoasts the blob again.';

DO $verify$
BEGIN
  IF NOT has_function_privilege('anon', 'public.vehicle_image_findings(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.vehicle_image_findings(uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'public.vehicle_image_findings(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'vehicle_image_findings grants are not anon, authenticated and service_role only';
  END IF;
END
$verify$;

COMMIT;

-- Live verification (after apply), as anon:
--   POST /rest/v1/rpc/vehicle_image_findings {"p_vehicle_id":"e08bf694-970f-4cbe-8a74-8715158a0f2e"}
--   -- {"total": <frames anon may read>, "rows": [...]} in about 0.1-0.3 s warm; the card shows the same sections as before.
