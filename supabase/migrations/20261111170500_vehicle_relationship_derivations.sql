-- Garage relationship derivations: what an account is to a vehicle is derived from cited evidence, not from
-- whichever source wrote last. Title-verified ownership is 'owner'; an account's own owner statement is
-- 'owner_reported'; photos alone document. A correction may only downgrade when it cites evidence.
-- Adds: vehicle_relationship_derivations (append/supersede), derive_vehicle_relationships (dry-run by default),
-- co_owner now needs the same approved title verification as owner and a self-grant never counts,
-- and get_user_garage prefers the active derivation. Rollback: supersede by run_id (see scripts/garage/replay-relationship-derivations.mjs).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.vehicle_relationship_derivations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  derived_role text NOT NULL CHECK (derived_role IN ('owner_verified','owner_reported','co_owner_verified',
    'previously_owned','business_handling','consignment','sales_representative','claimed_interest',
    'transfer_pending','documenting','contributor','profile_record')),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  title_verification_id uuid,
  producer text NOT NULL DEFAULT 'derive_vehicle_relationships',
  producer_version text NOT NULL DEFAULT 'v1',
  run_id uuid NOT NULL,
  derived_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid REFERENCES public.vehicle_relationship_derivations(id),
  superseded_reason text,
  CONSTRAINT vrd_verified_needs_title CHECK (
    derived_role NOT IN ('owner_verified','co_owner_verified') OR title_verification_id IS NOT NULL)
);
CREATE UNIQUE INDEX vrd_one_active ON public.vehicle_relationship_derivations (vehicle_id, user_id)
  WHERE superseded_at IS NULL;
CREATE INDEX vrd_user ON public.vehicle_relationship_derivations (user_id) WHERE superseded_at IS NULL;
CREATE INDEX vrd_run ON public.vehicle_relationship_derivations (run_id);
COMMENT ON TABLE public.vehicle_relationship_derivations IS
  'Derived account-to-vehicle relationship with cited evidence. Superseded, never deleted. Written only by derive_vehicle_relationships (service role).';

ALTER TABLE public.vehicle_relationship_derivations ENABLE ROW LEVEL SECURITY;
CREATE POLICY vrd_read_own ON public.vehicle_relationship_derivations FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY vrd_service_all ON public.vehicle_relationship_derivations FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.vehicle_relationship_derivations FROM anon, authenticated;
GRANT SELECT ON public.vehicle_relationship_derivations TO authenticated;
GRANT ALL ON public.vehicle_relationship_derivations TO service_role;

-- The derivation. Evidence is read from existing keys only; nothing is invented.
CREATE FUNCTION public.derive_vehicle_relationships(
  p_user uuid, p_vehicle uuid DEFAULT NULL, p_run_id uuid DEFAULT gen_random_uuid(), p_dry_run boolean DEFAULT true)
