-- Empty disposable PG17 only, as a superuser (the live view_write_guard event trigger is installed), from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_receipt_views_money_mask -f supabase/sql/test_receipt_views_money_mask.sql
-- scripts/ci/run-db-contracts.sh runs it that way in the db-contracts job.
-- Contract for 20261109140000_receipt_views_money_mask.sql. Synthetic rows only; never production.
-- The fixture is test_receipt_views_privacy.sql's (the same cast, vehicles and receipts), brought to the live state of 2026-11-05 by
-- 20261106160000 and 20261031042352. Then the mask:
--   * receipts_public_summary: anon and a signed-in stranger read the same receipts of the public, undeleted vehicles as before, with
--     vendor, dates, invoice number and status, and total and total_amount NULL, amounts_visible false. A caller's own filter on the
--     amount sees only the masked column. The vehicle's people (owner_id, user_id, created_by_user_id, uploaded_by, a contributor) and a
--     service-role request read the amounts of their vehicle, amounts_visible true, and only of theirs. Private vehicles stay hidden.
--   * vehicle_receipts_rollup_v: the same rows as before for every caller; the three totals NULL unless tied; receipts_count public.
--   * nothing but the money changes: the row set, keyed by receipt and vehicle, is the one the views gave before the mask.
--   * grants and options unchanged; replay-safe; refuses a drifted definition without changing it.
--     definition has lost a filter it was written from.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Run as a superuser: vanilla PG17 lets only a superuser create the view_write_guard event trigger';
  END IF;
END $$;

-- Supabase's auth shims and roles (service_role bypasses row-level security there).
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Supabase's default privileges: every new relation in public gives anon, authenticated and service_role everything.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- The live shapes (read from production on 2026-10-29).
CREATE TYPE public.receipt_amount_check AS ENUM ('unchecked', 'verified', 'plausible', 'implausible', 'no_amount');
CREATE TYPE public.receipt_doc_kind AS ENUM ('parts_service', 'vehicle_transaction', 'government_fee', 'fuel', 'insurance_document',
  'tax_form', 'financial_statement', 'letter_notice', 'personal_purchase', 'unknown', 'vehicle_sale', 'shipping', 'general_merchandise');
CREATE FUNCTION public.receipt_doc_kind_excluded(k public.receipt_doc_kind) RETURNS boolean LANGUAGE sql IMMUTABLE AS
$$ select coalesce(k::text in ('tax_form','financial_statement','insurance_document','letter_notice','personal_purchase','vehicle_sale'), false) $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean DEFAULT true, deleted_at timestamptz,
  listing_kind text NOT NULL DEFAULT 'vehicle', user_id uuid, owner_id uuid, created_by_user_id uuid, uploaded_by uuid);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid, role text, status text);
-- Access: owner columns or a contributor, as vehicle_user_has_access reads them (the live one adds admins, verifications and organizations).
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p_user_id IS NOT NULL AND p_vehicle_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id AND p_user_id IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc WHERE vc.vehicle_id = p_vehicle_id AND vc.user_id = p_user_id
      AND coalesce(vc.status, 'active') = 'active'
      AND vc.role = ANY (ARRAY['owner', 'co_owner', 'restorer', 'moderator', 'consigner', 'mechanic', 'appraiser', 'photographer', 'sales_agent']))) $$;
REVOKE ALL ON FUNCTION public.vehicle_user_has_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_user_has_access(uuid, uuid) TO anon, authenticated, service_role;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING ((is_public = true) OR (auth.role() = 'service_role'));
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT USING ((is_public = false) AND ((SELECT auth.uid()) IS NOT NULL)
  AND (((SELECT auth.uid()) = user_id) OR ((SELECT auth.uid()) = owner_id) OR ((SELECT auth.uid()) = uploaded_by)
       OR public.vehicle_user_has_access(id, (SELECT auth.uid()))));

CREATE TABLE public.receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vendor_name text, total_amount numeric(10,2),
  processing_status text DEFAULT 'pending', transaction_date date, scope_type text DEFAULT 'user', scope_id text, duplicate_of uuid,
  amount_check public.receipt_amount_check DEFAULT 'unchecked', document_kind public.receipt_doc_kind,
  vehicle_id uuid, source_document_id uuid, source_document_table text, total numeric, currency text, receipt_date date, purchase_date date,
  invoice_number text, transaction_number text, status text DEFAULT 'processed', created_at timestamptz DEFAULT now());
CREATE TABLE public.line_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, user_id uuid, category text,
  total_price numeric(10,2));
