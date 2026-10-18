-- Actual migrations, synthetic fixtures only. Never run in production.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_org_activity_%' OR to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_org_activity_* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END $$;
CREATE TABLE public.businesses(id uuid PRIMARY KEY, is_public boolean NOT NULL DEFAULT false);
\ir ../migrations/20260214100000_organization_seller_stats.sql
ALTER TABLE public.businesses RENAME TO organizations;
CREATE TABLE public.vehicle_events(id uuid PRIMARY KEY, vehicle_id uuid,
  source_organization_id uuid REFERENCES public.organizations, source_platform text,
  source_url text, source_listing_id text, event_status text, final_price numeric,
  bid_count int, comment_count int, view_count int, started_at timestamptz,
  created_at timestamptz DEFAULT now(), extracted_at timestamptz DEFAULT now(), metadata jsonb DEFAULT '{}');
CREATE INDEX idx_vehicle_events_source_org ON public.vehicle_events(source_organization_id);
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,is_public boolean,deleted_at timestamptz);
CREATE TABLE public.organization_vehicles(organization_id uuid,vehicle_id uuid,hidden_from_public boolean,user_rejected boolean);
CREATE INDEX org_vehicle_visibility ON public.organization_vehicles(organization_id,vehicle_id);
CREATE TABLE public.pipeline_registry(table_name text, column_name text, owned_by text, description text,
  do_not_write_directly boolean, write_via text, UNIQUE(table_name,column_name));
ALTER TABLE public.organization_seller_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_cache ON public.organization_seller_stats FOR ALL TO service_role USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated;
GRANT SELECT ON public.organizations, public.vehicle_events, public.vehicles, public.organization_vehicles TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.organization_seller_stats TO service_role;
\ir ../migrations/20261011032252_organization_listing_activity_fold.sql
-- Reapply the actual migration to verify idempotent DDL and permissions.
\ir ../migrations/20261011032252_organization_listing_activity_fold.sql
\ir ../migrations/20261011054710_organization_activity_candidate_probe.sql
\ir ../migrations/20261011054710_organization_activity_candidate_probe.sql
CREATE FUNCTION public.fixture_uid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO public.organizations VALUES (fixture_uid(1),true),(fixture_uid(2),true),(fixture_uid(3),false),(fixture_uid(4),true);
INSERT INTO public.organizations SELECT fixture_uid(n),true FROM generate_series(5,8)n;
INSERT INTO public.vehicles VALUES (fixture_uid(99999),true,NULL),(fixture_uid(90),true,NULL),(fixture_uid(91),true,NULL),
 (fixture_uid(92),false,NULL),(fixture_uid(93),true,now()),(fixture_uid(94),true,NULL),(fixture_uid(95),true,NULL);
INSERT INTO public.organization_vehicles VALUES (fixture_uid(2),fixture_uid(94),true,false),(fixture_uid(2),fixture_uid(95),false,true);
INSERT INTO public.organization_vehicles VALUES (fixture_uid(7),fixture_uid(94),true,false),(fixture_uid(8),fixture_uid(95),false,true);
INSERT INTO public.vehicle_events(id,vehicle_id,source_organization_id,source_platform,source_url,event_status)
SELECT fixture_uid(90000+n),fixture_uid(87+n),fixture_uid(n),'fixture','https://fixture.example/excluded/'||n,'sold'
FROM generate_series(5,8)n;
-- Every episode uses the same vehicle: organization volume must not collapse
-- to a vehicle count or silently stop at the old 1,000/5,000 client limits.
INSERT INTO public.vehicle_events(id,vehicle_id,source_organization_id,source_platform,source_url,event_status,final_price,metadata,started_at)
SELECT fixture_uid(100+n),fixture_uid(99999),fixture_uid(1),'fixture',
  'https://fixture.example/lot/'||n,'sold',1,'{"currency":"USD"}','2025-01-01'
