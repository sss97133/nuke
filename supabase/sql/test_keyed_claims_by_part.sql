-- Empty local fixture only. The reader against synthetic keyed observations shaped like the proof
-- vehicle's. No production observation is imported.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_observations') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires an empty disposable dm_refinement_ database'; END IF; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE vehicles(id uuid PRIMARY KEY,year int,make text,model text,deleted_at timestamptz);
CREATE TABLE subject_taxonomy(subject_key text PRIMARY KEY,category text,is_active boolean DEFAULT true);
CREATE TABLE condition_taxonomy(descriptor_id uuid PRIMARY KEY,canonical_key text UNIQUE,descriptor_type text,deprecated_at timestamptz);
CREATE TABLE observation_properties(id uuid PRIMARY KEY,property_key text);
CREATE TABLE vehicle_images(id uuid PRIMARY KEY,vehicle_id uuid,image_url text,taken_at timestamptz,is_duplicate boolean DEFAULT false);
CREATE FUNCTION vehicle_image_gallery_eligible(vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(($1).is_duplicate,false)=false $$;
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,structured_data jsonb,is_superseded boolean DEFAULT false,descriptor_id uuid,property_id uuid);
CREATE TABLE observation_witnesses(observation_id uuid REFERENCES vehicle_observations(id),image_id uuid,witness_role text);
INSERT INTO vehicles VALUES ('a1000000-0000-0000-0000-000000000001',1973,'Pontiac','Firebird',NULL),
 ('a2000000-0000-0000-0000-000000000002',1966,'Ford','Mustang',NULL),('a3000000-0000-0000-0000-000000000003',1970,'Deleted','Car',now());
INSERT INTO subject_taxonomy VALUES ('glass.felt.window','glass',true);
INSERT INTO condition_taxonomy VALUES ('d1000000-0000-0000-0000-000000000001','exterior.trim.missing','state',NULL),
 ('d2000000-0000-0000-0000-000000000002','exterior.trim.replaced','state',NULL),('d3000000-0000-0000-0000-000000000003','exterior.flag.wear','adjective',NULL);
INSERT INTO observation_properties VALUES ('e1000000-0000-0000-0000-000000000001','image_visible_paint_stage');
-- Vehicle a1, part glass.felt.window: missing on the 1st (two photos, one a duplicate frame), replaced on the 20th.
-- Vehicle a2: worn, on a photo with no capture time. Vehicle a3 is deleted. Another part and a superseded row are noise.
INSERT INTO vehicle_images VALUES
 ('b1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','https://img.example/1.jpg','2026-05-01T10:00:00Z',false),
 ('b2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','https://img.example/2.jpg','2026-05-01T18:00:00Z',false),
 ('b3000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','https://img.example/3.jpg','2026-05-20T10:00:00Z',false),
 ('b4000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000001','https://img.example/4.jpg','2026-05-01T11:00:00Z',true),
 ('b5000000-0000-0000-0000-000000000005','a2000000-0000-0000-0000-000000000002','https://img.example/5.jpg',NULL,false),
 ('b6000000-0000-0000-0000-000000000006','a3000000-0000-0000-0000-000000000003','https://img.example/6.jpg','2026-05-01T10:00:00Z',false);
INSERT INTO vehicle_observations VALUES
 ('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','{"part_key":"glass.felt.window"}',false,'d1000000-0000-0000-0000-000000000001',NULL),
 ('c2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','{"part_key":"glass.felt.window"}',false,'d1000000-0000-0000-0000-000000000001',NULL),
 ('c3000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','{"part_key":"glass.felt.window"}',false,'d2000000-0000-0000-0000-000000000002',NULL),
 ('c4000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000001','{"part_key":"glass.felt.window"}',false,'d1000000-0000-0000-0000-000000000001',NULL),
 ('c5000000-0000-0000-0000-000000000005','a2000000-0000-0000-0000-000000000002','{"part_key":"glass.felt.window"}',false,'d3000000-0000-0000-0000-000000000003',NULL),
 ('c6000000-0000-0000-0000-000000000006','a3000000-0000-0000-0000-000000000003','{"part_key":"glass.felt.window"}',false,'d1000000-0000-0000-0000-000000000001',NULL),
 ('c7000000-0000-0000-0000-000000000007','a1000000-0000-0000-0000-000000000001','{"part_key":"trim.bumper.front"}',false,'d3000000-0000-0000-0000-000000000003',NULL),
 ('c8000000-0000-0000-0000-000000000008','a1000000-0000-0000-0000-000000000001','{"part_key":"glass.felt.window"}',true,'d3000000-0000-0000-0000-000000000003',NULL),
 ('c9000000-0000-0000-0000-000000000009','a1000000-0000-0000-0000-000000000001','{"part_key":"glass.felt.window"}',false,NULL,NULL),
 ('ca000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000001','{"part_key":"glass.felt.window","image_visible_paint_stage":"primer"}',false,NULL,'e1000000-0000-0000-0000-000000000001');
