-- Preserve historical interpretation membership after sanctioned supersession.
-- The exact deployed owner was read on 2026-10-12. Only its two admission
-- predicates change; current/retrospective behavior and all source gates stay.
-- Unknown/nonfinite retirement clocks do not invent historical admissibility.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';
DO $repair$
DECLARE
  f text;
  original text;
  old_predicate constant text := 'o.is_superseded IS FALSE';
  new_predicate constant text := '(o.is_superseded IS FALSE OR (p_knowledge_mode = ''known_at'' AND o.is_superseded IS TRUE AND isfinite(o.superseded_at) AND o.superseded_at > v_known))';
BEGIN
  f := pg_get_functiondef('public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text)'::regprocedure);
  -- Normalize this patch only, so an identical deployment retry is safe.
  original := replace(f, new_predicate, old_predicate);
  IF encode(sha256(convert_to(original, 'UTF8')), 'base64') IS DISTINCT FROM
      'DvgxE8Le+vJFKXHzXjXMkNH2PNReL5XimSsDgHliz5U=' THEN
    RAISE EXCEPTION 'Valuation owner drifted; review before changing historical membership';
  END IF;
  IF cardinality(string_to_array(original, old_predicate)) <> 3 THEN
    RAISE EXCEPTION 'Valuation supersession predicate anchors changed';
  END IF;
  f := replace(original, old_predicate, new_predicate);
  EXECUTE f;
  IF pg_get_functiondef('public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text)'::regprocedure)
      IS DISTINCT FROM f THEN
    RAISE EXCEPTION 'Valuation replacement changed outside the reviewed predicates';
  END IF;
END $repair$;
COMMIT;