-- The receipts and line_items policies as they are live: the paying user, and the uploader of the vehicle a receipt is scoped to.
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own receipts" ON public.receipts FOR ALL USING (((SELECT auth.uid()) = user_id));
CREATE POLICY "Users can view own receipts" ON public.receipts FOR SELECT USING (((SELECT auth.uid()) = user_id));
CREATE POLICY "Users can view vehicle receipts" ON public.receipts FOR SELECT USING (
  ((scope_type = 'vehicle') AND (EXISTS (SELECT 1 FROM public.vehicles WHERE (((vehicles.id)::text = receipts.scope_id) AND (vehicles.uploaded_by = (SELECT auth.uid()))))))
  OR ((scope_type = 'user') AND (user_id = (SELECT auth.uid())))
  OR ((scope_type IS NULL) AND (user_id = (SELECT auth.uid()))));
ALTER TABLE public.line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own line items" ON public.line_items FOR SELECT USING (((SELECT auth.uid()) = user_id));

-- The live guard: it must accept every statement of the migration (it fires on CREATE VIEW, ALTER and GRANT).
\ir ../migrations/20261014214500_view_write_guard.sql

-- The two views as production has them on 2026-10-29: owner-run, no filter of their own. anon has no SELECT on the summary there.
CREATE VIEW public.user_receipt_summary AS
 WITH vendor_counts AS (
         SELECT r.user_id, r.vendor_name, count(*) AS receipt_count, sum(r.total_amount) AS vendor_total
           FROM receipts r
          WHERE r.vendor_name IS NOT NULL AND r.processing_status = 'completed'::text AND r.duplicate_of IS NULL AND (r.amount_check = ANY (ARRAY['verified'::receipt_amount_check, 'plausible'::receipt_amount_check]))
          GROUP BY r.user_id, r.vendor_name
        ), category_totals AS (
         SELECT li.user_id, COALESCE(li.category, 'uncategorized'::text) AS category, sum(li.total_price) AS category_total, count(*) AS item_count
           FROM line_items li
          WHERE li.total_price IS NOT NULL
          GROUP BY li.user_id, (COALESCE(li.category, 'uncategorized'::text))
        ), user_stats AS (
         SELECT r.user_id, count(DISTINCT r.id) AS total_receipts, sum(r.total_amount) AS total_spending,
            min(r.transaction_date) AS first_receipt_date, max(r.transaction_date) AS last_receipt_date, avg(r.total_amount) AS avg_receipt_amount
           FROM receipts r
          WHERE r.processing_status = 'completed'::text AND r.duplicate_of IS NULL AND (r.amount_check = ANY (ARRAY['verified'::receipt_amount_check, 'plausible'::receipt_amount_check]))
          GROUP BY r.user_id
        )
 SELECT user_id, total_receipts, total_spending, first_receipt_date, last_receipt_date, avg_receipt_amount,
    COALESCE(( SELECT jsonb_object_agg(vc.vendor_name, jsonb_build_object('count', vc.receipt_count, 'total', vc.vendor_total)) FROM vendor_counts vc WHERE vc.user_id = us.user_id), '{}'::jsonb) AS vendor_breakdown,
    COALESCE(( SELECT jsonb_object_agg(ct.category, jsonb_build_object('total', ct.category_total, 'items', ct.item_count)) FROM category_totals ct WHERE ct.user_id = us.user_id), '{}'::jsonb) AS spending_by_category
   FROM user_stats us;
REVOKE SELECT ON public.user_receipt_summary FROM anon;