FROM generate_series(1,6001)n;
INSERT INTO public.vehicle_events(id,vehicle_id,source_organization_id,source_platform,source_url,source_listing_id,event_status,final_price,metadata,bid_count)
SELECT fixture_uid(7000+n),fixture_uid(v),fixture_uid(2),'fixture',url,native,status,price,meta::jsonb,bids
FROM (VALUES
 (1,90,'https://fixture.example/a','a','sold',10,'{"currency":"USD"}',0),
 (2,90,'https://fixture.example/a','a','sold',10,'{"currency":"USD"}',NULL),
 (3,90,'https://fixture.example/b','b','sold',20,'{"currency":"GBP"}',4),
 (4,90,'https://fixture.example/c','c','sold',30,'{}',NULL),
 (5,90,'https://fixture.example/d','d','ended',NULL,'{}',NULL),
 (6,90,'https://fixture.example/e','e','ended',NULL,'{"reserve_status":"reserve_not_met"}',NULL),
 (7,90,NULL,NULL,'sold',999,'{"currency":"USD"}',NULL),
 (8,90,'https://fixture.example/f','f','sold',40,'{"currency":"USD"}',NULL),
 (9,90,'https://fixture.example/f','f','sold',50,'{"currency":"USD"}',NULL),
 (10,90,'https://fixture.example/g','g','sold',60,'{"currency":"USD"}',NULL),
 (11,90,'https://fixture.example/g','g','ended',60,'{"currency":"USD"}',NULL),
 (12,90,'https://fixture.example/h','h1','sold',70,'{"currency":"USD"}',NULL),
 (13,91,'https://fixture.example/h','h2','sold',70,'{"currency":"USD"}',NULL),
 (14,90,'https://fixture.example/i','i','cancelled',NULL,'{}',NULL),
 (15,90,NULL,'native-only','active',NULL,'{}',NULL),
 (16,90,'https://fixture.example/j','j','sold',80,'{"currency":"USD"}',NULL),
 (17,90,'https://fixture.example/j','j','sold',80,'{"currency":"GBP"}',NULL)
)f(n,v,url,native,status,price,meta,bids);
INSERT INTO public.vehicle_events(id,vehicle_id,source_organization_id,source_platform,source_url,event_status,final_price,metadata)
VALUES (fixture_uid(8000),fixture_uid(90),fixture_uid(3),'fixture','https://fixture.example/private-org','sold',100,'{"currency":"USD"}');
-- A public organization cannot publish private/deleted vehicle contributions or
-- an association the owner hid/rejected, including through aggregate amounts.
INSERT INTO public.vehicle_events(id,vehicle_id,source_organization_id,source_platform,source_url,event_status,final_price,metadata)
SELECT fixture_uid(8000+n),fixture_uid(91+n),fixture_uid(2),'fixture',
 'https://fixture.example/excluded/'||n,'sold',100000*n,'{"currency":"USD"}' FROM generate_series(1,4)n;