RETURNS TABLE(vehicle_id uuid, old_role text, derived_role text, confidence numeric, evidence jsonb, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_service boolean := coalesce(auth.role() = 'service_role', false);
  r record;
  v_ver uuid; v_co boolean; v_obs record; v_claim jsonb; v_roles text[];
  v_cited boolean; v_photos int; v_contrib boolean; v_tenure boolean;
  v_denied boolean; v_disputed boolean; v_role text; v_conf numeric; v_why text; v_notes text;
  v_ids uuid[]; v_ev jsonb; v_old text; v_prev uuid; v_new uuid;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'user required' USING ERRCODE = '22023'; END IF;
  IF NOT v_service AND (p_dry_run IS NOT TRUE OR auth.uid() IS DISTINCT FROM p_user) THEN
    RAISE EXCEPTION 'service role required (or own-account dry run)' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT DISTINCT c.vid FROM (
      SELECT ov.vehicle_id vid FROM ownership_verifications ov WHERE ov.user_id = p_user
      UNION SELECT vup.vehicle_id FROM vehicle_user_permissions vup WHERE vup.user_id = p_user
      UNION SELECT vo.vehicle_id FROM vehicle_ownerships vo WHERE vo.owner_profile_id = p_user
      UNION SELECT dv.vehicle_id FROM discovered_vehicles dv WHERE dv.user_id = p_user
      UNION SELECT vc.vehicle_id FROM vehicle_contributors vc WHERE vc.user_id = p_user
      UNION SELECT v.id FROM vehicles v WHERE v.user_id = p_user AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
      UNION SELECT vi.vehicle_id FROM vehicle_images vi WHERE vi.user_id = p_user
      UNION SELECT o.vehicle_id FROM vehicle_observations o
        WHERE o.submitted_by_user_id = p_user AND o.structured_data->>'claim_contract' = 'garage_owner_correction_v1'
    ) c WHERE c.vid IS NOT NULL AND (p_vehicle IS NULL OR c.vid = p_vehicle)
  LOOP
    v_notes := ''; v_ids := '{}'; v_role := NULL;

    -- Title evidence: approved, https document, not revoked (revoked_at read defensively; the column may not exist).
    SELECT ov.id INTO v_ver FROM ownership_verifications ov
     WHERE ov.vehicle_id = r.vid AND ov.user_id = p_user AND ov.status = 'approved'
       AND ov.title_document_url ~ '^https://' AND to_jsonb(ov)->>'revoked_at' IS NULL
     ORDER BY ov.created_at DESC LIMIT 1;
    -- A grant counts only if someone other than the account itself made it.
    SELECT EXISTS (SELECT 1 FROM vehicle_user_permissions p WHERE p.vehicle_id = r.vid AND p.user_id = p_user
        AND p.role = 'co_owner' AND p.revoked_at IS NULL AND coalesce(p.is_active, true)
        AND p.granted_by IS NOT NULL AND p.granted_by <> p.user_id) INTO v_co;
    IF EXISTS (SELECT 1 FROM vehicle_user_permissions p WHERE p.vehicle_id = r.vid AND p.user_id = p_user
        AND p.granted_by = p.user_id AND p.role IN ('owner','co_owner') AND p.revoked_at IS NULL) THEN
      v_notes := v_notes || 'self-granted permission ignored; ';
    END IF;

    -- Latest live account statement.
    SELECT o.id, o.content_text, o.structured_data INTO v_obs FROM vehicle_observations o
     WHERE o.vehicle_id = r.vid AND o.submitted_by_user_id = p_user AND o.is_superseded IS NOT TRUE
       AND o.structured_data->>'claim_contract' = 'garage_owner_correction_v1'
       AND o.structured_data->'correction' ? 'relationship'
     ORDER BY o.observed_at DESC NULLS LAST, o.ingested_at DESC LIMIT 1;
    v_claim := v_obs.structured_data->'correction'->'relationship';
    SELECT coalesce(array_agg(x), '{}') INTO v_roles FROM jsonb_array_elements_text(coalesce(v_claim->'roles','[]'::jsonb)) x;
    v_cited := v_obs.id IS NOT NULL AND (
      coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(v_obs.structured_data->'correction'->'evidence_ids') = 'array'
        THEN v_obs.structured_data->'correction'->'evidence_ids' END), 0) > 0
      OR nullif(btrim(coalesce(v_obs.content_text, '')), '') IS NOT NULL);
    v_denied := coalesce((v_claim->>'ownership_denied')::boolean, false);
    v_disputed := coalesce((v_claim->>'disputed')::boolean, false) OR 'claimed_interest' = ANY (v_roles);
    IF (v_denied OR v_disputed) AND NOT v_cited THEN
      v_notes := v_notes || 'uncited downgrade ignored; '; v_denied := false;
      v_disputed := false;
    END IF;
    SELECT count(*) INTO v_photos FROM vehicle_images vi WHERE vi.vehicle_id = r.vid AND vi.user_id = p_user;
    SELECT EXISTS (SELECT 1 FROM vehicle_contributors vc WHERE vc.vehicle_id = r.vid AND vc.user_id = p_user) INTO v_contrib;
    v_tenure := v_claim->>'start_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND (v_claim->>'start_date')::date <= current_date - 365;
    IF v_obs.id IS NOT NULL THEN v_ids := v_ids || v_obs.id; END IF;
    IF v_ver IS NOT NULL THEN v_ids := v_ids || v_ver; END IF;

    IF v_ver IS NOT NULL AND (v_denied OR v_disputed) THEN
      v_role := 'claimed_interest'; v_conf := 0.5; v_why := 'verified title capped by cited denial or dispute';
    ELSIF v_ver IS NOT NULL THEN
      v_role := CASE WHEN v_co AND NOT EXISTS (SELECT 1 FROM vehicle_user_permissions p WHERE p.vehicle_id = r.vid
          AND p.user_id = p_user AND p.role = 'owner' AND p.revoked_at IS NULL) THEN 'co_owner_verified' ELSE 'owner_verified' END;
      v_conf := 0.98; v_why := 'approved ownership verification with title document';
    ELSIF v_disputed AND v_cited THEN
      v_role := 'claimed_interest'; v_conf := 0.6; v_why := 'cited dispute';
    ELSIF 'transfer_pending' = ANY (v_roles) OR v_claim->>'title_status' = 'transfer_pending' THEN
      v_role := 'transfer_pending'; v_conf := 0.6; v_why := 'account states transfer pending';
    ELSIF 'owner_current' = ANY (v_roles) AND NOT v_denied THEN
      v_role := 'owner_reported';
      v_conf := CASE WHEN v_tenure AND v_photos > 0 THEN 0.85 WHEN v_photos > 0 THEN 0.75 ELSE 0.6 END;
      v_why := CASE WHEN v_tenure AND v_photos > 0 THEN 'long-tenure owner statement with own photos'
                    ELSE 'account states current ownership; no verified title' END;
    ELSIF 'owner_past' = ANY (v_roles) AND NOT v_denied THEN
      v_role := 'previously_owned'; v_conf := 0.6; v_why := 'account states past ownership';
    ELSIF 'business_handling' = ANY (v_roles) THEN
      v_role := 'business_handling'; v_conf := 0.6; v_why := 'correction role';
    ELSIF 'sales_representative' = ANY (v_roles) THEN
      v_role := 'sales_representative'; v_conf := 0.6; v_why := 'correction role';
    ELSIF 'consignment' = ANY (v_roles) THEN
      v_role := 'consignment'; v_conf := 0.6; v_why := 'correction role';
    ELSIF 'shared_interest' = ANY (v_roles) OR v_disputed THEN
      v_role := 'claimed_interest'; v_conf := 0.4; v_why := 'shared or claimed interest';
    ELSIF EXISTS (SELECT 1 FROM vehicle_ownerships vo WHERE vo.vehicle_id = r.vid AND vo.owner_profile_id = p_user
        AND vo.is_current = true) AND NOT v_denied THEN
      v_role := 'owner_reported'; v_conf := 0.5; v_why := 'current ownership record without title verification';
    ELSIF EXISTS (SELECT 1 FROM discovered_vehicles dv WHERE dv.vehicle_id = r.vid AND dv.user_id = p_user
        AND dv.is_active = true AND dv.relationship_type = 'previously_owned') THEN
      v_role := 'previously_owned'; v_conf := 0.5; v_why := 'discovered previously_owned';
    ELSIF v_contrib THEN
      v_role := 'contributor'; v_conf := 0.5; v_why := 'contributor row; not ownership';
    ELSIF v_photos > 0 THEN
      v_role := 'documenting'; v_conf := 0.4; v_why := 'own photos only; not ownership';
    ELSE
      v_role := 'profile_record'; v_conf := 0.3; v_why := 'creator of the profile';
    END IF;

    SELECT g.relationship INTO v_old FROM public.get_user_garage(p_user) g WHERE g.vehicle_id = r.vid LIMIT 1;
    v_ev := jsonb_build_object('title_verification_id', v_ver, 'correction_observation_id', v_obs.id,
      'correction_cited', v_cited, 'own_photo_count', v_photos, 'contributor_row', v_contrib,
      'co_owner_grant_by_other', v_co, 'long_tenure', v_tenure);

    IF NOT p_dry_run THEN
      SELECT d.id INTO v_prev FROM vehicle_relationship_derivations d
       WHERE d.vehicle_id = r.vid AND d.user_id = p_user AND d.superseded_at IS NULL;
      IF v_prev IS NULL OR (SELECT d.derived_role FROM vehicle_relationship_derivations d WHERE d.id = v_prev) <> v_role THEN
        v_new := gen_random_uuid();
        IF v_prev IS NOT NULL THEN
          UPDATE vehicle_relationship_derivations SET superseded_at = now(), superseded_by = v_new,
            superseded_reason = 'rederived run ' || p_run_id WHERE id = v_prev;
        END IF;
        INSERT INTO vehicle_relationship_derivations(id, vehicle_id, user_id, derived_role, confidence, evidence_ids,
          evidence, title_verification_id, run_id)
        VALUES (v_new, r.vid, p_user, v_role, v_conf, v_ids, v_ev,
          CASE WHEN v_role IN ('owner_verified','co_owner_verified') THEN v_ver END, p_run_id);
      END IF;
    END IF;

    vehicle_id := r.vid; old_role := v_old; derived_role := v_role; confidence := v_conf;
    evidence := v_ev; reason := v_why || CASE WHEN v_notes <> '' THEN ' (' || rtrim(v_notes, '; ') || ')' ELSE '' END;
    RETURN NEXT;
  END LOOP;