CREATE VIEW public.vehicle_receipts_rollup_v AS
 SELECT (scope_id)::uuid AS vehicle_id,
    sum(CASE WHEN (COALESCE(processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) THEN total_amount ELSE (0)::numeric END) AS total_lifetime,
    sum(CASE WHEN ((COALESCE(processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) AND (transaction_date >= ((now() - '90 days'::interval))::date)) THEN total_amount ELSE (0)::numeric END) AS total_90d,
    sum(CASE WHEN ((COALESCE(processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) AND (transaction_date >= ((now() - '365 days'::interval))::date)) THEN total_amount ELSE (0)::numeric END) AS total_365d,
    count(*) FILTER (WHERE (COALESCE(processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text]))) AS receipts_count
   FROM receipts
  WHERE ((scope_type = 'vehicle'::text) AND (NOT receipt_doc_kind_excluded(document_kind)) AND ((duplicate_of IS NULL) AND (amount_check = ANY (ARRAY['verified'::receipt_amount_check, 'plausible'::receipt_amount_check]))))
  GROUP BY scope_id;

-- The public view of receipts as production has it: column-limited, a security barrier, anon and authenticated SELECT only, and a vehicle
-- test of is_public alone.
CREATE VIEW public.receipts_public_summary WITH (security_barrier = true) AS
 SELECT r.id, r.vehicle_id, r.scope_type, r.scope_id, r.source_document_id, r.source_document_table, r.vendor_name, r.total, r.total_amount,
    r.currency, r.receipt_date, r.transaction_date, r.purchase_date, r.invoice_number, r.transaction_number, r.processing_status, r.status,
    r.created_at
   FROM receipts r
     JOIN vehicles v ON v.id = r.vehicle_id OR r.scope_type = 'vehicle'::text AND v.id::text = r.scope_id
  WHERE v.is_public = true;
REVOKE ALL ON public.receipts_public_summary FROM anon, authenticated;
GRANT SELECT ON public.receipts_public_summary TO anon, authenticated;

-- The cast of characters. Users: A pays every receipt and owns some vehicles; B, C, D, M, U each tie to one private vehicle; S is a stranger.
--   A ...a1, B ...b1, C ...c1 (created_by_user_id), D ...e1 (user_id), M ...f1 (contributor), U ...d1 (uploaded_by), S ...51
-- Vehicles (the last three characters label them below):
--   a01 public, uploaded by A    a02 public, uploaded by B    a03 public but deleted, uploaded by A
--   b01 private, user_id A       b02 private, owner_id B      b03 private, created_by_user_id C   b04 private, uploaded_by U
--   b05 private, user_id D       b06 private, contributor M   b07 is_public NULL, user_id A
--   c01 a vehicle id with no vehicles row
INSERT INTO public.vehicles (id, is_public, deleted_at, user_id, owner_id, created_by_user_id, uploaded_by) VALUES
 ('71000000-0000-0000-0000-000000000a01', true,  NULL, '00000000-0000-0000-0000-0000000000a1', NULL, NULL, '00000000-0000-0000-0000-0000000000a1'),
 ('71000000-0000-0000-0000-000000000a02', true,  NULL, NULL, NULL, NULL, '00000000-0000-0000-0000-0000000000b1'),
 ('71000000-0000-0000-0000-000000000a03', true,  '2026-10-01', NULL, NULL, NULL, '00000000-0000-0000-0000-0000000000a1'),
 ('72000000-0000-0000-0000-000000000b01', false, NULL, '00000000-0000-0000-0000-0000000000a1', NULL, NULL, '00000000-0000-0000-0000-0000000000a1'),
 ('72000000-0000-0000-0000-000000000b02', false, NULL, NULL, '00000000-0000-0000-0000-0000000000b1', NULL, NULL),
 ('72000000-0000-0000-0000-000000000b03', false, NULL, NULL, NULL, '00000000-0000-0000-0000-0000000000c1', NULL),
 ('72000000-0000-0000-0000-000000000b04', false, NULL, NULL, NULL, NULL, '00000000-0000-0000-0000-0000000000d1'),
 ('72000000-0000-0000-0000-000000000b05', false, NULL, '00000000-0000-0000-0000-0000000000e1', NULL, NULL, NULL),
 ('72000000-0000-0000-0000-000000000b06', false, NULL, NULL, NULL, NULL, NULL),
 ('72000000-0000-0000-0000-000000000b07', NULL,  NULL, '00000000-0000-0000-0000-0000000000a1', NULL, NULL, NULL);
INSERT INTO public.vehicle_contributors VALUES
 ('72000000-0000-0000-0000-000000000b06', '00000000-0000-0000-0000-0000000000f1', 'mechanic', 'active');

-- Receipts scoped to each of the eleven vehicle ids, all paid by A. Three count (175.00 in all, 100.00 in 90 days, 150.00 in 365 days);
-- three never do (a duplicate, an unchecked amount, a document kind the rollup leaves out).
INSERT INTO public.receipts (user_id, vendor_name, total_amount, processing_status, transaction_date, scope_type, scope_id, amount_check, duplicate_of, document_kind)
SELECT '00000000-0000-0000-0000-0000000000a1', NULL, x.amt, x.st, current_date - x.age, 'vehicle', v.id::text, x.chk, x.dup, x.kind
FROM (VALUES ('71000000-0000-0000-0000-000000000a01'::uuid), ('71000000-0000-0000-0000-000000000a02'), ('71000000-0000-0000-0000-000000000a03'),
             ('72000000-0000-0000-0000-000000000b01'), ('72000000-0000-0000-0000-000000000b02'), ('72000000-0000-0000-0000-000000000b03'),
             ('72000000-0000-0000-0000-000000000b04'), ('72000000-0000-0000-0000-000000000b05'), ('72000000-0000-0000-0000-000000000b06'),
             ('72000000-0000-0000-0000-000000000b07'), ('73000000-0000-0000-0000-000000000c01')) v(id)
CROSS JOIN (VALUES
  (100.00, 'validated', 10,  'verified'::public.receipt_amount_check,  NULL::uuid, NULL::public.receipt_doc_kind),
  ( 50.00, 'saved',     200, 'plausible', NULL, NULL),
  ( 25.00, 'validated', 400, 'verified',  NULL, NULL),
  (999.00, 'validated', 5,   'verified',  '99999999-0000-0000-0000-000000000000', NULL),
  (999.00, 'validated', 5,   'unchecked', NULL, NULL),
  (999.00, 'validated', 5,   'verified',  NULL, 'tax_form')) x(amt, st, age, chk, dup, kind);

-- The spending summary: A has four counted receipts (one scoped to b04, the vehicle U uploaded) and three that never count; B has one.
INSERT INTO public.receipts (id, user_id, vendor_name, total_amount, processing_status, transaction_date, scope_type, scope_id, amount_check, duplicate_of) VALUES
 ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Acme', 100.00, 'completed', '2026-01-10', 'user', NULL, 'verified', NULL),
 ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Acme',  50.00, 'completed', '2026-02-01', 'user', NULL, 'plausible', NULL),
 ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'Beta',  25.00, 'completed', '2026-03-01', 'user', NULL, 'verified', NULL),
 ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'Acme', 100.00, 'completed', '2026-01-10', 'user', NULL, 'verified', 'a0000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', 'Acme', 999.00, 'completed', '2026-01-11', 'user', NULL, 'unchecked', NULL),
 ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a1', 'Acme',  10.00, 'pending',   '2026-01-12', 'user', NULL, 'verified', NULL),
 ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a1', 'Acme',  75.00, 'completed', '2026-05-01', 'vehicle', '72000000-0000-0000-0000-000000000b04', 'verified', NULL),
 ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'Gamma', 500.00, 'completed', '2026-04-01', 'user', NULL, 'verified', NULL);
