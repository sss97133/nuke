-- zip_to_fips: re-key three county codes that were renamed, so their ZIPs find a county again.
-- Found 2026-10-20 while placing eBay listings on the map: 244 zip_to_fips rows name a fips that is not in us_county_boundaries
-- (20261007210000 counted them). Three of those codes are plain renames of one county, so the target is certain:
--   12025 Dade County FL        -> 12086 Miami-Dade   (renamed 1997; 137 ZIPs, e.g. 33010)
--   46113 Shannon County SD     -> 46102 Oglala Lakota (renamed 2015; 7 ZIPs, e.g. 57716)
--   02270 Wade Hampton CA AK    -> 02158 Kusilvak      (renamed 2015; 11 ZIPs, e.g. 99554)
-- The other orphan codes are splits, merges or state-level placeholders, not renames (Alaska boroughs split, Bedford city
-- merged, '51000'-style state codes); they stay until each has a cited target. No vehicle_location_observations row carries a
-- retired code (checked 2026-10-20), so nothing else is re-keyed. The source column says what changed.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

UPDATE public.zip_to_fips z SET fips = m.new_fips, source = 'county_rename:' || m.old_fips || '->' || m.new_fips
FROM (VALUES ('12025', '12086'), ('46113', '46102'), ('02270', '02158')) AS m(old_fips, new_fips)
WHERE z.fips = m.old_fips AND EXISTS (SELECT 1 FROM public.us_county_boundaries c WHERE c.fips = m.new_fips);

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.zip_to_fips WHERE fips IN ('12025', '46113', '02270')) THEN
    RAISE EXCEPTION 'a renamed county code is still in zip_to_fips';
  END IF;
  IF (SELECT count(*) FROM public.zip_to_fips WHERE source LIKE 'county_rename:%') <> 155 THEN
    RAISE EXCEPTION 'expected 155 re-keyed ZIPs';
  END IF;
END $check$;
COMMIT;