-- Driver and passenger felts, both worn, on the 25th: two claims, not one.
INSERT INTO vehicle_images VALUES
 ('b7000000-0000-0000-0000-000000000007','a1000000-0000-0000-0000-000000000001','https://img.example/7.jpg','2026-05-25T10:00:00Z',false),
 ('b8000000-0000-0000-0000-000000000008','a1000000-0000-0000-0000-000000000001','https://img.example/8.jpg','2026-05-25T11:00:00Z',false),
 ('b9000000-0000-0000-0000-000000000009','a2000000-0000-0000-0000-000000000002','https://img.example/9.jpg',NULL,false);
INSERT INTO vehicle_observations VALUES
 ('cb000000-0000-0000-0000-00000000000b','a1000000-0000-0000-0000-000000000001','{"part_key":"glass.felt.window","part_side":"driver"}',false,'d3000000-0000-0000-0000-000000000003',NULL),
 ('cc000000-0000-0000-0000-00000000000c','a1000000-0000-0000-0000-000000000001','{"part_key":"glass.felt.window","part_side":"passenger"}',false,'d3000000-0000-0000-0000-000000000003',NULL),
 ('cd000000-0000-0000-0000-00000000000d','a2000000-0000-0000-0000-000000000002','{"part_key":"glass.felt.window"}',false,'d3000000-0000-0000-0000-000000000003',NULL);
INSERT INTO observation_witnesses VALUES
 ('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','derived'),
 ('c2000000-0000-0000-0000-000000000002','b2000000-0000-0000-0000-000000000002','derived'),
 ('c3000000-0000-0000-0000-000000000003','b3000000-0000-0000-0000-000000000003','derived'),
 ('c4000000-0000-0000-0000-000000000004','b4000000-0000-0000-0000-000000000004','derived'),
 ('c5000000-0000-0000-0000-000000000005','b5000000-0000-0000-0000-000000000005','derived'),
 ('c6000000-0000-0000-0000-000000000006','b6000000-0000-0000-0000-000000000006','derived'),
 ('c7000000-0000-0000-0000-000000000007','b1000000-0000-0000-0000-000000000001','derived'),
 ('c8000000-0000-0000-0000-000000000008','b1000000-0000-0000-0000-000000000001','derived'),
 ('c9000000-0000-0000-0000-000000000009','b1000000-0000-0000-0000-000000000001','derived'),
 ('ca000000-0000-0000-0000-00000000000a','b3000000-0000-0000-0000-000000000003','derived'),
 ('cb000000-0000-0000-0000-00000000000b','b7000000-0000-0000-0000-000000000007','derived'),
 ('cc000000-0000-0000-0000-00000000000c','b8000000-0000-0000-0000-000000000008','derived'),
 ('cd000000-0000-0000-0000-00000000000d','b9000000-0000-0000-0000-000000000009','derived');