-- Receipts that reach a vehicle through vehicle_id, the other arm of the public view's join: on a01 (public), a03 (public, deleted) and b01
-- (private). Pending and user-scoped, so neither summary nor rollup counts them.
INSERT INTO public.receipts (id, user_id, vendor_name, total_amount, processing_status, scope_type, vehicle_id, amount_check) VALUES
 ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Acme', 10.00, 'pending', 'user', '71000000-0000-0000-0000-000000000a01', 'verified'),
 ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Acme', 10.00, 'pending', 'user', '71000000-0000-0000-0000-000000000a03', 'verified'),
 ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'Acme', 10.00, 'pending', 'user', '72000000-0000-0000-0000-000000000b01', 'verified');
INSERT INTO public.line_items (receipt_id, user_id, category, total_price) VALUES
 ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'parts', 60.00),
 ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'labor', 40.00),
 ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', NULL, 25.00),
 ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'parts', NULL),
 ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'parts', 500.00);

-- Helpers: what the rollup returns to the current role (an invoker function, so it runs as the caller), and a filter that records what it saw.
CREATE FUNCTION public.t_rollup_ids() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(string_agg(right(vehicle_id::text, 3), ',' ORDER BY vehicle_id), '') FROM public.vehicle_receipts_rollup_v $$;
-- What the public receipts view returns to the current role, counted per vehicle (a receipt is labelled by the vehicle it reaches).
CREATE FUNCTION public.t_public_by_vehicle() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(string_agg(lbl || ':' || n, ',' ORDER BY lbl), '') FROM (
     SELECT right(coalesce(vehicle_id::text, scope_id), 3) AS lbl, count(*) AS n FROM public.receipts_public_summary GROUP BY 1) t $$;
CREATE FUNCTION public.t_leak(p uuid) RETURNS boolean LANGUAGE plpgsql STABLE COST 0.0001 AS $$
BEGIN
  PERFORM set_config('test.leaked', coalesce(current_setting('test.leaked', true), '') || right(p::text, 3) || ',', false);
  RETURN true;
END $$;
-- What the old views answered, kept to compare the new answers with.
-- M also works on the public vehicle a01: a contributor with a working role is one of the vehicle's people.
INSERT INTO public.vehicle_contributors VALUES
 ('71000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000f1', 'mechanic', 'active');
-- One receipt of a01 with a stated total but no total_amount, and one with neither (the Firebird has three such pages).
INSERT INTO public.receipts (id, user_id, vendor_name, total, total_amount, processing_status, scope_type, scope_id, amount_check, receipt_date, invoice_number) VALUES
 ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Atomic Motors', 2190.64, NULL, 'completed', 'vehicle', '71000000-0000-0000-0000-000000000a01', 'plausible', '2025-01-13', 'WO 10370'),
 ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Atomic Motors', NULL, NULL, 'completed', 'vehicle', '71000000-0000-0000-0000-000000000a01', 'no_amount', '2024-10-07', 'WO 9810');

-- The live state of 2026-11-05.
\ir ../migrations/20261106160000_receipt_views_privacy.sql
\ir ../migrations/20261031042352_receipts_public_summary_indexed_vehicle_join.sql

