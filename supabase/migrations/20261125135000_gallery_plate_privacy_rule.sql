-- Gallery privacy rule rows: a custody photo with a keyed license plate reading is withheld from a viewer who is
-- neither its uploader nor tied to its vehicle. Owner rule: profiles are public; privacy is line-item masking inside
-- (withhold the item, never the car, never from the person it belongs to).
--
-- Rows:
--   image_privacy_rules (field_name, applies_to) PK: one row per private field. Seeded with ('license_plate', 4,
--     'custody'). The next private field (VIN plate close-up, title, face) is a row, not a migration.
--   photo_extracted_fields (image_id, field_name, source) UNIQUE: the keyed reading the rule matches; a value matches
--     when it has >= min_alnum letters or digits.
--   vehicle_image_privacy_withheld(image_id): SECURITY DEFINER, because photo_extracted_fields is owner-read under RLS
--     and vehicle_images_public carries no exif_data (the custody test needs it). It probes photo_extracted_fields by
--     image_id first and reads vehicle_images only on a match. It never returns NULL.
--   vehicle_image_gallery_eligible, both overloads (vehicle_images, vehicle_images_public): gain one term,
--     AND NOT vehicle_image_privacy_withheld(($1).id). Both stay inlinable SQL.
--
-- Who sees a withheld photo: its uploader (vehicle_images.user_id = auth.uid()), a viewer vehicle_viewer_tied()
-- admits (owner, permission, contributor, org; service_role), and a session with no viewer at all: no request claims
-- and not PostgREST's authenticator (pg_cron, job triggers, stored folds such as vehicles.image_count). The rule
-- governs what a viewer is served, so a stored count does not change with which writer last touched the car.
--
-- Prediction (measured 2026-11-24 23:3x PT, before code): 109 anon-served images withheld on 22 cars, all custody
-- photos (user_upload 74, iphoto 31, capture_relay_ios 2, dropbox_import 2), 0 listing-sourced. 1ac8edba goes 1 -> 0
-- anon gallery photos; the car page stays.
--
-- Guards: both overload bodies must hash to the 2026-11-24 live text (or to this migration's text, so a replay is a
-- no-op), and hash to this migration's text afterwards. Revert: supabase/sql/revert_20261125135000_gallery_plate_privacy_rule.sql.
-- Test: supabase/sql/test_gallery_plate_privacy_rule.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
DECLARE a text; b text;
BEGIN
  a := md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images)'::regprocedure));
  b := md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images_public)'::regprocedure));
  IF a NOT IN ('4761d9c78c54d78f09dc3235f691124c', '3a1a1a21648e022997d38138b44ceaea') THEN
    RAISE EXCEPTION 'vehicle_image_gallery_eligible(vehicle_images) changed since 2026-11-24 (md5 %); review before replacement', a;
  END IF;
  IF b NOT IN ('b41688a52b368750a330ba8980737e4a', '7393cb61fab3ff10327e0c3fc7864551') THEN
    RAISE EXCEPTION 'vehicle_image_gallery_eligible(vehicle_images_public) changed since 2026-11-24 (md5 %); review before replacement', b;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.image_privacy_rules (
  field_name text NOT NULL,
  min_alnum integer NOT NULL CHECK (min_alnum >= 1),
  applies_to text NOT NULL CHECK (applies_to IN ('custody')),
  enabled boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (field_name, applies_to)
);
COMMENT ON TABLE public.image_privacy_rules IS
  'One row per private field a photo reading can carry. An enabled row withholds a photo from the public gallery when '
  'photo_extracted_fields holds that field_name for it with >= min_alnum letters or digits and the photo is a custody '
  'photo (applies_to custody: image_stage_custody_external is false). The uploader and vehicle_viewer_tied viewers '
  'still see it. Read by vehicle_image_privacy_withheld. Revert a rule by enabled = false.';
ALTER TABLE public.image_privacy_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.image_privacy_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.image_privacy_rules TO anon, authenticated;
GRANT ALL ON public.image_privacy_rules TO service_role;
DROP POLICY IF EXISTS image_privacy_rules_read ON public.image_privacy_rules;
CREATE POLICY image_privacy_rules_read ON public.image_privacy_rules FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.image_privacy_rules (field_name, min_alnum, applies_to, enabled, reason)
VALUES ('license_plate', 4, 'custody', true,
  'A registration plate on a custody photo names the car''s keeper and where it is; a listing photo was already published by its source.')
ON CONFLICT (field_name, applies_to) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vehicle_image_privacy_withheld(p_image_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 COST 50
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
    WHEN (SELECT auth.role()) = 'service_role' THEN false
    -- no viewer: a direct database session (cron, a job's trigger, a stored fold) carries no request claims and is not
    -- PostgREST's authenticator
    WHEN (SELECT auth.role()) IS NULL AND session_user <> 'authenticator' THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.photo_extracted_fields f
      JOIN public.image_privacy_rules r
        ON r.field_name = f.field_name AND r.enabled AND r.applies_to = 'custody'
      JOIN public.vehicle_images i ON i.id = f.image_id
      WHERE f.image_id = p_image_id
        AND length(regexp_replace(upper(f.value), '[^A-Z0-9]', '', 'g')) >= r.min_alnum
        AND NOT public.image_stage_custody_external(i.is_external, i.user_id, i.source, i.exif_data)
        AND i.user_id IS DISTINCT FROM (SELECT auth.uid())
        AND NOT public.vehicle_viewer_tied(i.vehicle_id))
  END
$function$;
COMMENT ON FUNCTION public.vehicle_image_privacy_withheld(uuid) IS
  'True when an enabled image_privacy_rules row matches a photo_extracted_fields reading of this custody photo and the '
  'viewer is neither its uploader nor vehicle_viewer_tied to its vehicle. False for service_role and for a session with '
  'no viewer (no request claims, not authenticator). Never NULL. Called by both vehicle_image_gallery_eligible overloads.';
REVOKE ALL ON FUNCTION public.vehicle_image_privacy_withheld(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_privacy_withheld(uuid) TO anon, authenticated, service_role;

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
    END
    -- privacy rule rows (image_privacy_rules): a custody photo with a keyed private reading, for a viewer who is
    -- neither its uploader nor tied to its vehicle
    AND NOT public.vehicle_image_privacy_withheld(($1).id);
$function$;

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
    END
    -- privacy rule rows (image_privacy_rules): a custody photo with a keyed private reading, for a viewer who is
    -- neither its uploader nor tied to its vehicle
    AND NOT public.vehicle_image_privacy_withheld(($1).id);
$function$;

DO $$
DECLARE a text; b text;
BEGIN
  a := md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images)'::regprocedure));
  b := md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images_public)'::regprocedure));
  IF a <> '3a1a1a21648e022997d38138b44ceaea' OR b <> '7393cb61fab3ff10327e0c3fc7864551' THEN
    RAISE EXCEPTION 'vehicle_image_gallery_eligible bodies did not land as written (md5 % / %)', a, b;
  END IF;
END $$;

RESET statement_timeout;
RESET lock_timeout;
