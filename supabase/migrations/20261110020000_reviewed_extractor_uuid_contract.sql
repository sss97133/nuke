-- Supplied reviews have no registered extractor UUID. The producer method and
-- complete reviewer provenance already identify them. The previous text label
-- could not enter vehicle_observations.extractor_id (UUID), so no review using
-- this contract was admitted. Correct only the two existing owner predicates;
-- preserve all source locks, witness checks, roles, grants and projection logic.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
DO $repair$
DECLARE
  owner regprocedure;
  expected text;
  prior text;
  replacement text;
  definition text;
BEGIN
  IF (SELECT atttypid <> 'uuid'::regtype OR attnotnull FROM pg_attribute
      WHERE attrelid='public.vehicle_observations'::regclass AND attname='extractor_id')
     IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'review extractor column drifted; inspect its current contract';
  END IF;
  FOR owner, expected, prior, replacement IN
    SELECT * FROM (VALUES
      ('public.guard_reviewed_image_analysis()'::regprocedure,
       '796cd7b9fe5bbde9c5f2d930e2db63a9',
       'NEW.extractor_id IS DISTINCT FROM ''photo-pipeline-orchestrator''',
       'NEW.extractor_id IS NOT NULL'),
      ('public.project_reviewed_image_analysis(uuid)'::regprocedure,
       '7a7b9449ee313130a54bebedff7a7c82',
       'o.extractor_id IS DISTINCT FROM ''photo-pipeline-orchestrator''',
       'o.extractor_id IS NOT NULL')
    ) AS owners(signature, definition_md5, old_predicate, new_predicate)
  LOOP
    IF md5(pg_get_functiondef(owner)) IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'review owner % drifted; inspect its current definition', owner;
    END IF;
    definition := pg_get_functiondef(owner);
    IF (length(definition)-length(replace(definition,prior,'')))/length(prior) <> 1 THEN
      RAISE EXCEPTION 'review owner % does not contain exactly one extractor predicate', owner;
    END IF;
    EXECUTE replace(definition,prior,replacement);
  END LOOP;
END $repair$;
COMMIT;