-- What the views answered before the mask, by role, kept to compare with. Money columns are read by the superuser (no user: masked after).
CREATE TABLE public.t_before_public AS SELECT * FROM public.receipts_public_summary;
CREATE TABLE public.t_before_rollup AS SELECT * FROM public.vehicle_receipts_rollup_v;
CREATE FUNCTION public.t_public_keys() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(string_agg(right(id::text, 3) || '@' || right(coalesce(vehicle_id::text, scope_id), 3), ',' ORDER BY id, vehicle_id, scope_id), '')
     FROM public.receipts_public_summary $$;
CREATE FUNCTION public.t_leak_money(p numeric) RETURNS boolean LANGUAGE plpgsql STABLE COST 0.0001 AS $$
BEGIN
  PERFORM set_config('test.leaked', coalesce(current_setting('test.leaked', true), '') || coalesce(p::text, 'null') || ',', false);
  RETURN true;
END $$;
-- Every caller's row keys before the mask (anon, a stranger, A, B, M and a service-role request).
CREATE TABLE public.t_keys_before (who text, keys text, rollup text);
DO $$
DECLARE who text;
BEGIN
  SET ROLE anon; PERFORM set_config('test.auth_uid', '', false);
  INSERT INTO public.t_keys_before VALUES ('anon', public.t_public_keys(), public.t_rollup_ids());
  RESET ROLE; SET ROLE authenticated;
  FOREACH who IN ARRAY ARRAY['00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1'] LOOP
    PERFORM set_config('test.auth_uid', who, false);
    INSERT INTO public.t_keys_before VALUES (right(who, 2), public.t_public_keys(), public.t_rollup_ids());
  END LOOP;
  RESET ROLE; SET ROLE service_role; PERFORM set_config('test.auth_uid', '', false); PERFORM set_config('test.auth_role', 'service_role', false);
  INSERT INTO public.t_keys_before VALUES ('service', public.t_public_keys(), public.t_rollup_ids());
  RESET ROLE; PERFORM set_config('test.auth_role', '', false);
END $$;
-- Before: the leak this migration closes. anon reads the amounts of the public vehicles' receipts.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
DO $$
DECLARE n int; s numeric;
BEGIN
  SELECT count(*), sum(coalesce(total, total_amount)) INTO n, s FROM public.receipts_public_summary;
  IF n <> 15 OR s <> 8544.64 THEN RAISE EXCEPTION 'fixture: anon should read 15 public receipts and 8544.64 before the mask, got % and %', n, s; END IF;
  IF (SELECT total_lifetime FROM public.vehicle_receipts_rollup_v WHERE vehicle_id = '71000000-0000-0000-0000-000000000a01') <> 175.00 THEN
    RAISE EXCEPTION 'fixture: anon should read a01''s lifetime total before the mask';
  END IF;
END $$;
RESET ROLE;

-- The migration under test.
\ir ../migrations/20261109140000_receipt_views_money_mask.sql

-- anon: the same receipts, no money, amounts_visible false, the rest of the row intact.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
DO $$
DECLARE n int; r record;
BEGIN
  IF public.t_public_by_vehicle() <> 'a01:9,a02:6' THEN RAISE EXCEPTION 'anon: expected a01:9,a02:6, got %', public.t_public_by_vehicle(); END IF;
  SELECT count(*) INTO n FROM public.receipts_public_summary WHERE total IS NOT NULL OR total_amount IS NOT NULL OR amounts_visible IS DISTINCT FROM false;
  IF n <> 0 THEN RAISE EXCEPTION 'anon: % rows still carry an amount or say it is visible', n; END IF;
  SELECT * INTO r FROM public.receipts_public_summary WHERE id = 'd0000000-0000-0000-0000-000000000001';
  IF r.vendor_name <> 'Atomic Motors' OR r.receipt_date <> '2025-01-13' OR r.invoice_number <> 'WO 10370' OR r.processing_status <> 'completed'
     OR r.scope_id <> '71000000-0000-0000-0000-000000000a01' OR r.total IS NOT NULL OR r.amounts_visible THEN
    RAISE EXCEPTION 'anon: the masked row lost more than its money: %', r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.receipts_public_summary WHERE vehicle_id = '72000000-0000-0000-0000-000000000b01' OR scope_id = '72000000-0000-0000-0000-000000000b01'
             OR scope_id = '71000000-0000-0000-0000-000000000a03') THEN
    RAISE EXCEPTION 'anon: read a receipt of a private or deleted vehicle';
  END IF;
  -- a filter the caller writes on the amount sees the masked column only
  PERFORM set_config('test.leaked', '', false);
  PERFORM count(*) FROM public.receipts_public_summary WHERE public.t_leak_money(total) AND public.t_leak_money(total_amount);
  IF current_setting('test.leaked') <> repeat('null,', 30) THEN RAISE EXCEPTION 'anon: a caller filter saw an amount: %', current_setting('test.leaked'); END IF;
  SELECT count(*) INTO n FROM public.receipts_public_summary WHERE total > 0 OR total_amount > 0 OR coalesce(total, total_amount) IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'anon: a filter on the amount matched % rows', n; END IF;
  -- the rollup: counts public, totals not
  IF public.t_rollup_ids() <> 'a01,a02' THEN RAISE EXCEPTION 'anon: rollup expected a01,a02, got %', public.t_rollup_ids(); END IF;
  SELECT * INTO r FROM public.vehicle_receipts_rollup_v WHERE vehicle_id = '71000000-0000-0000-0000-000000000a01';
  IF r.receipts_count <> 3 OR r.total_lifetime IS NOT NULL OR r.total_90d IS NOT NULL OR r.total_365d IS NOT NULL OR r.amounts_visible THEN
    RAISE EXCEPTION 'anon: rollup for a01 should count 3 and show no total, got %', r;
  END IF;
