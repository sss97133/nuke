-- Create Vehicle Price History Table
-- Track all price changes over time with full audit trail
-- Created: November 1, 2025

-- Vehicle price history adjustments and backfill

-- Ensure expected indexes exist
CREATE INDEX IF NOT EXISTS idx_vehicle_price_history_vehicle 
  ON vehicle_price_history(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_price_history_date 
  ON vehicle_price_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_price_history_type 
  ON vehicle_price_history(price_type);

-- Harmonize RLS policies (drop permissive ones, ensure owner/public visibility)
DO $$
BEGIN
  IF to_regclass('public.vehicle_price_history') IS NULL THEN
    RAISE NOTICE 'vehicle_price_history table missing; skipping policy changes.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.vehicle_price_history ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS "Anyone can view vehicle price history" ON public.vehicle_price_history';
  EXECUTE 'DROP POLICY IF EXISTS "vph_select_public" ON public.vehicle_price_history';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vehicle_price_history'
      AND policyname = 'Users can view price history for public vehicles'
  ) THEN
    EXECUTE '
      CREATE POLICY "Users can view price history for public vehicles"
        ON public.vehicle_price_history FOR SELECT USING (
          EXISTS (
            SELECT 1 FROM public.vehicles v
            WHERE v.id = vehicle_price_history.vehicle_id
              AND COALESCE(v.is_public, true) = true
          )
        )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vehicle_price_history'
      AND policyname = 'Owners can view all price history for their vehicles'
  ) THEN
    EXECUTE '
      CREATE POLICY "Owners can view all price history for their vehicles"
        ON public.vehicle_price_history FOR SELECT USING (
          EXISTS (
            SELECT 1 FROM public.vehicles v
            WHERE v.id = vehicle_price_history.vehicle_id
              AND (v.user_id = auth.uid() OR v.owner_id = auth.uid())
          )
        )';
  END IF;
END
$$;

-- Trigger to automatically track price changes on vehicles table
CREATE OR REPLACE FUNCTION track_vehicle_price_change()
RETURNS TRIGGER AS $$
DECLARE
  effective_actor UUID := COALESCE(auth.uid(), NEW.user_id, NEW.owner_id, NEW.uploaded_by);
BEGIN
  -- Track current_value changes
  IF OLD.current_value IS DISTINCT FROM NEW.current_value AND NEW.current_value IS NOT NULL THEN
    INSERT INTO vehicle_price_history (vehicle_id, price_type, value, source, notes, as_of, logged_by)
    VALUES (
      NEW.id,
      'current',
      NEW.current_value,
      'vehicles',
      'Vehicle current value updated by trigger',
      COALESCE(NEW.updated_at, NOW()),
      effective_actor
    );
  END IF;
  
  -- Track asking_price changes
  IF OLD.asking_price IS DISTINCT FROM NEW.asking_price AND NEW.asking_price IS NOT NULL THEN
    INSERT INTO vehicle_price_history (vehicle_id, price_type, value, source, notes, as_of, logged_by)
    VALUES (
      NEW.id,
      'asking',
      NEW.asking_price,
      'vehicles',
      'Vehicle asking price updated by trigger',
      COALESCE(NEW.updated_at, NOW()),
      effective_actor
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- Create trigger
DROP TRIGGER IF EXISTS vehicle_price_change_trigger ON vehicles;
CREATE TRIGGER vehicle_price_change_trigger
  AFTER UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION track_vehicle_price_change();

-- Backfill initial prices from existing vehicles
DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL OR to_regclass('public.vehicle_price_history') IS NULL THEN
    RAISE NOTICE 'Skipping vehicle price backfill: required tables do not exist.';
    RETURN;
  END IF;

  INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, source, notes, as_of, logged_by)
  SELECT 
    id,
    'purchase',
    purchase_price,
    'migration_seed',
    'Initial purchase price',
    COALESCE(purchase_date::timestamptz, created_at),
    uploaded_by
  FROM public.vehicles
  WHERE purchase_price IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.vehicle_price_history vph
      WHERE vph.vehicle_id = vehicles.id
        AND vph.price_type = 'purchase'
    );

  INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, source, notes, as_of, logged_by)
  SELECT 
    id,
    'current',
    current_value,
    'migration_seed',
    'Initial current value',
    updated_at,
    uploaded_by
  FROM public.vehicles
  WHERE current_value IS NOT NULL
    AND (purchase_price IS NULL OR current_value <> purchase_price)
    AND NOT EXISTS (
      SELECT 1 FROM public.vehicle_price_history vph
      WHERE vph.vehicle_id = vehicles.id
        AND vph.price_type = 'current'
    );
END
$$;

