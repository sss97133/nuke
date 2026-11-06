-- Root cause (20261103): get_clip_embed_batch only embeds rows that already exist in image_observations; iOS
-- capture_relay uploads get no observation row until a classifier/claim writes one (24 of 1,441 in 30 d had one),
-- so the embedder (scripts/clip-embed-image-observations.py, launchd on the owner's Mac) never sees them.
-- Fix inside the existing system: every new capture_relay_ios image gets an embedding-carrier observation through the
-- sole writer (ingest_image_observation): role 'incidental', vehicle NULL, confidence 0 -> never a vehicle claim
-- (enqueue needs subject >= 0.85; derive needs subject + vehicle). The existing embedder then picks it up.
-- Revert: drop trigger trg_vehicle_images_clip_carrier on vehicle_images; drop function public.trg_vehicle_images_clip_carrier();
create or replace function public.trg_vehicle_images_clip_carrier() returns trigger
language plpgsql security definer set search_path to 'public' as $f$
begin
  begin
    perform ingest_image_observation(new.id, null, 'incidental', 0, 'clip_embed_carrier_v1', 'carrier_v1',
      jsonb_build_object('clip_embed_carrier_v1', jsonb_build_object('purpose','embedding carrier; no vehicle claim','origin','insert_trigger')));
  exception when others then
    raise warning 'clip carrier skipped for %: %', new.id, sqlerrm;   -- never block an upload
  end;
  return null;
end $f$;
drop trigger if exists trg_vehicle_images_clip_carrier on public.vehicle_images;
create trigger trg_vehicle_images_clip_carrier after insert on public.vehicle_images
  for each row when (new.source = 'capture_relay_ios') execute function public.trg_vehicle_images_clip_carrier();
