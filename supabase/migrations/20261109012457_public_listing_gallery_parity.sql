-- Restore canonical listing-capture eligibility omitted by the public-view overload.
-- No rows, RLS, grants, columns or vision verdicts change. BaT provenance remains required.
BEGIN;
DO $budget$ BEGIN
 IF current_setting('statement_timeout')::interval = interval '0' OR current_setting('statement_timeout')::interval > interval '10 seconds' THEN PERFORM set_config('statement_timeout','10s',true); END IF;
 IF current_setting('lock_timeout')::interval = interval '0' OR current_setting('lock_timeout')::interval > interval '2 seconds' THEN PERFORM set_config('lock_timeout','2s',true); END IF;
END $budget$;
DO $patch$
DECLARE old_body text := $old$
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
        AND coalesce(($1).source='bat_import',false)
        AND ($1).is_external IS TRUE
        AND ($1).is_approved IS TRUE
        AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
        AND coalesce(($1).verification_status='approved',false)
        AND coalesce(($1).redaction_level::text='none',false)
        AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
        AND public.bat_pending_image_listing_by_id(($1).id)
      ELSE false
    END;
$old$; new_body text := $new$
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
$new$; actual text;
BEGIN
 SELECT prosrc INTO actual FROM pg_proc WHERE oid=to_regprocedure('public.vehicle_image_gallery_eligible(public.vehicle_images_public)');
 IF actual = new_body THEN RETURN; END IF;
 IF actual IS DISTINCT FROM old_body THEN RAISE EXCEPTION 'Public gallery predicate drifted; inspect before retry'; END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images_public) RETURNS boolean LANGUAGE sql STABLE AS %L',new_body);
END $patch$;
NOTIFY pgrst, 'reload schema';
COMMIT;
