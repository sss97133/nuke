-- Disposable PG17 contract for 20261125013000_receipt_relations (receipt_relations_v1). Synthetic rows only. The spend
-- fold (20261124224500) is installed first over the reader it replaced. Asserts:
--   * same vendor + same total within 3 days + a shared item word: one same_purchase edge, copy -> the verified paper;
--     the copy stops counting in vehicle_spend_lines after vehicle_spend_fold;
--   * same vendor + same invoice number, different dates: a shares_invoice_number edge that changes no spend;
--   * same invoice number and date, lines of both add up to one total: the continuation page stops counting;
--   * a copy whose kept twin is a quote still counts;
--   * same total but no shared word, or 4 days apart: no edge;
--   * a refund paper gets one returns edge to its best purchase; a tie between two purchases gives none;
--   * an edge that stops being due is retired, not deleted; anon cannot read the edges or run the fold;
--   * applied twice; the revert restores vehicle_spend_lines_due byte for byte.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_receipt_relations%' OR to_regclass('public.receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_receipt_relations* database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.assert(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', what; END IF; END $$;
CREATE TYPE public.receipt_doc_kind AS ENUM ('parts_service', 'quote', 'tax_form');
CREATE TYPE public.receipt_amount_check AS ENUM ('unchecked','verified','plausible','implausible','no_amount');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY);
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY, vehicle_id uuid, cost_amount numeric);
CREATE TABLE public.work_order_parts (id uuid PRIMARY KEY, timeline_event_id uuid, total_price numeric);
CREATE TABLE public.work_order_labor (id uuid PRIMARY KEY, timeline_event_id uuid, total_cost numeric);
CREATE TABLE public.vehicle_value_recompute_queue (vehicle_id uuid PRIMARY KEY, queued_at timestamptz DEFAULT now());
CREATE TABLE public.receipts (id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, scope_type text, scope_id text, vendor_name text,
  total numeric, total_amount numeric, invoice_number text, receipt_date date, transaction_date date, purchase_date date,
  duplicate_of uuid, is_superseded boolean DEFAULT false, amount_check public.receipt_amount_check, amount_check_reasons jsonb,
  document_kind public.receipt_doc_kind DEFAULT 'parts_service', created_at timestamptz DEFAULT now());
CREATE TABLE public.receipt_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid REFERENCES public.receipts(id) ON DELETE CASCADE,
  line_number int, description text, total_price numeric);
CREATE TABLE public.receipt_vehicle_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid REFERENCES public.receipts(id),
  vehicle_id uuid, status text, retired_at timestamptz);
CREATE FUNCTION public.receipt_doc_kind_excluded(k receipt_doc_kind) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ select coalesce(k::text in ('tax_form'), false) $$;
CREATE FUNCTION public.receipt_doc_kind_quoted(k receipt_doc_kind) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ select coalesce(k::text = 'quote', false) $$;
-- Production definition, 2026-11-25.
CREATE FUNCTION public.supply_vendor_key(p_name text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog', 'public' AS $function$
  SELECT NULLIF(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(COALESCE(p_name, '')), '[®™©]', '', 'g'),
    '[^a-z0-9&'' ]+', ' ', 'g'), '\m(store|#)\s*[0-9]+.*$', ''), '\s+', ' ', 'g')), '')
$function$;

\ir revert_20261124224500_vehicle_spend_lines.sql
\ir ../migrations/20261124224500_vehicle_spend_lines.sql
\ir ../migrations/20261124234500_vehicle_spend_fold_enqueue_value.sql
CREATE TABLE public.before_def AS SELECT md5(pg_get_viewdef('public.vehicle_spend_lines_due'::regclass)) AS h;

INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-0000000000a1');
-- u1 owns everything. P1/P2: one purchase, two papers (P1 verified). I1/I2: shared invoice number, different items.
-- N1/N2: same total, no shared word. F1/F2: same total and words, 4 days apart. R1 returns B1. R2 ties between T1 and T2.
INSERT INTO public.receipts (id, user_id, vendor_name, total_amount, invoice_number, transaction_date, amount_check, amount_check_reasons) VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000f1', 'Parts Co.', 100, NULL, '2024-09-26', 'verified', '{"basis":"items_plus_tax"}'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000f1', 'PARTS CO', 100, NULL, '2024-09-24', 'plausible', '{}'),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-0000000000f1', 'Shop B', 50, 'INV-7', '2021-05-06', 'verified', '{"basis":"items_plus_tax"}'),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-0000000000f1', 'Shop B', 30, 'INV-7', '2021-06-05', 'verified', '{"basis":"items_plus_tax"}'),
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Shop C', 40, NULL, '2024-01-01', 'plausible', '{}'),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000000f1', 'Shop C', 40, NULL, '2024-01-02', 'plausible', '{}'),
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-0000000000f1', 'Shop D', 60, NULL, '2024-02-01', 'plausible', '{}'),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-0000000000f1', 'Shop D', 60, NULL, '2024-02-05', 'plausible', '{}'),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000000f1', 'Shop E', 80, NULL, '2024-03-01', 'plausible', '{}'),
  ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-0000000000f1', 'Shop E', -80, NULL, '2024-03-20', 'plausible', '{}'),
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-0000000000f1', 'Shop F', 20, NULL, '2024-04-01', 'plausible', '{}'),
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-0000000000f1', 'Shop F', 25, NULL, '2024-04-01', 'plausible', '{}'),
  ('00000000-0000-0000-0000-000000000063', '00000000-0000-0000-0000-0000000000f1', 'Shop F', -20, NULL, '2024-04-10', 'plausible', '{}'),
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000000f1', 'Shop G', 100, 'INV-9', '2021-05-06', 'verified', '{}'),
  ('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-0000000000f1', 'Shop G', 25, 'INV-9', '2021-05-06', 'verified', '{}'),
  ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-0000000000f1', 'Shop H', 70, NULL, '2024-05-01', 'verified', '{}'),
  ('00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-0000000000f1', 'Shop H', 70, NULL, '2024-05-02', 'plausible', '{}');
-- 81 is a quote: its twin 82 is the copy by rank, but 81 never counts, so 82 must
UPDATE public.receipts SET document_kind = 'quote' WHERE id = '00000000-0000-0000-0000-000000000081';
INSERT INTO public.receipt_items (receipt_id, line_number, description, total_price) VALUES
  ('00000000-0000-0000-0000-000000000011', 1, 'HARMONIC BALANCER', 100),
  ('00000000-0000-0000-0000-000000000012', 1, 'Harmonic balancer OEM', 100),
  ('00000000-0000-0000-0000-000000000021', 1, 'Tie rod end', 50),
  ('00000000-0000-0000-0000-000000000022', 1, 'Brake rotor', 30),
  ('00000000-0000-0000-0000-000000000031', 1, 'Spark plugs', 40),
  ('00000000-0000-0000-0000-000000000032', 1, 'Wiper blade', 40),
  ('00000000-0000-0000-0000-000000000041', 1, 'Water pump', 60),
  ('00000000-0000-0000-0000-000000000042', 1, 'Water pump', 60),
  ('00000000-0000-0000-0000-000000000051', 1, 'Fuel pump', 80),
  ('00000000-0000-0000-0000-000000000052', 1, 'Return fuel pump', -80),
  ('00000000-0000-0000-0000-000000000061', 1, 'Brake hose', 20),
  ('00000000-0000-0000-0000-000000000062', 1, 'Brake hose', 25),
  ('00000000-0000-0000-0000-000000000063', 1, 'Brake hose return', -20),
  ('00000000-0000-0000-0000-000000000071', 1, 'Tie rod end', 40),
  ('00000000-0000-0000-0000-000000000072', 1, 'Brake rotor', 60),
  ('00000000-0000-0000-0000-000000000081', 1, 'Clutch kit', 70),
  ('00000000-0000-0000-0000-000000000082', 1, 'Clutch kit', 70);
