-- Disposable PG17 contract: never connect this fixture to production.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database required'; END IF; END $$;
CREATE ROLE anon;
CREATE TABLE vehicles(id uuid PRIMARY KEY,is_public boolean NOT NULL,deleted_at timestamptz,listing_kind text);
CREATE TABLE auction_events(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES vehicles,duplicate_of uuid,visible boolean NOT NULL DEFAULT true);
CREATE VIEW auction_events_canonical WITH(security_invoker=true) AS SELECT * FROM auction_events WHERE duplicate_of IS NULL;
CREATE TABLE auction_comments(id integer PRIMARY KEY,vehicle_id uuid REFERENCES vehicles,auction_event_id uuid REFERENCES auction_events,
 source_url text,created_at timestamptz DEFAULT now(),posted_at timestamptz DEFAULT now(),comment_type text DEFAULT 'bid',
 bid_amount numeric,author_external_identity_id uuid);
CREATE INDEX comment_vehicle ON auction_comments(vehicle_id);
ALTER TABLE auction_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_visibility ON auction_events FOR SELECT USING(visible);
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_visibility ON vehicles FOR SELECT USING(is_public AND deleted_at IS NULL);
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON vehicles,auction_events,auction_events_canonical,auction_comments TO anon;
INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-000000000001',true,null,null),('00000000-0000-4000-8000-000000000002',false,null,null);
INSERT INTO auction_events VALUES
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001',null,true),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011',true),
 ('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000002',null,false);
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,source_url,bid_amount,author_external_identity_id) VALUES
 (1,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','https://bringatrailer.com/listing/test',null,'00000000-0000-4000-8000-000000000021'),
 (2,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012','https://bringatrailer.com/listing/test',null,'00000000-0000-4000-8000-000000000021'),
 (3,'00000000-0000-4000-8000-000000000001',null,'https://bringatrailer.com/listing/test',110,'00000000-0000-4000-8000-000000000021'),
 (4,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000013','https://bringatrailer.com/listing/private',120,null);
-- Original reader fragments with unchanged bounds, parent gates and security.
CREATE FUNCTION market_lot_activity(p_vehicle_ids uuid[],p_limit_per_lot integer) RETURNS jsonb LANGUAGE sql STABLE AS $$
 WITH v AS(SELECT id,'https://bringatrailer.com/listing/test'::text lot_url FROM vehicles WHERE id=ANY(p_vehicle_ids))
 SELECT coalesce(jsonb_agg(id),'[]') FROM (SELECT c.id FROM public.auction_comments c,v
 WHERE c.vehicle_id = v.id AND c.source_url IN (v.lot_url, v.lot_url || '/')
 ORDER BY c.id LIMIT p_limit_per_lot) bounded $$;
CREATE FUNCTION get_vehicle_profile_data(p_vehicle_id uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET statement_timeout='5s' AS $$
 SELECT CASE WHEN EXISTS(SELECT FROM vehicles WHERE id=p_vehicle_id AND is_public) THEN
 (SELECT COUNT(*) FROM public.auction_comments WHERE vehicle_id = p_vehicle_id) ELSE NULL END $$;
CREATE FUNCTION actor_profile_read(p_kind text,p_id uuid) RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
 DECLARE ids uuid[]:=ARRAY[p_id]; total bigint; BEGIN
 SELECT count(*) INTO total FROM public.auction_comments WHERE author_external_identity_id = ANY (ids);
 RETURN total; END $$;
CREATE FUNCTION market_source_pulse_read(p_source text) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER AS $$
 WITH t AS(SELECT date_trunc('hour', now()) AS h0, 0 AS unused) SELECT count(*) FROM public.auction_comments c,t
 WHERE c.created_at >= t.h0 - interval '23 hours'
 AND c.source_url=p_source $$;
CREATE TEMP TABLE original_acl AS SELECT oid,proacl,prosecdef,proconfig FROM pg_proc WHERE proname IN
 ('market_lot_activity','get_vehicle_profile_data','actor_profile_read','market_source_pulse_read');
SET statement_timeout='3s'; SET lock_timeout='1s';
\ir ../migrations/20261109033000_canonical_auction_measurement_readers.sql
\ir ../migrations/20261109033000_canonical_auction_measurement_readers.sql
DO $$ BEGIN
 IF current_setting('statement_timeout')<>'3s' OR current_setting('lock_timeout')<>'1s' THEN RAISE EXCEPTION 'budget changed'; END IF;
 IF EXISTS(SELECT FROM original_acl a JOIN pg_proc p ON p.oid=a.oid WHERE (a.proacl,a.prosecdef,a.proconfig) IS DISTINCT FROM (p.proacl,p.prosecdef,p.proconfig)) THEN RAISE EXCEPTION 'security contract changed'; END IF;
 IF (SELECT count(*) FROM auction_comments)<>4 THEN RAISE EXCEPTION 'raw testimony mutated'; END IF;
END $$;
SET ROLE anon;
DO $$ BEGIN
 IF market_lot_activity(ARRAY['00000000-0000-4000-8000-000000000001'::uuid],2)<>'[1,3]'::jsonb THEN RAISE EXCEPTION 'duplicate consumed limit or unkeyed row lost'; END IF;
 IF get_vehicle_profile_data('00000000-0000-4000-8000-000000000001')<>2 THEN RAISE EXCEPTION 'profile duplicate count'; END IF;
 IF get_vehicle_profile_data('00000000-0000-4000-8000-000000000002') IS NOT NULL THEN RAISE EXCEPTION 'private parent leaked'; END IF;
 IF actor_profile_read('external','00000000-0000-4000-8000-000000000021')<>2 THEN RAISE EXCEPTION 'actor duplicate count'; END IF;
 IF market_source_pulse_read('https://bringatrailer.com/listing/test')<>2 THEN RAISE EXCEPTION 'source duplicate count'; END IF;
 IF (SELECT count(*) FROM auction_comments c WHERE c.auction_event_id IS NULL OR EXISTS(SELECT FROM auction_events_canonical ae WHERE ae.id=c.auction_event_id OFFSET 0))<>2 THEN RAISE EXCEPTION 'anonymous event visibility lost'; END IF;
END $$;
RESET ROLE;
-- The existing rounded-hour window is unchanged, including its inclusive boundary.
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,source_url,created_at) VALUES
 (5,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','https://bringatrailer.com/listing/boundary',date_trunc('hour',now())-interval '23 hours'),
 (6,'00000000-0000-4000-8000-000000000001',null,'https://bringatrailer.com/listing/boundary',date_trunc('hour',now())-interval '23 hours 0.001 seconds');
SET ROLE anon;
DO $$ DECLARE clock timestamptz; BEGIN
 IF market_source_pulse_read('https://bringatrailer.com/listing/boundary')<>1 THEN RAISE EXCEPTION 'source hour boundary changed'; END IF;
 FOREACH clock IN ARRAY ARRAY['2026-11-09T02:59:59.999Z'::timestamptz,'2026-11-09T03:00:00Z'::timestamptz] LOOP
  IF EXISTS(SELECT FROM (VALUES(date_trunc('hour',clock)-interval '23 hours'),(date_trunc('hour',clock)-interval '23 hours 0.001 seconds')) dates(created_at),
   (SELECT date_trunc('hour',clock) h0) t
   WHERE (dates.created_at>=t.h0-interval '23 hours') IS DISTINCT FROM (dates.created_at>=date_trunc('hour',clock)-interval '23 hours')) THEN
   RAISE EXCEPTION 'hour rollover parity lost';
  END IF;
 END LOOP;
END $$;
RESET ROLE;
