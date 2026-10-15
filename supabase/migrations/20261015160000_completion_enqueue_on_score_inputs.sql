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
--
-- The score also counts timeline_events and vehicle_images for the vehicle. Those counts reached the queue only through
-- side-effect UPDATEs on vehicles (image_count, has_photos, updated_at), which no longer enqueue (lane-depth's review).
-- So the two tables enqueue directly: statement-level AFTER INSERT and AFTER DELETE triggers read the transition table
-- and enqueue each affected vehicle once per statement (a 6,000-image re-fold enqueues one vehicle once), and a
-- row-level AFTER UPDATE OF vehicle_id trigger, firing only when vehicle_id changes, enqueues both vehicles.
-- app.skip_completion_enqueue = '1' (the drainer's writeback) is respected throughout.
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

-- Enqueue the vehicles a statement touched (transition table rows carry vehicle_id).
CREATE OR REPLACE FUNCTION public.enqueue_completion_from_rows()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('app.skip_completion_enqueue', true) = '1' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.vehicle_completion_recompute_queue (vehicle_id)
    SELECT DISTINCT vehicle_id FROM new_rows WHERE vehicle_id IS NOT NULL
    ON CONFLICT (vehicle_id) DO NOTHING;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.vehicle_completion_recompute_queue (vehicle_id)
    SELECT DISTINCT o.vehicle_id FROM old_rows o
    WHERE o.vehicle_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = o.vehicle_id)
    ON CONFLICT (vehicle_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$function$;

-- A row moved to another vehicle changes both vehicles' counts.
CREATE OR REPLACE FUNCTION public.enqueue_completion_on_vehicle_move()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('app.skip_completion_enqueue', true) = '1' THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.vehicle_completion_recompute_queue (vehicle_id)
  SELECT x.id FROM (VALUES (OLD.vehicle_id), (NEW.vehicle_id)) AS x(id)
  WHERE x.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = x.id)
  ON CONFLICT (vehicle_id) DO NOTHING;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_completion_enqueue_images_ins ON public.vehicle_images;
CREATE TRIGGER trg_completion_enqueue_images_ins AFTER INSERT ON public.vehicle_images
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_completion_from_rows();
DROP TRIGGER IF EXISTS trg_completion_enqueue_images_del ON public.vehicle_images;
CREATE TRIGGER trg_completion_enqueue_images_del AFTER DELETE ON public.vehicle_images
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_completion_from_rows();
DROP TRIGGER IF EXISTS trg_completion_enqueue_images_move ON public.vehicle_images;
CREATE TRIGGER trg_completion_enqueue_images_move AFTER UPDATE OF vehicle_id ON public.vehicle_images
  FOR EACH ROW WHEN (OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id) EXECUTE FUNCTION public.enqueue_completion_on_vehicle_move();

DROP TRIGGER IF EXISTS trg_completion_enqueue_timeline_ins ON public.timeline_events;
CREATE TRIGGER trg_completion_enqueue_timeline_ins AFTER INSERT ON public.timeline_events
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_completion_from_rows();
DROP TRIGGER IF EXISTS trg_completion_enqueue_timeline_del ON public.timeline_events;
CREATE TRIGGER trg_completion_enqueue_timeline_del AFTER DELETE ON public.timeline_events
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_completion_from_rows();
DROP TRIGGER IF EXISTS trg_completion_enqueue_timeline_move ON public.timeline_events;
CREATE TRIGGER trg_completion_enqueue_timeline_move AFTER UPDATE OF vehicle_id ON public.timeline_events
  FOR EACH ROW WHEN (OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id) EXECUTE FUNCTION public.enqueue_completion_on_vehicle_move();

COMMIT;
