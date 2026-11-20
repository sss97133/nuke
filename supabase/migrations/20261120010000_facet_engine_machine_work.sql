-- facet_machine_work_v1: the engine panel's "machine work" item reads the machine-shop work already on file.
--
-- WHY. vehicle_facet_items listed engine.current.machine_work as "missing: machine-shop work order lines keyed to
-- this engine" (and bore as missing) while the same vehicle has machine-shop work order lines on file that
-- vehicle_build_reconstruction already folds under system 'machining' (receipt_work_lines classified by
-- receipt_line_system). One page contradicted itself.
--
-- WHAT CHANGES. vehicle_facet_items gains one testimony branch in its `t` CTE: for each shop with machining work
-- lines (labor, service or note lines) on the vehicle, one source for engine.current.machine_work with the shop
-- name, number of lines, date span, printed hours and the line item ids as witness. Read through
-- vehicle_build_reconstruction (SECURITY DEFINER, which keeps the visibility rule and shows amounts only to the
-- vehicle's own parties); this branch uses no amount, no description text and no person's name. It runs only for the
-- engine dimension, the masthead and the whole read, so other dimensions pay nothing.
--   Status: 'claim', the reader's word for an attributed statement no independent source has confirmed. The paper
--   shows the work was done on an engine at that shop; nothing on it ties that engine to the one in the car by
--   serial, so it is never 'established'. All shops share one reader family so several shops stay a claim, and the
--   source carries that limitation in words. The item's `needed` stays the engine-keyed work order.
--   NOT changed: engine.current.bore stays missing. The paper says "bore .060" but the base bore is not on it, so no
--   millimetre value is derived; no text is lifted from free-text lines.
--
-- ROLLBACK. The next migration to redefine vehicle_facet_items from the previous definition (20261117000400 is the
-- last one that edited it) reverts this; or remove the branch between the markers facet_machine_work_v1 and
-- facet_machine_work_v1_end. Nothing else is created, altered or written; grants are kept by CREATE OR REPLACE.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  anchor text := E'  WHERE nullif(btrim(m.val), '''') IS NOT NULL\n),\n-- One row per (item, independent source';
  branch text := $branch$
  UNION ALL
  -- facet_machine_work_v1: machine-shop work lines on paper (vehicle_build_reconstruction, system 'machining'), one
  -- source per shop. A claim: the paper does not tie the engine it worked on to the one in the car by serial.
  SELECT 'engine.current.machine_work', 'machine-shop work on paper', 'text', 'claim', 'shop:' || g.shop, 'src:machine_shop_paper',
         g.last_day::timestamptz, 1,
         jsonb_build_object('slug', NULL, 'label', g.shop, 'kind', 'document', 'url', NULL,
           'method', 'vehicle_build_reconstruction.machining', 'observed_at', g.last_day::timestamptz,
           'witness', jsonb_build_object('kind', 'receipt_item', 'id', g.item_ids->>0, 'ids', g.item_ids),
           'value', g.n || CASE WHEN g.n = 1 THEN ' work line, ' ELSE ' work lines, ' END
                      || CASE WHEN g.first_day = g.last_day THEN g.first_day ELSE g.first_day || ' to ' || g.last_day END
                      || coalesce(', ' || g.hours || ' printed hours', ''),
           'class', 'claim',
           'limitation', 'the paper shows this work was done on an engine at this shop; nothing on it ties that engine to the one now in the car by serial',
           'decoded', jsonb_strip_nulls(jsonb_build_object('lines', g.n, 'first_day', g.first_day, 'last_day', g.last_day,
                                                           'printed_hours', g.hours))),
         NULL::jsonb
  FROM (SELECT coalesce(nullif(l->>'source', ''), 'shop not named') AS shop, count(*) AS n,
               min(l->>'day') AS first_day, max(l->>'day') AS last_day,
               nullif(sum((l->>'paper_hours')::numeric), 0) AS hours,
               jsonb_agg(l->>'item_id' ORDER BY l->>'day', l->>'item_id') AS item_ids
        FROM v
        CROSS JOIN LATERAL (SELECT CASE WHEN p_dimension IS NULL OR p_dimension IN ('masthead', 'engine')
                                        THEN public.vehicle_build_reconstruction(v.id) END AS r) rc
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(rc.r->'systems', '[]'::jsonb)) s
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(s->'lines', '[]'::jsonb)) l
        WHERE s->>'system_key' = 'machining' AND l->>'kind' IN ('labor', 'service', 'note')
          AND l->>'item_id' IS NOT NULL
        GROUP BY 1) g
  -- facet_machine_work_v1_end
$branch$;
  n integer;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('facet_machine_work_v1' IN d) > 0 THEN RETURN; END IF;
  IF to_regprocedure('public.vehicle_build_reconstruction(uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_build_reconstruction(uuid) is not defined';
  END IF;
  n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'facet machine work anchor drifted: % matches', n; END IF;
  d := replace(d, anchor, E'  WHERE nullif(btrim(m.val), '''') IS NOT NULL\n' || branch || E'),\n-- One row per (item, independent source');
  EXECUTE d;
END $patch$;
