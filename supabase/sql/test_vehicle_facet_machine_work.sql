-- Disposable PG17: the engine panel's machine_work item reads machine-shop work lines (facet_machine_work_v1) through
-- vehicle_machine_shop_lines. Reuses the facet fixture, adds receipt fixtures behind views, and proves the line selection
-- (superseded, duplicate, retired-link, other-vehicle and non-machining or part lines excluded) and: present as a claim (never established) with one source per
-- shop, line ids as witness, date span and printed hours; no amounts, descriptions or contact details; bore stays
-- missing; a car without machining lines stays missing; a private car's lines are hidden from anon; the patch
-- applies once. Every fixture is synthetic.
\set ON_ERROR_STOP on
\ir test_vehicle_facet_items.sql
RESET ROLE;

-- Dependencies of vehicle_machine_shop_lines, as views over fixture tables (receipts, their vehicle links and lines).
-- receipt_line_kind is the live definition; receipt_line_system is stubbed to the machining words this contract uses.
CREATE FUNCTION public.text_redact_contact(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT p $$;
CREATE FUNCTION public.receipt_line_system(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lower(p) ~ '\y(bore|hone|valve job|surface heads?|polish crank|hang pistons?|block package)' THEN 'machining'
              WHEN lower(p) ~ 'brake' THEN 'brakes' END $$;
CREATE FUNCTION public.receipt_line_kind(p_description text, p_part_number text, p_total numeric, p_hours numeric, p_line_date date, p_performer text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d ~* '\m(shipping|freight|handling|delivery|sales tax|tax|discount|coupon|core charge|core exchange|core return|return|deposit|payment|surcharge|fee|subtotal|total)\M'
         OR coalesce(p_part_number, '') ~* '^\{?(shipping|freight|tax|handling)\}?$' THEN 'charge'
    WHEN d ~* 'back[- ]?order' OR d ~* 'qty shipped 0' THEN 'backordered'
    WHEN d ~* 'kit component' THEN 'kit_component'
    WHEN p_hours IS NOT NULL OR nullif(btrim(coalesce(p_performer, '')), '') IS NOT NULL
         OR (p_part_number IS NULL AND p_total IS NULL AND p_line_date IS NOT NULL) THEN 'labor'
    WHEN p_part_number IS NULL AND p_total IS NULL THEN 'note'
    ELSE 'part' END
  FROM (SELECT coalesce(p_description, '') AS d) s $$;
CREATE TABLE public.fixture_receipts (id uuid PRIMARY KEY, vendor_name text, receipt_date date, is_superseded boolean, duplicate_of uuid);
CREATE TABLE public.fixture_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, vehicle_id uuid, status text, retired_at timestamptz, page_date date);
CREATE TABLE public.fixture_items (id uuid PRIMARY KEY, receipt_id uuid, description text, part_number text, total_price numeric,
  line_date date, hours numeric, performer text);
CREATE VIEW public.receipts AS SELECT * FROM public.fixture_receipts;
CREATE VIEW public.receipt_vehicle_links AS SELECT * FROM public.fixture_links;
CREATE VIEW public.receipt_items AS SELECT * FROM public.fixture_items;

INSERT INTO public.fixture_receipts VALUES
 ('b0000000-0000-0000-0000-000000000001', 'Fixture Machine Co', '2024-09-01', false, NULL),
 ('b0000000-0000-0000-0000-000000000002', 'Second Shop', '2025-02-01', false, NULL),
 ('b0000000-0000-0000-0000-000000000003', 'Old Shop', '2024-01-01', true, NULL),
 ('b0000000-0000-0000-0000-000000000004', 'Retired Shop', '2024-01-01', false, NULL),
 ('b0000000-0000-0000-0000-000000000005', 'Duplicate Shop', '2024-01-01', false, 'b0000000-0000-0000-0000-000000000001'),
 ('b0000000-0000-0000-0000-000000000006', 'Private Car Shop', '2024-01-01', false, NULL);
INSERT INTO public.fixture_links (receipt_id, vehicle_id, status, retired_at, page_date) VALUES
 ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'linked', NULL, NULL),
 ('b0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'linked', NULL, NULL),
 ('b0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'linked', NULL, NULL),
 ('b0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'linked', now(), NULL),
 ('b0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'linked', NULL, NULL),
 ('b0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000004', 'linked', NULL, NULL);
INSERT INTO public.fixture_items VALUES
 ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Bore cylinders .060 call 702-555-0100', NULL, NULL, '2024-09-26', 3.5, 'Staff Name'),
 ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Hone cylinders', NULL, NULL, '2024-12-18', 2, NULL),
 ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'Valve Job', NULL, 100, '2025-01-13', NULL, NULL),
 ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'Cam bearings hone kit', 'CB1', 40, NULL, NULL, NULL),
 ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 'Brake pad install', NULL, NULL, '2024-10-01', 1, NULL),
 ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', 'Surface Heads', NULL, 50, NULL, NULL, NULL),
 ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000003', 'Hone cylinders', NULL, NULL, '2024-01-02', 1, NULL),
 ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000004', 'Hone cylinders', NULL, NULL, '2024-01-02', 1, NULL),
 ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000005', 'Hone cylinders', NULL, NULL, '2024-01-02', 1, NULL),
 ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000006', 'Hone cylinders', NULL, NULL, '2024-01-02', 1, NULL);

-- The patch applies once; a second run is a no-op.
\ir ../migrations/20261120010000_facet_engine_machine_work.sql
\ir ../migrations/20261120010000_facet_engine_machine_work.sql

SET ROLE anon;
SET test.auth_role = 'anon';
RESET test.auth_uid;
DO $$
DECLARE item jsonb; bore jsonb; txt text;
BEGIN
  PERFORM public.t_assert((length(pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure))
      - length(replace(pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure), 'facet_machine_work_v1_end', '')))
      / length('facet_machine_work_v1_end') = 1, 'machine work branch patched once');
  item := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.machine_work');
  PERFORM public.t_assert(item->>'status' = 'claim', format('present as a claim, never established; got %s', item->>'status'));
  PERFORM public.t_assert(jsonb_array_length(item->'sources') = 2, 'one source per shop (parts lines excluded)');
  PERFORM public.t_assert(item->'needed' IS NOT NULL AND item->>'needed' LIKE '%keyed to this engine%', 'the engine-keyed work order is still needed');
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(item->'sources') s
      WHERE s->>'label' = 'Fixture Machine Co' AND s#>>'{decoded,lines}' = '3' AND s#>>'{decoded,first_day}' = '2024-09-26'
        AND s#>>'{decoded,last_day}' = '2025-01-13' AND (s#>>'{decoded,printed_hours}')::numeric = 5.5
        AND jsonb_array_length(s#>'{witness,ids}') = 3 AND s#>>'{witness,id}' = 'a0000000-0000-0000-0000-000000000001'
        AND s->>'value' = '3 work lines, 2024-09-26 to 2025-01-13, 5.5 printed hours'
        AND s->>'limitation' LIKE '%by serial%' AND s->>'class' = 'claim'),
    format('shop source carries lines, span, hours and witness ids; got %s', item->'sources'));
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(item->'sources') s
      WHERE s->>'label' = 'Second Shop' AND s->>'value' = '1 work line, 2025-02-01' AND s#>'{decoded,printed_hours}' IS NULL),
    'single line, no printed hours, no hours text');
  txt := item::text;
  PERFORM public.t_assert(txt !~* '(amount|price|\$|702-555|call|bore cylinders|Staff Name|Old Shop|Retired Shop|Duplicate Shop)', format('no amounts, description text, contacts or parts supplier; got %s', txt));
  -- Bore is not derived from "bore .060": its base is not on the paper.
  bore := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.bore');
  PERFORM public.t_assert(bore->>'status' = 'missing' AND bore->'value' = 'null'::jsonb, 'bore stays missing');
  -- A car with no machining lines stays missing.
  item := public.t_item('10000000-0000-0000-0000-000000000002', 'engine', 'engine.current.machine_work');
  PERFORM public.t_assert(item->>'status' = 'missing' AND jsonb_array_length(item->'sources') = 0, 'no machining lines: missing');
  -- The masthead and the whole read carry it; other dimensions do not call the reconstruction.
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(public.vehicle_facet_items('10000000-0000-0000-0000-000000000001', 'masthead')->'engine') x
    WHERE x->>'key' = 'engine.current.machine_work' AND x->>'status' = 'claim'), 'masthead carries the item');
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(public.vehicle_facet_items('10000000-0000-0000-0000-000000000001')->'engine') x
    WHERE x->>'key' = 'engine.current.machine_work' AND x->>'status' = 'claim'), 'whole read carries the item');
  PERFORM public.t_assert((SELECT count(*) FROM public.vehicle_machine_shop_lines('10000000-0000-0000-0000-000000000001')) = 4,
    'helper returns the four current machine-shop lines (not the part, the brake line or excluded receipts)');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM public.vehicle_machine_shop_lines('10000000-0000-0000-0000-000000000004')),
    'a private car returns no lines to anon');
  PERFORM public.t_assert(public.t_item('10000000-0000-0000-0000-000000000004', 'engine', 'engine.current.machine_work') IS NULL,
    'a private car has no items for anon');
END $$;
RESET ROLE;
SELECT 'vehicle facet machine work: PASS' AS result;
