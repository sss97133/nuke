-- close_deal_guard_columns_v1: the closure key on deal_jackets is written only by close_deal_on_sale, and a skip row is
-- written only for a deal the sale could have closed.
--
-- WHY. 20261125084210 added deal_jackets.closed_by_auction_event_id and closed_price_basis. They decide whether a later
-- write of the same auction event may correct the closure, but any role that can UPDATE deal_jackets could set them
-- and so open a closed deal to another event's price (residual (a) of the 11-25 attack). Its skip branch also wrote a
-- price_unknown row for a deal opened after the auction ended, which the close branch would never close (residual (b)).
--
-- WHAT (keys, trigger):
--   close_deal_on_sale               edited in place: the skip insert carries the created_at test whenever the end
--                                     date is known; the closure UPDATE runs inside a transaction-local setting
--                                     deal_jackets.closing = the deal id, reset after.
--   deal_jackets_closure_by_trigger  BEFORE INSERT OR UPDATE OF closed_by_auction_event_id, closed_price_basis: setting
--                                     either to a new non-NULL value outside that setting is refused. Clearing is
--                                     allowed, so the ON DELETE SET NULL of the event key still works and a clear can
--                                     never forge a closure.
-- Prediction at deploy: 0 rows change (no deal carries a closure key yet; deal_close_skips is append-only and keeps its
-- rows).
--
-- REVERT. Re-run close_deal_on_sale from 20261125084210; drop the trigger and its function.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text; n int;
  a1 text := E'       AND (dj.sold_date IS NULL OR dj.closed_by_auction_event_id = NEW.id)\n    ON CONFLICT';
  r1 text := E'       AND (dj.sold_date IS NULL OR dj.closed_by_auction_event_id = NEW.id)\n       -- close_deal_guard_columns_v1: a deal opened after the sale ended is not one it could close.\n       AND (NEW.auction_end_date IS NULL OR NEW.auction_end_date >= dj.created_at)\n    ON CONFLICT';
  a2 text := E'    UPDATE public.deal_jackets SET\n      sold_date = NEW.auction_end_date::date,\n';
  r2 text := E'    PERFORM set_config(''deal_jackets.closing'', v_deal.id::text, true);\n    UPDATE public.deal_jackets SET\n      sold_date = NEW.auction_end_date::date,\n';
  a3 text := E'    WHERE id = v_deal.id;\n';
  r3 text := E'    WHERE id = v_deal.id;\n    PERFORM set_config(''deal_jackets.closing'', '''', true);\n';
BEGIN
  d := pg_get_functiondef('public.close_deal_on_sale()'::regprocedure);
  IF position('close_deal_guard_columns_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('close_deal_on_sale_columns_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'close_deal_guard_columns: close_deal_on_sale is not the 20261125084210 body';
  END IF;
  FOR n IN SELECT (length(d) - length(replace(d, a, ''))) / length(a) FROM unnest(ARRAY[a1, a2, a3]) a LOOP
    IF n <> 1 THEN RAISE EXCEPTION 'close_deal_guard_columns anchor drifted: % matches', n; END IF;
  END LOOP;
  d := replace(replace(replace(d, a1, r1), a2, r2), a3, r3);
  EXECUTE d;
END
$patch$;

CREATE OR REPLACE FUNCTION public.deal_jackets_closure_by_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $f$
BEGIN
  IF ((NEW.closed_by_auction_event_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.closed_by_auction_event_id IS DISTINCT FROM OLD.closed_by_auction_event_id))
      OR (NEW.closed_price_basis IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.closed_price_basis IS DISTINCT FROM OLD.closed_price_basis)))
     AND current_setting('deal_jackets.closing', true) IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'deal_jackets: % closure key is written only by close_deal_on_sale', NEW.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$f$;
REVOKE ALL ON FUNCTION public.deal_jackets_closure_by_trigger() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS deal_jackets_closure_by_trigger ON public.deal_jackets;
CREATE TRIGGER deal_jackets_closure_by_trigger
  BEFORE INSERT OR UPDATE OF closed_by_auction_event_id, closed_price_basis ON public.deal_jackets
  FOR EACH ROW EXECUTE FUNCTION public.deal_jackets_closure_by_trigger();

COMMENT ON COLUMN public.deal_jackets.closed_by_auction_event_id IS
'The auction event whose sold row closed this deal. Written only by close_deal_on_sale (trigger deal_jackets_closure_by_trigger refuses other writers); cleared when the event is deleted. Migrations 20261125084210, 20261125171500.';
