-- A receipt that just scheduled another retry must yield to an equally important
-- receipt that has already been due longer. Keep the existing one-receipt cap,
-- general queue ordering, source route, attempt limits and lease handling.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';

DO $$
DECLARE
  def text;
  anchor text := 'ORDER BY rp.priority,rp.created_at,rp.id LIMIT 1';
BEGIN
  def := pg_get_functiondef('public.claim_derivation_work(text,integer,uuid)'::regprocedure);
  IF (length(def)-length(replace(def,anchor,'')))/length(anchor) <> 1 THEN
    RAISE EXCEPTION 'Receipt catalog claim ordering anchor drift';
  END IF;
  EXECUTE replace(def,anchor,
    'ORDER BY rp.priority,rp.next_attempt_at,rp.created_at,rp.id LIMIT 1');
END $$;

COMMIT;
