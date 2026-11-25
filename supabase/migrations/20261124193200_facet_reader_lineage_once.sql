-- facet_reader_lineage_v2: look a reader's family up once per model, not once per observation.
--
-- WHY. 20261124193000 called reader_lineage(agent_model) (a definer function, so never inlined) for every observation the
-- fact reader reads. A car with 10,315 keyed photo readings and one model paid about 180 ms for it (EXPLAIN ANALYZE,
-- 2026-11-24: 293 ms with the call against 114 ms without), and its first logged-out read after the deploy hit the 15 s
-- anon timeout.
--
-- WHAT CHANGES. obs carries agent_model only; a new CTE `lin` asks reader_lineage once for each distinct model among
-- those observations; obs_w joins it and carries `lineage` and `lineage_known` exactly as before. Output is unchanged.
--
-- REVERT. Redefine vehicle_facet_items with the three replacements below in reverse. Nothing is written.
-- Contract: supabase/sql/test_vehicle_facet_reader_lineage.sql (applies 20261124193000 then this).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  n integer;
  r record;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('facet_reader_lineage_v2' IN d) > 0 THEN RETURN; END IF;
  IF position('facet_reader_lineage_v1' IN d) = 0 THEN RAISE EXCEPTION 'apply 20261124193000 first'; END IF;
  FOR r IN SELECT * FROM (VALUES
    (1, E'/* facet_reader_lineage_v1 */ coalesce(public.reader_lineage(o.agent_model), o.extraction_method) AS lineage,\n         nullif(btrim(o.agent_model), \'\') IS NOT NULL AS lineage_known,\n',
        E'/* facet_reader_lineage_v1 */ nullif(btrim(o.agent_model), \'\') AS agent_model,\n'),
    (2, E'-- An image witness only when the viewer can see the image; else the observation itself.\n',
        E'-- facet_reader_lineage_v2: each distinct reader model\'s family, asked once (reader_lineage).\nlin AS MATERIALIZED (\n  SELECT d.m, public.reader_lineage(d.m) AS l FROM (SELECT DISTINCT agent_model AS m FROM obs WHERE agent_model IS NOT NULL) d\n),\n-- An image witness only when the viewer can see the image; else the observation itself.\n'),
    (3, E'  SELECT o.*, CASE WHEN o.image_id IS NOT NULL AND EXISTS',
        E'  SELECT o.*, coalesce(lin.l, o.method) AS lineage, lin.l IS NOT NULL AS lineage_known,\n         CASE WHEN o.image_id IS NOT NULL AND EXISTS'),
    (4, E'  FROM obs o\n),\n-- A VIN decode',
        E'  FROM obs o LEFT JOIN lin ON lin.m = o.agent_model\n),\n-- A VIN decode')
  ) x(ord, old, new) ORDER BY ord LOOP
    n := (length(d) - length(replace(d, r.old, ''))) / length(r.old);
    IF n <> 1 THEN RAISE EXCEPTION 'facet reader lineage v2 anchor % drifted: % matches', r.ord, n; END IF;
    d := replace(d, r.old, r.new);
  END LOOP;
  EXECUTE d;
END $patch$;