END
$fn$;
REVOKE ALL ON FUNCTION public.derive_vehicle_relationships(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.derive_vehicle_relationships(uuid, uuid, uuid, boolean) TO authenticated, service_role;

-- Evidence gate: co_owner needs the same approved title as owner; nobody grants owner/co_owner to themselves.
CREATE OR REPLACE FUNCTION public.enforce_user_vehicle_evidence()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, false) = true AND COALESCE(NEW.is_active, false) = false THEN
    RETURN NEW;
  END IF;
  IF NEW.role = 'previously_owned' THEN RETURN NEW; END IF;

  IF NEW.role IN ('owner', 'co_owner') THEN
    IF NEW.granted_by IS NOT NULL AND NEW.granted_by = NEW.user_id THEN
      RAISE EXCEPTION 'Cannot self-grant role=% . Vehicle: %, User: %', NEW.role, NEW.vehicle_id, NEW.user_id;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = NEW.vehicle_id AND ov.user_id = NEW.user_id
        AND ov.status = 'approved' AND ov.title_document_url ~ '^https://'
    ) THEN
      RAISE EXCEPTION 'Cannot assign role=% without approved ownership verification with valid document URL. Vehicle: %, User: %',
        NEW.role, NEW.vehicle_id, NEW.user_id;
    END IF;
    RETURN NEW;
  END IF;

  -- contributor, consigned: photo evidence OR ownership docs
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_images vi
    WHERE vi.vehicle_id = NEW.vehicle_id AND (vi.user_id = NEW.user_id OR vi.documented_by_user_id = NEW.user_id)
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = NEW.vehicle_id AND ov.user_id = NEW.user_id
        AND ov.status = 'approved' AND ov.title_document_url ~ '^https://'
    ) THEN
      RAISE EXCEPTION 'Cannot link user to vehicle without photo contributions or ownership documents. Role: %, Vehicle: %, User: %',
        NEW.role, NEW.vehicle_id, NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Reader: same signature and columns; relationship prefers the active derivation.
