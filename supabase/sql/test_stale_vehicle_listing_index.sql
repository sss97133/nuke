\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
   RAISE EXCEPTION 'Requires empty disposable database';
 END IF;
END $$;
CREATE TABLE vehicles(id integer PRIMARY KEY,is_for_sale boolean,deleted_at timestamptz,
 listing_updated_at timestamptz,listing_posted_at timestamptz,updated_at timestamptz);
-- A realistic sparse subset; fixture clocks exercise each COALESCE fallback.
INSERT INTO vehicles SELECT i,false,NULL,NULL,NULL,now() FROM generate_series(1,10000) i;
UPDATE vehicles SET is_for_sale=true,updated_at=now()-interval '60 days' WHERE id<=100;
UPDATE vehicles SET listing_posted_at=now()-interval '50 days' WHERE id<=10;
UPDATE vehicles SET listing_updated_at=now()-interval '1 day' WHERE id<=5;
UPDATE vehicles SET deleted_at=now() WHERE id=6;
UPDATE vehicles SET updated_at=NULL WHERE id=100;
CREATE TEMP TABLE before_ids AS SELECT id FROM vehicles WHERE is_for_sale IS TRUE AND deleted_at IS NULL
 AND COALESCE(listing_updated_at,listing_posted_at,updated_at)<now()-interval '45 days';
\ir ../migrations/20261108192400_index_stale_vehicle_listing_clock.sql
\ir ../migrations/20261108192400_index_stale_vehicle_listing_clock.sql
ANALYZE vehicles;
DO $$ DECLARE plan json; BEGIN
 IF (SELECT count(*) FROM before_ids)<>93 THEN RAISE EXCEPTION 'Fixture eligibility wrong'; END IF;
 IF EXISTS((SELECT id FROM before_ids EXCEPT SELECT id FROM vehicles WHERE is_for_sale IS TRUE AND deleted_at IS NULL
 AND COALESCE(listing_updated_at,listing_posted_at,updated_at)<now()-interval '45 days')
 UNION ALL (SELECT id FROM vehicles WHERE is_for_sale IS TRUE AND deleted_at IS NULL
 AND COALESCE(listing_updated_at,listing_posted_at,updated_at)<now()-interval '45 days' EXCEPT SELECT id FROM before_ids)) THEN
 RAISE EXCEPTION 'Eligibility changed'; END IF;
 EXECUTE 'EXPLAIN (FORMAT JSON) SELECT id FROM vehicles WHERE is_for_sale IS TRUE AND deleted_at IS NULL
 AND COALESCE(listing_updated_at,listing_posted_at,updated_at)<now()-interval ''45 days''
 ORDER BY COALESCE(listing_updated_at,listing_posted_at,updated_at) ASC NULLS FIRST LIMIT 50 FOR UPDATE SKIP LOCKED' INTO plan;
 IF plan::text NOT LIKE '%idx_vehicles_stale_listing_clock%' OR plan::text LIKE '%"Node Type": "Sort"%' THEN
 RAISE EXCEPTION 'Original bounded locking selection did not use ordered index: %',plan; END IF;
END $$;
WITH stale AS (SELECT id FROM vehicles WHERE is_for_sale IS TRUE AND deleted_at IS NULL
 AND COALESCE(listing_updated_at,listing_posted_at,updated_at)<now()-interval '45 days'
 ORDER BY COALESCE(listing_updated_at,listing_posted_at,updated_at) ASC NULLS FIRST LIMIT 50 FOR UPDATE SKIP LOCKED)
UPDATE vehicles v SET is_for_sale=false,updated_at=now() FROM stale s WHERE v.id=s.id;
DO $$ BEGIN
 IF (SELECT count(*) FROM vehicles v JOIN before_ids b USING(id) WHERE NOT v.is_for_sale)<>50
 OR (SELECT count(*) FROM vehicles v JOIN before_ids b USING(id) WHERE v.is_for_sale)<>43 THEN
 RAISE EXCEPTION 'Bounded expiry did not advance exactly 50 eligible rows'; END IF;
END $$;
