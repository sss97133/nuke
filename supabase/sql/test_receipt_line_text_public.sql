-- Disposable PG17 contract for 20261124212500_receipt_line_text_public (receipt_line_text_public_v1). Synthetic rows only.
-- Builds on the vendor-label contract (quote fixture: real vehicle_build_reconstruction; day-documents reader of the live
-- shape), gives the day-documents reader its line items as the live definition writes them, applies the migration twice,
-- and asserts:
--   * a logged-out caller never receives a store's place from a line, nor a line's performer;
--   * the part, quantity and the rest of the line stay;
--   * the vehicle's people receive the line and the performer as read;
--   * a second run changes nothing.
\set ON_ERROR_STOP on
\ir test_receipt_vendor_public_label.sql
RESET ROLE;
SELECT set_config('test.role', '', false), set_config('test.uid', '', false);

-- The day-documents reader with its items CTE: the 'description' and 'performer' keys exactly as the live definition
-- writes them (2026-11-24), and the vendor key as 20261124173000 left it.
CREATE TABLE public.fixture_day_items (receipt_id uuid, line_number int, description text, performer text);
CREATE OR REPLACE FUNCTION public.get_vehicle_day_documents(p_vehicle_id uuid, p_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
  WITH gate AS (
    SELECT (auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid() OR v.owner_id = auth.uid()))) IS TRUE AS tied
      FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL),
  docs AS (SELECT r.id, r.vendor_name FROM public.receipts r WHERE r.vehicle_id = p_vehicle_id AND r.receipt_date = p_date AND EXISTS (SELECT 1 FROM gate)),
  items AS (
    SELECT i.receipt_id,
           jsonb_agg(jsonb_build_object('line_number', i.line_number, 'description', i.description,
                                        'performer', i.performer, 'hours', NULL) ORDER BY i.line_number) AS lines
      FROM public.fixture_day_items i JOIN docs d ON d.id = i.receipt_id GROUP BY i.receipt_id),
  shaped AS (
    SELECT jsonb_build_object(
             'receipt_id', d.id, 'vendor', public.receipt_vendor_for_viewer(d.vendor_name, (SELECT tied FROM gate)), 'vendor_address', NULL,
             'lines', coalesce(i.lines, '[]'::jsonb)) AS j, d.vendor_name
      FROM docs d LEFT JOIN items i ON i.receipt_id = d.id)
  SELECT jsonb_build_object('tied', coalesce((SELECT tied FROM gate), false),
                            'documents', coalesce((SELECT jsonb_agg(s.j ORDER BY s.vendor_name) FROM shaped s), '[]'::jsonb));
$function$;

-- Car A's parts purchase, its fulfilment note naming the store's town, and a technician's initials on the shop paper.
UPDATE public.receipt_items SET description = 'Brake pads; ordered 8 from Store 1234 Springfield, est in store 4/28/2025 2:45 PM'
 WHERE receipt_id = '00000000-0000-0000-0000-0000000000b1';
INSERT INTO public.fixture_day_items VALUES
  ('00000000-0000-0000-0000-0000000000b1', 1, 'Water pump; from Hub Store 77 Shelbyville, est 4/14/2025', NULL),
  ('00000000-0000-0000-0000-0000000000b2', 1, 'Install muffler', 'QZX');

\ir ../migrations/20261124212500_receipt_line_text_public.sql

-- The rule.
SELECT public.assert(public.receipt_line_text_for_viewer('Spark plug; ordered 8 from Store 1234 Springfield', false) = 'Spark plug; ordered 8 from store',
                     'store place dropped');
SELECT public.assert(public.receipt_line_text_for_viewer('Water pump; from Hub Store 77 Shelbyville, est 4/14/2025', false)
                     = 'Water pump; from Hub store, est 4/14/2025', 'hub store place dropped, date kept');
SELECT public.assert(public.receipt_line_text_for_viewer('est in store 4/28/2025 2:45 PM', false) = 'est in store 4/28/2025 2:45 PM',
                     'a date after "store" is not a place');
SELECT public.assert(public.receipt_line_text_for_viewer('Brake pads', false) = 'Brake pads', 'plain line unchanged');
SELECT public.assert(public.receipt_line_text_for_viewer('ordered from Store 1234 Springfield', true) = 'ordered from Store 1234 Springfield',
                     'tied viewer: as read');

-- Logged out.
SELECT set_config('test.role', 'anon', false), set_config('test.uid', '', false);
SELECT public.assert(public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1')::text !~ 'Springfield',
                     'anon build record: no store place');
SELECT public.assert(public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1')::text ~ 'Brake pads; ordered 8 from store',
                     'anon build record: the part and quantity stay');
SELECT public.assert(public.get_vehicle_day_documents('00000000-0000-0000-0000-0000000000a1', '2024-01-08')::text !~ 'Shelbyville',
                     'anon day documents: no store place');
SELECT public.assert(public.get_vehicle_day_documents('00000000-0000-0000-0000-0000000000a1', '2024-02-01') #> '{documents,0,lines,0,performer}' = 'null'::jsonb,
                     'anon day documents: no performer');

-- The vehicle's owner.
SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-0000-0000-0000000000f1', false);
SELECT public.assert(public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1')::text ~ 'Springfield',
                     'owner build record: the line as read');
SELECT public.assert(public.get_vehicle_day_documents('00000000-0000-0000-0000-0000000000a1', '2024-01-08')::text ~ 'Shelbyville'
                     AND public.get_vehicle_day_documents('00000000-0000-0000-0000-0000000000a1', '2024-02-01') #>> '{documents,0,lines,0,performer}' = 'QZX',
                     'owner day documents: line and performer as read');

-- A second run changes nothing.
SELECT set_config('test.role', '', false), set_config('test.uid', '', false);
CREATE TEMP TABLE line_first AS SELECT pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure) b,
  pg_get_functiondef('public.get_vehicle_day_documents(uuid, date)'::regprocedure) g;
\ir ../migrations/20261124212500_receipt_line_text_public.sql
SELECT public.assert((SELECT b = pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure)
                         AND g = pg_get_functiondef('public.get_vehicle_day_documents(uuid, date)'::regprocedure) FROM line_first),
                     'second run changes nothing');

-- The revert unwraps both and the migration applies again after it.
\ir revert_20261124212500_receipt_line_text_public.sql
SELECT public.assert(position('receipt_line_text_for_viewer' IN pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure)) = 0
                     AND position('receipt_line_text_for_viewer' IN pg_get_functiondef('public.get_vehicle_day_documents(uuid, date)'::regprocedure)) = 0,
                     'revert unwraps');
\ir ../migrations/20261124212500_receipt_line_text_public.sql

SELECT 'test_receipt_line_text_public: ok';
