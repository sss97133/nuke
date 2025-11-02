-- Align vehicle_price_history helpers with current schema
-- Fixes outdated trigger/function referencing non-existent price column

-- Ensure the value column exists (rename legacy price column if still present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_price_history'
      AND column_name = 'price'
  ) THEN
    ALTER TABLE public.vehicle_price_history
      RENAME COLUMN price TO value;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_price_history'
      AND column_name = 'change_reason'
  ) THEN
    ALTER TABLE public.vehicle_price_history
      DROP COLUMN change_reason;
  END IF;
END;
$$;

-- Clean up legacy trigger/function
DROP TRIGGER IF EXISTS track_vehicle_price_change_trigger ON public.vehicles;
DROP TRIGGER IF EXISTS vehicle_price_change_trigger ON public.vehicles;
DROP TRIGGER IF EXISTS trg_vehicle_price_change ON public.vehicles;
DROP FUNCTION IF EXISTS public.track_vehicle_price_change();

-- Standardised trigger to log price history entries
CREATE OR REPLACE FUNCTION public.log_vehicle_price_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- MSRP updates
  IF NEW.msrp IS DISTINCT FROM OLD.msrp AND NEW.msrp IS NOT NULL THEN
    INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, source, as_of)
    VALUES (NEW.id, 'msrp', NEW.msrp, 'db_trigger', NOW());
  END IF;

  -- Purchase price updates
  IF NEW.purchase_price IS DISTINCT FROM OLD.purchase_price AND NEW.purchase_price IS NOT NULL THEN
    INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, source, as_of)
    VALUES (NEW.id, 'purchase', NEW.purchase_price, 'db_trigger', NOW());
  END IF;

  -- Current value updates
  IF NEW.current_value IS DISTINCT FROM OLD.current_value AND NEW.current_value IS NOT NULL THEN
    INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, source, as_of)
    VALUES (NEW.id, 'current', NEW.current_value, 'db_trigger', NOW());
  END IF;

  -- Asking price updates
  IF NEW.asking_price IS DISTINCT FROM OLD.asking_price AND NEW.asking_price IS NOT NULL THEN
    INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, source, as_of)
    VALUES (NEW.id, 'asking', NEW.asking_price, 'db_trigger', NOW());
  END IF;

  -- Sale price updates
  IF NEW.sale_price IS DISTINCT FROM OLD.sale_price AND NEW.sale_price IS NOT NULL THEN
    INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, source, as_of)
    VALUES (NEW.id, 'sale', NEW.sale_price, 'db_trigger', NOW());
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger using the updated function
DROP TRIGGER IF EXISTS trg_log_vehicle_price_history ON public.vehicles;
CREATE TRIGGER trg_log_vehicle_price_history
AFTER UPDATE OF msrp, purchase_price, current_value, asking_price, sale_price ON public.vehicles
FOR EACH ROW
EXECUTE FUNCTION public.log_vehicle_price_history();

