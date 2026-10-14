-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_journal -f supabase/sql/test_journal_density_counts_only.sql
-- Proves the journal's day index counts every gate-approved owner photo by the day it was taken, excludes listing
-- imports and ungated photos, counts receipts and completed payments, names the day's top vehicle, and carries no money.
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
END $$;
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, taken_at timestamptz, source text, vision_gate_status text);
CREATE TABLE public.receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_date date, total numeric, total_amount numeric, vendor_name text);
CREATE TABLE public.work_order_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_date timestamptz, amount numeric, status text);

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

\ir ../migrations/20261014013500_journal_density_counts_only.sql

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
  IF (SELECT count(*) FROM public.vw_journal_density) <> 91 THEN RAISE EXCEPTION 'days: %', (SELECT count(*) FROM public.vw_journal_density); END IF;
  RAISE NOTICE 'vw_journal_density: counts only, every approved owner photo by the day it was taken';
END $$;
