-- DRAFT, NOT APPLIED. Per-image cohort graph: enqueue triggers (statement-level) and the two cron drains.
-- vehicle_images already carries 49 triggers; these add one statement-level INSERT per statement, never per row,
-- and only for native (uploaded) photos. External listing photos inherit their cohorts from the vehicle fold.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.image_cohort_enqueue_ins_stmt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO image_cohort_queue (image_id, reason)
  SELECT n.id, 'insert' FROM new_rows n WHERE n.user_id IS NOT NULL
  ON CONFLICT (image_id) DO NOTHING;
  RETURN NULL;
END $$;

-- Updates: a ROW trigger limited by UPDATE OF + WHEN, so the pipelines' frequent updates of other columns
-- (ai_scan_metadata, ai_processing_status, ...) never call it and no transition table is built on the hot table.
CREATE OR REPLACE FUNCTION public.image_cohort_enqueue_upd_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO image_cohort_queue (image_id, reason) VALUES (NEW.id, 'update') ON CONFLICT (image_id) DO NOTHING;
  RETURN NULL;
END $$;

-- Link tables that make a photo a member of something.
CREATE OR REPLACE FUNCTION public.image_cohort_enqueue_link_stmt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    IF TG_TABLE_NAME = 'data_set_members' THEN
      INSERT INTO image_cohort_queue (image_id, reason)
      SELECT n.member_id, TG_TABLE_NAME FROM new_rows n WHERE n.member_type = 'image' ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO image_cohort_queue (image_id, reason)
      SELECT n.image_id, TG_TABLE_NAME FROM new_rows n WHERE n.image_id IS NOT NULL ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  IF TG_OP IN ('DELETE','UPDATE') THEN
    IF TG_TABLE_NAME = 'data_set_members' THEN
      INSERT INTO image_cohort_queue (image_id, reason)
      SELECT o.member_id, TG_TABLE_NAME FROM old_rows o WHERE o.member_type = 'image' ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO image_cohort_queue (image_id, reason)
      SELECT o.image_id, TG_TABLE_NAME FROM old_rows o WHERE o.image_id IS NOT NULL ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.vehicle_cohort_enqueue_stmt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'vehicles' THEN   -- inserts only (updates use the row trigger below)
    INSERT INTO vehicle_cohort_queue (vehicle_id, reason)
    SELECT n.id, 'vehicles' FROM new_rows n ON CONFLICT DO NOTHING;
  ELSE  -- organization_vehicles
    IF TG_OP IN ('INSERT','UPDATE') THEN
      INSERT INTO vehicle_cohort_queue (vehicle_id, reason)
      SELECT n.vehicle_id, 'organization_vehicles' FROM new_rows n WHERE n.vehicle_id IS NOT NULL ON CONFLICT DO NOTHING;
    END IF;
    IF TG_OP IN ('DELETE','UPDATE') THEN
      INSERT INTO vehicle_cohort_queue (vehicle_id, reason)
      SELECT o.vehicle_id, 'organization_vehicles' FROM old_rows o WHERE o.vehicle_id IS NOT NULL ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- vehicle_images: one insert trigger, one update trigger (transition tables need one event each).
CREATE TRIGGER zz_image_cohort_enqueue_ins AFTER INSERT ON public.vehicle_images
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.image_cohort_enqueue_ins_stmt();
CREATE TRIGGER zz_image_cohort_enqueue_upd
  AFTER UPDATE OF vehicle_id, latitude, longitude, work_session_id, is_sensitive, vision_gate_status, user_id
  ON public.vehicle_images FOR EACH ROW
  WHEN (NEW.user_id IS NOT NULL AND
        (NEW.vehicle_id, NEW.latitude, NEW.longitude, NEW.work_session_id, NEW.is_sensitive, NEW.vision_gate_status, NEW.user_id)
        IS DISTINCT FROM
        (OLD.vehicle_id, OLD.latitude, OLD.longitude, OLD.work_session_id, OLD.is_sensitive, OLD.vision_gate_status, OLD.user_id))
  EXECUTE FUNCTION public.image_cohort_enqueue_upd_row();

CREATE TRIGGER zz_image_cohort_link_ins AFTER INSERT ON public.image_set_members
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.image_cohort_enqueue_link_stmt();
CREATE TRIGGER zz_image_cohort_link_del AFTER DELETE ON public.image_set_members
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.image_cohort_enqueue_link_stmt();
CREATE TRIGGER zz_image_cohort_link_ins AFTER INSERT ON public.work_order_evidence_images
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.image_cohort_enqueue_link_stmt();
CREATE TRIGGER zz_image_cohort_link_del AFTER DELETE ON public.work_order_evidence_images
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.image_cohort_enqueue_link_stmt();
CREATE TRIGGER zz_image_cohort_link_ins AFTER INSERT ON public.data_set_members
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.image_cohort_enqueue_link_stmt();
CREATE TRIGGER zz_image_cohort_link_upd AFTER UPDATE ON public.data_set_members
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.image_cohort_enqueue_link_stmt();

CREATE TRIGGER zz_vehicle_cohort_enqueue_ins AFTER INSERT ON public.vehicles
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_cohort_enqueue_stmt();
CREATE OR REPLACE FUNCTION public.vehicle_cohort_enqueue_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO vehicle_cohort_queue (vehicle_id, reason) VALUES (NEW.id, 'vehicles') ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER zz_vehicle_cohort_enqueue_upd AFTER UPDATE OF make, model, year, generation, series ON public.vehicles
  FOR EACH ROW WHEN ((NEW.make, NEW.model, NEW.year, NEW.generation, NEW.series)
                     IS DISTINCT FROM (OLD.make, OLD.model, OLD.year, OLD.generation, OLD.series))
  EXECUTE FUNCTION public.vehicle_cohort_enqueue_row();
CREATE TRIGGER zz_vehicle_cohort_ov_ins AFTER INSERT ON public.organization_vehicles
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_cohort_enqueue_stmt();
CREATE TRIGGER zz_vehicle_cohort_ov_upd AFTER UPDATE ON public.organization_vehicles
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_cohort_enqueue_stmt();
CREATE TRIGGER zz_vehicle_cohort_ov_del AFTER DELETE ON public.organization_vehicles
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_cohort_enqueue_stmt();

-- The drains: every minute, each bounded by budget_ms and the paused flag (starts paused; 01 inserts paused=true).
SELECT cron.schedule('image-cohort-drain',   '* * * * *', $$SELECT public.image_cohort_drain()$$);
SELECT cron.schedule('vehicle-cohort-drain', '* * * * *', $$SELECT public.vehicle_cohort_drain()$$);

commit;

-- Backfill (run by hand after the owner's yes; each call is one short statement; loop from a script or psql \gset):
--   update platform_config set config_value = jsonb_set(config_value, '{paused}', 'false') where config_key = 'image_cohort_graph';
--   select public.image_cohort_backfill_enqueue(NULL, 2000);          -- returns the cursor; repeat with it until NULL
--   select public.vehicle_cohort_backfill_enqueue(NULL, 5000);        -- same, overnight
-- Pause at any time: set paused = true. Progress: select count(*) from image_cohort_queue / vehicle_cohort_queue.