END $$;
RESET ROLE;

-- A signed-in stranger is anon with a name.
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-000000000051', false);
DO $$
DECLARE n int;
BEGIN
  IF public.t_public_by_vehicle() <> 'a01:9,a02:6' THEN RAISE EXCEPTION 'stranger: expected a01:9,a02:6, got %', public.t_public_by_vehicle(); END IF;
  SELECT count(*) INTO n FROM public.receipts_public_summary WHERE total IS NOT NULL OR total_amount IS NOT NULL OR amounts_visible;
  IF n <> 0 THEN RAISE EXCEPTION 'stranger: % rows carry an amount', n; END IF;
  IF (SELECT total_lifetime FROM public.vehicle_receipts_rollup_v WHERE vehicle_id = '71000000-0000-0000-0000-000000000a01') IS NOT NULL THEN
    RAISE EXCEPTION 'stranger: read a01''s rollup total';
  END IF;
END $$;

-- The vehicle's people read their own vehicle's amounts, amounts_visible true, and no other vehicle's.
--   A: user_id and uploaded_by of a01 (and of the private b01). B: uploaded_by of a02. M: contributor on a01.
DO $$
DECLARE who text; mine text; bad int; r record;
BEGIN
  FOR who, mine IN VALUES ('00000000-0000-0000-0000-0000000000a1', 'a01'), ('00000000-0000-0000-0000-0000000000b1', 'a02'), ('00000000-0000-0000-0000-0000000000f1', 'a01') LOOP
    PERFORM set_config('test.auth_uid', who, false);
    IF public.t_public_by_vehicle() <> 'a01:9,a02:6' THEN RAISE EXCEPTION 'user %: expected a01:9,a02:6, got %', right(who, 2), public.t_public_by_vehicle(); END IF;
    -- their vehicle: visible, and the amounts are the ones the base row holds
    SELECT count(*) INTO bad FROM public.receipts_public_summary s JOIN public.receipts b ON b.id = s.id
     WHERE right(coalesce(s.vehicle_id::text, s.scope_id), 3) = mine
       AND (NOT s.amounts_visible OR s.total IS DISTINCT FROM b.total OR s.total_amount IS DISTINCT FROM b.total_amount);
    IF bad <> 0 THEN RAISE EXCEPTION 'user %: % rows of their own vehicle % are masked or wrong', right(who, 2), bad, mine; END IF;
    -- the other public vehicle: masked
    SELECT count(*) INTO bad FROM public.receipts_public_summary
     WHERE right(coalesce(vehicle_id::text, scope_id), 3) <> mine AND (amounts_visible OR total IS NOT NULL OR total_amount IS NOT NULL);
    IF bad <> 0 THEN RAISE EXCEPTION 'user %: read % amounts of a vehicle not theirs', right(who, 2), bad; END IF;
    -- the rollup of their vehicle carries its totals; the other public vehicle's does not
    SELECT * INTO r FROM public.vehicle_receipts_rollup_v WHERE right(vehicle_id::text, 3) = mine;
    IF r.total_lifetime <> 175.00 OR r.total_90d <> 100.00 OR r.total_365d <> 150.00 OR r.receipts_count <> 3 OR NOT r.amounts_visible THEN
      RAISE EXCEPTION 'user %: wrong rollup for %, got %', right(who, 2), mine, r;
    END IF;
    SELECT * INTO r FROM public.vehicle_receipts_rollup_v WHERE right(vehicle_id::text, 3) <> mine AND vehicle_id::text LIKE '71%';
    IF r.total_lifetime IS NOT NULL OR r.receipts_count <> 3 OR r.amounts_visible THEN
      RAISE EXCEPTION 'user %: read the rollup total of a public vehicle not theirs: %', right(who, 2), r;
    END IF;
  END LOOP;
  -- A's private vehicle b01 stays A's alone, with its totals; the same row the old view gave.
  PERFORM set_config('test.auth_uid', '00000000-0000-0000-0000-0000000000a1', false);
  SELECT * INTO r FROM public.vehicle_receipts_rollup_v WHERE vehicle_id = '72000000-0000-0000-0000-000000000b01';
  IF r.total_lifetime <> 175.00 OR r.receipts_count <> 3 OR NOT r.amounts_visible THEN RAISE EXCEPTION 'owner A: wrong rollup for b01: %', r; END IF;
  -- the receipt A pays on U's vehicle b04 is not a public row: A is not one of b04's people and b04 is private
  IF EXISTS (SELECT 1 FROM public.receipts_public_summary WHERE id = 'a0000000-0000-0000-0000-000000000007') THEN
    RAISE EXCEPTION 'owner A: the public view served a receipt of a private vehicle';
  END IF;
  -- the one A owns no vehicle for reads nothing of A's money: S again
  PERFORM set_config('test.auth_uid', '00000000-0000-0000-0000-000000000051', false);
  IF EXISTS (SELECT 1 FROM public.vehicle_receipts_rollup_v WHERE vehicle_id = '72000000-0000-0000-0000-000000000b01') THEN
    RAISE EXCEPTION 'stranger S: read the rollup of a private vehicle';
  END IF;
