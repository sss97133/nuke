-- Live definitions on 2026-10-15 (pg_get_functiondef, base64 sha256 of it), test fixture only:
-- auto_tag_organization_from_gps() RUfXPvoaxxbeLWgqmOhEwCtGYy2N0d29o6OO2qLWiOQ=, the source
-- 20261016203000_gps_org_tag_proposes_pending.sql replaces; approve_pending_assignment(uuid,uuid,text)
-- /JEu8T7lFdOxpDyRhF4HiLGZuSbGZy2KvJ0DJBlsM0E=, the owner's Sign that turns a proposal into a link (not changed).
CREATE OR REPLACE FUNCTION public.auto_tag_organization_from_gps()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  nearby_org RECORD;
  distance_km NUMERIC;
  target_vehicle_id UUID;
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    IF TG_TABLE_NAME = 'vehicle_images' THEN
      target_vehicle_id := NEW.vehicle_id;
    ELSIF TG_TABLE_NAME = 'organization_images' THEN
      target_vehicle_id := NULL;
    END IF;
    
    IF target_vehicle_id IS NOT NULL THEN
      FOR nearby_org IN
        SELECT 
          id, business_name, latitude, longitude,
          ST_Distance(
            ST_MakePoint(longitude, latitude)::geography,
            ST_MakePoint(NEW.longitude, NEW.latitude)::geography
          ) / 1000.0 AS dist_km
        FROM businesses
        WHERE latitude IS NOT NULL 
          AND longitude IS NOT NULL
          AND ST_DWithin(
            ST_MakePoint(longitude, latitude)::geography,
            ST_MakePoint(NEW.longitude, NEW.latitude)::geography,
            500
          )
        ORDER BY dist_km ASC
        LIMIT 1
      LOOP
        INSERT INTO organization_vehicles (
          organization_id, vehicle_id, relationship_type,
          auto_tagged, gps_match_confidence, linked_by_user_id
        )
        VALUES (
          nearby_org.id, target_vehicle_id, 'work_location',
          true,
          GREATEST(0, LEAST(100, (1 - (nearby_org.dist_km / 0.5)) * 100)),
          NEW.user_id
        )
        ON CONFLICT (organization_id, vehicle_id, relationship_type) 
        DO UPDATE SET
          gps_match_confidence = GREATEST(
            organization_vehicles.gps_match_confidence,
            GREATEST(0, LEAST(100, (1 - (nearby_org.dist_km / 0.5)) * 100))
          ),
          auto_tagged = true,
          updated_at = NOW();
      END LOOP;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.approve_pending_assignment(p_assignment_id uuid, p_user_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_assignment RECORD;
BEGIN
  -- P3.7 identity check (2026-09-27): the caller acts as themself (p_user_id = auth.uid()) and is an active contributor of the assignment's organization, or an admin. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() OR NOT (public.is_admin_or_moderator() OR EXISTS (SELECT 1 FROM public.pending_vehicle_assignments pa JOIN public.organization_contributors oc ON oc.organization_id = pa.organization_id WHERE pa.id = p_assignment_id AND oc.user_id = auth.uid() AND coalesce(oc.status, 'active') = 'active')) THEN
      RAISE EXCEPTION 'approve_pending_assignment: only a contributor of that organization (acting as themself) can approve' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Get assignment
  SELECT * INTO v_assignment
  FROM pending_vehicle_assignments
  WHERE id = p_assignment_id
    AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found or already processed';
  END IF;
  
  -- Create organization_vehicles record
  INSERT INTO organization_vehicles (
    organization_id,
    vehicle_id,
    relationship_type,
    auto_tagged,
    gps_match_confidence,
    linked_by_user_id,
    status
  )
  VALUES (
    v_assignment.organization_id,
    v_assignment.vehicle_id,
    v_assignment.suggested_relationship_type,
    true,
    v_assignment.overall_confidence,
    p_user_id,
    'active'
  )
  ON CONFLICT (organization_id, vehicle_id, relationship_type)
  DO UPDATE SET
    gps_match_confidence = GREATEST(
      organization_vehicles.gps_match_confidence,
      v_assignment.overall_confidence
    ),
    auto_tagged = true,
    status = 'active',
    updated_at = NOW();
  
  -- Update assignment status
  UPDATE pending_vehicle_assignments
  SET 
    status = 'approved',
    reviewed_by_user_id = p_user_id,
    reviewed_at = NOW(),
    review_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_assignment_id;
  
  RETURN true;
END;
$function$

;