\ir ../migrations/20261116061000_keyed_claims_by_part.sql
DO $$ DECLARE j jsonb; a jsonb; BEGIN
 j:=public.keyed_claims_by_part('glass.felt.window');
 -- Two live vehicles carry the part; the deleted vehicle is neither returned nor counted.
 ASSERT (j->>'vehicles')::int=2 AND jsonb_array_length(j->'results')=2 AND (j->>'claims')::int=7,j::text;
 ASSERT (j->>'part_in_registry')::boolean AND j->'state_key'='null'::jsonb AND (j->>'proven')::int=0,j::text;
 a:=j#>'{results,0}';
 ASSERT a->>'vehicle_id'='a1000000-0000-0000-0000-000000000001' AND a->>'make'='Pontiac' AND (a->>'days_seen')::int=3,a::text;
 -- The part's days in order: missing on the 1st, replaced (and a paint value) on the 20th, then each side worn
 -- on the 25th. The reader states the sequence; it does not call it a repair.
 ASSERT a->'days'='[{"capture_day":"2026-05-01","part_side":null,"states":["exterior.trim.missing"]},
   {"capture_day":"2026-05-20","part_side":null,"states":["exterior.trim.replaced","image_visible_paint_stage=primer"]},
   {"capture_day":"2026-05-25","part_side":"driver","states":["exterior.flag.wear"]},
   {"capture_day":"2026-05-25","part_side":"passenger","states":["exterior.flag.wear"]}]'::jsonb,a::text;
 -- One claim per state, side and day: two photos fold into the claim of the 1st; the duplicate frame, the
 -- superseded row and the unkeyed row add nothing; the two sides on the 25th stay two claims.
 ASSERT jsonb_array_length(a->'claims')=5,a::text;
 ASSERT a#>>'{claims,0,state_key}'='exterior.trim.missing' AND (a#>>'{claims,0,photo_count}')::int=2 AND (a#>>'{claims,0,rows}')::int=2
  AND a#>>'{claims,0,kind}'='state' AND a#>'{claims,0,part_side}'='null'::jsonb,a::text;
 ASSERT (SELECT array_agg(p->>'image_url' ORDER BY p->>'image_url') FROM jsonb_array_elements(a#>'{claims,0,photos}') p)
  = ARRAY['https://img.example/1.jpg','https://img.example/2.jpg'],a::text;
 ASSERT a#>>'{claims,3,part_side}'='driver' AND a#>>'{claims,4,part_side}'='passenger'
  AND a#>>'{claims,3,photos,0,image_url}'='https://img.example/7.jpg' AND a#>>'{claims,4,photos,0,image_url}'='https://img.example/8.jpg',a::text;
 -- Photos with no capture time: two sightings of the same state stay two claims, each with a null day, and
 -- make no day entry. When they happened relative to each other is unknown.
 a:=j#>'{results,1}';
 ASSERT a->>'vehicle_id'='a2000000-0000-0000-0000-000000000002' AND (a->>'days_seen')::int=0 AND a->'days'='[]'::jsonb
  AND jsonb_array_length(a->'claims')=2 AND a#>'{claims,0,capture_day}'='null'::jsonb AND a#>'{claims,1,capture_day}'='null'::jsonb
  AND (a#>>'{claims,0,photo_count}')::int=1 AND (a#>>'{claims,1,photo_count}')::int=1 AND a#>>'{claims,0,state_key}'='exterior.flag.wear',a::text;
 -- The proof question itself: which vehicles show this part replaced, with the photos.
 j:=public.keyed_claims_by_part('glass.felt.window','exterior.trim.replaced');
 ASSERT jsonb_array_length(j->'results')=1 AND (j->>'state_in_registry')::boolean AND j#>>'{results,0,vehicle_id}'='a1000000-0000-0000-0000-000000000001'
  AND j#>>'{results,0,claims,0,photos,0,image_url}'='https://img.example/3.jpg' AND j#>>'{results,0,claims,0,capture_day}'='2026-05-20',j::text;
 -- A property-backed state is asked as property=value, is found, and is reported as registered.
 j:=public.keyed_claims_by_part('glass.felt.window','image_visible_paint_stage=primer');
 ASSERT (j->>'state_in_registry')::boolean AND jsonb_array_length(j->'results')=1
  AND j#>>'{results,0,claims,0,state_key}'='image_visible_paint_stage=primer',j::text;
 ASSERT NOT (public.keyed_claims_by_part('glass.felt.window','no_such_property=primer')->>'state_in_registry')::boolean;
 -- Scoped to one vehicle; a state the registry does not hold says so; a part nobody carries and an empty part return nothing.
 ASSERT jsonb_array_length(public.keyed_claims_by_part('glass.felt.window',NULL,'a2000000-0000-0000-0000-000000000002')->'results')=1;
 j:=public.keyed_claims_by_part('glass.felt.window','made.up.state');
 ASSERT NOT (j->>'state_in_registry')::boolean AND j->'results'='[]'::jsonb,j::text;
 j:=public.keyed_claims_by_part('no.such.part');
 ASSERT NOT (j->>'part_in_registry')::boolean AND j->'results'='[]'::jsonb AND (j->>'vehicles')::int=0,j::text;
 ASSERT public.keyed_claims_by_part('  ')->'results'='[]'::jsonb;
 ASSERT NOT has_function_privilege('anon','public.keyed_claims_by_part(text,text,uuid)','execute')
  AND NOT has_function_privilege('authenticated','public.keyed_claims_by_part(text,text,uuid)','execute')
  AND has_function_privilege('service_role','public.keyed_claims_by_part(text,text,uuid)','execute');
END $$;
-- The row cap bounds the requested state, not the part: with 6,000 rows of another state on the part, a
-- rare state is still found.
INSERT INTO vehicle_observations(id,vehicle_id,structured_data,is_superseded,descriptor_id)
 SELECT gen_random_uuid(),'a2000000-0000-0000-0000-000000000002','{"part_key":"glass.felt.window"}',false,'d3000000-0000-0000-0000-000000000003'
 FROM generate_series(1,6000);
DO $$ DECLARE j jsonb; BEGIN
 j:=public.keyed_claims_by_part('glass.felt.window','exterior.trim.replaced');
 ASSERT jsonb_array_length(j->'results')=1 AND j#>>'{results,0,claims,0,photos,0,image_url}'='https://img.example/3.jpg',j::text;
END $$;
\echo keyed claims by part: ok
