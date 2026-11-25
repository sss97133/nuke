-- vehicle_facet_items containment (20261124194900), two corrections.
--
-- 1. A value merges into the value that contains it only when every value that target contains forms one chain.
--    WHY. 194900 checked the chain upward from each value only. With 'blue', 'white' and 'blue and white' on one item, both
--    'blue' and 'white' have the single superset 'blue and white', so all three merged into one key: a real blue-vs-white
--    disagreement read as three agreeing sources. Now the target's own subsets ('blue', 'white') must also be a chain, so
--    none merges and the item stays in conflict. 'blue' with 'blue and white' alone still merges.
-- 2. Containment also runs on items whose format row is a vocabulary only (no code rule, no strip rules), after the
--    vocabulary step. WHY. Measured 2026-11-25 logged out: a90c008a body_style.recorded keeps 'pickup' apart from 'pickup,
--    regular cab, long bed' and 'pickup truck, long bed' because 194900 skipped every item with a format row.
-- Both are anchored replacements of text 194900 wrote (marker facet_containment_chain_v1); nothing else changes.
-- REVERT: re-run 194900's tc and tk text in place of these. Contract: supabase/sql/test_facet_containment_chain.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE d text;
  a1 text := $a$    AND NOT EXISTS (SELECT 1 FROM public.vehicle_facet_key_formats f WHERE f.item_key = tn.key)$a$;
  r1 text := $a$    AND NOT EXISTS (SELECT 1 FROM public.vehicle_facet_key_formats f WHERE f.item_key = tn.key
                     AND (f.vocabulary IS NULL OR f.code_rule_key IS NOT NULL OR cardinality(f.strip_rule_keys) > 0))$a$;
  a2 text := $a$tc AS (
  SELECT a.key, a.norm0,
         (SELECT b.norm0 FROM tk b WHERE b.key = a.key AND a.tok <@ b.tok ORDER BY cardinality(b.tok) DESC, b.norm0 LIMIT 1) AS norm
  FROM tk a
  WHERE cardinality(a.tok) > 0
    AND NOT EXISTS (SELECT 1 FROM tk b JOIN tk c ON c.key = b.key
                     WHERE b.key = a.key AND a.tok <@ b.tok AND a.tok <@ c.tok
                       AND NOT (b.tok <@ c.tok) AND NOT (c.tok <@ b.tok))
),$a$;
  r2 text := $a$-- facet_containment_chain_v1: the values containing a value form one chain, and so do the values its target contains.
tc0 AS MATERIALIZED (
  SELECT a.key, a.norm0,
         (SELECT b.tok FROM tk b WHERE b.key = a.key AND a.tok <@ b.tok ORDER BY cardinality(b.tok) DESC, b.norm0 LIMIT 1) AS ttok,
         (SELECT b.norm0 FROM tk b WHERE b.key = a.key AND a.tok <@ b.tok ORDER BY cardinality(b.tok) DESC, b.norm0 LIMIT 1) AS norm
  FROM tk a
  WHERE cardinality(a.tok) > 0
    AND NOT EXISTS (SELECT 1 FROM tk b JOIN tk c ON c.key = b.key
                     WHERE b.key = a.key AND a.tok <@ b.tok AND a.tok <@ c.tok
                       AND NOT (b.tok <@ c.tok) AND NOT (c.tok <@ b.tok))
),
tc AS MATERIALIZED (
  SELECT t0.key, t0.norm0, t0.norm
  FROM tc0 t0
  WHERE NOT EXISTS (SELECT 1 FROM tk x JOIN tk y ON y.key = x.key
                     WHERE x.key = t0.key AND cardinality(x.tok) > 0 AND cardinality(y.tok) > 0
                       AND x.tok <@ t0.ttok AND y.tok <@ t0.ttok
                       AND NOT (x.tok <@ y.tok) AND NOT (y.tok <@ x.tok))
),$a$;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid, text)'::regprocedure);
  IF position('facet_containment_chain_v1' IN d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'vehicle_facet_items: tk anchor not found exactly once (needs 20261124194900)'; END IF;
  IF (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'vehicle_facet_items: tc anchor not found exactly once (needs 20261124194900)'; END IF;
  d := replace(replace(d, a1, r1), a2, r2);
  EXECUTE d;
END $patch$;