DO $guard$
DECLARE actual text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc,'UTF8')),'base64') INTO actual
  FROM pg_proc WHERE oid='public.get_user_garage(uuid)'::regprocedure;
  IF actual IS DISTINCT FROM 'nY5tJfoq0Y7v5IjNJ0TIW02u07YDvFzHjy3MU9AIP3A=' THEN
    RAISE EXCEPTION 'get_user_garage differs from reviewed reader (%)', actual;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text, image_url text, current_value numeric, purchase_price numeric, image_count bigint, relationship text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH viewer AS (SELECT coalesce(auth.uid() = p_user_id, false) OR coalesce(auth.role() = 'service_role', false) AS is_own),
  owned AS (
    SELECT vehicle_id, 1 pr FROM vehicle_ownerships WHERE owner_profile_id=p_user_id AND is_current=true AND (SELECT is_own FROM viewer)
    UNION SELECT vehicle_id, 2 FROM discovered_vehicles WHERE user_id=p_user_id AND is_active=true AND relationship_type='previously_owned' AND (SELECT is_own FROM viewer)
    UNION SELECT vehicle_id, 3 FROM vehicle_contributors WHERE user_id=p_user_id AND (SELECT is_own FROM viewer)
    UNION SELECT v.id, 4 FROM vehicles v
      WHERE v.user_id=p_user_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
        AND (SELECT is_own FROM viewer)
    -- A co_owner row is not ownership on its own; only an owner grant counts here (title-verified at write).
    UNION SELECT vehicle_id, 1 FROM vehicle_user_permissions WHERE user_id=p_user_id AND revoked_at IS NULL AND role = 'owner' AND NOT (SELECT is_own FROM viewer)
    -- A revoked verification is not title.
    UNION SELECT vehicle_id, 1 FROM ownership_verifications WHERE user_id=p_user_id AND status='approved' AND to_jsonb(ownership_verifications)->>'revoked_at' IS NULL
    -- A derived relationship brings its vehicle with it.
    UNION SELECT vehicle_id, 5 FROM vehicle_relationship_derivations WHERE user_id=p_user_id AND superseded_at IS NULL AND (SELECT is_own FROM viewer)
  ),
  dedup AS (SELECT vehicle_id, MIN(pr) pr FROM owned GROUP BY vehicle_id),
  rel AS (
    SELECT d.vehicle_id, d.pr, x.derived_role,
           CASE
             WHEN x.derived_role IN ('owner_verified','co_owner_verified') THEN 'owner'
             WHEN x.derived_role IS NOT NULL THEN x.derived_role
             WHEN d.pr = 1 THEN 'owner'
             WHEN d.pr = 2 THEN 'previously_owned'
             WHEN d.pr = 3 THEN 'contributor'
             ELSE 'profile_record' END AS relationship
    FROM dedup d
    LEFT JOIN vehicle_relationship_derivations x
      ON x.vehicle_id = d.vehicle_id AND x.user_id = p_user_id AND x.superseded_at IS NULL
  )
  SELECT v.id, v.year, v.make, v.model, v.trim,
         COALESCE(v.primary_image_url,
                  (SELECT vi2.image_url FROM vehicle_images vi2
                     WHERE vi2.vehicle_id = v.id AND vi2.image_url IS NOT NULL
                       AND ((SELECT is_own FROM viewer) OR public.vehicle_image_gallery_eligible(vi2))
                     ORDER BY vi2.created_at LIMIT 1)),
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr <> 4 THEN
           (SELECT ne.estimated_value FROM nuke_estimates ne
              WHERE ne.vehicle_id = v.id AND ne.comp_method = 'class_stratified'
              ORDER BY ne.calculated_at DESC NULLS LAST LIMIT 1) END,
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr <> 4 THEN v.purchase_price END,
         COALESCE(v.image_count, 0)::bigint,
         d.relationship
  FROM rel d JOIN vehicles v ON v.id=d.vehicle_id
  WHERE (SELECT is_own FROM viewer)
     OR (v.is_public = true AND v.deleted_at IS NULL AND (d.derived_role IS NULL OR d.derived_role IN ('owner_verified','co_owner_verified')))
  ORDER BY CASE d.relationship WHEN 'owner' THEN 1 WHEN 'owner_reported' THEN 2 WHEN 'previously_owned' THEN 3
                               WHEN 'contributor' THEN 4 WHEN 'profile_record' THEN 6 ELSE 5 END, v.year;
$function$;
COMMIT;
