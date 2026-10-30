-- Empty disposable PG17 only, as a superuser (the live view_write_guard event trigger is installed), from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_receipt_views_privacy -f supabase/sql/test_receipt_views_privacy.sql
-- scripts/ci/run-db-contracts.sh runs it that way in the db-contracts job.
-- Contract for 20261106160000_receipt_views_privacy.sql. Synthetic rows only; never production.
-- With the 2026-10-29 definitions (owner-run views over receipts, which has row-level security), a signed-in stranger reads another
-- user's spending summary, anon reads the receipt totals of every vehicle, public or not, and the public receipts view serves the
-- receipts of public vehicles that are deleted. After the migration:
--   * user_receipt_summary: anon is refused. A signed-in user reads exactly their own row, with the numbers the old view gave them.
--     A stranger, an uploader who can read another user's receipt on their vehicle, a contributor and a request with no user read nothing.
--   * vehicle_receipts_rollup_v: anon and a stranger read the rollups of public, undeleted vehicles, with unchanged totals, and nothing
--     else. An owner (by each of owner_id, user_id, created_by_user_id, uploaded_by) and a contributor read their own vehicle too; a payer
--     with no tie to a vehicle does not. A filter the caller writes cannot see a hidden row. A vehicle made private or deleted leaves
--     anon's answer at once.
--   * receipts_public_summary: a public vehicle that is deleted yields no row to anon, to a stranger or to its owner, through either
--     arm of the view's join (vehicle_id, or scope_id on a vehicle scope); the other public vehicles' rows are unchanged.
--   * grants and options: anon has nothing on the summary and SELECT only on the two public views; authenticated has SELECT only on
--     all three; security_invoker and security_barrier are set; no view is updatable.
--   * the live view_write_guard accepts the migration, it is replay-safe, and it stops without changing anything when a live
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
CREATE TABLE public.t_before_user_summary AS SELECT * FROM public.user_receipt_summary;
CREATE TABLE public.t_before_rollup AS SELECT * FROM public.vehicle_receipts_rollup_v;
CREATE TABLE public.t_before_public AS SELECT * FROM public.receipts_public_summary;

-- Before: the leaks this migration closes.
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-000000000051', false);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.user_receipt_summary;
  IF n <> 2 THEN RAISE EXCEPTION 'fixture: a stranger should read both users'' summaries before the migration, got %', n; END IF;
END $$;
RESET ROLE;
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
DO $$
DECLARE ids text;
BEGIN
  ids := public.t_rollup_ids();
  IF ids <> 'a01,a02,a03,b01,b02,b03,b04,b05,b06,b07,c01' THEN
    RAISE EXCEPTION 'fixture: anon should read all eleven rollups before the migration, got %', ids;
  END IF;
  BEGIN PERFORM 1 FROM public.user_receipt_summary; RAISE EXCEPTION 'fixture: anon should have no SELECT on the summary';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ids := public.t_public_by_vehicle();
  IF ids <> 'a01:7,a02:6,a03:7' THEN
    RAISE EXCEPTION 'fixture: anon should read the receipts of the deleted public vehicle a03 before the migration, got %', ids;
  END IF;
END $$;
RESET ROLE;

-- The migration, twice: it must be replay-safe, and the live guard must accept every statement of it.
\ir ../migrations/20261106160000_receipt_views_privacy.sql
\ir ../migrations/20261106160000_receipt_views_privacy.sql