INSERT INTO public.receipt_vehicle_links (receipt_id, vehicle_id, status) SELECT id, '00000000-0000-0000-0000-0000000000a1', 'linked' FROM public.receipts;
SELECT public.vehicle_spend_fold('before');
CREATE TABLE public.spend_before AS SELECT count(*) n FROM public.vehicle_spend_lines WHERE receipt_id = '00000000-0000-0000-0000-000000000012';

\ir ../migrations/20261125013000_receipt_relations.sql
\ir ../migrations/20261125013000_receipt_relations.sql

CREATE FUNCTION pg_temp.edges() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(right(receipt_id::text, 2) || '>' || right(related_receipt_id::text, 2) || ':' || rule_key, ',' ORDER BY right(receipt_id::text, 2))
    FROM public.receipt_relations WHERE retired_at IS NULL $$;
SELECT public.assert(pg_temp.edges() = '12>11:same_vendor_total_items,21>22:same_vendor_invoice_number,52>51:return_same_vendor_items,71>72:same_vendor_invoice_number,72>71:same_vendor_invoice_pages,82>81:same_vendor_total_items',
                     'edges: ' || coalesce(pg_temp.edges(), 'none'));
SELECT public.assert((SELECT n FROM public.spend_before) = 1, 'the copy counted before');
SELECT public.vehicle_spend_fold('after');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_spend_lines WHERE receipt_id = '00000000-0000-0000-0000-000000000012'), 'the copy no longer counts');
SELECT public.assert(EXISTS (SELECT 1 FROM public.vehicle_spend_lines WHERE receipt_id = '00000000-0000-0000-0000-000000000011')
                     AND EXISTS (SELECT 1 FROM public.vehicle_spend_lines WHERE receipt_id = '00000000-0000-0000-0000-000000000022')
                     AND EXISTS (SELECT 1 FROM public.vehicle_spend_lines WHERE receipt_id = '00000000-0000-0000-0000-000000000052'),
                     'kept paper, invoice-number pair and the refund still count');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_spend_lines WHERE receipt_id = '00000000-0000-0000-0000-000000000072')
                     AND (SELECT sum(amount) FROM public.vehicle_spend_lines WHERE receipt_id = '00000000-0000-0000-0000-000000000071') = 100,
                     'invoice pages: the continuation page stops counting, the grand total counts once');
SELECT public.assert(EXISTS (SELECT 1 FROM public.vehicle_spend_lines WHERE receipt_id = '00000000-0000-0000-0000-000000000082'),
                     'a copy whose kept twin does not count (a quote) still counts: never zero times');
-- the copy is superseded: its edge retires, and a second run adds nothing
UPDATE public.receipts SET is_superseded = true WHERE id = '00000000-0000-0000-0000-000000000012';
SELECT public.assert((public.receipt_relations_fold('t2') ->> 'retired')::int = 1, 'an edge no longer due is retired');
SELECT public.assert((SELECT count(*) FROM public.receipt_relations WHERE retired_at IS NOT NULL) = 1, 'retired, not deleted');
SELECT public.assert((public.receipt_relations_fold('t3') ->> 'added')::int = 0, 'quiet when nothing changed');
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM count(*) FROM public.receipt_relations; RAISE EXCEPTION 'contract failed: anon read edges'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.receipt_relations_fold('x'); RAISE EXCEPTION 'contract failed: anon ran the fold'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT public.assert((SELECT count(*) FROM public.receipt_relation_rules) = 4, 'anon reads the rule rows');
RESET ROLE;
\ir revert_20261125013000_receipt_relations.sql
SELECT public.assert(md5(pg_get_viewdef('public.vehicle_spend_lines_due'::regclass)) = (SELECT h FROM public.before_def), 'revert restores the view');
SELECT public.assert(to_regclass('public.receipt_relations') IS NULL, 'revert drops the edges');
\echo receipt_relations: ok
