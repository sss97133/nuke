-- fix(vehicles): trim the 46 space-padded makes (run make_trim_v1_20261102). Normalizes whitespace only: it does
-- not create, merge or re-key vehicles. Every touched or skipped row is logged in vehicle_make_trim_log first
-- (nothing deleted), and scripts/vehicles/revert_make_trim_v1_20261102.sql restores make_before from that log.
--
-- Skipped (action = excluded_*, left padded, reported):
--   excluded_conflict         another non-merged vehicle already has the same short VIN and the trimmed make, so
--                             the trim would hit vehicles_vin_unique_short_v2 (that is a duplicate pair, not a
--                             whitespace problem; merging is out of scope here)
--   excluded_canonical_change make_canonical(trimmed) differs from make_canonical(padded)
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.vehicle_make_trim_log (
  run_id      text        NOT NULL,
  vehicle_id  uuid        NOT NULL,
  make_before text        NOT NULL,
  make_after  text        NOT NULL,
  action      text        NOT NULL CHECK (action IN ('trimmed', 'excluded_conflict', 'excluded_canonical_change')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  PRIMARY KEY (run_id, vehicle_id)
);
COMMENT ON TABLE public.vehicle_make_trim_log IS
  'Backup and audit of the one-time padded-make trim (run make_trim_v1_20261102). make_before is the exact original value.';
ALTER TABLE public.vehicle_make_trim_log ENABLE ROW LEVEL SECURITY;

-- Find the padded values with an index-only scan of idx_vehicles_make_year, then fetch their rows by equality
-- (about 0.6 s; a LIKE '% ' filter picks the trigram index instead and is far slower).
INSERT INTO public.vehicle_make_trim_log (run_id, vehicle_id, make_before, make_after, action)
WITH padded AS MATERIALIZED (
  SELECT make FROM public.vehicles WHERE make <> btrim(make) GROUP BY make
)
SELECT 'make_trim_v1_20261102', v.id, v.make, btrim(v.make),
  CASE
    WHEN v.vin IS NOT NULL AND length(v.vin) < 17 AND v.status IS DISTINCT FROM 'merged'
         AND EXISTS (SELECT 1 FROM public.vehicles w
                     WHERE w.vin = v.vin AND w.id <> v.id AND w.make = btrim(v.make)
                       AND w.status IS DISTINCT FROM 'merged')
      THEN 'excluded_conflict'
    WHEN (SELECT mc FROM public.make_canonical(v.make) mc)::text
         IS DISTINCT FROM (SELECT mc FROM public.make_canonical(btrim(v.make)) mc)::text
      THEN 'excluded_canonical_change'
    ELSE 'trimmed'
  END
FROM padded pm
JOIN public.vehicles v ON v.make = pm.make
WHERE btrim(v.make) <> ''
ON CONFLICT (run_id, vehicle_id) DO NOTHING;

UPDATE public.vehicles v
SET make = l.make_after
FROM public.vehicle_make_trim_log l
WHERE l.run_id = 'make_trim_v1_20261102'
  AND l.action = 'trimmed'
  AND l.reverted_at IS NULL
  AND v.id = l.vehicle_id
  AND v.make = l.make_before;

COMMIT;
