-- Facility assets (R3 sections 3 and 7, step 6; R1 agreement "Facility/bay access"). A shop has bays, lifts, a paint
-- booth, compressors, parking and licenses; providers who show up use them under the shop's permission.
--
--   * equipment.shop_id gets a foreign key to organizations (2026-10-19: 20 rows; 5 resolve to an organization, 15 were
--     already null; any value that does not resolve is set null with a note in equipment.notes rather than guessed).
--   * shop_licenses.shop_id pointed at shops_archived_20260129 (1 row, an archived shop with no organization of the same
--     id or slug). It now references organizations; unresolved values move to legacy_archived_shop_id and shop_id is set
--     null. Policies are rewritten to organization owners/members (read) and active owners (write), plus global admins;
--     anon loses its table grants (licenses reach the public through facility_read: type and expiry only).
--   * declare_facility_asset(p_organization_id, p_kind, p_label, p_capacity, p_evidence): an active owner or member of the
--     organization declares an asset (bay | lift | paint_booth | compressor | parking | other) with a capacity. One
--     owner-input specification observation about the organization (vehicle_id null, subject organization) and one
--     equipment row (source member_declaration) per kind+label; a later declaration of the same kind+label updates
--     capacity/evidence and points at the newer source. Evidence is optional and only referenced: [{kind: url, url} |
--     {kind: image, id}]. Assets are never inferred from photos: the existing photo_evidence_inferred rows are kept as
--     they are and are not declared assets. Purchase, depreciation and market values stay separate and optional.
-- Contract: supabase/sql/test_facility_assets.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

UPDATE public.equipment e SET notes = concat_ws(E'\n', NULLIF(e.notes, ''),
    format('shop_id %s did not resolve to an organization on 2026-10-19; left unset rather than guessed.', e.shop_id)),
  shop_id = NULL
WHERE e.shop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = e.shop_id);
ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.organizations(id) ON DELETE SET NULL NOT VALID,
  ADD COLUMN asset_kind text CHECK (asset_kind IN ('bay','lift','paint_booth','compressor','parking','other')),
  ADD COLUMN capacity integer CHECK (capacity BETWEEN 1 AND 500),
  ADD COLUMN declared_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN declaration_observation_id uuid,
  ADD COLUMN evidence jsonb CHECK (evidence IS NULL OR jsonb_typeof(evidence) = 'array'),
  ADD CONSTRAINT equipment_declared_asset_complete CHECK ((source = 'member_declaration') =
    (asset_kind IS NOT NULL AND capacity IS NOT NULL AND declared_by_user_id IS NOT NULL AND declaration_observation_id IS NOT NULL AND shop_id IS NOT NULL)) NOT VALID;
ALTER TABLE public.equipment VALIDATE CONSTRAINT equipment_shop_id_fkey;
ALTER TABLE public.equipment VALIDATE CONSTRAINT equipment_declared_asset_complete;
CREATE INDEX equipment_shop ON public.equipment(shop_id) WHERE shop_id IS NOT NULL;
CREATE UNIQUE INDEX equipment_declared_asset_label ON public.equipment(shop_id, asset_kind, lower(name)) WHERE source = 'member_declaration';
COMMENT ON COLUMN public.equipment.shop_id IS 'Organization holding the equipment (FK organizations). Null when unknown; legacy values that did not resolve were nulled with a note.';
COMMENT ON COLUMN public.equipment.asset_kind IS 'Facility asset kind for member-declared assets: bay, lift, paint_booth, compressor, parking, other.';
COMMENT ON COLUMN public.equipment.capacity IS 'How many concurrent confirmed reservations the declared asset holds.';
COMMENT ON COLUMN public.equipment.declaration_observation_id IS 'Current owner-input declaration (declare_facility_asset) behind a member_declaration row.';

