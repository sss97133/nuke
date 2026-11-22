-- Garage covers v4: the best whole-car photo of the car, by a rule in the database (owner, 2026-11-21, walking the
-- garage: "not showing best lead images", "bad lead image", "represented poorly with bad lead image"; covers he saw
-- included a loose door panel, a view out through a windshield and a car masked for paint).
--
-- Why v3 picked those: it ranked by the zone and angle labels alone and then by is_primary. Neither label says the
-- frame shows the whole car (a door panel leaning on steps is zone panel_door_fl with is_primary set by
-- recompute_vehicle_primary_image), and the zone placed a rear three-quarter at the front corner.
--
-- The rule, garage_cover_class(zone, angle, category, reading): a frame is a whole-car exterior when at least one
-- reading says so (the photo reading's scene body_exterior / road_test / off_property at 2.5 m or more; an exterior
-- vehicle_zone; an exterior angle label) and no reading places it elsewhere (another scene, under 2 m, a close-up, an
-- inside / mechanical / detail / panel / underside zone, a detail or interior angle, a non-body category). Those
-- frames rank, lower first, by: finished and assembled (0), unread or as found (1), mid-build or masked (2); plus
-- staged on a trailer, lift or stands (3) or in a shop or booth (1); plus a person or dog in frame (1); then the
-- view (front three-quarter, then side or head-on, then rear), taken from the reading's own words before the zone and
-- the label (the reading's azimuth disagrees with its words on about one exterior frame in five, measured 2026-11-21
-- on the owner's garage: 114 of 515 frames it calls front sit at a rear azimuth); then how many readings agree.
-- A frame no reading places as a whole car gets no class, and a car with no classed frame keeps v3's answer.
--
-- Only an approved frame (vision_gate_status) is classed. Admission is v3's plus two changes: a sensitive frame is
-- never a cover, and the owner's own cloud import (dropbox_import) is admitted only as a whole-car frame.
--
-- Measured 2026-11-21 against live rows (the SELECT form of this function, run read-only as postgres): of the 138
-- cars in the owner's garage (vehicle_class_price), 124 had a v3 cover; under v4 125 have one, 114 of them a
-- whole-car frame; 41 covers change, 40 of them to a whole-car frame and one (a car whose v3 cover is a title
-- document marked sensitive) to no cover. Cars with no classed frame keep the v3 cover exactly.
-- Display preference only: it files no image and decides nothing about the vehicle. An owner's cover correction
-- (get_my_garage_owner_corrections) still overrides the reader on the web card. The iOS garage (get_user_garage)
-- reads vehicles.primary_image_url, which this migration does not change.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF encode(digest(pg_get_functiondef('public.get_first_image_batch(uuid[])'::regprocedure), 'sha256'), 'base64')
      <> 'zgShDGC8opqyp5GwYMDdLSl4aFY6NVGBSnKcF9t+IDg=' THEN
    RAISE EXCEPTION 'get_first_image_batch changed since the reviewed live definition';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.garage_cover_class(p_zone text, p_angle text, p_category text, p_reading jsonb)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
SELECT (
  SELECT CASE
           WHEN r.neg OR NOT (r.byok_pos OR r.zone_pos OR r.ang_pos) THEN NULL
           ELSE (r.finish + r.staging + r.clutter + r.view_rank) * 100 + r.view_rank * 10
                + (3 - (r.byok_pos::int + r.zone_pos::int + r.ang_pos::int))
         END
  FROM (
    SELECT
      coalesce(d.st IN ('body_exterior', 'road_test', 'off_property') AND d.dist >= 2.5, false) AS byok_pos,
      coalesce(i.z IN ('ext_front_driver', 'ext_front_passenger', 'ext_front_3q', 'ext_front', 'ext_driver_side',
                       'ext_passenger_side', 'ext_rear_driver', 'ext_rear_passenger', 'ext_rear'), false) AS zone_pos,
      coalesce(i.ang IN ('exterior_three_quarter', 'exterior_front', 'exterior_side', 'exterior_rear', 'exterior',
                         'front_three_quarter', 'front_3quarter', 'front_3quarter_driver', 'front_3quarter_passenger',
                         'side', 'side_profile', 'front', 'rear', 'driver_side', 'passenger_side'), false) AS ang_pos,
      -- any reader that places the frame elsewhere (a part, a close-up, inside, underneath, paper) vetoes it
      coalesce(d.st NOT IN ('body_exterior', 'road_test', 'off_property', 'shop_context', 'paint_booth'), false)
        OR coalesce(d.dist < 2, false)
        OR coalesce(d.tx ~ '(macro|close[- ]?up|closeup|close on )', false)
        OR coalesce(i.z !~ '^ext_' OR i.z = 'ext_undercarriage', false)
        OR coalesce(i.ang NOT IN ('exterior_three_quarter', 'exterior_front', 'exterior_side', 'exterior_rear', 'exterior',
                         'front_three_quarter', 'front_3quarter', 'front_3quarter_driver', 'front_3quarter_passenger',
                         'side', 'side_profile', 'front', 'rear', 'driver_side', 'passenger_side'), false)
        OR coalesce(i.cat !~ '^exterior_body', false) AS neg,
      -- finished and assembled first; then whole but not finished (as found, in primer, unread); then apart or masked
      CASE WHEN d.complete = 'assembled' AND d.phase IN ('show_finish', 'drivable', 'final_assembly') THEN 0
           WHEN d.complete IN ('partial', 'stripped') OR d.phase IN ('teardown', 'paint_application')
             OR d.st = 'paint_booth' THEN 2
           ELSE 1 END AS finish,
      -- the view: the reading's own words first (its azimuth disagrees with its words on about one frame in five),
      -- then the zone, then the angle label
      CASE WHEN d.tx ~ 'front' AND d.tx !~ 'rear' AND d.tx ~ '(3/4|three[- ]quarter|quarter|angle|corner)' THEN 0
           WHEN d.tx ~ 'rear' AND d.tx !~ 'front' THEN 2
           WHEN d.tx ~ '(front|profile|side)' THEN 1
           WHEN i.z IN ('ext_front_driver', 'ext_front_passenger', 'ext_front_3q')
             OR i.ang IN ('front_three_quarter', 'front_3quarter', 'front_3quarter_driver', 'front_3quarter_passenger') THEN 0
           WHEN i.z IN ('ext_driver_side', 'ext_passenger_side', 'ext_front')
             OR (i.z IS NULL AND i.ang IN ('exterior_three_quarter', 'exterior_side', 'exterior_front', 'side', 'side_profile', 'front')) THEN 1
           ELSE 2 END AS view_rank,
      -- how the car is presented: on a trailer, a lift or stands (3) or in a shop or booth (1); hood, trunk or a door
      -- open (1); far off, over 12 m (2); in the dark (1); closed up on open ground in daylight reads best (0)
      CASE WHEN d.tx ~ '(trailer|flatbed|car hauler|\mon (a|the) ([a-z0-9-]+ )?lift\M|lift arms|hoist|raised on|rotisserie|jack ?stands|dolly|dollies)' THEN 3
           WHEN d.st IN ('shop_context', 'paint_booth') THEN 1 ELSE 0 END
        + CASE WHEN d.tx ~ '(hood|bonnet|trunk|decklid|tailgate|doors?) (and [a-z]+ )?(up|open|raised|off)' THEN 1 ELSE 0 END
        + CASE WHEN d.dist > 12 THEN 2 ELSE 0 END
        + CASE WHEN d.light = 'low' THEN 1 ELSE 0 END AS staging,
      CASE WHEN d.person OR d.dog THEN 1 ELSE 0 END AS clutter
    FROM (SELECT
            i.a->>'scene_type' AS st,
            CASE WHEN regexp_replace(coalesce(i.a->'camera_pose'->>'distance_est', ''), '[^0-9.]', '', 'g') ~ '^[0-9]+(\.[0-9]+)?$'
                 THEN regexp_replace(i.a->'camera_pose'->>'distance_est', '[^0-9.]', '', 'g')::numeric END AS dist,
            lower(coalesce(i.a->'camera_pose'->>'framing', '') || ' ' || coalesce(i.a->>'narrative_one_line', '')) AS tx,
            i.a->'state_observations'->>'completeness' AS complete,
            i.a->>'build_phase_guess' AS phase,
            i.a->'workshop_signals'->>'lighting' AS light,
            coalesce(i.a->'presence'->>'person' = 'true', false) AS person,
            coalesce(i.a->'presence'->>'dog' = 'true', false) AS dog) d
  ) r
)
FROM (SELECT p_zone AS z, p_angle AS ang, p_category AS cat, p_reading AS a) i;
$function$;

COMMENT ON FUNCTION public.garage_cover_class(text, text, text, jsonb) IS
  'Garage cover rule: the class of one photo as a garage cover from the readings it already has (vehicle_zone, the angle label, image_category, ai_scan_metadata.byok_deep_analysis). NULL when no reading places the frame as a whole-car exterior or any reading places it elsewhere; otherwise lower is better: (finish 0-2 + staging 0-7 + person or dog 0-1 + view 0-2) x 100 + view (front three-quarter 0, side or head-on 1, rear 2) x 10 + readings not agreeing (0-2). Read by get_first_image_batch v4. Display preference only.';
REVOKE ALL ON FUNCTION public.garage_cover_class(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.garage_cover_class(text, text, text, jsonb) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_first_image_batch(vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, image_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT wanted.vehicle_id, cover.image_url
  FROM (SELECT DISTINCT unnest(vehicle_ids) AS vehicle_id) wanted
  CROSS JOIN LATERAL (
    SELECT admitted.image_url
    FROM (
    SELECT vi.id
    FROM public.vehicle_images_public vi
    -- The whole-car class (garage_cover_class), read only for an approved frame no cheap reading already places
    -- elsewhere, so the reading itself is opened for the few frames that can be a whole-car cover.
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN vi.vision_gate_status::text = 'approved'
          AND coalesce(vi.vehicle_zone ~ '^ext_' AND vi.vehicle_zone <> 'ext_undercarriage', true)
          AND coalesce(coalesce(vi.ai_detected_angle, vi.angle) IN ('exterior_three_quarter', 'exterior_front',
                'exterior_side', 'exterior_rear', 'exterior', 'front_three_quarter', 'front_3quarter',
                'front_3quarter_driver', 'front_3quarter_passenger', 'side', 'side_profile', 'front', 'rear',
                'driver_side', 'passenger_side'), true)
          AND coalesce(vi.image_category ~ '^exterior_body', true)
        THEN public.garage_cover_class(vi.vehicle_zone, coalesce(vi.ai_detected_angle, vi.angle), vi.image_category,
               vi.ai_scan_metadata->'byok_deep_analysis')
      END AS whole_car
    ) c
    WHERE vi.vehicle_id = wanted.vehicle_id
      AND vi.image_url IS NOT NULL
      AND vi.is_document IS NOT TRUE
      AND vi.is_duplicate IS NOT TRUE
      AND vi.is_superseded IS NOT TRUE
      AND vi.is_video IS NOT TRUE
      -- Preserve the existing cover source policy. Native capture relay is
      -- also a supported supplied-photo path; publication eligibility still
      -- applies below and source labels never establish ownership.
      AND coalesce(vi.source, '') NOT IN ('ssd_blast', 'drop-folder', 'hd_archive')
      AND vi.is_sensitive IS NOT TRUE
      AND (vi.is_primary = true OR vi.source IN
        ('iphoto', 'user_upload', 'manual', 'tech_capture', 'photo_auto_sync', 'capture_relay_ios')
        -- the owner's own cloud import is admitted only as a whole-car frame
        OR (vi.source = 'dropbox_import' AND c.whole_car IS NOT NULL))
      AND coalesce(vi.image_vehicle_match_status, '') NOT IN ('mismatch', 'unrelated')
      AND lower(coalesce(vi.image_medium, '')) NOT IN
        ('rendering', 'illustration', 'drawing', 'screenshot', 'document', 'logo')
      AND lower(coalesce(vi.image_category, '')) NOT IN
        ('documentation', 'document', 'receipt', 'screenshot', 'brochure', 'illustration', 'rendering', 'logo')
    ORDER BY
      -- v4: the best whole-car exterior first (lower class is better); a car with none keeps the v3 order below.
      c.whole_car NULLS LAST,
      -- The lead angle first, so every card that has one opens on the same view: the front three-quarter from
      -- the driver's side, then from the other front corner, then a three-quarter view no reading placed at the
      -- rear. A view reading or a zone reading is display evidence only; it decides no fact about the car.
      CASE
        WHEN vi.image_category IN ('interior', 'engine_mechanical', 'undercarriage', 'exterior_detail')
          OR coalesce(vi.ai_detected_angle, '') LIKE 'interior_%' THEN 9
        WHEN vi.vehicle_zone = 'ext_front_driver'
          AND coalesce(vi.ai_detected_angle, vi.angle, 'exterior_three_quarter') IN
            ('exterior_three_quarter', 'front_three_quarter', 'front_3quarter', 'front_3quarter_driver') THEN 0
        WHEN vi.vehicle_zone IN ('ext_front_passenger', 'ext_front_3q')
          AND coalesce(vi.ai_detected_angle, vi.angle, 'exterior_three_quarter') IN
            ('exterior_three_quarter', 'front_three_quarter', 'front_3quarter', 'front_3quarter_passenger') THEN 1
        WHEN coalesce(vi.ai_detected_angle, vi.angle) IN
            ('exterior_three_quarter', 'front_three_quarter', 'front_3quarter', 'front_3quarter_driver', 'front_3quarter_passenger')
          AND coalesce(vi.vehicle_zone, '') NOT LIKE 'ext_rear%' THEN 2
        ELSE 9
      END,
      -- Without a lead angle, the owner's chosen primary; then the v2 cover order.
      vi.is_primary DESC NULLS LAST,
      CASE
        WHEN vi.image_category IN ('interior', 'engine_mechanical', 'undercarriage', 'exterior_detail')
          OR coalesce(vi.ai_detected_angle, '') LIKE 'interior_%' THEN 3
        WHEN vi.ai_detected_angle IN
          ('exterior_three_quarter', 'front_three_quarter', 'rear_three_quarter',
           'exterior_front', 'front', 'exterior_side', 'side_profile', 'exterior_rear', 'rear') THEN 0
        WHEN vi.image_category = 'exterior_body' THEN 1
        ELSE 2
      END,
      vi.is_primary DESC NULLS LAST,
      vi.photo_quality_score DESC NULLS LAST,
      vi.taken_at DESC NULLS LAST,
      vi.created_at DESC NULLS LAST,
      vi.id
    -- Rank first, then test admission in order until one cover qualifies.
    -- OFFSET prevents the gate from being pushed ahead of this ordering.
    OFFSET 0
    ) ranked
    CROSS JOIN LATERAL (
      SELECT vi.image_url
      FROM public.vehicle_images_public vi
      WHERE vi.id = ranked.id AND vi.vehicle_id = wanted.vehicle_id
        AND vi.vehicle_image_gallery_eligible = true
      OFFSET 0
    ) admitted
    LIMIT 1
  ) cover
  ORDER BY wanted.vehicle_id;
$function$;

COMMENT ON FUNCTION public.get_first_image_batch(uuid[]) IS
  'Garage cover display v4: the best whole-car exterior first by garage_cover_class (approved frames only), then the v3 order (front three-quarter lead angle, primary, photographic exterior views, exterior bodies, unknown views, detail/interior fallback; quality, source clocks and stable ID break ties). Admission is v3''s, never a sensitive frame, plus the owner''s dropbox_import only as a whole-car frame. Existing viewer RLS and gallery eligibility apply; no image or ownership testimony is changed.';

COMMIT;
