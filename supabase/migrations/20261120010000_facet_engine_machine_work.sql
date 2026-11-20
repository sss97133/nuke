-- facet_machine_work_v1: the engine panel's "machine work" item reads the machine-shop work already on file.
--
-- WHY. vehicle_facet_items listed engine.current.machine_work as "missing: machine-shop work order lines keyed to
-- this engine" (and bore as missing) while the same vehicle has machine-shop work order lines on file that
-- vehicle_build_reconstruction already folds under system 'machining' (receipt_work_lines classified by
-- receipt_line_system). One page contradicted itself. The reconstruction and receipt_work_lines are too slow for the
-- masthead read (about 2.7 s and 1.8 s against 1.0 s for the masthead), so the item is fed by a small helper.
--
-- WHAT CHANGES.
-- 1. vehicle_machine_shop_lines(vehicle): STABLE SECURITY DEFINER. Returns only item_id, shop, day and printed hours of the
--    machine-shop work lines of a vehicle. It reproduces receipt_work_lines' selection of current lines (a receipt linked
--    to the vehicle with status 'linked' and not retired; the receipt not superseded and not a duplicate; the line's
--    anchor date the printed line date, else the link's page date, else the receipt date, a date after tomorrow not
--    counting) and the reconstruction's reading of shop work (receipt_line_kind labor or note, or a part line with no
--    part number whose words are work), keeping the lines receipt_line_system places in 'machining'. No photo
--    correlation. It has the reconstruction's visibility rule (a public vehicle, or the owner, a granted user or the
--    service role) and returns no amount, no description and no performer name; the shop name goes through
--    text_redact_contact as the reconstruction does.
-- 2. vehicle_facet_items gains one testimony branch in its `t` CTE reading that helper: one source per shop for
--    engine.current.machine_work with the shop name, number of lines, date span, printed hours and the line item ids as
--    witness. It runs only for the engine dimension, the masthead and the whole read.
--   Status: 'claim', the reader's word for an attributed statement no independent source has confirmed. The paper
--   shows the work was done on an engine at that shop; nothing on it ties that engine to the one in the car by
--   serial, so it is never 'established'. All shops share one reader family so several shops stay a claim, and the
--   source carries that limitation in words. The item's `needed` stays the engine-keyed work order.
--   NOT changed: engine.current.bore stays missing. The paper says "bore .060" but the base bore is not on it, so no
--   millimetre value is derived; no text is lifted from free-text lines.
--
-- REVERT. Redefine vehicle_facet_items without the branch between the markers facet_machine_work_v1 and
-- facet_machine_work_v1_end (its previous definition is in 20261116016000 as patched by the later facet migrations),
-- then DROP FUNCTION public.vehicle_machine_shop_lines(uuid). Nothing else is created, altered or written; grants on
-- vehicle_facet_items are kept by CREATE OR REPLACE.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.vehicle_machine_shop_lines(p_vehicle_id uuid)
RETURNS TABLE(item_id uuid, shop text, day date, hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH v AS (
    SELECT v.id FROM public.vehicles v
     WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
       AND (v.is_public IS TRUE OR auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid()
            OR v.owner_id = auth.uid() OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid()))))),
  raw AS (
    SELECT i.id AS item_id, r.vendor_name, i.description, i.part_number, i.total_price, i.hours,
           i.line_date, l.page_date, r.receipt_date, nullif(btrim(i.performer), '') AS performer
      FROM v
      JOIN public.receipt_vehicle_links l ON l.vehicle_id = v.id AND l.status = 'linked' AND l.retired_at IS NULL
      JOIN public.receipts r ON r.id = l.receipt_id AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
      JOIN public.receipt_items i ON i.receipt_id = r.id)
  SELECT w.item_id,
         nullif(left(btrim(public.text_redact_contact(w.vendor_name)), 300), ''),
         coalesce(CASE WHEN w.line_date <= current_date + 1 THEN w.line_date END,
                  CASE WHEN w.page_date <= current_date + 1 THEN w.page_date END,
                  CASE WHEN w.receipt_date <= current_date + 1 THEN w.receipt_date END),
         w.hours
    FROM raw w
   WHERE public.receipt_line_system(w.description) = 'machining'
     AND (public.receipt_line_kind(w.description, w.part_number, w.total_price, w.hours, w.line_date, w.performer) IN ('labor', 'note')
          OR (public.receipt_line_kind(w.description, w.part_number, w.total_price, w.hours, w.line_date, w.performer) = 'part'
              AND w.part_number IS NULL AND lower(w.description) ~
                '\y(check and repair|repair|rebuild|install(ation)?|alignment|labor|surface heads?|polish crank|valve job|hang pistons?|block package|machine work|mount and balance)\y'))
