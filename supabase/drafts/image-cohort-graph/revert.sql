-- Revert of the per-image cohort graph drafts (01-04). Order: stop the drains, drop triggers, functions, tables.
begin;
set local lock_timeout = '3s';
SELECT cron.unschedule('image-cohort-drain')   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'image-cohort-drain');
SELECT cron.unschedule('vehicle-cohort-drain') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vehicle-cohort-drain');
DROP TRIGGER IF EXISTS zz_image_cohort_enqueue_ins ON public.vehicle_images;
DROP TRIGGER IF EXISTS zz_image_cohort_enqueue_upd ON public.vehicle_images;
DROP TRIGGER IF EXISTS zz_image_cohort_link_ins ON public.image_set_members;
DROP TRIGGER IF EXISTS zz_image_cohort_link_del ON public.image_set_members;
DROP TRIGGER IF EXISTS zz_image_cohort_link_ins ON public.work_order_evidence_images;
DROP TRIGGER IF EXISTS zz_image_cohort_link_del ON public.work_order_evidence_images;
DROP TRIGGER IF EXISTS zz_image_cohort_link_ins ON public.data_set_members;
DROP TRIGGER IF EXISTS zz_image_cohort_link_upd ON public.data_set_members;
DROP TRIGGER IF EXISTS zz_vehicle_cohort_enqueue_ins ON public.vehicles;
DROP TRIGGER IF EXISTS zz_vehicle_cohort_enqueue_upd ON public.vehicles;
DROP TRIGGER IF EXISTS zz_vehicle_cohort_ov_ins ON public.organization_vehicles;
DROP TRIGGER IF EXISTS zz_vehicle_cohort_ov_upd ON public.organization_vehicles;
DROP TRIGGER IF EXISTS zz_vehicle_cohort_ov_del ON public.organization_vehicles;
DROP FUNCTION IF EXISTS public.image_cohorts_read(uuid), private.image_cohorts_worker(uuid, uuid),
  public.image_cohort_enqueue_ins_stmt(), public.image_cohort_enqueue_upd_row(), public.image_cohort_enqueue_link_stmt(),
  public.vehicle_cohort_enqueue_stmt(), public.vehicle_cohort_enqueue_row(),
  public.image_cohort_drain(), public.vehicle_cohort_drain(),
  public.image_cohort_derive(uuid[], text), public.vehicle_cohort_derive(uuid[], text),
  public.image_cohort_backfill_enqueue(uuid, int), public.vehicle_cohort_backfill_enqueue(uuid, int);
DROP FUNCTION IF EXISTS public.record_device_tags(jsonb), public.image_device_edges(uuid[]), public.paid_vision_question(uuid);
DROP TABLE IF EXISTS public.image_device_tags, public.image_device_reads;
DROP TABLE IF EXISTS public.image_cohort_queue, public.vehicle_cohort_queue, public.image_cohort_edges, public.vehicle_cohort_edges;
DELETE FROM public.platform_config WHERE config_key = 'image_cohort_graph';
commit;
