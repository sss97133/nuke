-- Keep facet testimony while exposing image witnesses only through the same
-- invoker-visible gallery boundary used by the public image reader.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';

CREATE FUNCTION pg_temp.facet_patch_once(p_text text, p_old text, p_new text, p_label text)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n integer;
BEGIN
  n := (length(p_text) - length(replace(p_text, p_old, ''))) / greatest(length(p_old), 1);
  IF n <> 1 THEN RAISE EXCEPTION '% anchor drifted: % matches', p_label, n; END IF;
  RETURN replace(p_text, p_old, p_new);
END $f$;

DO $patch$
DECLARE d text; h text;
  image_where text := 'i.id = o.image_id AND i.vehicle_id = o.vehicle_id'
    || ' AND public.vehicle_image_gallery_eligible(i) IS TRUE'
    || ' AND i.is_sensitive IS NOT TRUE AND i.is_document IS NOT TRUE'
    || ' AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE AND i.superseded_by IS NULL';
  field_where text := 'i.id = f.image_id AND i.vehicle_id = f.vehicle_id'
    || ' AND public.vehicle_image_gallery_eligible(i) IS TRUE'
    || ' AND i.is_sensitive IS NOT TRUE AND i.is_document IS NOT TRUE'
    || ' AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE AND i.superseded_by IS NULL';
BEGIN
  IF to_regclass('public.vehicle_images_public') IS NULL
     OR to_regprocedure('public.vehicle_image_gallery_eligible(public.vehicle_images_public)') IS NULL THEN
    RAISE EXCEPTION 'Public invoker gallery qualification unavailable';
  END IF;
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('facet_image_currentness_v1' IN d) > 0 THEN
    IF position('facet_image_currentness_v1' IN pg_get_functiondef('public.vehicle_facet_observation_ids(uuid)'::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'Facet image helper patch missing';
    END IF;
    RETURN;
  END IF;
  d := pg_temp.facet_patch_once(d, '-- facet_items_v1',
    '-- facet_items_v1' || E'\n' || '-- facet_image_currentness_v1', 'facet image patch marker');
  d := pg_temp.facet_patch_once(d,
    'WHERE o.is_superseded IS NOT TRUE',
    'WHERE o.is_superseded IS NOT TRUE AND o.superseded_by IS NULL', 'facet observation currentness');
  d := pg_temp.facet_patch_once(d,
    'SELECT o.id, o.kind::text AS kind',
    'SELECT o.id, o.vehicle_id, o.kind::text AS kind', 'facet observation vehicle binding');
  d := pg_temp.facet_patch_once(d,
    'SELECT 1 FROM public.vehicle_images i WHERE i.id = o.image_id',
    'SELECT 1 FROM public.vehicle_images_public i WHERE ' || image_where, 'observation image witness');
  d := pg_temp.facet_patch_once(d,
    'SELECT 1 FROM public.vehicle_images i WHERE i.id = f.image_id',
    'SELECT 1 FROM public.vehicle_images_public i WHERE ' || field_where, 'field evidence image witness');
  d := pg_temp.facet_patch_once(d,
    'FROM public.vehicle_images i WHERE i.id = o.image_id',
    'FROM public.vehicle_images_public i WHERE ' || image_where, 'observation witness thumbnail');
  d := pg_temp.facet_patch_once(d,
    'FROM public.vehicle_images i WHERE i.id = f.image_id',
    'FROM public.vehicle_images_public i WHERE ' || field_where, 'field evidence witness thumbnail');
  EXECUTE d;

  h := pg_get_functiondef('public.vehicle_facet_observation_ids(uuid)'::regprocedure);
  h := pg_temp.facet_patch_once(h, 'AND o.is_superseded IS NOT TRUE',
    '-- facet_image_currentness_v1' || E'\n    AND o.is_superseded IS NOT TRUE', 'facet id helper patch marker');
  h := pg_temp.facet_patch_once(h,
    'AND o.is_superseded IS NOT TRUE',
    'AND o.is_superseded IS NOT TRUE AND o.superseded_by IS NULL', 'facet observation id helper currentness');
  EXECUTE h;
END $patch$;

DROP FUNCTION pg_temp.facet_patch_once(text,text,text,text);
COMMIT;
