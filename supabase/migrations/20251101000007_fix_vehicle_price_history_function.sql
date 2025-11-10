-- Align vehicle_price_history helpers with current schema
-- Fixes outdated trigger/function referencing non-existent price column

-- Ensure the value column exists (rename legacy price column if still present)
-- Fix vehicle price history helpers (align with current schema)
DO $$
BEGIN
  IF to_regclass('public.vehicle_price_history') IS NULL THEN
    RAISE NOTICE 'vehicle_price_history table missing; skipping column alignment.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_price_history'
      AND column_name = 'price'
  ) THEN
    EXECUTE 'ALTER TABLE public.vehicle_price_history RENAME COLUMN price TO value';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_price_history'
      AND column_name = 'change_reason'
  ) THEN
    EXECUTE 'ALTER TABLE public.vehicle_price_history DROP COLUMN change_reason';
  END IF;
END
$$;

-- Clean up legacy triggers/functions
DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE NOTICE 'vehicles table missing; skipping trigger recreation.';
    RETURN;
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS track_vehicle_price_change_trigger ON public.vehicles';
  EXECUTE 'DROP TRIGGER IF EXISTS vehicle_price_change_trigger ON public.vehicles';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_vehicle_price_change ON public.vehicles';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_log_vehicle_price_history ON public.vehicles';
  EXECUTE 'DROP FUNCTION IF EXISTS public.track_vehicle_price_change()';
END
$$;

-- Standardized trigger function
CREATE OR REPLACE FUNCTION public.log_vehicle_price_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  effective_actor UUID := COALESCE(auth.uid(), NEW.user_id, NEW.owner_id, NEW.uploaded_by);
BEGIN
  IF NEW.msrp IS DISTINCT FROM OLD.msrp AND NEW.msrp IS NOT NULL THEN
    INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by)
    VALUES (NEW.id, 'msrp', NEW.msrp, 'db_trigger', COALESCE(NEW.updated_at, NOW()), effective_actor);
  END IF;

  IF NEW.purchase_price IS DISTINCT FROM OLD.purchase_price AND NEW.purchase_price IS NOT NULL THEN
    INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by)
    VALUES (NEW.id, 'purchase', NEW.purchase_price, 'db_trigger', COALESCE(NEW.updated_at, NOW()), effective_actor);
  END IF;

  IF NEW.current_value IS DISTINCT FROM OLD.current_value AND NEW.current_value IS NOT NULL THEN
    INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by)
    VALUES (NEW.id, 'current', NEW.current_value, 'db_trigger', COALESCE(NEW.updated_at, NOW()), effective_actor);
  END IF;

  IF NEW.asking_price IS DISTINCT FROM OLD.asking_price AND NEW.asking_price IS NOT NULL THEN
    INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by)
    VALUES (NEW.id, 'asking', NEW.asking_price, 'db_trigger', COALESCE(NEW.updated_at, NOW()), effective_actor);
  END IF;

  IF NEW.sale_price IS DISTINCT FROM OLD.sale_price AND NEW.sale_price IS NOT NULL THEN
    INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by)
    VALUES (NEW.id, 'sale', NEW.sale_price, 'db_trigger', COALESCE(NEW.updated_at, NOW()), effective_actor);
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger using the updated function
DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'CREATE TRIGGER trg_log_vehicle_price_history
    AFTER UPDATE OF msrp, purchase_price, current_value, asking_price, sale_price ON public.vehicles
    FOR EACH ROW
    EXECUTE FUNCTION public.log_vehicle_price_history()';
END
$$;