-- user_receipt_summary: anon is refused.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.user_receipt_summary; RAISE EXCEPTION 'anon read user_receipt_summary';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- user_receipt_summary: A reads exactly A's row, the row the old view gave A.
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-0000000000a1', false);
DO $$
DECLARE n int; s record;
BEGIN
  SELECT count(*) INTO n FROM public.user_receipt_summary;
  IF n <> 1 THEN RAISE EXCEPTION 'owner A: expected 1 row, got %', n; END IF;
  SELECT * INTO s FROM public.user_receipt_summary;
  IF s.user_id <> '00000000-0000-0000-0000-0000000000a1' OR s.total_receipts <> 4 OR s.total_spending <> 250.00
     OR s.first_receipt_date <> '2026-01-10' OR s.last_receipt_date <> '2026-05-01' OR round(s.avg_receipt_amount, 2) <> 62.50
     OR s.vendor_breakdown IS DISTINCT FROM '{"Acme": {"count": 3, "total": 225.00}, "Beta": {"count": 1, "total": 25.00}}'::jsonb
     OR s.spending_by_category IS DISTINCT FROM
        '{"parts": {"items": 1, "total": 60.00}, "labor": {"items": 1, "total": 40.00}, "uncategorized": {"items": 1, "total": 25.00}}'::jsonb THEN
    RAISE EXCEPTION 'owner A: wrong summary %', s;
  END IF;
  SELECT count(*) INTO n FROM (SELECT * FROM public.user_receipt_summary EXCEPT
    SELECT * FROM public.t_before_user_summary WHERE user_id = '00000000-0000-0000-0000-0000000000a1') x;
  IF n <> 0 THEN RAISE EXCEPTION 'owner A: the row differs from the one the old view gave'; END IF;
  SELECT count(*) INTO n FROM (SELECT * FROM public.t_before_user_summary WHERE user_id = '00000000-0000-0000-0000-0000000000a1' EXCEPT
    SELECT * FROM public.user_receipt_summary) x;
  IF n <> 0 THEN RAISE EXCEPTION 'owner A: the old row is not the new one'; END IF;
END $$;
-- B reads B's row, not A's.
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-0000000000b1', false);
DO $$
DECLARE n int; s record;
BEGIN
  SELECT count(*) INTO n FROM public.user_receipt_summary;
  IF n <> 1 THEN RAISE EXCEPTION 'owner B: expected 1 row, got %', n; END IF;
  SELECT * INTO s FROM public.user_receipt_summary;
  IF s.user_id <> '00000000-0000-0000-0000-0000000000b1' OR s.total_receipts <> 1 OR s.total_spending <> 500.00
     OR s.vendor_breakdown IS DISTINCT FROM '{"Gamma": {"count": 1, "total": 500.00}}'::jsonb
     OR s.spending_by_category IS DISTINCT FROM '{"parts": {"items": 1, "total": 500.00}}'::jsonb THEN
    RAISE EXCEPTION 'owner B: wrong summary %', s;
  END IF;
END $$;
-- Everyone else reads nothing. U can read A's receipt on the vehicle U uploaded (row-level security allows it), and still gets no summary row.
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-0000000000d1', false);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.receipts WHERE id = 'a0000000-0000-0000-0000-000000000007';
  IF n <> 1 THEN RAISE EXCEPTION 'fixture: the uploader should read the receipt scoped to their vehicle, got %', n; END IF;
  SELECT count(*) INTO n FROM public.user_receipt_summary;
  IF n <> 0 THEN RAISE EXCEPTION 'uploader U: expected no summary row, got %', n; END IF;
END $$;
DO $$
DECLARE n int; who text;
BEGIN
  FOREACH who IN ARRAY ARRAY['00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000000c1',
                             '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1'] LOOP
    PERFORM set_config('test.auth_uid', who, false);
    SELECT count(*) INTO n FROM public.user_receipt_summary;
    IF n <> 0 THEN RAISE EXCEPTION 'stranger %: expected no summary row, got %', who, n; END IF;
  END LOOP;
END $$;
RESET ROLE;
-- A request with no user: service_role carries none, so it reads no one's summary.
SET ROLE service_role;
SELECT set_config('test.auth_uid', '', false);
SELECT set_config('test.auth_role', 'service_role', false);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.user_receipt_summary;
  IF n <> 0 THEN RAISE EXCEPTION 'service_role: expected no summary row, got %', n; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_role', '', false);

