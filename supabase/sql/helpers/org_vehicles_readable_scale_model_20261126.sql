-- Scale model behind 20261126074500's timings. Empty disposable PG17 only (a dm_refinement_* database):
--   createdb dm_refinement_ovidx; psql -X -d dm_refinement_ovidx -f this-file.sql
-- Builds 895,839 synthetic links, then times the two shapes as anon under four policy/index variants:
--   V0 live USING (true); V1 USING (vehicle_readable); V2 V1 + the partial index; V3 one OR policy + the index.
-- Measured 2026-11-26 on PG17.9 (laptop, warm): S1 18-20 ms in V0-V2, 37-44 ms in V3; S2 4.1-4.5 / 18.7-21.0 / 4.2-4.7 /
-- 17.3-18.0 ms. No production row.
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database only'; END IF; END $$;
-- Synthetic scale model of organization_vehicles (prod 2026-11-25: 895,839 rows, heap 165 MB; biggest org 21%,
-- ~181k active; top three ~51%; 94.5% of links on a publicly readable car in a 1/256 slice). No production row.
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE TABLE public.organization_contributors (id uuid PRIMARY KEY, organization_id uuid, user_id uuid, role text, status text);
CREATE INDEX ON public.organization_contributors (organization_id, user_id);
CREATE TABLE public.organization_vehicles (
  id uuid PRIMARY KEY, organization_id uuid, vehicle_id uuid, relationship_type text, status text,
  start_date date, end_date date, linked_by_user_id uuid, notes text, created_at timestamptz, updated_at timestamptz,
  listing_status text, days_on_lot int, sale_date date, vehicle_readable boolean);
INSERT INTO public.organization_vehicles
SELECT md5('ov'||g)::uuid,
       CASE WHEN g % 100 < 21 THEN 'aaaaaaaa-0000-4000-8000-000000000001'::uuid
            WHEN g % 100 < 36 THEN 'aaaaaaaa-0000-4000-8000-000000000002'::uuid
            WHEN g % 100 < 51 THEN 'aaaaaaaa-0000-4000-8000-000000000003'::uuid
            ELSE md5('org'||(g % 2000))::uuid END,
       md5('veh'||g)::uuid,
       (ARRAY['consigner','dealer','service_provider','owner'])[1 + g % 4],
       CASE WHEN g % 100 < 21 THEN (CASE WHEN g % 50 = 0 THEN 'sold' ELSE 'active' END)
            ELSE (ARRAY['active','active','active','sold','archived','pending'])[1 + g % 6] END,
       NULL, NULL, md5('u'||(g % 5000))::uuid, NULL,
       now() - (g % 900) * interval '1 day' - (g % 86400) * interval '1 second', now(),
       (ARRAY['for_sale','sold',NULL])[1 + g % 3], g % 90, NULL,
       (hashtext('r'||g) % 1000 + 1000) % 1000 < 945
  FROM generate_series(1, 895839) g;
CREATE INDEX idx_org_vehicles_org_status ON public.organization_vehicles (organization_id, status)
  WHERE status = ANY (ARRAY['active','sold','archived']);
CREATE INDEX idx_org_vehicles_listing_status ON public.organization_vehicles (organization_id, listing_status, created_at DESC);
CREATE INDEX idx_org_vehicles_org ON public.organization_vehicles (organization_id);
CREATE INDEX idx_org_vehicles_vehicle ON public.organization_vehicles (vehicle_id);
CREATE UNIQUE INDEX ON public.organization_vehicles (organization_id, vehicle_id, relationship_type);
GRANT SELECT ON public.organization_vehicles, public.organization_contributors TO anon, authenticated;
ALTER TABLE public.organization_vehicles ENABLE ROW LEVEL SECURITY;
VACUUM ANALYZE public.organization_vehicles;

\timing on

\echo '### V0 live USING (true)'
CREATE POLICY p_all ON public.organization_vehicles FOR SELECT USING (true);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
-- S1: org, 3 statuses, ORDER BY created_at DESC LIMIT 50
\o /dev/null
SELECT id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, listing_status, days_on_lot
  FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
SELECT id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, listing_status, days_on_lot
  FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
SELECT id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, listing_status, days_on_lot
  FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
-- S2: exact count, org + active
SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
\o
EXPLAIN (COSTS OFF) SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
EXPLAIN (COSTS OFF) SELECT id FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
RESET ROLE;

\echo '### V1 anon USING (vehicle_readable), no new index'
DROP POLICY p_all ON public.organization_vehicles;
CREATE POLICY p_anon ON public.organization_vehicles FOR SELECT TO anon USING (vehicle_readable);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
-- S1: org, 3 statuses, ORDER BY created_at DESC LIMIT 50
\o /dev/null
SELECT id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, listing_status, days_on_lot
  FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
SELECT id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, listing_status, days_on_lot
  FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
SELECT id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, listing_status, days_on_lot
  FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
-- S2: exact count, org + active
SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
\o
EXPLAIN (COSTS OFF) SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
EXPLAIN (COSTS OFF) SELECT id FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
RESET ROLE;

\echo '### V2 V1 + the partial index'
CREATE INDEX idx_org_vehicles_org_status_readable ON public.organization_vehicles (organization_id, status) WHERE vehicle_readable;
ANALYZE public.organization_vehicles;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
-- S1: org, 3 statuses, ORDER BY created_at DESC LIMIT 50
\o /dev/null
SELECT id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, listing_status, days_on_lot
  FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
SELECT id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, listing_status, days_on_lot
  FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
SELECT id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, listing_status, days_on_lot
  FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
-- S2: exact count, org + active
SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
\o
EXPLAIN (COSTS OFF) SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
EXPLAIN (COSTS OFF) SELECT id FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
RESET ROLE;

\echo '### V3 one OR policy + the partial index'
DROP POLICY p_anon ON public.organization_vehicles;
CREATE POLICY p_one ON public.organization_vehicles FOR SELECT USING (vehicle_readable OR ((SELECT auth.uid()) IS NOT NULL AND (linked_by_user_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.organization_contributors oc WHERE oc.organization_id = organization_vehicles.organization_id AND oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'))));
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
-- S1: org, 3 statuses, ORDER BY created_at DESC LIMIT 50
\o /dev/null
SELECT id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, listing_status, days_on_lot
  FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
SELECT id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, listing_status, days_on_lot
  FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
SELECT id, vehicle_id, relationship_type, status, start_date, end_date, sale_date, listing_status, days_on_lot
  FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
-- S2: exact count, org + active
SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
\o
EXPLAIN (COSTS OFF) SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'active';
EXPLAIN (COSTS OFF) SELECT id FROM public.organization_vehicles WHERE (status = 'active' OR status = 'sold' OR status = 'archived')
   AND organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 50;
RESET ROLE;