$$;
COMMENT ON FUNCTION public.vehicle_machine_shop_lines(uuid) IS
  'The machine-shop work lines of one vehicle, for the engine panel: item_id, shop, day, printed hours. Current receipt lines tied to the vehicle (linked, not retired, receipt not superseded or a duplicate) that receipt_line_system places in machining and that are shop work, with receipt_work_lines'' anchor date and no photo correlation. No amount, description or performer. Same visibility as vehicle_build_reconstruction. Read-only.';
REVOKE ALL ON FUNCTION public.vehicle_machine_shop_lines(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_machine_shop_lines(uuid) TO anon, authenticated, service_role;

DO $patch$
DECLARE
  d text;
  anchor text := E'  WHERE nullif(btrim(m.val), '''') IS NOT NULL\n),\n-- One row per (item, independent source';
  branch text := $branch$
  UNION ALL
  -- facet_machine_work_v1: machine-shop work lines on paper (vehicle_machine_shop_lines), one
  -- source per shop. A claim: the paper does not tie the engine it worked on to the one in the car by serial.
  SELECT 'engine.current.machine_work', 'machine-shop work on paper', 'text', 'claim', 'shop:' || g.shop, 'src:machine_shop_paper',
         g.last_day::timestamptz, 1,
         jsonb_build_object('slug', NULL, 'label', g.shop, 'kind', 'document', 'url', NULL,
           'method', 'vehicle_machine_shop_lines', 'observed_at', g.last_day::timestamptz,
           'witness', jsonb_build_object('kind', 'receipt_item', 'id', g.item_ids->>0, 'ids', g.item_ids),
           'value', g.n || CASE WHEN g.n = 1 THEN ' work line, ' ELSE ' work lines, ' END
                      || CASE WHEN g.first_day = g.last_day THEN g.first_day ELSE g.first_day || ' to ' || g.last_day END
                      || coalesce(', ' || g.hours || ' printed hours', ''),
           'class', 'claim',
           'limitation', 'the paper shows this work was done on an engine at this shop; nothing on it ties that engine to the one now in the car by serial',
           'decoded', jsonb_strip_nulls(jsonb_build_object('lines', g.n, 'first_day', g.first_day, 'last_day', g.last_day,
                                                           'printed_hours', g.hours))),
         NULL::jsonb
  FROM (SELECT coalesce(m.shop, 'shop not named') AS shop, count(*) AS n,
               min(m.day)::text AS first_day, max(m.day)::text AS last_day,
               nullif(sum(m.hours), 0) AS hours,
               jsonb_agg(m.item_id::text ORDER BY m.day, m.item_id) AS item_ids
        FROM v
        CROSS JOIN LATERAL public.vehicle_machine_shop_lines(v.id) m
        WHERE p_dimension IS NULL OR p_dimension IN ('masthead', 'engine')
        GROUP BY 1) g
  -- facet_machine_work_v1_end
$branch$;
  n integer;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('facet_machine_work_v1' IN d) > 0 THEN RETURN; END IF;
  IF to_regprocedure('public.vehicle_machine_shop_lines(uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_machine_shop_lines(uuid) is not defined';
  END IF;
  n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'facet machine work anchor drifted: % matches', n; END IF;
  d := replace(d, anchor, E'  WHERE nullif(btrim(m.val), '''') IS NOT NULL\n' || branch || E'),\n-- One row per (item, independent source');
  EXECUTE d;
END $patch$;
