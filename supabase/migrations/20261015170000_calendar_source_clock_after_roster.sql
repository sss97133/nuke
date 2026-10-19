-- The roster/census expansion replaced the calendar function after the reviewed
-- source-clock correction. Restore that same projection without removing the
-- roster, census, non-vehicle or correction-aware history additions.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5s';

DO $patch$
DECLARE
  v_definition text;
  v_hash text;
BEGIN
  SELECT pg_get_functiondef('public.auction_calendar_read(integer,text,text,integer,integer)'::regprocedure)
    INTO v_definition;
  v_hash := encode(sha256(convert_to(v_definition, 'UTF8')), 'base64');
  IF v_hash = 'JXl0GXog+0W8WetihAcbFriewcDSxfr5noTYdLcYt80=' THEN
    RETURN;
  END IF;
  IF v_hash <> '7m8djwaPupkZUQrzgnYrxqb6Kg2OjD6Cl4mygkSFzFk=' THEN
    RAISE EXCEPTION 'auction_calendar_read differs from the reviewed roster/source-clock contract';
  END IF;
  EXECUTE replace(v_definition,
    '''on'', COALESCE(p.ended_at, p.sold_at, p.created_at)::date',
    '''on'', COALESCE(p.ended_at, p.sold_at)::date');
END;
$patch$;

COMMIT;
