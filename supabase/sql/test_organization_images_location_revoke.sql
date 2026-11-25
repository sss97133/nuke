-- Disposable PG17 contract for 20261125093500_organization_images_location_revoke (organization_images_location_v1).
-- Synthetic rows only. Builds on the step-1 contract (test_organization_images_read_narrow.sql, which ends reverted),
-- re-applies 20261125084500, then this migration twice. Reads run under SET ROLE. Asserts:
--   * anon and a signed-in stranger are refused latitude / longitude / location_name / exif_data (42501), and the page's
--     base-column select still succeeds for them and for the uploader;
--   * organization_image_locations still answers the uploader (4 rows) and a stranger nothing;
--   * a signed-in uploader can still insert a work-order photo: the BEFORE INSERT bundle trigger reads latitude and runs
--     as its owner;
--   * the revert grants the four columns back.
\set ON_ERROR_STOP on
\ir test_organization_images_read_narrow.sql
\ir ../migrations/20261125084500_organization_images_read_narrow.sql

-- The live upload policy and the live trigger shape: an invoker BEFORE INSERT trigger that reads latitude / longitude
-- of the uploader's earlier work-order photos (its metadata update is left out of the stub).
CREATE POLICY "Users upload org images" ON public.organization_images FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
CREATE FUNCTION public.bundle_org_images_into_work_orders() RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_similar_images RECORD;
BEGIN
  IF NEW.is_sensitive = TRUE AND NEW.sensitivity_type = 'work_order' THEN
    FOR v_similar_images IN
      SELECT id, taken_at, latitude, longitude FROM organization_images
       WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id
         AND is_sensitive = TRUE AND sensitivity_type = 'work_order' LIMIT 20
    LOOP NULL; END LOOP;
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_bundle_work_order_images BEFORE INSERT ON public.organization_images FOR EACH ROW
  WHEN (((new.is_sensitive = true) AND (new.sensitivity_type = 'work_order'::text))) EXECUTE FUNCTION bundle_org_images_into_work_orders();
UPDATE public.organization_images SET sensitivity_type = 'work_order' WHERE id = '00000000-0000-0000-0000-0000000000b3';

\ir ../migrations/20261125093500_organization_images_location_revoke.sql
\ir ../migrations/20261125093500_organization_images_location_revoke.sql

SET ROLE anon; SELECT set_config('test.uid', '', false);
SELECT public.assert(NOT public.denied(:'base_select'), 'anon: base select succeeds');
SELECT public.assert(public.denied('SELECT latitude FROM public.organization_images'), 'anon: latitude refused');
SELECT public.assert(public.denied('SELECT longitude FROM public.organization_images'), 'anon: longitude refused');
SELECT public.assert(public.denied('SELECT location_name FROM public.organization_images'), 'anon: location_name refused');
SELECT public.assert(public.denied('SELECT exif_data FROM public.organization_images'), 'anon: exif_data refused');
SELECT public.assert(public.denied(:'profile_select'), 'anon: the old page select (with the four columns) is refused');
SELECT public.assert((SELECT count(id) FROM public.organization_images) = 2, 'anon: still the 2 public rows');
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f3', false);
SELECT public.assert(NOT public.denied(:'base_select'), 'stranger: base select succeeds');
SELECT public.assert(public.denied('SELECT exif_data FROM public.organization_images'), 'stranger: exif_data refused');
SELECT public.assert((SELECT count(*) FROM public.organization_image_locations('00000000-0000-0000-0000-0000000000e1')) = 0, 'stranger: no locations');
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f1', false);
SELECT public.assert(NOT public.denied(:'base_select'), 'uploader: base select succeeds');
SELECT public.assert(public.denied('SELECT latitude FROM public.organization_images'), 'uploader: columns come only through the reader');
SELECT public.assert((SELECT count(*) FROM public.organization_image_locations('00000000-0000-0000-0000-0000000000e1')) = 4, 'uploader: 4 locations through the reader');
INSERT INTO public.organization_images (id, organization_id, user_id, image_url, visibility_level, is_sensitive, sensitivity_type, latitude, longitude)
VALUES ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'u5',
        'internal_only', true, 'work_order', 1, 1);
SELECT public.assert((SELECT count(*) FROM public.organization_image_locations('00000000-0000-0000-0000-0000000000e1')) = 5, 'uploader: work-order upload landed through the trigger');
RESET ROLE;
SELECT public.assert((SELECT prosecdef FROM pg_proc WHERE oid = 'public.bundle_org_images_into_work_orders()'::regprocedure), 'bundle trigger runs as owner');

\ir revert_20261125093500_organization_images_location_revoke.sql
SET ROLE anon; SELECT set_config('test.uid', '', false);
SELECT public.assert(NOT public.denied(:'profile_select'), 'revert: the four columns are granted again');
RESET ROLE;
\echo organization_images_location_revoke: ok
