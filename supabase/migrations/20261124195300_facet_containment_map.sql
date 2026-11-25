-- vehicle_facet_items: the containment chain (20261124195100) computed per item, same rule, a third of the time.
--
-- WHY. Measured 2026-11-25 logged out after #3830: e08bf694 2.45-3.62 s (4 calls; 1.8 s before #3830), the proof car
-- 0.60-0.99 s. The same function with containment removed runs e08bf694 in 0.76-0.79 s, so containment was ~1.7 s of it:
-- tc0/tc scanned every text value of the vehicle for each value (four nested tk scans), with the item key only as a filter.
-- WHAT. public.vehicle_facet_containment_map(text[]) takes one item's normalised values and returns the values that merge
-- (norm0 -> norm), by exactly 195100's rule: a value merges into its largest containing value when the values containing
-- it form one chain and the values that target contains form one chain. vehicle_facet_items calls it once per text item
-- with more than one value (marker facet_containment_chain_v2), in place of tc0/tc. Values that map to themselves are
-- not returned (td's coalesce(tc.norm, tn.norm0) gives them unchanged).
-- Parity: pg_temp copies of the live and patched function returned the same md5 for all 14 bench vehicles and the proof
-- car; e08bf694 0.81-1.36 s against 2.27-2.41 s for the live copy in the same session.
-- REVERT: re-run 195100's tc0/tc text in place of the tc below; drop the function.
-- Contract: supabase/sql/test_facet_containment_map.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.vehicle_facet_containment_map(p_vals text[])
RETURNS TABLE(norm0 text, norm text)
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $f$
  WITH tk AS MATERIALIZED (
    SELECT DISTINCT x AS norm0, array_remove(regexp_split_to_array(x, '[^a-z0-9]+'), '') AS tok
    FROM unnest(p_vals) x WHERE x IS NOT NULL),
  tc0 AS MATERIALIZED (
    SELECT a.norm0,
           (SELECT b.tok FROM tk b WHERE a.tok <@ b.tok ORDER BY cardinality(b.tok) DESC, b.norm0 LIMIT 1) AS ttok,
           (SELECT b.norm0 FROM tk b WHERE a.tok <@ b.tok ORDER BY cardinality(b.tok) DESC, b.norm0 LIMIT 1) AS norm
    FROM tk a
    WHERE cardinality(a.tok) > 0
      AND NOT EXISTS (SELECT 1 FROM tk b, tk c
                       WHERE a.tok <@ b.tok AND a.tok <@ c.tok AND NOT (b.tok <@ c.tok) AND NOT (c.tok <@ b.tok)))
  SELECT t0.norm0, t0.norm FROM tc0 t0
  WHERE t0.norm IS DISTINCT FROM t0.norm0
    AND NOT EXISTS (SELECT 1 FROM tk x, tk y
                     WHERE cardinality(x.tok) > 0 AND cardinality(y.tok) > 0
                       AND x.tok <@ t0.ttok AND y.tok <@ t0.ttok AND NOT (x.tok <@ y.tok) AND NOT (y.tok <@ x.tok))
$f$;
REVOKE ALL ON FUNCTION public.vehicle_facet_containment_map(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_facet_containment_map(text[]) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_facet_containment_map(text[]) IS
  'One facet item''s normalised values -> the values that merge into a containing value (norm0 -> norm), by the '
  'containment chain rule (20261124195100); read by vehicle_facet_items. 20261124195300.';

DO $patch$
DECLARE d text; a text; r text; i int; j int;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid, text)'::regprocedure);
  IF position('facet_containment_chain_v2' IN d) > 0 THEN RETURN; END IF;
  i := position('-- facet_containment_chain_v1' IN d);
  j := position('-- One row per (item, independent source' IN d);
  IF i = 0 OR j <= i THEN RAISE EXCEPTION 'vehicle_facet_items: containment block not found (needs 20261124195100)'; END IF;
  a := substr(d, i, j - i);
  IF position('tc0 AS MATERIALIZED' IN a) = 0 OR position('tc AS MATERIALIZED' IN a) = 0 THEN
    RAISE EXCEPTION 'vehicle_facet_items: tc0/tc not in the containment block';
  END IF;
  r := $r$-- facet_containment_chain_v2: the containment chain rule, computed per item over that item's values
-- (vehicle_facet_containment_map), not by scanning every value of the vehicle for each value.
tc AS MATERIALIZED (
  SELECT g.key, m.norm0, m.norm
  FROM (SELECT tk.key, array_agg(tk.norm0) AS vals FROM tk GROUP BY tk.key HAVING count(*) > 1) g
  CROSS JOIN LATERAL public.vehicle_facet_containment_map(g.vals) m
),
$r$;
  d := substr(d, 1, i - 1) || r || substr(d, j);
  EXECUTE d;
END $patch$;
