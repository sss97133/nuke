-- Functions as read from production on 2026-10-19 (pg_get_functiondef), for test_vehicle_access_requires_provenance.sql.

CREATE OR REPLACE FUNCTION public.jsonb_mask_keys(j jsonb, p_keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN coalesce((
      SELECT jsonb_object_agg(e.k, CASE WHEN e.k = ANY (p_keys) THEN 'null'::jsonb ELSE public.jsonb_mask_keys(e.v, p_keys) END)
      FROM jsonb_each(j) AS e(k, v)), '{}'::jsonb)
    WHEN 'array' THEN coalesce((
      SELECT jsonb_agg(public.jsonb_mask_keys(a.e, p_keys) ORDER BY a.o)
      FROM jsonb_array_elements(j) WITH ORDINALITY AS a(e, o)), '[]'::jsonb)
    ELSE j END;
$function$
;

CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  has_perm boolean := false;
begin
  if p_user_id is null then
    return false;
  end if;

  -- Direct vehicle-level permissions (legacy, optional)
  if to_regclass('public.vehicle_user_permissions') is not null then
    select true into has_perm
    from public.vehicle_user_permissions vup
    where vup.vehicle_id = p_vehicle_id
      and vup.user_id = p_user_id
      and coalesce(vup.is_active, true) = true
      and vup.role = any (array[
        'owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member'
      ]::text[])
    limit 1;

    if has_perm then
      return true;
    end if;
  end if;

  -- Vehicle contributors table (legacy collaborators)
  if to_regclass('public.vehicle_contributors') is not null then
    select true into has_perm
    from public.vehicle_contributors vc
    where vc.vehicle_id = p_vehicle_id
      and vc.user_id = p_user_id
      and coalesce(vc.status, 'active') = 'active'
      and vc.role = any (array[
        'owner','co_owner','restorer','moderator','consigner','mechanic','appraiser','photographer','sales_agent'
      ]::text[])
    limit 1;

    if has_perm then
      return true;
    end if;
  end if;

  -- Organization contributors linked to this vehicle
  if to_regclass('public.organization_vehicles') is not null and to_regclass('public.organization_contributors') is not null then
    select true into has_perm
    from public.organization_vehicles ov
    where ov.vehicle_id = p_vehicle_id
      and exists (
        select 1
        from public.organization_contributors oc
        where oc.organization_id = ov.organization_id
          and oc.user_id = p_user_id
          and oc.status = 'active'
          and oc.role = any (array[
            'owner','co_founder','board_member','manager','employee','technician','contractor','moderator','contributor','photographer'
          ]::text[])
      )
    limit 1;

    if has_perm then
      return true;
    end if;
  end if;

  -- Verified ownership records
  if to_regclass('public.ownership_verifications') is not null then
    select true into has_perm
    from public.ownership_verifications ov
    where ov.vehicle_id = p_vehicle_id
      and ov.user_id = p_user_id
      and ov.status = 'approved'
    limit 1;

    if has_perm then
      return true;
    end if;
  end if;

  return false;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.vehicle_row_read(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_public boolean;
  v_insider boolean;
BEGIN
  SELECT to_jsonb(v.*),
         coalesce(v.is_public, false),
         coalesce(auth.role() = 'service_role', false)
           OR (v_uid IS NOT NULL AND (coalesce(v_uid IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                                     OR public.vehicle_user_has_access(v.id, v_uid)))
    INTO v_row, v_public, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;
  IF v_row IS NULL OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;
  IF v_insider THEN
    RETURN v_row;
  END IF;
  RETURN public.jsonb_mask_keys(v_row, ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact']);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_user_vehicle_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Revocations always allowed: an active row going inactive
  -- doesn't claim anything new, it retracts a prior claim.
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.is_active, false) = true
     AND COALESCE(NEW.is_active, false) = false THEN
    RETURN NEW;
  END IF;

  -- previously_owned: user attestation OK, no evidence required
  IF NEW.role = 'previously_owned' THEN
    RETURN NEW;
  END IF;

  -- owner: require approved ownership_verifications with real URLs
  IF NEW.role = 'owner' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = NEW.vehicle_id
        AND ov.user_id = NEW.user_id
        AND ov.status = 'approved'
        AND ov.title_document_url ~ '^https://'
    ) THEN
      RAISE EXCEPTION 'Cannot assign role=owner without approved ownership verification with valid document URL. Vehicle: %, User: %',
        NEW.vehicle_id, NEW.user_id;
    END IF;
    RETURN NEW;
  END IF;

  -- co_owner, contributor, consigned: require photo evidence OR ownership docs
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_images vi
    WHERE vi.vehicle_id = NEW.vehicle_id
    AND (vi.user_id = NEW.user_id OR vi.documented_by_user_id = NEW.user_id)
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = NEW.vehicle_id
        AND ov.user_id = NEW.user_id
        AND ov.status = 'approved'
        AND ov.title_document_url ~ '^https://'
    ) THEN
      RAISE EXCEPTION 'Cannot link user to vehicle without photo contributions or ownership documents. Role: %, Vehicle: %, User: %',
        NEW.role, NEW.vehicle_id, NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_contributor_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_images vi
    WHERE vi.vehicle_id = NEW.vehicle_id
    AND (vi.user_id = NEW.user_id OR vi.documented_by_user_id = NEW.user_id)
  ) THEN
    RAISE EXCEPTION 'Cannot add contributor without photo evidence on this vehicle. Vehicle: %, User: %',
      NEW.vehicle_id, NEW.user_id;
  END IF;
  RETURN NEW;
END;
$function$
;