END $$;
RESET ROLE;

-- A service-role request reads every public row with its amounts.
SET ROLE service_role;
SELECT set_config('test.auth_uid', '', false);
SELECT set_config('test.auth_role', 'service_role', false);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.receipts_public_summary s JOIN public.receipts b ON b.id = s.id
   WHERE NOT s.amounts_visible OR s.total IS DISTINCT FROM b.total OR s.total_amount IS DISTINCT FROM b.total_amount;
  IF n <> 0 THEN RAISE EXCEPTION 'service_role: % rows masked', n; END IF;
  IF public.t_public_by_vehicle() <> 'a01:9,a02:6' THEN RAISE EXCEPTION 'service_role: expected a01:9,a02:6, got %', public.t_public_by_vehicle(); END IF;
  IF (SELECT total_lifetime FROM public.vehicle_receipts_rollup_v WHERE vehicle_id = '71000000-0000-0000-0000-000000000a01') <> 175.00 THEN
    RAISE EXCEPTION 'service_role: rollup total masked';
  END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_role', '', false);

-- Nothing but the money changed: every caller's row keys are the ones before the mask, and the superuser's rows match the old ones
-- column for column once the money and the new column are set aside.
DO $$
DECLARE who text; keys text; rollup text; n int;
BEGIN
  FOR who, keys, rollup IN SELECT * FROM public.t_keys_before LOOP
    IF who = 'anon' THEN SET ROLE anon; PERFORM set_config('test.auth_uid', '', false);
    ELSIF who = 'service' THEN SET ROLE service_role; PERFORM set_config('test.auth_uid', '', false); PERFORM set_config('test.auth_role', 'service_role', false);
    ELSE SET ROLE authenticated; PERFORM set_config('test.auth_uid', '00000000-0000-0000-0000-0000000000' || who, false);
    END IF;
    IF public.t_public_keys() IS DISTINCT FROM keys THEN RAISE EXCEPTION '%: the public receipt rows changed: % vs %', who, public.t_public_keys(), keys; END IF;
    IF public.t_rollup_ids() IS DISTINCT FROM rollup THEN RAISE EXCEPTION '%: the rollup rows changed: % vs %', who, public.t_rollup_ids(), rollup; END IF;
    RESET ROLE; PERFORM set_config('test.auth_role', '', false);
  END LOOP;
  SELECT count(*) INTO n FROM (
    SELECT id, vehicle_id, scope_type, scope_id, source_document_id, source_document_table, vendor_name, currency, receipt_date, transaction_date,
           purchase_date, invoice_number, transaction_number, processing_status, status, created_at FROM public.receipts_public_summary
    EXCEPT ALL
    SELECT id, vehicle_id, scope_type, scope_id, source_document_id, source_document_table, vendor_name, currency, receipt_date, transaction_date,
           purchase_date, invoice_number, transaction_number, processing_status, status, created_at FROM public.t_before_public) x;
  IF n <> 0 THEN RAISE EXCEPTION 'the public view changed % rows beyond the money', n; END IF;
  SELECT count(*) INTO n FROM (SELECT * FROM public.t_before_public EXCEPT ALL
    SELECT id, vehicle_id, scope_type, scope_id, source_document_id, source_document_table, vendor_name, total, total_amount, currency, receipt_date,
           transaction_date, purchase_date, invoice_number, transaction_number, processing_status, status, created_at FROM public.receipts_public_summary) x;
  IF n <> (SELECT count(*) FROM public.t_before_public WHERE total IS NOT NULL OR total_amount IS NOT NULL) THEN
    RAISE EXCEPTION 'a request with no user should now see every public row that had an amount masked (14), % differ', n;
  END IF;
  SELECT count(*) INTO n FROM (SELECT vehicle_id, receipts_count FROM public.vehicle_receipts_rollup_v EXCEPT ALL SELECT vehicle_id, receipts_count FROM public.t_before_rollup) x;
  IF n <> 0 THEN RAISE EXCEPTION 'the rollup changed % rows beyond the money', n; END IF;
