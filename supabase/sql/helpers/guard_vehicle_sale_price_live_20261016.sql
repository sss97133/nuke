-- The live guard_vehicle_sale_price() (pg_get_functiondef on prod 2026-10-16), verbatim, and its trigger definition.
CREATE OR REPLACE FUNCTION public.guard_vehicle_sale_price()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- A NULL or non-positive sale_price claims nothing.
  IF NEW.sale_price IS NULL OR NEW.sale_price <= 0 THEN
    RETURN NEW;
  END IF;

  -- A status says money moved (the 'status' basis in vehicle_sale_basis()).
  IF NEW.sale_status = 'sold' OR NEW.auction_outcome = 'sold' THEN
    RETURN NEW;
  END IF;

  -- The correction chokepoint runs under this transaction-local flag (see 20260927020100).
  IF current_setting('nuke.bulk_sale_correction', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Legacy rows (247,954 priced-without-status on 2026-09-27): every other column stays writable;
  -- the price itself may only change with a status, or through the chokepoint.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sale_price IS NOT DISTINCT FROM OLD.sale_price THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE    = 'check_violation',
    CONSTRAINT = 'vehicles_sale_price_requires_sold_status',
    TABLE      = 'vehicles',
    COLUMN     = 'sale_price',
    MESSAGE    = format('vehicles.sale_price = %s refused for %s: no sold status (sale_status = %L, auction_outcome = %L)',
                        NEW.sale_price, NEW.id, NEW.sale_status, NEW.auction_outcome),
    DETAIL     = 'A price alone is a bid, an ask or an estimate, never a sale (vehicle_sale_basis, 2026-09-27).',
    HINT       = 'Write a quote to asking_price and a bid to high_bid / winning_bid. Write a sale with sale_status = ''sold'' or auction_outcome = ''sold'' in the same statement. Supersede a wrong sale value through correct_vehicle_sale_provenance_batch(), never by overwriting it.';
END;
$function$

;
CREATE TRIGGER trg_guard_vehicle_sale_price BEFORE INSERT OR UPDATE OF sale_price, sale_status, auction_outcome ON public.vehicles FOR EACH ROW EXECUTE FUNCTION guard_vehicle_sale_price();
