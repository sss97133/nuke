-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_journal -f supabase/sql/test_journal_density_counts_only.sql
-- Proves the journal's day index counts every gate-approved owner photo by the day it was taken, excludes listing
-- imports and ungated photos, counts receipts and completed payments, names the day's top vehicle, and carries no money.
-- Then (20261121123000) that the view reads as its caller: a caller without owner rights counts only the rows its row
-- policy lets it read, and the owner-rights caller's counts are unchanged.
-- And that the 90-day photo bound is an index condition for that caller: under row security a bound whose operator is
-- not leakproof (timestamptz against timestamp) cannot be one, and the per-user probe stops being a probe.
-- The inserts below seed stub tables in a disposable database, never production: -- ALLOW_RAW_TESTIMONY_WRITE
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid DEFAULT 'cccccccc-0000-0000-0000-000000000001', taken_at timestamptz, source text, vision_gate_status text, is_sensitive boolean NOT NULL DEFAULT false);
CREATE TABLE public.receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_date date, total numeric, total_amount numeric, vendor_name text);
CREATE TABLE public.work_order_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_date timestamptz, amount numeric, status text);
CREATE INDEX idx_vehicle_images_user_taken_at ON public.vehicle_images (user_id, taken_at);

-- ALLOW_RAW_TESTIMONY_WRITE (stub tables in a disposable database)
INSERT INTO public.vehicle_images (vehicle_id, taken_at, source, vision_gate_status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 3 + time '10:00', 'iphoto', 'approved'),
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 3 + time '11:00', 'owner_upload', 'approved'),
  ('aaaaaaaa-0000-0000-0000-000000000002', current_date - 3 + time '12:00', 'agent_verified_iphoto', 'approved'),
  ('aaaaaaaa-0000-0000-0000-000000000002', current_date - 3 + time '13:00', 'bat_import', 'approved'),
  ('aaaaaaaa-0000-0000-0000-000000000002', current_date - 3 + time '14:00', 'iphoto', 'rejected'),
  ('aaaaaaaa-0000-0000-0000-000000000002', current_date - 3 + time '15:00', 'iphoto', NULL),
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 200, 'iphoto', 'approved');
INSERT INTO public.receipts (receipt_date, total, total_amount, vendor_name) VALUES (current_date - 3, 120.50, 120.50, 'Vendor A'), (current_date - 1, 9.99, 9.99, 'Vendor B');
INSERT INTO public.work_order_payments (payment_date, amount, status) VALUES (current_date - 1 + time '09:00', 500, 'completed'), (current_date - 1 + time '10:00', 700, 'pending');

-- ALLOW_RAW_TESTIMONY_WRITE (stub rows in a disposable database)
INSERT INTO public.profiles VALUES ('cccccccc-0000-0000-0000-000000000001'), ('cccccccc-0000-0000-0000-000000000002');
-- A second user's photo counts; a photo documented by nobody does not.
INSERT INTO public.vehicle_images (vehicle_id, user_id, taken_at, source, vision_gate_status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', current_date - 5 + time '09:00', 'capture_relay_ios', 'approved'),
  ('aaaaaaaa-0000-0000-0000-000000000002', NULL, current_date - 5 + time '10:00', 'iphoto', 'approved');
-- ALLOW_RAW_TESTIMONY_WRITE (stub row in a disposable database)
-- A gate-approved owner photo that the visitor row policy below refuses (it stands in for every refused flag).
INSERT INTO public.vehicle_images (vehicle_id, taken_at, source, vision_gate_status, is_sensitive) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 7 + time '09:00', 'iphoto', 'approved', true);

\ir ../migrations/20261014013500_journal_density_counts_only.sql
\ir ../migrations/20261014040500_journal_density_per_user_probe.sql

