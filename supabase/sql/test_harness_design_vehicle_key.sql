\set ON_ERROR_STOP on
SET statement_timeout='10s';
SET lock_timeout='2s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
  OR current_setting('server_version_num')::integer/10000<>17 THEN
  RAISE EXCEPTION 'Harness design key contract requires disposable PG17 database';
 END IF;
END $$;
CREATE FUNCTION public.t_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label; END IF;END $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
CREATE TABLE public.harness_designs(id uuid PRIMARY KEY,vehicle_id uuid,name text NOT NULL);
INSERT INTO public.vehicles VALUES('10000000-0000-4000-8000-000000000001');
INSERT INTO public.harness_designs VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000009','legacy orphan'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','known subject'),
 ('20000000-0000-4000-8000-000000000003',NULL,'unassigned');
SELECT md5(jsonb_agg(to_jsonb(d) ORDER BY d.id)::text) AS prior_rows FROM public.harness_designs d \gset
\ir ../migrations/20261127045333_harness_design_vehicle_key.sql
SELECT public.t_assert((SELECT md5(jsonb_agg(to_jsonb(d) ORDER BY d.id)::text)=:'prior_rows' FROM public.harness_designs d),
 'installation preserves every legacy, assigned and unassigned source row');
SELECT public.t_assert((SELECT NOT convalidated AND contype='f' AND confrelid='public.vehicles'::regclass
 AND confdeltype='a' AND confupdtype='a' FROM pg_constraint
 WHERE conrelid='public.harness_designs'::regclass AND conname='harness_designs_vehicle_id_fkey'),
 'actual foreign key is unvalidated with no cascading reassignment or deletion');
DO $$ BEGIN
 BEGIN
  INSERT INTO public.harness_designs VALUES('20000000-0000-4000-8000-000000000004',
   '10000000-0000-4000-8000-000000000009','new invalid subject');
  RAISE EXCEPTION 'new orphan accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  UPDATE public.harness_designs SET vehicle_id='10000000-0000-4000-8000-000000000009'
   WHERE id='20000000-0000-4000-8000-000000000002';
  RAISE EXCEPTION 'changed orphan accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  DELETE FROM public.vehicles WHERE id='10000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'referenced vehicle deleted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  ALTER TABLE public.harness_designs VALIDATE CONSTRAINT harness_designs_vehicle_id_fkey;
  RAISE EXCEPTION 'legacy orphan incorrectly validated';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
INSERT INTO public.harness_designs VALUES
 ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','new valid subject'),
 ('20000000-0000-4000-8000-000000000005',NULL,'new unassigned');
UPDATE public.harness_designs SET vehicle_id='10000000-0000-4000-8000-000000000001'
 WHERE id='20000000-0000-4000-8000-000000000003';
UPDATE public.harness_designs SET name='legacy preserved without reattribution'
 WHERE id='20000000-0000-4000-8000-000000000001';
SELECT public.t_assert((SELECT count(*)=5 FROM public.harness_designs)
 AND (SELECT count(*)=1 FROM public.harness_designs d WHERE d.vehicle_id IS NOT NULL
  AND NOT EXISTS(SELECT FROM public.vehicles v WHERE v.id=d.vehicle_id)),
 'valid and unassigned writes work while the one legacy orphan remains intact');
SELECT public.t_assert((SELECT NOT convalidated FROM pg_constraint
 WHERE conrelid='public.harness_designs'::regclass AND conname='harness_designs_vehicle_id_fkey')
 AND (SELECT count(*)=2 FROM pg_attribute a WHERE a.attrelid='public.harness_designs'::regclass
  AND a.attname IN('id','vehicle_id') AND col_description(a.attrelid,a.attnum) IS NOT NULL),
 'validation failure is honest and both ownership-path columns have definitions');
SELECT 'harness design vehicle key contract PASS' AS result;
