-- update_vehicle_completion: enqueue a completion recompute only when a score input changed (2026-10-15).
--
-- WHY: the trigger skipped an UPDATE only when completion_percentage moved AND the input columns did not. Every other
-- UPDATE enqueued, including the many that change no input: sale_status / auction_outcome corrections, live bid
-- writes, observation_count and stats writebacks from the derived drains. On 2026-10-15 the queue went 2,494 -> 20,003
-- in about 20 minutes while job 500 drains about 150 to 300 a minute (calculate_vehicle_completion_algorithmic ~11 ms
-- plus a ~47 ms vehicles writeback per row), and every vehicle writer gates on that queue.
--
-- calculate_vehicle_completion_algorithmic reads, from vehicles: vin, make, model, year, mileage, transmission,
-- drivetrain, sale_price, current_value (plus counts of timeline_events and vehicle_images, other tables). The list
-- below keeps the trigger's existing superset of those columns; only the skip rule changes: an UPDATE whose input
-- columns are all unchanged no longer enqueues, whatever else it changed. INSERT still always enqueues.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.update_vehicle_completion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Skip when drainer is doing the writeback (avoid recursive enqueue).
  IF current_setting('app.skip_completion_enqueue', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, enqueue only when a column the completion score reads (or the existing superset) changed.
  IF TG_OP = 'UPDATE' THEN
    IF row(
         NEW.year, NEW.make, NEW.model, NEW.vin, NEW.color, NEW.transmission,
         NEW.engine_size, NEW.fuel_type, NEW.mileage, NEW.purchase_price,
         NEW.purchase_date, NEW.body_style, NEW.horsepower, NEW.torque,
         NEW.drivetrain, NEW.current_value, NEW.condition_rating, NEW.doors,
         NEW.seats, NEW.weight_lbs, NEW.bat_auction_url, NEW.sale_price
       ) IS NOT DISTINCT FROM row(
         OLD.year, OLD.make, OLD.model, OLD.vin, OLD.color, OLD.transmission,
         OLD.engine_size, OLD.fuel_type, OLD.mileage, OLD.purchase_price,
         OLD.purchase_date, OLD.body_style, OLD.horsepower, OLD.torque,
         OLD.drivetrain, OLD.current_value, OLD.condition_rating, OLD.doors,
         OLD.seats, OLD.weight_lbs, OLD.bat_auction_url, OLD.sale_price
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.vehicle_completion_recompute_queue (vehicle_id)
  VALUES (NEW.id)
  ON CONFLICT (vehicle_id) DO UPDATE SET
    queued_at = LEAST(vehicle_completion_recompute_queue.queued_at, now());

  RETURN NEW;
END;
$function$;

COMMIT;