END $$;

-- The gate still reads the vehicle as it is now: made private, a vehicle leaves anon's answer; its owner keeps it, with the money.
UPDATE public.vehicles SET is_public = false WHERE id = '71000000-0000-0000-0000-000000000a01';
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
DO $$ BEGIN
  IF public.t_public_by_vehicle() <> 'a02:6' OR public.t_rollup_ids() <> 'a02' THEN
    RAISE EXCEPTION 'anon after the flip: expected a02 only, got % / %', public.t_public_by_vehicle(), public.t_rollup_ids();
  END IF;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-0000000000a1', false);
DO $$ BEGIN
  IF public.t_rollup_ids() <> 'a01,a02,a03,b01,b07' OR (SELECT total_lifetime FROM public.vehicle_receipts_rollup_v WHERE vehicle_id = '71000000-0000-0000-0000-000000000a01') <> 175.00 THEN
    RAISE EXCEPTION 'owner A after the flip: expected a01 with its total, got %', public.t_rollup_ids();
  END IF;
END $$;
RESET ROLE;
UPDATE public.vehicles SET is_public = true WHERE id = '71000000-0000-0000-0000-000000000a01';

-- Grants and options: only what the contract above needs, and nothing that writes.
DO $$
DECLARE acl text; r regclass;
BEGIN
  FOREACH r IN ARRAY ARRAY['public.receipts_public_summary'::regclass, 'public.vehicle_receipts_rollup_v'::regclass] LOOP
    SELECT coalesce(string_agg(coalesce(ro.rolname, 'PUBLIC') || ':' || a.privilege_type, ',' ORDER BY coalesce(ro.rolname, 'PUBLIC'), a.privilege_type), '')
      INTO acl FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles ro ON ro.oid = a.grantee
     WHERE c.oid = r AND coalesce(ro.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated');
    IF acl <> 'anon:SELECT,authenticated:SELECT' THEN RAISE EXCEPTION '%: grants to PUBLIC, anon and authenticated are %', r, acl; END IF;
    IF NOT coalesce((SELECT 'security_barrier=true' = ANY (reloptions) FROM pg_class WHERE oid = r), false) THEN RAISE EXCEPTION '%: no security barrier', r; END IF;
    IF pg_relation_is_updatable(r, false) <> 0 THEN RAISE EXCEPTION '%: updatable', r; END IF;
    IF obj_description(r, 'pg_class') IS NULL THEN RAISE EXCEPTION '%: lost its comment', r; END IF;
    BEGIN EXECUTE format('SELECT file_url FROM %s', r); RAISE EXCEPTION '% exposes file_url', r;
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END LOOP;
END $$;

-- Replay: the same definitions, the same answers.
CREATE TABLE public.t_after_public AS SELECT * FROM public.receipts_public_summary;
\ir ../migrations/20261109140000_receipt_views_money_mask.sql
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (SELECT * FROM public.receipts_public_summary EXCEPT ALL SELECT * FROM public.t_after_public) x;
  IF n <> 0 THEN RAISE EXCEPTION 'replay changed the public view (% rows)', n; END IF;
END $$;

-- Drift: a definition this migration was not written from makes it stop and change nothing (the next ERROR line is that refusal).
CREATE OR REPLACE VIEW public.receipts_public_summary WITH (security_barrier = true) AS
 SELECT r.id, r.vehicle_id, r.scope_type, r.scope_id, r.source_document_id, r.source_document_table, r.vendor_name, r.total, r.total_amount,
    r.currency, r.receipt_date, r.transaction_date, r.purchase_date, r.invoice_number, r.transaction_number, r.processing_status, r.status,
    r.created_at, false AS amounts_visible
   FROM public.receipts r JOIN public.vehicles v ON v.id = r.vehicle_id
  WHERE v.is_public = true AND r.status = 'later_filter';
\set ON_ERROR_STOP off
\ir ../migrations/20261109140000_receipt_views_money_mask.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF pg_get_viewdef('public.receipts_public_summary'::regclass) NOT LIKE '%later_filter%' THEN
    RAISE EXCEPTION 'drift: the migration replaced a definition it was not written from';
  END IF;
END $$;

SELECT 'test_receipt_views_money_mask: PASS' AS result;
