-- Disposable PG17 contract for 20261124224500_vehicle_spend_lines (vehicle_spend_lines_v1). Synthetic rows only.
-- The reader it replaces is installed from the revert file (production definition 2026-11-25) and the mask wrapper
-- from 20261124211500; fixture rows land before the migration so its first-run check runs. Asserts:
--   * a reconciled paper (items_plus_tax) is one row per priced line plus one remainder; a paper verified another way,
--     a plausible one and a fallback (scope, no link) are one receipt_total row; every paper's rows sum to its total;
--   * a negative-total paper nets as a credit (the old reader dropped it); a negative line on a positive paper is a
--     credit row inside that paper, and the paper's sum is unchanged;
--   * duplicates, superseded papers, retired links, quotes, excluded kinds and no-amount papers hold no row;
--   * the fold refolds a car after a link retires, a paper is superseded or its kind changes, and is quiet otherwise;
--   * anon/authenticated cannot read the rows or the view or run the fold; the masked wrapper still hides amounts;
--   * applied twice; the revert restores the old reader byte for byte; it applies again after the revert.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_vehicle_spend_lines%' OR to_regclass('public.receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_vehicle_spend_lines* database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.assert(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.assert(boolean, text) TO anon, authenticated;

CREATE TYPE public.receipt_doc_kind AS ENUM ('parts_service','vehicle_transaction','government_fee','fuel','insurance_document','tax_form','financial_statement','letter_notice','personal_purchase','unknown','vehicle_sale','shipping','general_merchandise','quote');
CREATE TYPE public.receipt_amount_check AS ENUM ('unchecked','verified','plausible','implausible','no_amount');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, owner_id uuid, user_id uuid, created_by_user_id uuid, uploaded_by uuid,
  is_public boolean, deleted_at timestamptz);
CREATE TABLE public.access_grants (vehicle_id uuid, user_id uuid);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.access_grants g WHERE g.vehicle_id = p_vehicle AND g.user_id = p_user) $$;
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, cost_amount numeric);
CREATE TABLE public.work_order_parts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), timeline_event_id uuid, total_price numeric);
CREATE TABLE public.work_order_labor (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), timeline_event_id uuid, total_cost numeric);
CREATE TABLE public.receipts (id uuid PRIMARY KEY, vehicle_id uuid, scope_type text, scope_id text, total numeric, total_amount numeric,
  duplicate_of uuid, is_superseded boolean DEFAULT false, amount_check public.receipt_amount_check, amount_check_reasons jsonb,
  document_kind public.receipt_doc_kind);
CREATE TABLE public.receipt_items (id uuid PRIMARY KEY, receipt_id uuid REFERENCES public.receipts(id) ON DELETE CASCADE, total_price numeric);
CREATE TABLE public.receipt_vehicle_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid REFERENCES public.receipts(id),
  vehicle_id uuid, status text, retired_at timestamptz);
-- Production definitions, 2026-11-25.
CREATE FUNCTION public.receipt_doc_kind_excluded(k receipt_doc_kind) RETURNS boolean LANGUAGE sql IMMUTABLE AS $function$
  select coalesce(k::text in ('tax_form','financial_statement','insurance_document','letter_notice','personal_purchase','vehicle_sale'), false)
$function$;
CREATE FUNCTION public.receipt_doc_kind_quoted(k receipt_doc_kind) RETURNS boolean LANGUAGE sql IMMUTABLE AS $function$
  select coalesce(k::text = 'quote', false)
$function$;

-- The reader before this migration (from the revert), then the mask wrapper over it.
\ir revert_20261124224500_vehicle_spend_lines.sql
\ir ../migrations/20261124211500_vehicle_total_invested_mask.sql
CREATE TABLE public.before_def AS
  SELECT md5(pg_get_functiondef('public.get_vehicle_total_invested_unmasked(uuid)'::regprocedure)) AS h;

