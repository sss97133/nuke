-- 20261124212500 receipt_line_text_public (receipt_line_text_public_v1)
--
-- WHY. Measured as a logged-out client (anon key), 2026-11-24 20:40 PT, proof vehicle:
--   * vehicle_build_reconstruction systems[].lines[].description returned 3 parts-store lines whose fulfilment note
--     names the store's town ("ordered 8 from Store <n> <town>"), which places the buyer;
--   * get_vehicle_day_documents documents[].lines[].performer returned the technician initials printed on shop paper
--     (a person's identifier), and documents[].lines[].description carries the same fulfilment notes.
-- The line tables themselves answer anon 0 rows (RLS on receipt_items, line_items, financial_document_lines), so these
-- two readers are the whole logged-out surface for line text.
--
-- RULE (receipt_vendor_for_viewer's family): receipt_line_text_for_viewer(text, tied)
--   tied   -> the line as read
--   untied -> "store <number> <place>" becomes "store"; the part, quantity and dates stay.
-- The store test is text shape: no store -> organisation-branch key exists. Performer is returned to tied viewers only.
--
-- WHAT CHANGES. Both functions are read live and patched in place, occurrences counted (any other count stops the
-- migration): vehicle_build_reconstruction's untied description (1); get_vehicle_day_documents' line description (1)
-- and performer (1).
--
-- REVERT. supabase/sql/revert_20261124212500_receipt_line_text_public.sql.
-- TEST. supabase/sql/test_receipt_line_text_public.sql (disposable PG17).

SET statement_timeout = '60s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.receipt_line_text_for_viewer(p_text text, p_tied boolean) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN p_tied IS TRUE THEN p_text
              ELSE regexp_replace(p_text, '\m((?:hub\s+)?)store\s*#?\s*[0-9]+\s+[A-Za-z][^,;]*', '\1store', 'gi') END
$$;
COMMENT ON FUNCTION public.receipt_line_text_for_viewer(text, boolean) IS
  'receipt_line_text_public_v1: a receipt line as a reader returns it. Tied viewers get it as read; anyone else gets it with a store''s number and place ("store <n> <town>") reduced to "store", so a fulfilment note does not place the buyer.';
REVOKE ALL ON FUNCTION public.receipt_line_text_for_viewer(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receipt_line_text_for_viewer(text, boolean) TO anon, authenticated, service_role;

DO $patch$
DECLARE
  d text; n int;
  b_from text := 'ELSE public.receipt_line_strip_list_price(x.description) END';
  b_to   text := 'ELSE public.receipt_line_text_for_viewer(public.receipt_line_strip_list_price(x.description), false) END';
  g_from text := '''description'', i.description,';
  g_to   text := '''description'', public.receipt_line_text_for_viewer(i.description, (SELECT tied FROM gate)),';
  p_from text := '''performer'', i.performer,';
  p_to   text := '''performer'', CASE WHEN (SELECT tied FROM gate) THEN i.performer END,';
BEGIN
  d := pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure);
  IF position('receipt_line_text_for_viewer' IN d) = 0 THEN
    n := (length(d) - length(replace(d, b_from, ''))) / length(b_from);
    IF n <> 1 THEN RAISE EXCEPTION 'vehicle_build_reconstruction: expected 1 untied description, found %', n; END IF;
    EXECUTE replace(d, b_from, b_to);
  END IF;

  d := pg_get_functiondef('public.get_vehicle_day_documents(uuid, date)'::regprocedure);
  IF position('receipt_line_text_for_viewer' IN d) = 0 THEN
    n := (length(d) - length(replace(d, g_from, ''))) / length(g_from);
    IF n <> 1 THEN RAISE EXCEPTION 'get_vehicle_day_documents: expected 1 line description, found %', n; END IF;
    n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
    IF n <> 1 THEN RAISE EXCEPTION 'get_vehicle_day_documents: expected 1 line performer, found %', n; END IF;
    EXECUTE replace(replace(d, g_from, g_to), p_from, p_to);
  END IF;
END
$patch$;
