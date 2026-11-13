-- Keep the interleaved record pass within the existing claim deadline.
-- No cursor reset, worker/capacity increase or testimony write.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $patch$
DECLARE f text;before text;after text;pair text[];
BEGIN
 f:=pg_get_functiondef('public.seed_retained_listing_properties()'::regprocedure);
 IF position('retained_generic_page_25_v1' IN f)>0 THEN RETURN;END IF;
 IF md5(f)<>'7a38c3cfc16ae2d70476fba53d6aa2b6' THEN RAISE EXCEPTION 'Retained interleaved replay owner changed';END IF;
 FOREACH pair SLICE 1 IN ARRAY ARRAY[
  ARRAY['ORDER BY v.id LIMIT 500 LOOP','ORDER BY v.id LIMIT 25 LOOP'],
  ARRAY['remaining:=500-coalesce(cardinality(sources),0);','remaining:=25-coalesce(cardinality(sources),0);'],
  ARRAY['EXIT WHEN cardinality(sources)>=500;','EXIT WHEN cardinality(sources)>=25;'],
  ARRAY['vehicles_visited<500 AND coalesce(cardinality(sources),0)<500','vehicles_visited<25 AND coalesce(cardinality(sources),0)<25']
 ] LOOP
  before:=pair[1];after:=pair[2];
  IF (length(f)-length(replace(f,before,'')))/length(before)<>1 THEN RAISE EXCEPTION 'Generic page anchor changed: %',before;END IF;
  f:=replace(f,before,after);
 END LOOP;
 IF (length(f)-length(replace(f,E'BEGIN\n','')))/length(E'BEGIN\n')<>1 THEN RAISE EXCEPTION 'Seeder entry changed';END IF;
 EXECUTE replace(f,E'BEGIN\n',E'BEGIN\n -- retained_generic_page_25_v1: at most25 vehicles and25 source rows per generic call.\n');
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