-- vehicle_receipts_rollup_v: anon and a stranger read the public, undeleted vehicles and nothing else.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
DO $$
DECLARE ids text; r record;
BEGIN
  ids := public.t_rollup_ids();
  IF ids <> 'a01,a02' THEN RAISE EXCEPTION 'anon: expected a01,a02, got %', ids; END IF;
  SELECT * INTO r FROM public.vehicle_receipts_rollup_v WHERE vehicle_id = '71000000-0000-0000-0000-000000000a01';
  IF r.total_lifetime <> 175.00 OR r.total_90d <> 100.00 OR r.total_365d <> 150.00 OR r.receipts_count <> 3 THEN
    RAISE EXCEPTION 'anon: wrong totals for a01, got %', r;
  END IF;
  -- asking for a hidden vehicle by id gets nothing
  IF EXISTS (SELECT 1 FROM public.vehicle_receipts_rollup_v WHERE vehicle_id IN
     ('72000000-0000-0000-0000-000000000b01', '71000000-0000-0000-0000-000000000a03', '72000000-0000-0000-0000-000000000b07', '73000000-0000-0000-0000-000000000c01')) THEN
    RAISE EXCEPTION 'anon: a hidden vehicle answered by id';
  END IF;
END $$;
-- A filter the caller writes (not leakproof) sees only what the gate lets through: with the barrier it records a01 and a02, never a hidden id.
SELECT set_config('test.leaked', '', false);
SELECT count(*) FROM public.vehicle_receipts_rollup_v WHERE public.t_leak(vehicle_id);
DO $$
DECLARE seen text;
BEGIN
  SELECT string_agg(DISTINCT x, ',' ORDER BY x) INTO seen
    FROM unnest(string_to_array(trim(BOTH ',' FROM current_setting('test.leaked')), ',')) x;
  IF seen IS DISTINCT FROM 'a01,a02' THEN RAISE EXCEPTION 'anon: a caller filter saw % before the gate', seen; END IF;
END $$;
RESET ROLE;
-- The same totals the old view gave for the public vehicles (superuser reads the new view as a request with no user).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (SELECT * FROM public.vehicle_receipts_rollup_v EXCEPT
    SELECT * FROM public.t_before_rollup WHERE vehicle_id IN ('71000000-0000-0000-0000-000000000a01', '71000000-0000-0000-0000-000000000a02')) x;
  IF n <> 0 THEN RAISE EXCEPTION 'rollup totals changed for the public vehicles (new minus old: %)', n; END IF;
  SELECT count(*) INTO n FROM (SELECT * FROM public.t_before_rollup WHERE vehicle_id IN ('71000000-0000-0000-0000-000000000a01', '71000000-0000-0000-0000-000000000a02') EXCEPT
    SELECT * FROM public.vehicle_receipts_rollup_v) x;
  IF n <> 0 THEN RAISE EXCEPTION 'rollup totals changed for the public vehicles (old minus new: %)', n; END IF;
END $$;

-- Each signed-in user reads the public vehicles and the ones they own or may access, and no other. A pays for every receipt and still
-- reads only the vehicles it is tied to.
SET ROLE authenticated;
DO $$
DECLARE who text; want text; ids text;
BEGIN
  FOR who, want IN VALUES
    ('00000000-0000-0000-0000-000000000051', 'a01,a02'),                      -- S, a stranger
    ('00000000-0000-0000-0000-0000000000a1', 'a01,a02,a03,b01,b07'),          -- A: uploader of a03, user_id of b01 and b07
    ('00000000-0000-0000-0000-0000000000b1', 'a01,a02,b02'),                  -- B: owner_id of b02
    ('00000000-0000-0000-0000-0000000000c1', 'a01,a02,b03'),                  -- C: created_by_user_id of b03
    ('00000000-0000-0000-0000-0000000000d1', 'a01,a02,b04'),                  -- U: uploaded_by of b04
    ('00000000-0000-0000-0000-0000000000e1', 'a01,a02,b05'),                  -- D: user_id of b05
    ('00000000-0000-0000-0000-0000000000f1', 'a01,a02,b06')                   -- M: contributor on b06
  LOOP
    PERFORM set_config('test.auth_uid', who, false);
    ids := public.t_rollup_ids();
    IF ids <> want THEN RAISE EXCEPTION 'user %: expected %, got %', right(who, 2), want, ids; END IF;
  END LOOP;
