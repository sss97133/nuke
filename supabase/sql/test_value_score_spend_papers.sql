-- Disposable PG17 contract for 20261124232500_value_score_spend_papers. Synthetic rows only. The function before it is
-- installed from the revert file (production 2026-11-25). Asserts: value_breakdown carries documented_spend and
-- spend_papers and no receipts_total and no amount; the score's spend term is one point per paper, capped at 15; the
-- cars with spend rows are queued; applied twice; the revert restores the old definition byte for byte.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_value_score_spend%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_value_score_spend* database'; END IF;
END $$;
CREATE FUNCTION public.assert(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', what; END IF; END $$;
CREATE TYPE public.receipt_doc_kind AS ENUM ('parts_service','quote');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, listing_kind text, make text, model text, year int, vin text,
  color text, engine_size numeric, transmission text, value_score numeric, value_breakdown jsonb);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid, is_approved boolean);
CREATE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE TABLE public.image_tags (id uuid PRIMARY KEY, image_id uuid);
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY, vehicle_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.receipts (id uuid PRIMARY KEY, scope_type text, scope_id text, duplicate_of uuid, amount_check text,
  document_kind public.receipt_doc_kind, processing_status text, total_amount numeric);
CREATE FUNCTION public.receipt_doc_kind_quoted(k receipt_doc_kind) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ select coalesce(k::text = 'quote', false) $$;
CREATE TABLE public.vehicle_spend_lines (vehicle_id uuid, receipt_id uuid, amount numeric);
CREATE TABLE public.vehicle_value_recompute_queue (vehicle_id uuid PRIMARY KEY, queued_at timestamptz DEFAULT now());

\ir revert_20261124232500_value_score_spend_papers.sql
CREATE TABLE public.before_def AS SELECT md5(pg_get_functiondef('public.compute_vehicle_value(uuid)'::regprocedure)) AS h;

INSERT INTO public.vehicles (id, is_public, make) VALUES
  ('00000000-0000-0000-0000-0000000000a1', true, 'Pontiac'), ('00000000-0000-0000-0000-0000000000a2', true, 'Pontiac'),
  ('00000000-0000-0000-0000-0000000000a3', true, 'Pontiac');
-- a1: 3 papers, net 4321.09; a2: none; a3: 20 papers, a credit-only net.
INSERT INTO public.vehicle_spend_lines VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 4000),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 21.09),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000002', 200),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003', 100);
INSERT INTO public.vehicle_spend_lines SELECT '00000000-0000-0000-0000-0000000000a3', gen_random_uuid(), -1 FROM generate_series(1, 20);

\ir ../migrations/20261124232500_value_score_spend_papers.sql
\ir ../migrations/20261124232500_value_score_spend_papers.sql

SELECT public.assert((SELECT count(*) FROM public.vehicle_value_recompute_queue) = 2, 'the two cars with spend rows are queued');
SELECT public.compute_vehicle_value(id) FROM public.vehicles;
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicles WHERE value_breakdown ? 'receipts_total'), 'no receipts_total');
SELECT public.assert((SELECT value_breakdown::text !~ '4321|4000|21\.09' FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a1'), 'no amount in value_breakdown');
SELECT public.assert((SELECT value_breakdown @> '{"documented_spend": "present", "spend_papers": 3}' FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a1'), 'a1 presence and papers');
SELECT public.assert((SELECT value_breakdown @> '{"documented_spend": "none", "spend_papers": 0}' FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a2'), 'a2 none');
SELECT public.assert((SELECT value_breakdown @> '{"documented_spend": "none", "spend_papers": 20}' FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a3'), 'a3 credits only: none, 20 papers');
SELECT public.assert((SELECT a.value_score - b.value_score FROM public.vehicles a, public.vehicles b
                       WHERE a.id = '00000000-0000-0000-0000-0000000000a1' AND b.id = '00000000-0000-0000-0000-0000000000a2') = 3, 'one point per paper');
SELECT public.assert((SELECT a.value_score - b.value_score FROM public.vehicles a, public.vehicles b
                       WHERE a.id = '00000000-0000-0000-0000-0000000000a3' AND b.id = '00000000-0000-0000-0000-0000000000a2') = 15, 'capped at 15');

\ir revert_20261124232500_value_score_spend_papers.sql
SELECT public.assert(md5(pg_get_functiondef('public.compute_vehicle_value(uuid)'::regprocedure)) = (SELECT h FROM public.before_def), 'revert restores the old definition');
\echo value_score_spend_papers: ok