CREATE TABLE public.fixture_fingerprint AS SELECT md5(string_agg(to_jsonb(e)::text,'' ORDER BY id)) hash FROM public.vehicle_events e;
SET ROLE service_role;
SELECT public.compute_organization_listing_activity(public.fixture_uid(1));
SELECT public.compute_organization_listing_activity(public.fixture_uid(2));
SELECT public.compute_organization_listing_activity(public.fixture_uid(3));
SELECT public.compute_organization_listing_activity(public.fixture_uid(4));
RESET ROLE;
DO $$ DECLARE a jsonb; b jsonb; BEGIN
 SELECT evidence_summary INTO a FROM public.organization_seller_stats WHERE organization_id=fixture_uid(1);
 ASSERT (a->>'total_listings')::int=6001 AND (a->>'input_rows')::int=6001,'Full indexed population beyond both client limits';
 ASSERT (a->>'total_sold')::int=6001 AND (a->>'sell_through_rate')::numeric=100,'Complete known outcomes';
 ASSERT (a->'currencies'->0->>'total')::numeric=6001,'Explicit USD unit preserved';
 ASSERT (a->>'dated_listings')::int=6001,'Native start clock population';
 SELECT evidence_summary INTO b FROM public.organization_seller_stats WHERE organization_id=fixture_uid(2);
 ASSERT (b->>'input_rows')::int=17 AND (b->>'total_listings')::int=11,'Aliases deduplicated, different source episodes preserved';
 ASSERT (b->>'unresolved_identity_rows')::int=1,'Unresolved blip retained in coverage';
 ASSERT (b->>'total_sold')::int=5 AND (b->>'total_unsold')::int=1 AND (b->>'active_listings')::int=1,'Only explicit reserve-not-met is unsold';
 ASSERT (b->>'unknown_outcomes')::int=4 AND b->>'sell_through_rate' IS NULL,'Incomplete closed population has no misleading rate';
 ASSERT (b->>'identity_conflicts')::int=1 AND (b->>'outcome_conflicts')::int=1,'Conflicting parents/native IDs and outcomes withheld';
 ASSERT (b->>'unpriced_sold')::int=3 AND (b->>'unknown_currency_sold')::int=1 AND (b->>'amount_conflicts')::int=2,'Unknown units and conflicting prices retained';
 ASSERT (b->>'avg_bid_count')::numeric=2,'Known zero retained, missing counters not imputed';
 ASSERT jsonb_array_length(b->'currencies')=2,'Currencies never combined';
 ASSERT (SELECT sum((c->>'total')::numeric) FROM jsonb_array_elements(b->'currencies')c)=30,'Only eligible native amounts';
 ASSERT (b->>'input_rows')::int=17,'Private/deleted vehicles and hidden/rejected associations contribute neither counts nor amounts';
 ASSERT NOT EXISTS(SELECT 1 FROM public.organization_seller_stats WHERE total_gross_sales IS NOT NULL),'Legacy unitless revenue scalars retired';
 ASSERT NOT has_function_privilege('anon','public.compute_organization_listing_activity(uuid)','EXECUTE') AND
   NOT has_function_privilege('authenticated','public.compute_organization_listing_activity(uuid)','EXECUTE'),'Fold stays service-only';
 ASSERT has_function_privilege('service_role','public.compute_organization_listing_activity(uuid)','EXECUTE'),'Existing worker may execute';
 ASSERT (SELECT md5(string_agg(to_jsonb(e)::text,'' ORDER BY id)) FROM public.vehicle_events e)=(SELECT hash FROM public.fixture_fingerprint),'Testimony untouched';
 ASSERT (SELECT count(*) FROM public.organization_listing_activity_candidates(999))=3,'No-evidence organization excluded from batches';
 ASSERT NOT EXISTS (SELECT 1 FROM public.organization_listing_activity_candidates(999) WHERE organization_id IN
   (fixture_uid(5),fixture_uid(6),fixture_uid(7),fixture_uid(8))),'Private/deleted/hidden/rejected-only cohorts excluded from selector';
 ASSERT NOT has_function_privilege('anon','public.organization_listing_activity_candidates(int)','EXECUTE') AND
   NOT has_function_privilege('authenticated','public.organization_listing_activity_candidates(int)','EXECUTE'),'Selector remains service-only';
 ASSERT (SELECT count(*) FROM public.organization_listing_activity_candidates(1))=1,'Bounded candidate batch';
 ASSERT (SELECT total_listings FROM public.organization_seller_stats WHERE organization_id=fixture_uid(4))=0,'Empty evidence is measured zero';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock'),'No lock cascade';
END $$;
-- A failed cache write rolls back atomically and preserves the prior cache.
CREATE FUNCTION public.fixture_reject_cache() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_rejection'; END $$;
CREATE TRIGGER fixture_reject BEFORE UPDATE ON public.organization_seller_stats FOR EACH ROW EXECUTE FUNCTION public.fixture_reject_cache();
DO $$ DECLARE before jsonb; BEGIN
 SELECT to_jsonb(s) INTO before FROM public.organization_seller_stats s WHERE organization_id=fixture_uid(1);
 BEGIN PERFORM public.compute_organization_listing_activity(fixture_uid(1)); RAISE EXCEPTION 'unexpected_success';
 EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM='fixture_rejection','Expected actual cache failure'; END;
 ASSERT before=(SELECT to_jsonb(s) FROM public.organization_seller_stats s WHERE organization_id=fixture_uid(1)),'Failed fold retains prior cache';
END $$;
DROP TRIGGER fixture_reject ON public.organization_seller_stats;
-- More eligible keys than the batch cap; never computed caches sort first.
INSERT INTO public.organizations SELECT fixture_uid(n),true FROM generate_series(200,254)n;
INSERT INTO public.vehicle_events(id,vehicle_id,source_organization_id,source_platform,source_url,event_status)
SELECT fixture_uid(91000+n),fixture_uid(90),fixture_uid(n),'fixture','https://fixture.example/new-org/'||n,'active'
FROM generate_series(200,254)n;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM public.organization_listing_activity_candidates(999))=50,'Hard cap applies beyond fifty eligible keys';
 ASSERT (SELECT organization_id FROM public.organization_listing_activity_candidates(1))=fixture_uid(200),'Oldest-first selection is deterministic';
END $$;
SELECT 'organization listing activity SQL contracts passed' AS result;
