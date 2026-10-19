-- A retained row's creation time is not its source event date. Keep undated prior
-- presentations visible under the existing eligibility/order, but emit a null
-- occurrence date instead of presenting their admission day as the sale day.
-- This changes no rows, price qualification, visibility, ordering or grants.
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
  IF v_hash = 'ME7K0/g1hPC3w8JC5HNmhfKZanQJtZ/yWKI4Id6erc8=' THEN
    RETURN; -- A successful migration may be retried.
  END IF;
  IF v_hash <> 'QiQ6D1bPt6w9+TrxjMaOAoW8IY24vqlMFo5KZQU/6j0=' THEN
    RAISE EXCEPTION 'auction_calendar_read differs from the reviewed source-clock contract';
  END IF;
  EXECUTE replace(v_definition,
    '''on'', COALESCE(p.ended_at, p.sold_at, p.created_at)::date',
    '''on'', COALESCE(p.ended_at, p.sold_at)::date');
END;
$patch$;

COMMIT;