-- V1 public (owner f1), V2 public, V3 private.
INSERT INTO public.vehicles VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', NULL, NULL, NULL, true, NULL),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', NULL, NULL, NULL, true, NULL),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000f1', NULL, NULL, NULL, false, NULL);
INSERT INTO public.receipts (id, vehicle_id, scope_type, scope_id, total_amount, duplicate_of, is_superseded, amount_check, amount_check_reasons, document_kind) VALUES
  -- V1
  ('00000000-0000-0000-0000-000000000001', NULL, NULL, NULL, 110, NULL, false, 'verified', '{"basis":"items_plus_tax"}', 'parts_service'),   -- lines 60 + 40, remainder 10
  ('00000000-0000-0000-0000-000000000002', NULL, NULL, NULL, 50, NULL, false, 'plausible', '{}', 'parts_service'),                          -- lines don't reconcile -> total
  ('00000000-0000-0000-0000-000000000003', NULL, NULL, NULL, -25, NULL, false, 'verified', '{"basis":"items_plus_tax"}', 'parts_service'),  -- refund paper, one -25 line
  ('00000000-0000-0000-0000-000000000004', NULL, NULL, NULL, 100, NULL, false, 'verified', '{"basis":"subtotal_plus_tax"}', 'parts_service'), -- verified by subtotal -> total
  ('00000000-0000-0000-0000-000000000005', NULL, NULL, NULL, 50, '00000000-0000-0000-0000-000000000002', false, 'plausible', '{}', 'parts_service'), -- duplicate
  ('00000000-0000-0000-0000-000000000006', NULL, NULL, NULL, 70, NULL, true, 'plausible', '{}', 'parts_service'),                           -- superseded
  ('00000000-0000-0000-0000-000000000007', NULL, NULL, NULL, 80, NULL, false, 'plausible', '{}', 'parts_service'),                          -- link retired
  ('00000000-0000-0000-0000-000000000008', NULL, NULL, NULL, 90, NULL, false, 'plausible', '{}', 'quote'),                                  -- quote
  ('00000000-0000-0000-0000-000000000009', NULL, NULL, NULL, NULL, NULL, false, 'no_amount', '{}', 'parts_service'),                        -- no amount
  ('00000000-0000-0000-0000-00000000000c', NULL, NULL, NULL, 95, NULL, false, 'plausible', '{}', 'tax_form'),                               -- excluded kind
  -- V2
  ('00000000-0000-0000-0000-00000000000a', NULL, 'vehicle', '00000000-0000-0000-0000-0000000000a2', 20, NULL, false, 'plausible', '{}', 'parts_service'), -- fallback by scope
  ('00000000-0000-0000-0000-00000000000b', NULL, NULL, NULL, 40, NULL, false, 'verified', '{"basis":"items_plus_tax"}', 'parts_service'),   -- 50 and -10 lines
  -- V3
  ('00000000-0000-0000-0000-00000000000d', NULL, NULL, NULL, 77, NULL, false, 'plausible', '{}', 'parts_service');
INSERT INTO public.receipt_items VALUES
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000001', 60),
  ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-000000000001', 40),
  ('00000000-0000-0000-0000-0000000001a3', '00000000-0000-0000-0000-000000000001', NULL),
  ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000002', 30),
  ('00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-000000000003', -25),
  ('00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-000000000004', 5),
  ('00000000-0000-0000-0000-0000000011a1', '00000000-0000-0000-0000-00000000000b', 50),
  ('00000000-0000-0000-0000-0000000011a2', '00000000-0000-0000-0000-00000000000b', -10);
INSERT INTO public.receipt_vehicle_links (receipt_id, vehicle_id, status, retired_at)
SELECT r.id, '00000000-0000-0000-0000-0000000000a1'::uuid, 'linked', CASE WHEN r.id = '00000000-0000-0000-0000-000000000007' THEN now() END
  FROM public.receipts r WHERE r.id::text ~ '-00000000000[1-9c]$';
INSERT INTO public.receipt_vehicle_links (receipt_id, vehicle_id, status) VALUES
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a2', 'linked'),
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-0000000000a3', 'linked');

