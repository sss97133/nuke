-- auto_tag_organization_from_gps turns a located photo into a pending proposal, never an active organization link.
--
-- Measured 2026-10-15 (read-only, scripts/data/q.sh). The trigger on vehicle_images (AFTER INSERT OR UPDATE OF latitude,
-- longitude) took the single nearest of every organization with coordinates (2,285 of 5,734, read through the
-- businesses view by random heap fetches over 4,895 pages) within 500 m, and upserted an ACTIVE organization_vehicles
-- work_location row, auto_tagged. Nothing limited it to the photographer's organizations, broke a tie or read a
-- rejection. Three of the owner's organizations sit within 60 m of each other at one address, so the pick there was
-- arbitrary: of the 131 vehicles his filed photos are on, 58 carry work_location links to two or more organizations,
-- 0 links are user-confirmed, and 5 (vehicle, organization, relationship) triples he rejected in
-- pending_vehicle_assignments in Nov-Dec 2025 are active again. Table-wide, 264 organization_vehicles rows are active
-- auto_tagged work_location links; 243 of them are on vehicles he photographed or holds.
--
-- After: GPS is evidence, and the owner's Sign makes the link (.claude/rules/liveness-and-intent.md, rule 2). A photo
-- with a vehicle, a photographer and coordinates, not superseded and not rejected by the vision gate, proposes
-- work_location for at most one organization:
-- - candidates are the organizations the photographer actively contributes to (organization_contributors; a
--   membership with an end_date covers only photos taken by then), at their organization_locations points, or at the
--   organizations row's coordinates when the organization has no located point, within 150 m of the photo;
-- - nothing when there is no candidate, or when the site is shared: another candidate within 150 m of the photo or of
--   the point it matched (a shared site names a place, not an organization; the second test catches a photo at the
--   far edge of a shared lot, as 2 of one truck's 85 member photos at 707 Yucca were in the 2026-10-15 review);
-- - nothing when the owner already decided the triple: a rejected or approved pending_vehicle_assignments row, or an
--   organization_vehicles row with user_rejected or user_confirmed;
-- - nothing when the photographer's holding of the vehicle is on record (vehicle_ownerships) and taken_at falls outside
--   every window of it, or taken_at is unknown;
-- - otherwise one pending_vehicle_assignments row (status pending; evidence gps and user_org_membership; the photo,
--   location and distance in confidence_breakdown). That is the table suggest_vehicle_organization_assignments fills
--   and the Dashboard lists, and approve_pending_assignment is the step that makes it an organization_vehicles row.
-- It writes no organization_vehicles row. It does not call suggest_vehicle_organization_assignments, which reads every
-- public organization per call and itself writes an active link at 80% confidence.
--
-- Cost per row: rows without a vehicle, a photographer or coordinates return before any read. Otherwise one read of
-- organization_contributors (11 rows) and, for a member, organization_locations by organization_id (the index below;
-- the table has 4,593 rows and no such index), then index probes of pending_vehicle_assignments, organization_vehicles
-- and vehicle_ownerships. Repeat photos of one triple update the pending row only when they are closer. 150 m is the
-- radius user_sites and known_places give a site.
--
-- Existing organization_vehicles rows are not touched here: scripts/org-tagging/review-gps-org-links.mjs lists the
-- ones this rule would not have made. The function is replaced only from its 2026-10-15 source (sha256 of
-- pg_get_functiondef); any other source stops the migration. Contract: supabase/sql/test_gps_org_tag_proposes_pending.sql.
-- definer-grants: default reviewed auto_tag_organization_from_gps: a trigger function, which cannot be called directly; CREATE OR REPLACE keeps its grants and none are changed here
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

DO $guard$
DECLARE
  v_def text := pg_get_functiondef(to_regprocedure('public.auto_tag_organization_from_gps()'));
BEGIN
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.auto_tag_organization_from_gps() does not exist';
  END IF;
  IF encode(sha256(convert_to(v_def, 'UTF8')), 'base64') IS DISTINCT FROM 'RUfXPvoaxxbeLWgqmOhEwCtGYy2N0d29o6OO2qLWiOQ='
     AND v_def NOT LIKE '%c_radius_m%' THEN
    RAISE EXCEPTION 'auto_tag_organization_from_gps is not the 2026-10-15 source this migration was written from (sha256 %); re-read it',
      encode(sha256(convert_to(v_def, 'UTF8')), 'base64');
  END IF;
END
$guard$;

CREATE INDEX IF NOT EXISTS idx_org_locations_organization_id ON public.organization_locations (organization_id);

CREATE OR REPLACE FUNCTION public.auto_tag_organization_from_gps()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_radius_m CONSTANT double precision := 150;
  v_lat double precision;
  v_lon double precision;
  v_day date;
  v_shared boolean;
  v_org uuid;
  v_location uuid;
  v_dist double precision;
  v_confidence numeric;
BEGIN
  -- organization_images rows carry no vehicle; read no vehicle_images field before this.
  IF TG_TABLE_NAME <> 'vehicle_images' THEN
    RETURN NEW;
  END IF;
  IF NEW.vehicle_id IS NULL OR NEW.user_id IS NULL OR NEW.latitude IS NULL OR NEW.longitude IS NULL
     OR coalesce(NEW.is_superseded, false)
     OR NEW.vision_gate_status IN ('rejected_personal', 'rejected_misattributed') THEN
    RETURN NEW;
  END IF;
  v_lat := NEW.latitude;
  v_lon := NEW.longitude;
  v_day := NEW.taken_at::date;

  -- The photographer's organizations within the radius: their located points, or the organization's own coordinates
  -- when it has none.
  WITH points AS (
    SELECT oc.organization_id, l.id AS location_id, l.latitude::double precision AS lat, l.longitude::double precision AS lon
    FROM organization_contributors oc
    JOIN organization_locations l ON l.organization_id = oc.organization_id
    WHERE oc.user_id = NEW.user_id
      AND coalesce(oc.status, 'active') = 'active'
      AND (oc.end_date IS NULL OR v_day <= oc.end_date)
      AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
    UNION ALL
    SELECT oc.organization_id, NULL, o.latitude::double precision, o.longitude::double precision
    FROM organization_contributors oc
    JOIN organizations o ON o.id = oc.organization_id
    WHERE oc.user_id = NEW.user_id
      AND coalesce(oc.status, 'active') = 'active'
      AND (oc.end_date IS NULL OR v_day <= oc.end_date)
      AND o.latitude IS NOT NULL AND o.longitude IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM organization_locations l
                      WHERE l.organization_id = oc.organization_id AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL)
  ), near AS (
    SELECT p.organization_id, p.location_id, p.lat, p.lon, d.m
    FROM points p
    CROSS JOIN LATERAL (SELECT 2 * 6371008.8 * asin(least(1, sqrt(
      power(sin(radians(p.lat - v_lat) / 2), 2)
      + cos(radians(v_lat)) * cos(radians(p.lat)) * power(sin(radians(p.lon - v_lon) / 2), 2)))) AS m) d
    WHERE abs(p.lat - v_lat) < 0.01 AND d.m <= c_radius_m
  ), pick AS (
    SELECT * FROM near ORDER BY m LIMIT 1
  )
  -- Shared: another of his organizations within the radius of the photo, or of the point it matched (a photo at the
  -- far edge of a shared lot is still at that lot).
  SELECT (SELECT count(DISTINCT organization_id) FROM near) > 1
         OR EXISTS (SELECT 1 FROM points p CROSS JOIN LATERAL (SELECT 2 * 6371008.8 * asin(least(1, sqrt(
                      power(sin(radians(p.lat - pick.lat) / 2), 2)
                      + cos(radians(pick.lat)) * cos(radians(p.lat)) * power(sin(radians(p.lon - pick.lon) / 2), 2)))) AS m) d
                    WHERE p.organization_id <> pick.organization_id AND abs(p.lat - pick.lat) < 0.01 AND d.m <= c_radius_m),
         pick.organization_id, pick.location_id, pick.m
  INTO v_shared, v_org, v_location, v_dist
  FROM pick;

  -- No candidate, or a site several of them share.
  IF v_org IS NULL OR v_shared THEN
    RETURN NEW;
  END IF;

  -- The owner already decided this triple.
  IF EXISTS (SELECT 1 FROM pending_vehicle_assignments r
             WHERE r.vehicle_id = NEW.vehicle_id AND r.organization_id = v_org
               AND r.suggested_relationship_type = 'work_location' AND r.status IN ('rejected', 'approved'))
     OR EXISTS (SELECT 1 FROM organization_vehicles ov
                WHERE ov.organization_id = v_org AND ov.vehicle_id = NEW.vehicle_id AND ov.relationship_type = 'work_location'
                  AND (coalesce(ov.user_rejected, false) OR coalesce(ov.user_confirmed, false))) THEN
    RETURN NEW;
  END IF;

  -- When the photographer's holding of this vehicle is on record, the photo must fall inside it.
  IF EXISTS (SELECT 1 FROM vehicle_ownerships w WHERE w.vehicle_id = NEW.vehicle_id AND w.owner_profile_id = NEW.user_id)
     AND NOT EXISTS (SELECT 1 FROM vehicle_ownerships w
                     WHERE w.vehicle_id = NEW.vehicle_id AND w.owner_profile_id = NEW.user_id
                       AND v_day >= coalesce(w.start_date, v_day) AND v_day <= coalesce(w.end_date, v_day)) THEN
    RETURN NEW;
  END IF;

  v_confidence := round(greatest(0, least(100, (1 - v_dist / c_radius_m) * 100))::numeric, 2);
  INSERT INTO pending_vehicle_assignments (
    vehicle_id, organization_id, suggested_relationship_type, overall_confidence, confidence_breakdown,
    evidence_sources, evidence_count, suggested_by_system, suggested_by_user_id, status, auto_approve_threshold
  )
  VALUES (
    NEW.vehicle_id, v_org, 'work_location', v_confidence,
    jsonb_build_object(
      'gps', v_confidence,
      'user_org_membership', 100,
      'gps_evidence', jsonb_build_object(
        'image_id', NEW.id, 'organization_location_id', v_location, 'distance_m', round(v_dist::numeric, 1),
        'radius_m', c_radius_m, 'taken_at', NEW.taken_at,
        'rule', 'the only organization of the photographer within the radius')),
    ARRAY['gps', 'user_org_membership'], 2, true, NEW.user_id, 'pending', NULL
  )
  ON CONFLICT ON CONSTRAINT pending_vehicle_assignments_vehicle_id_organization_id_sugg_key
  DO UPDATE SET
    overall_confidence = EXCLUDED.overall_confidence,
    confidence_breakdown = EXCLUDED.confidence_breakdown,
    updated_at = now()
  WHERE pending_vehicle_assignments.overall_confidence < EXCLUDED.overall_confidence;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.auto_tag_organization_from_gps() IS
  'Trigger on vehicle_images (and organization_images, where it does nothing). A located photo of a vehicle proposes '
  'work_location for the one organization of the photographer within 150 m, as a pending_vehicle_assignments row for '
  'the owner to approve or reject. Proposes nothing at a site two of his organizations share, for a triple the owner '
  'decided, or outside his recorded holding of the vehicle. Writes no organization_vehicles row (2026-10-15).';

COMMIT;
