-- Guard vehicles.sale_price writes copied from a non-USD vehicle_events price.
-- Companion to 20261025190000_vehicle_events_currency_guard (#2593).
-- When sale_price is written (INSERT, or the value/currency changes) and it equals the
-- final_price/hammer_price of this vehicle's own events, the event's currency_code is the label:
-- 1. sale_price_currency NULL and every matching event agrees on one non-USD code -> copy it
--    (not a guess: the event's own label). sale_price_fx_source records the copy.
-- 2. sale_price_currency set and every matching event agrees on a different code -> reject.
-- Matches with mixed or unlabeled currencies are left alone. Writes that don't touch the
-- price or its currency (legacy rows) pass untouched.
-- Revert: DROP TRIGGER IF EXISTS trg_vehicles_sale_currency_guard ON public.vehicles;
--         DROP FUNCTION IF EXISTS public.vehicles_sale_currency_guard();
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.vehicles_sale_currency_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ev_cur text;
  n_cur int;
BEGIN
  IF NEW.sale_price IS NULL OR NEW.sale_price <= 0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.sale_price IS NOT DISTINCT FROM OLD.sale_price
     AND NEW.sale_price_currency IS NOT DISTINCT FROM OLD.sale_price_currency THEN
    RETURN NEW;
  END IF;
  SELECT min(upper(e.currency_code)), count(DISTINCT upper(coalesce(e.currency_code, '?')))
    INTO ev_cur, n_cur
    FROM public.vehicle_events e
   WHERE e.vehicle_id = NEW.id
     AND (e.final_price = NEW.sale_price OR e.hammer_price = NEW.sale_price);
  IF n_cur IS DISTINCT FROM 1 OR ev_cur IS NULL OR ev_cur = '?' THEN RETURN NEW; END IF;
  IF NEW.sale_price_currency IS NULL THEN
    IF ev_cur <> 'USD' THEN
      NEW.sale_price_currency := ev_cur;
      NEW.sale_price_fx_source := coalesce(NEW.sale_price_fx_source,
        'currency_guard: sale_price matches vehicle_events price labelled ' || ev_cur);
    END IF;
  ELSIF upper(NEW.sale_price_currency) <> ev_cur THEN
    RAISE EXCEPTION 'vehicles.sale_price % labelled % but matches vehicle_events price in % (vehicle %)',
      NEW.sale_price, NEW.sale_price_currency, ev_cur, NEW.id
      USING ERRCODE = 'check_violation',
            HINT = 'Write the native amount with its currency, or the USD amount to sale_price_usd.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_vehicles_sale_currency_guard ON public.vehicles;
CREATE TRIGGER trg_vehicles_sale_currency_guard
  BEFORE INSERT OR UPDATE OF sale_price, sale_price_currency
  ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.vehicles_sale_currency_guard();
