-- Header facet items: an image witness carries its thumbnail, and the observation-id helper takes no role list.
--
-- WHY.
-- 1. The header renderer shows each photo witness as a thumbnail. Items carried only `witness {kind, id}`, and no reader
--    resolves an arbitrary image id for a logged-out viewer; a page-local vehicle_images query would bypass the reader.
-- 2. vehicle_facet_observation_ids(vehicle, roles[]) (20261116031000) let any caller pass its own role list, so it
--    answered "how many observations with claim role X does this public car hold", counting rows the caller's row
--    policies hide. The list is now fixed inside the helper.
--
-- WHAT.
-- 1. vehicle_facet_items: an image witness gains `thumb`, the image's thumbnail (else medium, else original) URL, read
--    under the viewer's own row policies exactly as the existing visibility check reads the image. The renderer passes it
--    through the existing optimizeImageUrl(…, 'thumbnail').
-- 2. vehicle_facet_observation_ids(uuid): the claim roles vehicle_facet_items maps, fixed here. The reader calls it; the
--    (uuid, text[]) form is dropped. The reader's own role filter still runs after the row policies, so a role listed
--    here but not mapped by the reader is read and dropped; a role mapped by the reader but missing here would be lost,
--    which test_vehicle_facet_items.sql checks against the reader's own role table.
-- Anchor patches of the deployed body; they refuse drift and are skipped when already applied.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.vehicle_facet_observation_ids(p_vehicle_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(array_agg(o.id), '{}'::uuid[])
  FROM public.vehicles v
  JOIN public.vehicle_observations o ON o.vehicle_id = v.id
  WHERE v.id = p_vehicle_id
    AND v.deleted_at IS NULL
    AND (v.is_public IS TRUE
         OR ((SELECT auth.uid()) IS NOT NULL AND ((SELECT auth.uid()) IN (v.user_id, v.owner_id, v.uploaded_by)
             OR public.vehicle_user_has_access(v.id, (SELECT auth.uid())))))
    AND o.is_superseded IS NOT TRUE
    AND (o.property_id IS NOT NULL OR o.structured_data ? 'property_key'
         -- facet_roles_v1: the claim roles vehicle_facet_items maps (its `roles` table), plus the option-code reading
         -- its `examined` item reads.
         OR o.structured_data->>'claim_role' = ANY (ARRAY[
           'cowl_tag_body_number', 'cowl_tag_build_date', 'cowl_tag_option_codes', 'cowl_tag_style',
           'cowl_tag_transcription', 'cowl_tag_trim', 'engine_block_casting', 'engine_block_casting_dossier_fields',
           'engine_code_stamp', 'identified_transmission_housing', 'nominal_engine_displacement',
           'original_transmission_evidence', 'transmission_bellhousing', 'transmission_case_model',
           'transmission_id_stamp', 'transmission_shifter', 'transmission_side_cover', 'transmission_tailhousing',
           'visible_drivetrain_layout'])
         OR (o.extraction_method LIKE 'vin\_decode\_%' AND o.structured_data ? 'decode_rule'))
$function$;
COMMENT ON FUNCTION public.vehicle_facet_observation_ids(uuid) IS
  'Ids only: the current observations of one visible vehicle that carry a property, a claim role vehicle_facet_items '
  'maps, or a VIN decode. vehicle_facet_items reads those rows under the viewer''s own row policies.';
REVOKE ALL ON FUNCTION public.vehicle_facet_observation_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_facet_observation_ids(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.patch_once(p_text text, p_anchor text, p_replacement text, p_what text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE n integer := (length(p_text) - length(replace(p_text, p_anchor, ''))) / greatest(length(p_anchor), 1);
BEGIN
  IF n <> 1 THEN RAISE EXCEPTION '% anchor drifted (found % times): %', p_what, n, p_anchor; END IF;
  RETURN replace(p_text, p_anchor, p_replacement);
END $f$;

DO $migration$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('''thumb''' in d) = 0 THEN
    d := pg_temp.patch_once(d,
      E'  SELECT public.vehicle_facet_observation_ids(v.id,\n    ARRAY(SELECT role FROM roles UNION ALL SELECT ''cowl_tag_option_codes'')) AS ids\n',
      E'  SELECT public.vehicle_facet_observation_ids(v.id) AS ids\n',
      'vehicle_facet_items observation ids call');
    d := pg_temp.patch_once(d,
      $a$THEN jsonb_build_object('kind', 'image', 'id', o.image_id)$a$,
      $b$THEN jsonb_build_object('kind', 'image', 'id', o.image_id,
                     'thumb', (SELECT coalesce(i.thumbnail_url, i.medium_url, i.image_url)
                               FROM public.vehicle_images i WHERE i.id = o.image_id))$b$,
      'vehicle_facet_items reading witness');
    d := pg_temp.patch_once(d,
      $a$THEN jsonb_build_object('kind', 'image', 'id', f.image_id)$a$,
      $b$THEN jsonb_build_object('kind', 'image', 'id', f.image_id,
                             'thumb', (SELECT coalesce(i.thumbnail_url, i.medium_url, i.image_url)
                                       FROM public.vehicle_images i WHERE i.id = f.image_id))$b$,
      'vehicle_facet_items field evidence witness');
    EXECUTE d;
  END IF;
  IF position('''thumb''' in pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'vehicle_facet_items is not patched';
  END IF;
END $migration$;

DROP FUNCTION IF EXISTS public.vehicle_facet_observation_ids(uuid, text[]);
DROP FUNCTION pg_temp.patch_once(text, text, text, text);
COMMIT;
