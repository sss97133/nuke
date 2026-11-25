-- market_source_landing_readable_cars_v1: market_source_landing_read reads a car's attributes only when the public may
-- read the car, and its dealer-organization fallback lists only links on such a car, priced from the car.
--
-- WHY. market_source_landing_read(text, timestamptz) is SECURITY DEFINER and anon may execute it. When a source has no
-- recent events, it falls back to the 40 newest organization_vehicles links of each dealer or shop organization behind
-- the source, joins vehicles for year, make, model, trim, VIN and mileage, and returns coalesce(ov.sale_price,
-- ov.asking_price) as price. Nothing tests the car, and anon holds no grant on organization_vehicles.asking_price or
-- sale_price (a dealer's books). Live, read-only, 2026-11-25: 36 dealer organizations, 1,440 fallback rows; 123 of them on
-- a car vehicle_publicly_readable() refuses (9 with a VIN), 21 with a link price. Its two event paths (vehicle_events,
-- public-read) join vehicles the same way for year, make, model, trim, VIN and mileage: of the 5,185 events landed in the
-- 24 hours to 2026-11-25, 17 point at an unreadable car, 6 of those cars with a VIN.
--
-- WHAT. An anchored edit of the live definition (20261021004000; live prosrc sha256 below, equal to that file's body):
--   * the three LEFT JOINs of vehicles (one per path) join only a car vehicle_publicly_readable() passes; an event on
--     any other car keeps its own testimony (price, metadata VIN, URL) and shows no car attributes;
--   * inside the per-organization LIMIT 40: AND EXISTS (the car passes vehicle_publicly_readable), so the 40 are 40
--     readable cars, not fewer;
--   * 'price' := coalesce(v.sale_price, v.asking_price), the car's own columns, which anon may read.
-- Each anchor must occur exactly once; the marker makes a re-run a no-op. CREATE OR REPLACE keeps the owner and ACL.
-- CONTRACT: supabase/sql/test_market_source_landing_readable_cars.sql (PG17).
-- REVERSAL: re-apply 20261021004000_market_source_window_starts_at_first_bar.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $edit$
DECLARE
  f regprocedure := to_regprocedure('public.market_source_landing_read(text,timestamp with time zone)');
  src text;
  def text;
  a1 text := E'              WHERE ov.organization_id = d.org_id\n';
  r1 text := E'              WHERE ov.organization_id = d.org_id\n'
          || E'                -- market_source_landing_readable_cars_v1: only links on a car the public may read\n'
          || E'                AND EXISTS (SELECT 1 FROM public.vehicles vr WHERE vr.id = ov.vehicle_id\n'
          || E'                            AND public.vehicle_publicly_readable(vr.is_public, vr.deleted_at, vr.merged_into_vehicle_id))\n';
  a2 text := E'''price'', coalesce(m.sale_price, m.asking_price),';
  r2 text := E'''price'', coalesce(v.sale_price, v.asking_price),';
  a3 text := 'LEFT JOIN public.vehicles v ON v.id = e.vehicle_id';
  r3 text := 'LEFT JOIN public.vehicles v ON v.id = e.vehicle_id'
          || ' AND public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id)';
  a4 text := 'LEFT JOIN public.vehicles v ON v.id = m.vehicle_id';
  r4 text := 'LEFT JOIN public.vehicles v ON v.id = m.vehicle_id'
          || ' AND public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id)';
BEGIN
  IF f IS NULL THEN
    RAISE EXCEPTION 'market_source_landing_read(text, timestamptz) is missing';
  END IF;
  IF to_regprocedure('public.vehicle_publicly_readable(boolean,timestamp with time zone,uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_publicly_readable(boolean, timestamptz, uuid) is missing';
  END IF;
  SELECT p.prosrc INTO src FROM pg_proc p WHERE p.oid = f;
  IF position('market_source_landing_readable_cars_v1' IN src) > 0 THEN
    RAISE NOTICE 'market_source_landing_readable_cars_v1 already applied';
    RETURN;
  END IF;
  IF encode(sha256(convert_to(src, 'UTF8')), 'hex')
     <> 'c894e6b864125586d39519b7e66720d2ce7a2b1dbddfd145d31f5dca8f0e09e8' THEN -- gitleaks:allow (function body hash read 2026-11-25, not a secret)
    RAISE EXCEPTION 'market_source_landing_read changed since 2026-11-25; review first';
  END IF;
  IF (length(src) - length(replace(src, a1, ''))) / length(a1) <> 1
     OR (length(src) - length(replace(src, a2, ''))) / length(a2) <> 1
     OR (length(src) - length(replace(src, a3, ''))) / length(a3) <> 1
     OR (length(src) - length(replace(src, a4, ''))) / length(a4) <> 2 THEN
    RAISE EXCEPTION 'an anchor does not occur the expected number of times';
  END IF;
  def := replace(replace(replace(replace(pg_get_functiondef(f), a1, r1), a2, r2), a3, r3), a4, r4);
  EXECUTE def;
END
$edit$;

DO $check$
DECLARE src text := (SELECT p.prosrc FROM pg_proc p
                      WHERE p.oid = 'public.market_source_landing_read(text,timestamp with time zone)'::regprocedure);
BEGIN
  IF position('market_source_landing_readable_cars_v1' IN src) = 0
     OR position('public.vehicle_publicly_readable(vr.is_public, vr.deleted_at, vr.merged_into_vehicle_id)' IN src) = 0
     OR position('coalesce(m.sale_price, m.asking_price)' IN src) > 0
     OR (length(src) - length(replace(src, 'v.id = e.vehicle_id AND public.vehicle_publicly_readable(', '')))
        / length('v.id = e.vehicle_id AND public.vehicle_publicly_readable(') <> 1
     OR (length(src) - length(replace(src, 'v.id = m.vehicle_id AND public.vehicle_publicly_readable(', '')))
        / length('v.id = m.vehicle_id AND public.vehicle_publicly_readable(') <> 2 THEN
    RAISE EXCEPTION 'market_source_landing_read not as intended';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.market_source_landing_read(text,timestamp with time zone)'::regprocedure) THEN
    RAISE EXCEPTION 'market_source_landing_read lost SECURITY DEFINER';
  END IF;
END
$check$;

-- The body now restates the vehicles read rule (vehicle_publicly_readable is vehicles_public_select plus the deleted
-- test): register the copy so the hourly exposure watch fails when the vehicles read policies change (as 20261125220000).
DO $reg$
DECLARE h text;
BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    IF to_regprocedure('public.private_row_policy_hash(text,text)') IS NOT NULL THEN
      EXECUTE $q$SELECT h.policy_hash FROM public.private_row_policy_hash('vehicles', 'p.cmd IN (''SELECT'', ''ALL'')') h$q$
         INTO h;
      IF h IS DISTINCT FROM '7773d11e280e80abad0422000a1ff9cc' THEN -- gitleaks:allow (policy fingerprint read 2026-11-25, not a secret)
        RAISE EXCEPTION 'the vehicles read policies changed since 2026-11-25 (md5 %); re-read the copy first', h;
      END IF;
    END IF;
    EXECUTE $i$INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
      VALUES ('market_source_landing_read(text,timestamp with time zone)', 'vehicles', 'p.cmd IN (''SELECT'', ''ALL'')',
              '7773d11e280e80abad0422000a1ff9cc', 'ta-provenance',
              '20261126080000 restates vehicles_public_select (and the deleted test) as vehicle_publicly_readable on its three vehicles joins and the dealer fallback')
      ON CONFLICT (reader, relation, policy_filter) DO NOTHING$i$;
  END IF;
END $reg$;
COMMIT;
