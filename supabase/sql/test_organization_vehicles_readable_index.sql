-- Empty disposable PG17 only:
--   createdb dm_refinement_ov_index; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_ov_index -f this-file.sql
-- Proves 20261126074500_organization_vehicles_readable_index.sql: it refuses before the backfill records done_at; then
-- it builds a valid partial index (organization_id, status) WHERE vehicle_readable; a re-run is a no-op; and under the
-- anon policy USING (vehicle_readable) the organization + status count is an index-only scan of it. Timings at scale
-- are in the migration header (PG17 scale model, 895,839 links).
-- Fixture: the shared profile fixture (live organization_vehicles columns), the predicate, 20261126071500, and
-- platform_config as read live on 2026-11-25.
\set ON_ERROR_STOP on
\ir helpers/get_vehicle_profile_data_fixture_20261125.sql
CREATE FUNCTION public.vehicle_publicly_readable(p_is_public boolean, p_deleted_at timestamptz, p_merged_into_vehicle_id uuid)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT coalesce(p_is_public, false) AND (p_deleted_at IS NULL OR p_merged_into_vehicle_id IS NOT NULL)
$function$;
CREATE TABLE public.platform_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text NOT NULL UNIQUE,
  config_value jsonb NOT NULL,
  description text,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
\ir ../migrations/20261126071500_organization_vehicles_vehicle_readable.sql
-- Made-up rows: 3 organizations, 2 cars (public, private), 6,000 links.
INSERT INTO public.vehicles (id, is_public, make, model, year) VALUES
  ('11111111-1111-4111-8111-111111111111', true, 'Fixture', 'Public', 1970),
  ('22222222-2222-4222-8222-222222222222', false, 'Fixture', 'Private', 1971);
INSERT INTO public.organization_vehicles (id, organization_id, vehicle_id, relationship_type, status, created_at)
SELECT md5('ov' || g)::uuid, md5('org' || (g % 3))::uuid,
       (ARRAY['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'])[1 + (g % 10 = 0)::int]::uuid,
       'r' || g, (ARRAY['active', 'sold', 'archived'])[1 + g % 3], now()
  FROM generate_series(1, 6000) g;

-- 1. Before the backfill is done the migration refuses and builds nothing.
INSERT INTO public.platform_config (config_key, config_value) VALUES ('org_vehicles_readable_backfill_state', '{"runs": 3}');
\set ON_ERROR_STOP off
\ir ../migrations/20261126074500_organization_vehicles_readable_index.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  ASSERT to_regclass('public.idx_org_vehicles_org_status_readable') IS NULL, '1 refused before done_at';
END $$;

-- 2. After done_at it builds a valid partial index; a re-run is a no-op.
UPDATE public.platform_config SET config_value = config_value || '{"done_at": "2026-11-26T00:00:00Z"}'
 WHERE config_key = 'org_vehicles_readable_backfill_state';
\ir ../migrations/20261126074500_organization_vehicles_readable_index.sql
\ir ../migrations/20261126074500_organization_vehicles_readable_index.sql
RESET statement_timeout;
RESET lock_timeout;
DO $$ BEGIN
  ASSERT (SELECT i.indisvalid AND pg_get_expr(i.indpred, i.indrelid) = 'vehicle_readable'
                 AND pg_get_indexdef(i.indexrelid) LIKE '%(organization_id, status)%'
            FROM pg_index i WHERE i.indexrelid = 'public.idx_org_vehicles_org_status_readable'::regclass),
    '2 valid partial index on (organization_id, status) WHERE vehicle_readable';
  ASSERT (SELECT count(*) FROM pg_index WHERE indexrelid = 'public.idx_org_vehicles_org_status_readable'::regclass) = 1, '2 one index';
END $$;

-- 3. Under anon's step-3 policy the organization + status count reads only this index.
ALTER TABLE public.organization_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY ov_anon_readable ON public.organization_vehicles FOR SELECT TO anon USING (vehicle_readable);
GRANT SELECT (id, organization_id, status, vehicle_readable) ON public.organization_vehicles TO anon;
VACUUM ANALYZE public.organization_vehicles;
SET enable_seqscan = off;
SET enable_bitmapscan = off;
CREATE FUNCTION pg_temp.plan(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE l text; o text := '';
BEGIN
  FOR l IN EXECUTE 'EXPLAIN (COSTS OFF) ' || q LOOP o := o || l || E'\n'; END LOOP;
  RETURN o;
END $$;
SET ROLE anon;
DO $$
DECLARE p text := pg_temp.plan(format('SELECT count(*) FROM public.organization_vehicles WHERE organization_id = %L AND status = %L',
                                      md5('org1')::uuid, 'active'));
BEGIN
  ASSERT p LIKE '%Index Only Scan using idx_org_vehicles_org_status_readable%', format('3 index-only on the new index: %s', p);
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.organization_vehicles WHERE organization_id = md5('org1')::uuid AND status = 'active'
            AND vehicle_readable) = (SELECT count(*) FROM public.organization_vehicles
                                      WHERE organization_id = md5('org1')::uuid AND status = 'active' AND vehicle_id = '11111111-1111-4111-8111-111111111111'),
    '3 the index holds exactly the readable links';
END $$;
SELECT 'PASS: idx_org_vehicles_org_status_readable is built after the backfill and serves anon''s count' AS result;