ALTER TABLE public.shop_licenses ADD COLUMN legacy_archived_shop_id uuid;
COMMENT ON COLUMN public.shop_licenses.legacy_archived_shop_id IS 'shops_archived_20260129 id this license pointed at when it did not resolve to an organization (2026-10-19); kept for review, never guessed.';
ALTER TABLE public.shop_licenses DROP CONSTRAINT shop_licenses_shop_id_fkey;
ALTER TABLE public.shop_licenses ALTER COLUMN shop_id DROP NOT NULL;
UPDATE public.shop_licenses l SET legacy_archived_shop_id = l.shop_id, shop_id = NULL
WHERE l.shop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = l.shop_id);
ALTER TABLE public.shop_licenses ADD CONSTRAINT shop_licenses_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.organizations(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.shop_licenses VALIDATE CONSTRAINT shop_licenses_shop_id_fkey;
COMMENT ON COLUMN public.shop_licenses.shop_id IS 'Organization holding the license (FK organizations); null when the legacy archived shop did not resolve.';

DO $$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['shop_licenses_admin_delete','shop_licenses_admin_update','shop_licenses_admin_write','shop_licenses_insert_own',
      'shop_licenses_member_read','shop_licenses_member_read_safe','shop_licenses_owner_admin_read','shop_licenses_public_read'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.shop_licenses', p);
  END LOOP;
END $$;
CREATE FUNCTION public.organization_facility_role(p_user uuid, p_organization_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_user IS NULL OR p_organization_id IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.business_ownership bo WHERE bo.business_id = p_organization_id AND bo.owner_id = p_user AND bo.status = 'active') THEN 'organization_owner'
    WHEN EXISTS (SELECT 1 FROM public.organization_contributors oc WHERE oc.organization_id = p_organization_id AND oc.user_id = p_user AND oc.status = 'active') THEN 'organization_member' END
$$;
REVOKE ALL ON FUNCTION public.organization_facility_role(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_facility_role(uuid,uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.organization_facility_role(uuid,uuid) IS 'organization_owner (active business_ownership) | organization_member (active organization_contributors) | null.';
CREATE POLICY shop_licenses_org_read ON public.shop_licenses FOR SELECT TO authenticated
  USING (public.organization_facility_role((SELECT auth.uid()), shop_id) IS NOT NULL OR public.is_global_admin());
CREATE POLICY shop_licenses_owner_insert ON public.shop_licenses FOR INSERT TO authenticated
  WITH CHECK (public.organization_facility_role((SELECT auth.uid()), shop_id) = 'organization_owner');
CREATE POLICY shop_licenses_owner_update ON public.shop_licenses FOR UPDATE TO authenticated
  USING (public.organization_facility_role((SELECT auth.uid()), shop_id) = 'organization_owner')
  WITH CHECK (public.organization_facility_role((SELECT auth.uid()), shop_id) = 'organization_owner');
CREATE POLICY shop_licenses_owner_delete ON public.shop_licenses FOR DELETE TO authenticated
  USING (public.organization_facility_role((SELECT auth.uid()), shop_id) = 'organization_owner');
REVOKE ALL ON public.shop_licenses FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.shop_licenses FROM authenticated;

CREATE FUNCTION public.facility_asset_evidence_valid(p_evidence jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_evidence IS NULL OR (jsonb_typeof(p_evidence) = 'array' AND jsonb_array_length(p_evidence) <= 20
    AND COALESCE((SELECT bool_and(jsonb_typeof(e) = 'object' AND CASE e->>'kind'
        WHEN 'url' THEN (e - ARRAY['kind','url']) = '{}'::jsonb AND (e->>'url') ~ '^https://' AND length(e->>'url') <= 500
        WHEN 'image' THEN (e - ARRAY['kind','id']) = '{}'::jsonb
          AND (e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND (EXISTS (SELECT 1 FROM public.vehicle_images vi WHERE vi.id = (e->>'id')::uuid)
            OR EXISTS (SELECT 1 FROM public.organization_images oi WHERE oi.id = (e->>'id')::uuid))
        ELSE false END) FROM jsonb_array_elements(p_evidence) e), true))
$$;
REVOKE ALL ON FUNCTION public.facility_asset_evidence_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facility_asset_evidence_valid(jsonb) TO service_role;

CREATE FUNCTION public.declare_facility_asset(p_organization_id uuid, p_kind text, p_label text, p_capacity integer DEFAULT 1, p_evidence jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  role text;
  label text := btrim(p_label);
  owner_source uuid;
  request_key text;
  obs_id uuid;
  prev public.equipment%ROWTYPE;
  asset_id uuid;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  role := public.organization_facility_role(signer, p_organization_id);
  IF role IS NULL THEN RAISE EXCEPTION 'Only active owners or members of the organization declare its facility assets' USING ERRCODE = '42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('bay','lift','paint_booth','compressor','parking','other') THEN
    RAISE EXCEPTION 'Kind must be bay, lift, paint_booth, compressor, parking or other' USING ERRCODE = '22023';
  END IF;
  IF label IS NULL OR length(label) NOT BETWEEN 1 AND 120 OR position(E'\n' IN label) > 0 THEN
    RAISE EXCEPTION 'Label must be one line of 1 to 120 characters' USING ERRCODE = '22023';
  END IF;
  IF p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Capacity must be 1 to 500' USING ERRCODE = '22023'; END IF;
  IF NOT public.facility_asset_evidence_valid(p_evidence) THEN
    RAISE EXCEPTION 'Evidence must be [{kind: url, url: https://...} | {kind: image, id}] (at most 20)' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('facility_asset:' || p_organization_id::text, 0));
  SELECT * INTO prev FROM public.equipment WHERE shop_id = p_organization_id AND asset_kind = p_kind AND lower(name) = lower(label)
    AND source = 'member_declaration';
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('facility-asset', p_organization_id, p_kind, lower(label), p_capacity, p_evidence, signed)::text);
  IF prev.id IS NOT NULL AND prev.capacity = p_capacity AND prev.evidence IS NOT DISTINCT FROM p_evidence THEN
    RETURN jsonb_build_object('asset_id', prev.id, 'organization_id', p_organization_id, 'kind', p_kind, 'label', prev.name, 'capacity', prev.capacity,
      'declarer_role', role, 'duplicate', true, 'updated_existing', false, 'valuation', 'not_recorded');
  END IF;
  INSERT INTO public.vehicle_observations(vehicle_id, subject_type, subject_id, subject_organization_id, source_id, source_identifier, observed_at,
    observed_at_basis, source_event_at, source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id,
    observer_raw, extraction_method, confidence, confidence_score)
  VALUES (NULL, 'organization', p_organization_id, p_organization_id, owner_source,
    'facility_asset:' || p_organization_id::text || ':' || p_kind || ':' || lower(label), signed, 'event_time', signed, 'exact', 'specification',
    format('An organization %s declared a facility asset: %s "%s" (capacity %s).', replace(role, 'organization_', ''), p_kind, label, p_capacity),
    request_key,
    jsonb_build_object('facility_asset', jsonb_build_object('version', 1, 'organization_id', p_organization_id, 'kind', p_kind, 'label', label,
      'capacity', p_capacity, 'evidence', p_evidence, 'declarer_role', role, 'signer_user_id', signer, 'supersedes_asset_declaration', prev.declaration_observation_id)),
    signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account', 'declarer_role', role), 'facility_asset_declaration_sign_v1', 'high', 0.95)
  RETURNING id INTO obs_id;
  IF prev.id IS NOT NULL THEN
    UPDATE public.vehicle_observations SET is_superseded = true, superseded_by = obs_id, superseded_at = signed
      WHERE id = prev.declaration_observation_id AND is_superseded IS FALSE;
    UPDATE public.equipment SET capacity = p_capacity, evidence = p_evidence, declared_by_user_id = signer, declaration_observation_id = obs_id,
      updated_at = signed WHERE id = prev.id;
    asset_id := prev.id;
  ELSE
    INSERT INTO public.equipment(shop_id, name, category, asset_kind, capacity, status, source, declared_by_user_id, declaration_observation_id,
      evidence, created_at, updated_at)
    VALUES (p_organization_id, label, p_kind, p_kind, p_capacity, 'in_service', 'member_declaration', signer, obs_id, p_evidence, signed, signed)
    RETURNING id INTO asset_id;
  END IF;
  RETURN jsonb_build_object('asset_id', asset_id, 'organization_id', p_organization_id, 'kind', p_kind, 'label', label, 'capacity', p_capacity,
    'declarer_role', role, 'declared_at', signed, 'declaration_id', obs_id, 'duplicate', false, 'updated_existing', prev.id IS NOT NULL,
    'evidence_count', COALESCE(jsonb_array_length(p_evidence), 0), 'valuation', 'not_recorded');
END $$;
REVOKE ALL ON FUNCTION public.declare_facility_asset(uuid,text,text,integer,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.declare_facility_asset(uuid,text,text,integer,jsonb) TO authenticated;
COMMENT ON FUNCTION public.declare_facility_asset(uuid,text,text,integer,jsonb) IS 'Sign: an active owner or member declares a facility asset (bay, lift, paint_booth, compressor, parking, other) with capacity and optional evidence references; owner-input observation about the organization plus one equipment row (source member_declaration). Never inferred from photos; no valuation.';

INSERT INTO public.pipeline_registry(table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'equipment', 'declaration_observation_id', 'declare_facility_asset', 'Member-declared facility assets (source member_declaration) are written only by the Sign; photo-inferred rows are not declared assets.', true,
  'declare_facility_asset(uuid,text,text,integer,jsonb)'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r WHERE r.table_name = 'equipment' AND r.column_name = 'declaration_observation_id');
NOTIFY pgrst, 'reload schema';
COMMIT;
