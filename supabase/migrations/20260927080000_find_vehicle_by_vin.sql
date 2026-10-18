-- find_vehicle_by_vin(): the reader's VIN lookup, written for the index that exists.
-- Session cb179857 / bat-to-db, 2026-09-27.
--
-- WHY (measured with the phase timings of 5bfef8d34, 18:09–18:11Z, three new BaT lots): resolve_vehicle
-- took 16.0 s, 60.5 s and 26.9 s of 33.9 s, 66.0 s and 33.5 s total. For a lot prod never had, the
-- three URL lookups miss on their indexes and the reader then runs `vin = $1 LIMIT 1`. EXPLAIN on prod:
-- Parallel Seq Scan on vehicles (cost 316K) — the only plain-vin indexes are partial
-- (vehicles_vin_unique_17char_v2 needs length(vin) = 17 in the query, vehicles_vin_unique_short_v2 is
-- on (vin, make)), and the two expression indexes are on upper(vin) / upper(btrim(vin)). A plain
-- `vin = $1` matches none of them, so every new lot pays a 920K-row scan under write load.
-- Written as upper(btrim(vin)) = upper(btrim($1)) the same lookup is an Index Scan on
-- idx_vehicles_vin_norm_trim (EXPLAIN on prod, 18:13Z) and returns in milliseconds.
--
-- SCHEMA_LAW §1: no new index (four VIN indexes exist; this uses one of them); §4 read-only function;
-- §7 CI-applied. The reader (extract-bat-core) calls this instead of the column filter and keeps the
-- old query as a loud fallback if the function is missing.

CREATE OR REPLACE FUNCTION public.find_vehicle_by_vin(p_vin text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id
  FROM vehicles
  WHERE upper(btrim(vin)) = upper(btrim(p_vin))
    AND deleted_at IS NULL
  ORDER BY (status IS DISTINCT FROM 'merged') DESC, created_at ASC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.find_vehicle_by_vin(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.find_vehicle_by_vin(text) IS
  'The live vehicle for a VIN, case/space-insensitive, via idx_vehicles_vin_norm_trim (upper(btrim(vin))); unmerged rows first. Replaces the reader''s `vin = $1` filter, which no index served (Parallel Seq Scan, 16–60 s per new lot on 2026-09-27).';

-- Live verification (after apply):
--   explain select find_vehicle_by_vin('1GCEK14L9EJ147915');  -- and the inner plan: Index Scan using idx_vehicles_vin_norm_trim
--   select find_vehicle_by_vin('1GCEK14L9EJ147915');          -- 6442df03-9cac-43a8-b89e-e4fb4c08ee99 (the White K10)
