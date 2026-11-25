-- build_reconstruction_edges_v1: vehicle_build_reconstruction reads each line's system and operation from the stored
-- edge (receipt_line_edges, 20261124234000) by receipt_items.id, instead of running the text classifiers per line.
--
-- WHY. Measured live 2026-11-24: the reader ran receipt_line_system() and receipt_line_labor_operation() on every work
-- line per read (2.7 s proof vehicle, 4.9 s Blazer, whole read); the answer is stored with its rule as basis.
-- WHAT CHANGES. Two expressions, edited in place (other lanes keep editing this body, so it is not copied): a line with
-- an item_id reads its edge; a line with no item_id (receipt_work_lines rows that are not receipt items, 14 on the
-- Blazer) keeps the text classifier. Output is unchanged: the edge writer and the text wrappers pick the same rule
-- while no active rule is scoped or reads part_number (asserted below), and the read is compared before and after on
-- two vehicles.
-- REVERT. Swap each replacement back to its anchor in pg_get_functiondef and EXECUTE.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text; n int;
  a1 text := $a$coalesce(public.receipt_line_system(k.description), 'unplaced') AS system_key$a$;
  r1 text := $r$coalesce(CASE WHEN k.item_id IS NULL THEN public.receipt_line_system(k.description)
                         ELSE (SELECT e.system_key FROM public.receipt_line_edges e
                                WHERE e.receipt_item_id = k.item_id AND e.classifier = 'system') END,
                    'unplaced') AS system_key /* build_reconstruction_edges_v1 */$r$;
  a2 text := $a$WHERE o.code = public.receipt_line_labor_operation(k.description)$a$;
  r2 text := $r$WHERE o.code = CASE WHEN k.item_id IS NULL THEN public.receipt_line_labor_operation(k.description)
                             ELSE (SELECT e.operation_code FROM public.receipt_line_edges e
                                    WHERE e.receipt_item_id = k.item_id AND e.classifier = 'labor_operation') END$r$;
  cars uuid[] := ARRAY['20d21fb0-4651-4469-a0ba-e751309a1e54', 'e08bf694-970f-4cbe-8a74-8715158a0f2e']::uuid[];
  before text[]; after text[];
BEGIN
  d := pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure);
  IF position('build_reconstruction_edges_v1' IN d) > 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.receipt_line_rules WHERE status = 'active' AND classifier IN ('system', 'labor_operation')
              AND (field <> 'description' OR scope_vendor_pattern IS NOT NULL OR scope_make IS NOT NULL
                   OR scope_year_min IS NOT NULL OR scope_year_max IS NOT NULL)) THEN
    RAISE EXCEPTION 'an active rule is scoped or reads part_number: edges and text wrappers can differ, not switching';
  END IF;
  FOR n IN SELECT (length(d) - length(replace(d, a, ''))) / length(a) FROM unnest(ARRAY[a1, a2]) a LOOP
    IF n <> 1 THEN RAISE EXCEPTION 'build reconstruction anchor drifted: % matches', n; END IF;
  END LOOP;
  SELECT array_agg(md5(public.vehicle_build_reconstruction(c)::text) ORDER BY o) INTO before FROM unnest(cars) WITH ORDINALITY u(c, o);
  EXECUTE replace(replace(d, a1, r1), a2, r2);
  SELECT array_agg(md5(public.vehicle_build_reconstruction(c)::text) ORDER BY o) INTO after FROM unnest(cars) WITH ORDINALITY u(c, o);
  IF before IS DISTINCT FROM after THEN
    RAISE EXCEPTION 'vehicle_build_reconstruction output changed: % -> %', before, after;
  END IF;
END
$patch$;