SELECT public.assert((public.get_vehicle_total_invested_unmasked('00000000-0000-0000-0000-0000000000a1') #>> '{breakdown,receipts}')::numeric = 260,
                     'old reader: V1 receipts 110 + 50 + 100, the refund dropped');

\ir ../migrations/20261124224500_vehicle_spend_lines.sql
\ir ../migrations/20261124224500_vehicle_spend_lines.sql

CREATE FUNCTION pg_temp.rows_of(p_receipt text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(basis || ':' || amount::text, ',' ORDER BY basis, amount)
    FROM public.vehicle_spend_lines WHERE receipt_id::text LIKE '%' || p_receipt $$;
CREATE FUNCTION pg_temp.receipts_of(p_vehicle text) RETURNS numeric LANGUAGE sql AS $$
  SELECT (public.get_vehicle_total_invested_unmasked(('00000000-0000-0000-0000-0000000000' || p_vehicle)::uuid) #>> '{breakdown,receipts}')::numeric $$;

SELECT public.assert(pg_temp.rows_of('000000000001') = 'receipt_line:40.00,receipt_line:60.00,receipt_remainder:10.00', 'reconciled paper: lines + remainder');
SELECT public.assert(pg_temp.rows_of('000000000002') = 'receipt_total:50.00', 'plausible paper: total');
SELECT public.assert(pg_temp.rows_of('000000000003') = 'receipt_line:-25.00', 'refund paper: a credit line');
SELECT public.assert(pg_temp.rows_of('000000000004') = 'receipt_total:100.00', 'verified by subtotal: total, not lines');
SELECT public.assert(pg_temp.rows_of('00000000000a') = 'receipt_total:20.00', 'fallback by scope: total');
SELECT public.assert(pg_temp.rows_of('00000000000b') = 'receipt_line:-10.00,receipt_line:50.00', 'negative line inside a positive paper');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_spend_lines WHERE receipt_id::text ~ '-00000000000[5-9c]$'),
                     'duplicate, superseded, retired link, quote, no amount, excluded kind: no row');
SELECT public.assert(pg_temp.receipts_of('a1') = 235, 'V1 receipts net of the refund');
SELECT public.assert((public.get_vehicle_total_invested_unmasked('00000000-0000-0000-0000-0000000000a1') #>> '{breakdown,receipts_credits}')::numeric = -25, 'V1 credits');
SELECT public.assert(public.get_vehicle_total_invested_unmasked('00000000-0000-0000-0000-0000000000a1') -> 'components_count'
                     @> '{"receipts": 4, "receipts_itemised": 2}', 'V1 counts');
SELECT public.assert(pg_temp.receipts_of('a2') = 60, 'V2 unchanged: 20 + 40');
SELECT public.assert(pg_temp.receipts_of('a3') = 77, 'V3 private car still folded');
SELECT public.assert((SELECT count(*) FROM public.vehicle_spend_lines) = 10, 'ten rows');

-- Quiet when nothing changed; refolds one car when its paper changes.
SELECT public.assert((public.vehicle_spend_fold('t1') ->> 'cars_refolded')::int = 0, 'no change, no refold');
UPDATE public.receipt_vehicle_links SET retired_at = now() WHERE receipt_id = '00000000-0000-0000-0000-000000000002';
SELECT public.assert((public.vehicle_spend_fold('t2') ->> 'cars_refolded')::int = 1, 'retired link refolds V1');
SELECT public.assert(pg_temp.receipts_of('a1') = 185 AND pg_temp.rows_of('000000000002') IS NULL, 'retired link drops its paper');
UPDATE public.receipts SET is_superseded = true WHERE id = '00000000-0000-0000-0000-000000000001';
UPDATE public.receipts SET document_kind = 'quote' WHERE id = '00000000-0000-0000-0000-000000000004';
SELECT public.vehicle_spend_fold('t3');
SELECT public.assert(pg_temp.receipts_of('a1') = -25, 'superseded and quoted papers drop');
SELECT public.assert(pg_temp.receipts_of('a2') = 60 AND (SELECT run_id FROM public.vehicle_spend_lines WHERE receipt_id::text LIKE '%00000000000a') <> 't3',
                     'V2 untouched');
UPDATE public.receipt_vehicle_links SET retired_at = now() WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1';
SELECT public.vehicle_spend_fold('t4');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_spend_lines WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1')
                     AND pg_temp.receipts_of('a1') = 0, 'a car with no live paper holds no row');

-- Mask and grants.
SELECT set_config('test.role', 'anon', false), set_config('test.uid', '', false);
SET ROLE anon;
SELECT public.assert(public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a2') ->> 'amounts_visible' = 'false'
                     AND public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a2') ->> 'documented_spend' = 'present'
                     AND public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a2') -> 'breakdown' = 'null'::jsonb
                     AND public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a2')::text !~ '60', 'anon: presence, no amount');
SELECT public.assert(public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a3') IS NULL, 'anon on a private car: null');
DO $$
DECLARE stmt text;
BEGIN
  FOREACH stmt IN ARRAY ARRAY['SELECT count(*) FROM public.vehicle_spend_lines', 'SELECT count(*) FROM public.vehicle_spend_lines_due',
                              'SELECT public.vehicle_spend_fold(''x'')',
                              'SELECT public.get_vehicle_total_invested_unmasked(''00000000-0000-0000-0000-0000000000a2'')'] LOOP
    BEGIN
      EXECUTE stmt;
      RAISE EXCEPTION 'contract failed: anon ran %', stmt;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;
SELECT public.assert((SELECT count(*) FROM public.vehicle_spend_bases) = 3, 'anon reads the basis rules');
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM count(*) FROM public.vehicle_spend_lines; RAISE EXCEPTION 'contract failed: authenticated read rows';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Revert restores the old reader exactly; the migration applies again after it.
\ir revert_20261124224500_vehicle_spend_lines.sql
SELECT public.assert(md5(pg_get_functiondef('public.get_vehicle_total_invested_unmasked(uuid)'::regprocedure)) = (SELECT h FROM public.before_def),
                     'revert restores the old reader byte for byte');
SELECT public.assert(to_regclass('public.vehicle_spend_lines') IS NULL AND to_regprocedure('public.vehicle_spend_fold(text)') IS NULL, 'revert drops the fold');
UPDATE public.receipt_vehicle_links SET retired_at = NULL;
\ir ../migrations/20261124224500_vehicle_spend_lines.sql
SELECT public.assert(pg_temp.receipts_of('a1') IS NOT NULL, 'applies again after the revert');
\echo vehicle_spend_lines: ok
