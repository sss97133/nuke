-- Revert of 20261125135000_gallery_plate_privacy_rule.sql: puts back both vehicle_image_gallery_eligible bodies as
-- production held them on 2026-11-24 (pg_get_functiondef, md5 4761d9c78c54d78f09dc3235f691124c for vehicle_images and
-- b41688a52b368750a330ba8980737e4a for vehicle_images_public), then drops vehicle_image_privacy_withheld and
-- image_privacy_rules. This re-serves custody photos with a keyed plate reading to every viewer. To stop one rule without
-- reverting, set its image_privacy_rules row enabled = false.
SET statement_timeout = '60s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    coalesce(($1).is_document,false)=false
    AND coalesce(($1).is_duplicate,false)=false
    AND coalesce(($1).is_superseded,false)=false
    AND nullif(btrim(($1).image_url),'') IS NOT NULL
    AND ($1).image_url NOT LIKE 'file://%'
    AND (($1).source IS NULL OR ($1).source <> 'e2e_test')
    AND coalesce(($1).image_vehicle_match_status,'') NOT IN ('mismatch','unrelated')
    AND CASE
      WHEN ($1).vision_gate_status IS NULL OR ($1).vision_gate_status::text='approved' THEN true
      WHEN ($1).vision_gate_status::text='pending' THEN
        coalesce(($1).is_sensitive,false)=false
        AND (
          (
            coalesce(($1).source='bat_import',false)
            AND ($1).is_external IS TRUE
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
            AND public.bat_pending_image_has_listing(($1).vehicle_id, ($1).exif_data)
          )
          OR (
            -- listing capture: a photo taken from a public web listing by an extractor, never an upload
            coalesce(($1).source='bat_import',false)=false
            AND ($1).is_external IS TRUE
            AND ($1).user_id IS NULL
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text,'') <> 'rejected'
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://'
          )
        )
      ELSE false
    END;
$function$
;

CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images_public)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    coalesce(($1).is_document,false)=false
    AND coalesce(($1).is_duplicate,false)=false
    AND coalesce(($1).is_superseded,false)=false
    AND nullif(btrim(($1).image_url),'') IS NOT NULL
    AND ($1).image_url NOT LIKE 'file://%'
    AND (($1).source IS NULL OR ($1).source <> 'e2e_test')
    AND coalesce(($1).image_vehicle_match_status,'') NOT IN ('mismatch','unrelated')
    AND CASE
      WHEN ($1).vision_gate_status IS NULL OR ($1).vision_gate_status::text='approved' THEN true
      WHEN ($1).vision_gate_status::text='pending' THEN
        coalesce(($1).is_sensitive,false)=false
        AND (
          (
            coalesce(($1).source='bat_import',false)
            AND ($1).is_external IS TRUE
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
            AND public.bat_pending_image_listing_by_id(($1).id)
          )
          OR (
            -- listing capture: a photo taken from a public web listing by an extractor, never an upload
            coalesce(($1).source='bat_import',false)=false
            AND ($1).is_external IS TRUE
            AND ($1).user_id IS NULL
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text,'') <> 'rejected'
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://'
          )
        )
      ELSE false
    END;
$function$
;

DO $$
DECLARE a text; b text;
BEGIN
  a := md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images)'::regprocedure));
  b := md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images_public)'::regprocedure));
  IF a <> '4761d9c78c54d78f09dc3235f691124c' OR b <> 'b41688a52b368750a330ba8980737e4a' THEN
    RAISE EXCEPTION 'revert: vehicle_image_gallery_eligible bodies are not the 2026-11-24 text (md5 % / %)', a, b;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.vehicle_image_privacy_withheld(uuid);
DROP TABLE IF EXISTS public.image_privacy_rules;

RESET statement_timeout;
RESET lock_timeout;