END $$;
-- The owner reads a private vehicle by id with the right totals; a stranger reads nothing for it.
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-0000000000a1', false);
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.vehicle_receipts_rollup_v WHERE vehicle_id = '72000000-0000-0000-0000-000000000b01';
  IF r.total_lifetime <> 175.00 OR r.total_90d <> 100.00 OR r.total_365d <> 150.00 OR r.receipts_count <> 3 THEN
    RAISE EXCEPTION 'owner A: wrong totals for b01, got %', r;
  END IF;
END $$;
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-000000000051', false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.vehicle_receipts_rollup_v WHERE vehicle_id = '72000000-0000-0000-0000-000000000b01') THEN
    RAISE EXCEPTION 'stranger S: read the rollup of a private vehicle by id';
  END IF;
END $$;
RESET ROLE;

-- receipts_public_summary: the deleted public vehicle a03 yields nothing to anon, to a stranger or to its own owner, through either arm of the
-- join (the six scope_id receipts and the one vehicle_id receipt); the live public vehicles keep every row; the private vehicle stays hidden.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
DO $$
DECLARE ids text; r record;
BEGIN
  ids := public.t_public_by_vehicle();
  IF ids <> 'a01:7,a02:6' THEN RAISE EXCEPTION 'anon: expected a01:7,a02:6 from the public receipts view, got %', ids; END IF;
  IF EXISTS (SELECT 1 FROM public.receipts_public_summary WHERE id = 'c0000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'anon: read the receipt reached through vehicle_id on the deleted vehicle';
  END IF;
  IF EXISTS (SELECT 1 FROM public.receipts_public_summary WHERE scope_id = '71000000-0000-0000-0000-000000000a03') THEN
    RAISE EXCEPTION 'anon: read a receipt scoped to the deleted vehicle';
  END IF;
  IF EXISTS (SELECT 1 FROM public.receipts_public_summary WHERE vehicle_id = '72000000-0000-0000-0000-000000000b01'
             OR scope_id = '72000000-0000-0000-0000-000000000b01') THEN
    RAISE EXCEPTION 'anon: read a receipt of a private vehicle';
  END IF;
  SELECT * INTO r FROM public.receipts_public_summary WHERE id = 'c0000000-0000-0000-0000-000000000001';
  IF r.vendor_name IS DISTINCT FROM 'Acme' OR r.total_amount <> 10.00 OR r.vehicle_id <> '71000000-0000-0000-0000-000000000a01' THEN
    RAISE EXCEPTION 'anon: wrong row for the receipt on the live public vehicle, got %', r;
  END IF;
  -- columns the view never exposes
  BEGIN PERFORM file_url FROM public.receipts_public_summary; RAISE EXCEPTION 'the public view exposes file_url';
  EXCEPTION WHEN undefined_column THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$
DECLARE who text; ids text;
BEGIN
  FOREACH who IN ARRAY ARRAY['00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000000a1'] LOOP  -- S, a stranger; A, a03's owner
    PERFORM set_config('test.auth_uid', who, false);
    ids := public.t_public_by_vehicle();
    IF ids <> 'a01:7,a02:6' THEN RAISE EXCEPTION 'user %: expected a01:7,a02:6 from the public receipts view, got %', right(who, 2), ids; END IF;
  END LOOP;
END $$;
RESET ROLE;
-- Nothing else changed: every row the old view returned for a vehicle that is not deleted is the same row now.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (SELECT * FROM public.receipts_public_summary EXCEPT SELECT * FROM public.t_before_public) x;
  IF n <> 0 THEN RAISE EXCEPTION 'the public view gained rows (new minus old: %)', n; END IF;
  SELECT count(*) INTO n FROM (SELECT * FROM public.t_before_public EXCEPT SELECT * FROM public.receipts_public_summary) x;
  IF n <> 7 THEN RAISE EXCEPTION 'the public view should have dropped exactly the 7 rows of the deleted vehicle, dropped %', n; END IF;
  IF EXISTS (SELECT * FROM public.t_before_public EXCEPT SELECT * FROM public.receipts_public_summary
             EXCEPT SELECT * FROM public.t_before_public WHERE right(coalesce(vehicle_id::text, scope_id), 3) = 'a03') THEN
    RAISE EXCEPTION 'the public view dropped a row that is not on the deleted vehicle';
  END IF;
END $$;

-- The gate reads the vehicle as it is now: made private or deleted, a vehicle leaves anon's answer at once; made public, a vehicle joins it.
UPDATE public.vehicles SET is_public = false WHERE id = '71000000-0000-0000-0000-000000000a02';
UPDATE public.vehicles SET deleted_at = now() WHERE id = '71000000-0000-0000-0000-000000000a01';
UPDATE public.vehicles SET is_public = true WHERE id = '72000000-0000-0000-0000-000000000b02';
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
DO $$ BEGIN
  IF public.t_rollup_ids() <> 'b02' THEN RAISE EXCEPTION 'anon after the flips: expected b02, got %', public.t_rollup_ids(); END IF;
  IF public.t_public_by_vehicle() <> 'b02:6' THEN
    RAISE EXCEPTION 'anon after the flips: expected b02:6 from the public receipts view, got %', public.t_public_by_vehicle();
  END IF;
END $$;
RESET ROLE;
UPDATE public.vehicles SET is_public = true WHERE id = '71000000-0000-0000-0000-000000000a02';
UPDATE public.vehicles SET deleted_at = NULL WHERE id = '71000000-0000-0000-0000-000000000a01';
UPDATE public.vehicles SET is_public = false WHERE id = '72000000-0000-0000-0000-000000000b02';
-- Undelete the deleted public vehicle and its receipts come back; delete it again and they go.
UPDATE public.vehicles SET deleted_at = NULL WHERE id = '71000000-0000-0000-0000-000000000a03';
SET ROLE anon;
DO $$ BEGIN
  IF public.t_public_by_vehicle() <> 'a01:7,a02:6,a03:7' THEN
    RAISE EXCEPTION 'anon after the undelete: expected a01:7,a02:6,a03:7, got %', public.t_public_by_vehicle();
  END IF;
END $$;
RESET ROLE;
UPDATE public.vehicles SET deleted_at = '2026-10-01' WHERE id = '71000000-0000-0000-0000-000000000a03';
SET ROLE anon;
DO $$ BEGIN
  IF public.t_public_by_vehicle() <> 'a01:7,a02:6' THEN
    RAISE EXCEPTION 'anon after the delete: expected a01:7,a02:6, got %', public.t_public_by_vehicle();
  END IF;
END $$;
RESET ROLE;

-- Grants and options: only what the contract above needs, and nothing that writes.
DO $$
DECLARE acl text; r regclass;
BEGIN
  r := 'public.user_receipt_summary'::regclass;
  SELECT coalesce(string_agg(coalesce(ro.rolname, 'PUBLIC') || ':' || a.privilege_type, ',' ORDER BY coalesce(ro.rolname, 'PUBLIC'), a.privilege_type), '')
    INTO acl FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles ro ON ro.oid = a.grantee
   WHERE c.oid = r AND coalesce(ro.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated');
  IF acl <> 'authenticated:SELECT' THEN RAISE EXCEPTION 'user_receipt_summary: grants to PUBLIC, anon and authenticated are %', acl; END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = r), false) THEN
    RAISE EXCEPTION 'user_receipt_summary: not security_invoker';
  END IF;
  IF pg_relation_is_updatable(r, false) <> 0 THEN RAISE EXCEPTION 'user_receipt_summary: updatable'; END IF;
  r := 'public.vehicle_receipts_rollup_v'::regclass;
  SELECT coalesce(string_agg(coalesce(ro.rolname, 'PUBLIC') || ':' || a.privilege_type, ',' ORDER BY coalesce(ro.rolname, 'PUBLIC'), a.privilege_type), '')
    INTO acl FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles ro ON ro.oid = a.grantee
   WHERE c.oid = r AND coalesce(ro.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated');
  IF acl <> 'anon:SELECT,authenticated:SELECT' THEN RAISE EXCEPTION 'vehicle_receipts_rollup_v: grants to PUBLIC, anon and authenticated are %', acl; END IF;
  IF NOT coalesce((SELECT 'security_barrier=true' = ANY (reloptions) FROM pg_class WHERE oid = r), false) THEN
    RAISE EXCEPTION 'vehicle_receipts_rollup_v: no security barrier';
  END IF;
  IF pg_relation_is_updatable(r, false) <> 0 THEN RAISE EXCEPTION 'vehicle_receipts_rollup_v: updatable'; END IF;
  r := 'public.receipts_public_summary'::regclass;
  SELECT coalesce(string_agg(coalesce(ro.rolname, 'PUBLIC') || ':' || a.privilege_type, ',' ORDER BY coalesce(ro.rolname, 'PUBLIC'), a.privilege_type), '')
    INTO acl FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles ro ON ro.oid = a.grantee
   WHERE c.oid = r AND coalesce(ro.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated');
  IF acl <> 'anon:SELECT,authenticated:SELECT' THEN RAISE EXCEPTION 'receipts_public_summary: grants to PUBLIC, anon and authenticated are %', acl; END IF;
  IF NOT coalesce((SELECT 'security_barrier=true' = ANY (reloptions) FROM pg_class WHERE oid = r), false) THEN
    RAISE EXCEPTION 'receipts_public_summary: no security barrier';
  END IF;
  IF pg_relation_is_updatable(r, false) <> 0 THEN RAISE EXCEPTION 'receipts_public_summary: updatable'; END IF;
  IF pg_get_viewdef(r) NOT LIKE '%deleted_at%' THEN RAISE EXCEPTION 'receipts_public_summary: no deleted_at test'; END IF;
  IF obj_description('public.user_receipt_summary'::regclass, 'pg_class') IS NULL
     OR obj_description('public.vehicle_receipts_rollup_v'::regclass, 'pg_class') IS NULL
     OR obj_description('public.receipts_public_summary'::regclass, 'pg_class') IS NULL THEN
    RAISE EXCEPTION 'a view lost its comment';
  END IF;
END $$;

-- Drift: a live definition that lost a filter makes the migration stop and change nothing (the next ERROR line is that refusal).
CREATE OR REPLACE VIEW public.vehicle_receipts_rollup_v WITH (security_barrier = true) AS
 SELECT (scope_id)::uuid AS vehicle_id, sum(total_amount) AS total_lifetime, sum(total_amount) AS total_90d, sum(total_amount) AS total_365d,
        count(*) AS receipts_count
   FROM public.receipts WHERE scope_type = 'vehicle' GROUP BY scope_id;
\set ON_ERROR_STOP off
\ir ../migrations/20261106160000_receipt_views_privacy.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF pg_get_viewdef('public.vehicle_receipts_rollup_v'::regclass) LIKE '%vehicle_user_has_access%' THEN
    RAISE EXCEPTION 'drift: the migration replaced a definition it was not written from';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.user_receipt_summary'::regclass AND 'security_invoker=true' = ANY (reloptions)) THEN
    RAISE EXCEPTION 'drift: the refused migration did not leave the summary as the first run made it';
  END IF;
END $$;

SELECT 'test_receipt_views_privacy: PASS' AS result;