DO $$
DECLARE r record; cols text;
BEGIN
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vw_journal_density';
  IF cols <> 'date,photo_count,receipt_count,payment_count,top_vehicle_id' THEN RAISE EXCEPTION 'columns: %', cols; END IF;
  SELECT * INTO r FROM public.vw_journal_density WHERE date = current_date - 3;
  IF r.photo_count <> 3 THEN RAISE EXCEPTION 'photos three days ago: % (expected 3: approved owner photos; listing import and ungated excluded)', r.photo_count; END IF;
  IF r.receipt_count <> 1 OR r.payment_count <> 0 THEN RAISE EXCEPTION 'receipts/payments three days ago: % %', r.receipt_count, r.payment_count; END IF;
  IF r.top_vehicle_id <> 'aaaaaaaa-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'top vehicle: %', r.top_vehicle_id; END IF;
  SELECT * INTO r FROM public.vw_journal_density WHERE date = current_date - 1;
  IF r.photo_count <> 0 OR r.receipt_count <> 1 OR r.payment_count <> 1 OR r.top_vehicle_id IS NOT NULL THEN RAISE EXCEPTION 'yesterday: %', r; END IF;
  SELECT * INTO r FROM public.vw_journal_density WHERE date = current_date - 5;
  IF r.photo_count <> 1 OR r.top_vehicle_id <> 'aaaaaaaa-0000-0000-0000-000000000002' THEN RAISE EXCEPTION 'five days ago (another user counts, nobody does not): %', r; END IF;
  IF (SELECT count(*) FROM public.vw_journal_density) <> 91 THEN RAISE EXCEPTION 'days: %', (SELECT count(*) FROM public.vw_journal_density); END IF;
  RAISE NOTICE 'vw_journal_density: counts only, every approved owner photo by the day it was taken';
END $$;

-- The visitor: a row policy on the photo table and the grants a visitor holds.
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY visitor_reads_unrefused ON public.vehicle_images FOR SELECT TO anon USING (NOT is_sensitive);
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON public.profiles, public.vehicle_images, public.receipts, public.work_order_payments TO anon;
GRANT SELECT ON public.vw_journal_density TO anon;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.vw_journal_density WHERE date = current_date - 7;
  IF r.photo_count <> 1 OR r.top_vehicle_id IS DISTINCT FROM 'aaaaaaaa-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'seven days ago, owner rights, before: %', r;
  END IF;
END $$;

\ir ../migrations/20261121123000_journal_density_reads_as_caller.sql

DO $$
DECLARE r record; opts text[];
BEGIN
  SELECT reloptions INTO opts FROM pg_class WHERE oid = 'public.vw_journal_density'::regclass;
  IF NOT ('security_invoker=true' = ANY (coalesce(opts, '{}'))) THEN RAISE EXCEPTION 'view options: %', opts; END IF;
  -- The owner-rights caller reads what it read before.
  SELECT * INTO r FROM public.vw_journal_density WHERE date = current_date - 7;
  IF r.photo_count <> 1 THEN RAISE EXCEPTION 'seven days ago, owner rights, after: %', r; END IF;
  SELECT * INTO r FROM public.vw_journal_density WHERE date = current_date - 3;
  IF r.photo_count <> 3 OR r.top_vehicle_id <> 'aaaaaaaa-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'three days ago, owner rights, after: %', r; END IF;
END $$;

SET ROLE anon;
DO $$
DECLARE r record;
BEGIN
  -- A visitor's counts hold only rows its row policy lets it read: the refused photo is neither counted nor named.
  SELECT * INTO r FROM public.vw_journal_density WHERE date = current_date - 7;
  IF r.photo_count <> 0 OR r.top_vehicle_id IS NOT NULL THEN RAISE EXCEPTION 'seven days ago as a visitor: %', r; END IF;
  SELECT * INTO r FROM public.vw_journal_density WHERE date = current_date - 3;
  IF r.photo_count <> 3 OR r.receipt_count <> 1 THEN RAISE EXCEPTION 'three days ago as a visitor: %', r; END IF;
  IF (SELECT count(*) FROM public.vw_journal_density) <> 91 THEN RAISE EXCEPTION 'visitor days: %', (SELECT count(*) FROM public.vw_journal_density); END IF;
  RAISE NOTICE 'vw_journal_density: reads as its caller; a visitor counts only rows it may read';
END $$;

-- The visitor's photo probe: with sequential and bitmap scans off the planner must use the (user_id, taken_at) index,
-- and the 90-day bound has to sit in its index condition. As a filter it would be applied to every photo the user has.
SET enable_seqscan = off;
SET enable_bitmapscan = off;
DO $$
DECLARE plan json;
BEGIN
  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT * FROM public.vw_journal_density' INTO plan;
  IF plan::text !~ '"Index Name": "idx_vehicle_images_user_taken_at"' THEN
    RAISE EXCEPTION 'as a visitor the photo probe does not use idx_vehicle_images_user_taken_at: %', plan;
  END IF;
  IF plan::text !~ '"Index Cond": "[^"]*user_id = [^"]*taken_at >= ' THEN
    RAISE EXCEPTION 'as a visitor the 90-day bound is not an index condition of the photo probe: %', plan;
  END IF;
  RAISE NOTICE 'vw_journal_density: as a visitor the 90-day bound is an index condition of the per-user photo probe';
END $$;
RESET enable_seqscan;
RESET enable_bitmapscan;
RESET ROLE;
