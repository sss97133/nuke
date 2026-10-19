-- The generic family-sales plan scans every Ford/Porsche sale through the Silverado/Sierra UNION arm,
-- even though that arm can only return Chevrolet/GMC rows. An explicit parameter-only brand guard gives
-- PostgreSQL a one-time filter before that scan. Existing eligibility, enrichment, dedup, order and cap stay exact.
-- Observed 2026-10-18: anonymous Ford/Mustang full read timed out; a two-row read took 11.5s.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

DO $patch$
DECLARE
  target regprocedure := 'public.treemap_family_sales(text,text,integer)'::regprocedure;
  prior_body text;
  next_body text;
  definition text;
BEGIN
  SELECT prosrc INTO STRICT prior_body FROM pg_proc WHERE oid = target;
  -- Public SQL-body fingerprints, represented as UUIDs (the same 128 bits).
  IF md5(prior_body)::uuid = 'b5714a15-c8ff-d169-6675-e25e053b217f'::uuid THEN RETURN; END IF;
  IF md5(prior_body)::uuid <> '57d3d0c7-ec24-6d34-21c3-04251e9e235f'::uuid THEN
    RAISE EXCEPTION 'treemap_family_sales body changed; review before applying fallback gate';
  END IF;
  next_body := replace(prior_body,
    E'FROM public.mv_family_sales s\n    WHERE s.brand = p_brand\n',
    E'FROM public.mv_family_sales s\n    WHERE p_brand IN (\'Chevrolet\', \'GMC\')\n      AND s.brand = p_brand\n');
  IF md5(next_body)::uuid <> 'b5714a15-c8ff-d169-6675-e25e053b217f'::uuid THEN
    RAISE EXCEPTION 'fallback gate did not produce the reviewed body';
  END IF;
  -- Reuse PostgreSQL's full definition so default arguments and all function attributes are preserved.
  -- CREATE OR REPLACE also retains the existing grants; no permission or visibility change is made.
  definition := pg_get_functiondef(target);
  IF position(prior_body IN definition) = 0 THEN RAISE EXCEPTION 'function body not found in definition'; END IF;
  EXECUTE replace(definition, prior_body, next_body);
END
$patch$;

COMMIT;
