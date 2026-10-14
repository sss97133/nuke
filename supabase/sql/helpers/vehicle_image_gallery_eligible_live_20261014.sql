-- vehicle_image_gallery_eligible as production has it on 2026-10-14 (pg_get_functiondef; md5 of the definition 8e1b679106cda35298b92e827fb5e444).
-- Owner postgres, SECURITY INVOKER, STABLE, SET search_path TO '', COST 100; EXECUTE for postgres, service_role, anon and authenticated.
CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
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
        AND coalesce(($1).source='bat_import',false)
        AND ($1).is_external IS TRUE
        AND ($1).is_approved IS TRUE
        AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
        AND coalesce(($1).verification_status='approved',false)
        AND coalesce(($1).redaction_level::text='none',false)
        AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
        AND EXISTS (
          SELECT 1
          FROM public.vehicles v
          JOIN public.auction_events e ON e.vehicle_id=v.id
          WHERE v.id=($1).vehicle_id AND v.is_public IS TRUE
            AND e.source::text='bat'
            AND e.source_url ~* '^https://(www\.)?bringatrailer\.com/listing/[^/?#]+/?$'
            AND (
              (jsonb_typeof(($1).exif_data->'listing_urls')='array'
                AND (($1).exif_data->'listing_urls') ? e.source_url)
              OR rtrim(e.source_url,'/')=rtrim(($1).exif_data->>'discovery_url','/')
              OR rtrim(e.source_url,'/')=rtrim(($1).exif_data->>'source_url','/')
            )
        )
      ELSE false
    END;
$function$;


REVOKE ALL ON FUNCTION public.vehicle_image_gallery_eligible(vehicle_images) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_gallery_eligible(vehicle_images) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_image_gallery_eligible(vehicle_images) IS $c$Canonical gallery read predicate, filter by vehicle_id first. Excludes superseded, duplicate, document, explicit mismatch/unrelated and invalid/test/local URLs. Preserves NULL/approved vision eligibility under existing caller RLS and reader privacy checks. Pending is eligible only for nonsensitive publication-approved external BaT images on a public vehicle whose listing provenance matches that same vehicle auction event. Rejected/review-needed and pending private/user uploads remain excluded. Returns visibility eligibility, never a vision verdict; performs no writes. PostgREST computed field.$c$;
