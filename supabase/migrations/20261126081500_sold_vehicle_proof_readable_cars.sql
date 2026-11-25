-- sold_vehicle_proof_readable_cars_v1: the sold_vehicle_proof view lists a sold organization link only when the public
-- may read its car, or the caller manages the organization.
--
-- WHY. sold_vehicle_proof is an owner-run view (no security_invoker; owner postgres) that anon and authenticated select.
-- It reads organization_vehicles, vehicles, external_listings, timeline_events and data_validations as its owner, so no
-- policy of theirs applies: it returns the car's year, make, model and VIN, the link's notes, the car's sale timeline
-- event (title, description, amount) and the external listing's final price for every link with listing_status 'sold',
-- whatever the car's visibility. Live, read-only, 2026-11-25, in a 1/64 primary-key slice of organization_vehicles
-- ([10, 14) of 256): 44 of 529 sold links are on a car vehicle_publicly_readable() refuses. The web reader is the
-- organization page's sold inventory (SoldInventoryBrowser.tsx, filtered by organization_id).
--
-- WHAT. CREATE OR REPLACE VIEW from the live definition (md5 of pg_get_viewdef guarded), the same columns, with:
--   WHERE ov.listing_status = 'sold'
--     AND (vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id)
--          OR caller_manages_organization(ov.organization_id))
-- and security_barrier, so a caller's filter cannot be evaluated on rows the gate drops (a leakproof equality such as the
-- page's organization_id = $1 is still pushed into the scan). An organization's managers keep their own sold links, as
-- the view's sale_price column already allows them; that branch narrows to tied links when
-- organization_vehicle_link_grants() is live (#3971 family). Not mirrored here: timeline_events' restrictive
-- private-source policy (0 of the 11 live 'sale' events carry such a source, 2026-11-25).
-- CONTRACT: supabase/sql/test_sold_vehicle_proof_readable_cars.sql (PG17).
-- REVERSAL: CREATE OR REPLACE VIEW from the 2026-11-25 definition kept in that test, then RESET (security_barrier).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $edit$
DECLARE
  d text := pg_get_viewdef('public.sold_vehicle_proof'::regclass);
  a text := E'  WHERE (ov.listing_status = ''sold''::text);';
  r text := E'  WHERE ov.listing_status = ''sold''::text\n'
         || E'    -- sold_vehicle_proof_readable_cars_v1\n'
         || E'    AND (public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id)\n'
         || E'         OR public.caller_manages_organization(ov.organization_id))';
BEGIN
  IF to_regprocedure('public.vehicle_publicly_readable(boolean,timestamp with time zone,uuid)') IS NULL
     OR to_regprocedure('public.caller_manages_organization(uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_publicly_readable or caller_manages_organization is missing';
  END IF;
  IF position('vehicle_publicly_readable(' IN d) > 0 THEN
    RAISE NOTICE 'sold_vehicle_proof_readable_cars_v1 already applied';
    RETURN;
  END IF;
  IF md5(d) <> '19a5c9e59fae46625eb706a434b3f12a' THEN -- gitleaks:allow (view definition hash read 2026-11-25, not a secret)
    RAISE EXCEPTION 'sold_vehicle_proof changed since 2026-11-25 (md5 %); review first', md5(d);
  END IF;
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION 'the WHERE anchor does not occur exactly once';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.sold_vehicle_proof WITH (security_barrier = true) AS ' || replace(d, a, r);
END
$edit$;

DO $check$
DECLARE d text := pg_get_viewdef('public.sold_vehicle_proof'::regclass);
BEGIN
  IF position('vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id)' IN d) = 0
     OR position('caller_manages_organization(ov.organization_id)' IN d) = 0
     OR NOT coalesce((SELECT 'security_barrier=true' = ANY (c.reloptions) FROM pg_class c
                       WHERE c.oid = 'public.sold_vehicle_proof'::regclass), false)
     OR NOT has_table_privilege('anon', 'public.sold_vehicle_proof', 'SELECT') THEN
    RAISE EXCEPTION 'sold_vehicle_proof not as intended';
  END IF;
END
$check$;
COMMIT;
