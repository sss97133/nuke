-- Source photographs and derived artwork extend the existing identity-mark catalogue.
-- An unassigned source is useful evidence, not a verified model/year fitment.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.vehicle_identity_mark_assets (
  id uuid PRIMARY KEY,
  identity_mark_id uuid REFERENCES public.vehicle_identity_marks(id),
  source_asset_id uuid REFERENCES public.vehicle_identity_mark_assets(id),
  supersedes_id uuid UNIQUE REFERENCES public.vehicle_identity_mark_assets(id),
  asset_kind text NOT NULL CHECK (asset_kind IN ('source', 'vector')),
  label text NOT NULL CHECK (btrim(label) <> ''),
  asset_path text NOT NULL CHECK (asset_path ~ '^/stacks/makes/emblems/[a-z0-9][a-z0-9._-]+$'),
  sha256_base64 text NOT NULL CHECK (sha256_base64 ~ '^[A-Za-z0-9+/]{43}=$'),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/svg+xml')),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 20000),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 20000),
  source_url text CHECK (source_url ~ '^https?://'),
  source_context text NOT NULL CHECK (btrim(source_context) <> ''),
  observed_at timestamptz,
  method text NOT NULL CHECK (btrim(method) <> ''),
  method_parameters jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(method_parameters) = 'object'),
  review_state text NOT NULL CHECK (review_state IN ('reference', 'draft', 'usable', 'withdrawn')),
  applicability_evidence text CHECK (btrim(applicability_evidence) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((asset_kind = 'source' AND source_asset_id IS NULL AND mime_type <> 'image/svg+xml')
    OR (asset_kind = 'vector' AND source_asset_id IS NOT NULL AND mime_type = 'image/svg+xml')),
  CHECK (identity_mark_id IS NULL OR applicability_evidence IS NOT NULL),
  CHECK (id IS DISTINCT FROM supersedes_id AND id IS DISTINCT FROM source_asset_id)
);
COMMENT ON TABLE public.vehicle_identity_mark_assets IS
  'Public curated identity artwork provenance. One immutable original or vector derivative per revision. Source hash/path and extraction method survive; optional identity_mark_id requires separately recorded applicability evidence. Not evidence that a badge is installed on a vehicle.';
COMMENT ON COLUMN public.vehicle_identity_mark_assets.observed_at IS 'Source capture clock, nullable when not known. recorded_at is registration time and never substitutes for capture time.';
COMMENT ON COLUMN public.vehicle_identity_mark_assets.review_state IS 'Artwork usability only. Usable does not establish model/year applicability or installation; the vehicle reader additionally requires a vetted identity mark and applicability evidence.';
CREATE INDEX vehicle_identity_mark_assets_mark_idx ON public.vehicle_identity_mark_assets(identity_mark_id) WHERE identity_mark_id IS NOT NULL;
CREATE INDEX vehicle_identity_mark_assets_source_idx ON public.vehicle_identity_mark_assets(source_asset_id) WHERE source_asset_id IS NOT NULL;
ALTER TABLE public.vehicle_identity_mark_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read curated public identity artwork" ON public.vehicle_identity_mark_assets FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.vehicle_identity_mark_assets FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.vehicle_identity_mark_assets TO anon, authenticated, service_role;

CREATE FUNCTION public.guard_vehicle_identity_mark_asset() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Identity artwork revisions are immutable; record a superseding revision'; END IF;
  IF NEW.source_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vehicle_identity_mark_assets WHERE id = NEW.source_asset_id AND asset_kind = 'source'
  ) THEN RAISE EXCEPTION 'A vector must cite an original source asset'; END IF;
  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vehicle_identity_mark_assets prior_asset WHERE prior_asset.id = NEW.supersedes_id
      AND prior_asset.asset_kind = NEW.asset_kind AND prior_asset.identity_mark_id IS NOT DISTINCT FROM NEW.identity_mark_id
  ) THEN RAISE EXCEPTION 'A revision must supersede the same artwork kind and identity scope'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicle_identity_mark_asset_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vehicle_identity_mark_assets
