-- analysis_events: declare the two keys the data already honors, and describe the table.
-- Discovery pass 2026-10-03 (inclusion test, then exact check on the full table):
--   vehicle_id: 129 distinct values, 0 not in vehicles.id
--   image_id:   12,967 distinct values, 0 not in vehicle_images.id
-- NOT VALID: enforced for new rows now; existing rows are validated in a separate migration.
-- ON DELETE NO ACTION on purpose: this is an append-only event log, so deleting a parent must
-- not silently delete its history.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.analysis_events
  add constraint analysis_events_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles(id) not valid;

alter table public.analysis_events
  add constraint analysis_events_image_id_fkey
  foreign key (image_id) references public.vehicle_images(id) not valid;

comment on table public.analysis_events is
  'Event log of image-analysis pipeline stages. One row = one stage transition for one image (grain: image x stage x moment). Event time = created_at (written when the stage is logged; the source event time is in detail where present). Source: the image analysis drain and coordinator.';
comment on column public.analysis_events.created_at is 'When the stage was logged (UTC). Both event time and ingest time: the writer logs it as it happens.';
comment on column public.analysis_events.user_id is 'Owner account whose image was being analyzed (auth user id).';
comment on column public.analysis_events.vehicle_id is 'The vehicle the image was attributed to when the stage ran. FK to vehicles.id.';
comment on column public.analysis_events.image_id is 'The image the stage ran on. FK to vehicle_images.id.';
comment on column public.analysis_events.stage is 'Pipeline stage name at this event, e.g. analyzing.';
comment on column public.analysis_events.detail is 'Stage context as JSON, e.g. {"day": work day analyzed, "source": image source}. Free-form; not a key.';