FOR EACH ROW EXECUTE FUNCTION public.guard_vehicle_identity_mark_asset();

-- Registration is an explicit operator action. No browser or ambient upload can publish a binding.
CREATE FUNCTION public.record_vehicle_identity_mark_asset(p_asset jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE candidate public.vehicle_identity_mark_assets; previous public.vehicle_identity_mark_assets;
BEGIN
  candidate := jsonb_populate_record(NULL::public.vehicle_identity_mark_assets, p_asset);
  IF candidate.id IS NULL THEN RAISE EXCEPTION 'An explicit idempotency id is required'; END IF;
  SELECT * INTO previous FROM public.vehicle_identity_mark_assets WHERE id = candidate.id;
  IF FOUND THEN
    IF (to_jsonb(previous) - 'recorded_at') IS DISTINCT FROM
       (to_jsonb(candidate) - 'recorded_at') THEN RAISE EXCEPTION 'Artwork id already records different evidence'; END IF;
    RETURN previous.id;
  END IF;
  candidate.recorded_at := now();
  INSERT INTO public.vehicle_identity_mark_assets SELECT candidate.*;
  RETURN candidate.id;
END $$;
REVOKE ALL ON FUNCTION public.record_vehicle_identity_mark_asset(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_vehicle_identity_mark_asset(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.guard_vehicle_identity_mark_asset() FROM PUBLIC, anon, authenticated, service_role;

-- One bounded reader works for every visible vehicle, including an honest empty catalogue.
-- Existing vehicle RLS and existing era/series/trim matching remain authoritative.
CREATE FUNCTION public.vehicle_identity_artwork(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object('vehicle_id', v.id, 'marks', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('identity_mark_id', m.id, 'kind', m.mark_kind,
      'label', m.display_label, 'assets', assets.rows) ORDER BY m.mark_kind, m.id)
    FROM public.resolve_vehicle_identity_marks(v.make, v.model, v.year, NULL, v.trim, v.body_style) m
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.asset_kind, a.id) AS rows
      FROM public.vehicle_identity_mark_assets a
      WHERE a.identity_mark_id = m.id AND a.review_state = 'usable'
        AND NOT EXISTS (SELECT 1 FROM public.vehicle_identity_mark_assets newer WHERE newer.supersedes_id = a.id)
        AND (a.asset_kind = 'source' OR EXISTS (
          SELECT 1 FROM public.vehicle_identity_mark_assets original WHERE original.id = a.source_asset_id
            AND original.review_state <> 'withdrawn'
            AND NOT EXISTS (SELECT 1 FROM public.vehicle_identity_mark_assets newer WHERE newer.supersedes_id = original.id)
        ))
    ) assets WHERE assets.rows IS NOT NULL AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
  ), '[]'::jsonb))
  FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.is_public = true AND v.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.vehicle_identity_artwork(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_identity_artwork(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_identity_artwork(uuid) IS 'Public visible-vehicle identity artwork. Uses vetted model/year/series/trim matching and only usable, applicability-supported, current assets. Empty marks is unfilled coverage, not permission to invent a badge.';

-- Reference registrations follow below. SVG rendering has been inspected; fitment remains unverified.

SELECT public.record_vehicle_identity_mark_asset($asset${"id":"97ada8f5-fdde-51b0-b65b-ac983ad6c394","identity_mark_id":null,"source_asset_id":null,"supersedes_id":null,"asset_kind":"source","label":"k5 blazer reference pair","asset_path":"/stacks/makes/emblems/k5-blazer-reference-pair.jpg","mime_type":"image/jpeg","width":800,"height":651,"source_url":null,"source_context":"Owner-supplied emblem reference; original publisher, capture date and fitment not established.","observed_at":null,"method":"owner_supplied_reference","method_parameters":{},"review_state":"reference","applicability_evidence":null,"sha256_base64":"CVrEt7t+9bM+Vw79EmKrqxcFriSjfuMBVrHGXYqj9Rw="}$asset$::jsonb);
SELECT public.record_vehicle_identity_mark_asset($asset${"id":"991b3b46-4342-58d4-9ce8-3f6846580bc5","identity_mark_id":null,"source_asset_id":"97ada8f5-fdde-51b0-b65b-ac983ad6c394","supersedes_id":null,"asset_kind":"vector","label":"k5 blazer reference pair","asset_path":"/stacks/makes/emblems/k5-blazer-reference-pair.svg","mime_type":"image/svg+xml","width":800,"height":325,"source_url":null,"source_context":"Owner-supplied emblem reference; original publisher, capture date and fitment not established.","observed_at":null,"method":"sips-bmp+potrace-1.16-color-v1","method_parameters":{"width":800,"height":325,"sourceWidth":800,"sourceHeight":651,"crop":[0,0,800,325],"clear":[],"palette":["#111214","#303235","#55575a","#7e8082","#a8aaac","#d1d3d4","#f7f6ed","#6d4913","#9b711e","#bd962c","#dfba49","#eedc85","#771c28","#a92535","#d03c3f","#ef654b"],"method":"sips-bmp+potrace-1.16-color-v1","tolerance":0.35,"turdsize":3},"review_state":"usable","applicability_evidence":null,"sha256_base64":"kkod59TLoj583U1o1QIiYJ9+hcNS1pblb7qX0YMvwfY="}$asset$::jsonb);
SELECT public.record_vehicle_identity_mark_asset($asset${"id":"58c5692a-c9be-54fe-874f-75756953bcf3","identity_mark_id":null,"source_asset_id":null,"supersedes_id":null,"asset_kind":"source","label":"cheyenne round reference","asset_path":"/stacks/makes/emblems/cheyenne-round-reference.jpg","mime_type":"image/jpeg","width":800,"height":728,"source_url":null,"source_context":"Owner-supplied emblem reference; original publisher, capture date and fitment not established.","observed_at":null,"method":"owner_supplied_reference","method_parameters":{},"review_state":"reference","applicability_evidence":null,"sha256_base64":"uwscniSMKWKcKVey354mUPyoNfbn4y1dD4YFwAtbIE4="}$asset$::jsonb);
SELECT public.record_vehicle_identity_mark_asset($asset${"id":"96bebed9-77f5-5b04-bbc4-407800b680df","identity_mark_id":null,"source_asset_id":"58c5692a-c9be-54fe-874f-75756953bcf3","supersedes_id":null,"asset_kind":"vector","label":"cheyenne round reference","asset_path":"/stacks/makes/emblems/cheyenne-round-reference.svg","mime_type":"image/svg+xml","width":800,"height":728,"source_url":null,"source_context":"Owner-supplied emblem reference; original publisher, capture date and fitment not established.","observed_at":null,"method":"sips-bmp+potrace-1.16-color-v1","method_parameters":{"width":800,"height":728,"sourceWidth":800,"sourceHeight":728,"crop":[0,0,800,728],"clear":[[400,180],[400,550]],"palette":["#111214","#303235","#55575a","#7e8082","#a8aaac","#d1d3d4","#f7f6ed","#6d4913","#9b711e","#bd962c","#dfba49","#eedc85","#771c28","#a92535","#d03c3f","#ef654b"],"method":"sips-bmp+potrace-1.16-color-v1","tolerance":0.35,"turdsize":3},"review_state":"usable","applicability_evidence":null,"sha256_base64":"BCJQnHTLF3RhHdGTS9zkBXm2E1yX9k5crfO5ErA4sOQ="}$asset$::jsonb);
SELECT public.record_vehicle_identity_mark_asset($asset${"id":"71661d04-e697-5b9c-bff6-e802ca965c66","identity_mark_id":null,"source_asset_id":null,"supersedes_id":null,"asset_kind":"source","label":"k5 blazer gold reference","asset_path":"/stacks/makes/emblems/k5-blazer-gold-reference.webp","mime_type":"image/webp","width":800,"height":352,"source_url":null,"source_context":"Owner-supplied emblem reference; original publisher, capture date and fitment not established.","observed_at":null,"method":"owner_supplied_reference","method_parameters":{},"review_state":"reference","applicability_evidence":null,"sha256_base64":"939BdGHSakSItd5RROfb2Dxspv7Jbc+P7LrXhoKCuUo="}$asset$::jsonb);
SELECT public.record_vehicle_identity_mark_asset($asset${"id":"1a173058-9f9b-53b7-a919-daf7d09bc47a","identity_mark_id":null,"source_asset_id":"71661d04-e697-5b9c-bff6-e802ca965c66","supersedes_id":null,"asset_kind":"vector","label":"k5 blazer gold reference","asset_path":"/stacks/makes/emblems/k5-blazer-gold-reference.svg","mime_type":"image/svg+xml","width":800,"height":352,"source_url":null,"source_context":"Owner-supplied emblem reference; original publisher, capture date and fitment not established.","observed_at":null,"method":"sips-bmp+potrace-1.16-color-v1","method_parameters":{"width":800,"height":352,"sourceWidth":800,"sourceHeight":352,"crop":[0,0,800,352],"clear":[],"palette":["#111214","#303235","#55575a","#7e8082","#a8aaac","#d1d3d4","#f7f6ed","#6d4913","#9b711e","#bd962c","#dfba49","#eedc85","#771c28","#a92535","#d03c3f","#ef654b"],"method":"sips-bmp+potrace-1.16-color-v1","tolerance":0.35,"turdsize":3},"review_state":"usable","applicability_evidence":null,"sha256_base64":"w0v6o+odWVjGNu3ucTzA5AVHOxjrbfcjTTlJo9sDC8E="}$asset$::jsonb);
SELECT public.record_vehicle_identity_mark_asset($asset${"id":"66c3d008-dc4c-522e-855a-a0ed1cecb263","identity_mark_id":null,"source_asset_id":null,"supersedes_id":null,"asset_kind":"source","label":"cheyenne red bar reference","asset_path":"/stacks/makes/emblems/cheyenne-red-bar-reference.jpg","mime_type":"image/jpeg","width":800,"height":213,"source_url":null,"source_context":"Owner-supplied emblem reference; original publisher, capture date and fitment not established.","observed_at":null,"method":"owner_supplied_reference","method_parameters":{},"review_state":"reference","applicability_evidence":null,"sha256_base64":"xssD6BpmdYD9pUcpoFdepU/nLsJuccSMjUTQec3gxy0="}$asset$::jsonb);
SELECT public.record_vehicle_identity_mark_asset($asset${"id":"e682b425-15ab-513a-8318-87cd42c31cf7","identity_mark_id":null,"source_asset_id":"66c3d008-dc4c-522e-855a-a0ed1cecb263","supersedes_id":null,"asset_kind":"vector","label":"cheyenne red bar reference","asset_path":"/stacks/makes/emblems/cheyenne-red-bar-reference.svg","mime_type":"image/svg+xml","width":800,"height":213,"source_url":null,"source_context":"Owner-supplied emblem reference; original publisher, capture date and fitment not established.","observed_at":null,"method":"sips-bmp+potrace-1.16-color-v1","method_parameters":{"width":800,"height":213,"sourceWidth":800,"sourceHeight":213,"crop":[0,0,800,213],"clear":[],"palette":["#111214","#303235","#55575a","#7e8082","#a8aaac","#d1d3d4","#f7f6ed","#6d4913","#9b711e","#bd962c","#dfba49","#eedc85","#771c28","#a92535","#d03c3f","#ef654b"],"method":"sips-bmp+potrace-1.16-color-v1","tolerance":0.35,"turdsize":3},"review_state":"usable","applicability_evidence":null,"sha256_base64":"j+PNIDcehACiSA0BwEblOTzAdmFbLKcM9TyzUbAPQrY="}$asset$::jsonb);
SELECT public.record_vehicle_identity_mark_asset($asset${"id":"34887555-29d0-572e-aedd-3fa589e14ba8","identity_mark_id":null,"source_asset_id":null,"supersedes_id":null,"asset_kind":"source","label":"chevrolet chrome bowtie reference","asset_path":"/stacks/makes/emblems/chevrolet-chrome-bowtie-reference.webp","mime_type":"image/webp","width":1500,"height":549,"source_url":null,"source_context":"Owner-supplied emblem reference; original publisher, capture date and fitment not established.","observed_at":null,"method":"owner_supplied_reference","method_parameters":{},"review_state":"reference","applicability_evidence":null,"sha256_base64":"27PG79XxN0wP8q4K6RLZVkd0Q8xosGnw2En1IXsMcm4="}$asset$::jsonb);
SELECT public.record_vehicle_identity_mark_asset($asset${"id":"aaf87fac-ea0d-5452-a3f2-b5242137664d","identity_mark_id":null,"source_asset_id":"34887555-29d0-572e-aedd-3fa589e14ba8","supersedes_id":null,"asset_kind":"vector","label":"chevrolet chrome bowtie reference","asset_path":"/stacks/makes/emblems/chevrolet-chrome-bowtie-reference.svg","mime_type":"image/svg+xml","width":1500,"height":549,"source_url":null,"source_context":"Owner-supplied emblem reference; original publisher, capture date and fitment not established.","observed_at":null,"method":"sips-bmp+potrace-1.16-color-v1","method_parameters":{"width":1500,"height":549,"sourceWidth":1500,"sourceHeight":549,"crop":[0,0,1500,549],"clear":[],"palette":["#111214","#303235","#55575a","#7e8082","#a8aaac","#d1d3d4","#f7f6ed","#6d4913","#9b711e","#bd962c","#dfba49","#eedc85","#771c28","#a92535","#d03c3f","#ef654b"],"method":"sips-bmp+potrace-1.16-color-v1","tolerance":0.35,"turdsize":3},"review_state":"usable","applicability_evidence":null,"sha256_base64":"fjCEMKjY2Jt5zi2TFK+6YiTTl1NHXHjB3N97b75WIdo="}$asset$::jsonb);
SELECT public.record_vehicle_identity_mark_asset($asset${"id":"e93ac37f-427b-5d7e-9136-713a6bc57e21","identity_mark_id":null,"source_asset_id":null,"supersedes_id":null,"asset_kind":"source","label":"chevrolet black bowtie reference","asset_path":"/stacks/makes/emblems/chevrolet-black-bowtie-reference.webp","mime_type":"image/webp","width":1402,"height":723,"source_url":null,"source_context":"Owner-supplied emblem reference; original publisher, capture date and fitment not established.","observed_at":null,"method":"owner_supplied_reference","method_parameters":{},"review_state":"reference","applicability_evidence":null,"sha256_base64":"F7PzcCqEpOS+Q2tFu4apsQoxB0Guz/swJ8MNfsMADdA="}$asset$::jsonb);
SELECT public.record_vehicle_identity_mark_asset($asset${"id":"1d5325b4-499d-50fc-94fe-c89e7aea6b49","identity_mark_id":null,"source_asset_id":"e93ac37f-427b-5d7e-9136-713a6bc57e21","supersedes_id":null,"asset_kind":"vector","label":"chevrolet black bowtie reference","asset_path":"/stacks/makes/emblems/chevrolet-black-bowtie-reference.svg","mime_type":"image/svg+xml","width":1402,"height":525,"source_url":null,"source_context":"Owner-supplied emblem reference; original publisher, capture date and fitment not established.","observed_at":null,"method":"sips-bmp+potrace-1.16-color-v1","method_parameters":{"width":1402,"height":525,"sourceWidth":1402,"sourceHeight":723,"crop":[0,0,1402,525],"clear":[],"palette":["#111214","#303235","#55575a","#7e8082","#a8aaac","#d1d3d4","#f7f6ed","#6d4913","#9b711e","#bd962c","#dfba49","#eedc85","#771c28","#a92535","#d03c3f","#ef654b"],"method":"sips-bmp+potrace-1.16-color-v1","tolerance":0.35,"turdsize":3},"review_state":"usable","applicability_evidence":null,"sha256_base64":"Rpp37ZLf1Ao297jdMR2j9sDezw4JzAzHr9aBEj7HjTE="}$asset$::jsonb);

COMMIT;
