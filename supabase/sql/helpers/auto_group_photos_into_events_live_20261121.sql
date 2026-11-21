-- The live body of public.auto_group_photos_into_events() as read from production on 2026-11-21 (pg_proc.prosrc,
-- md5 fb0bc02ec95b96e89fd6db034bdfdb49; SECURITY DEFINER, search_path=public, owned by the table owner).
-- For the contract tests only. The body is byte-for-byte; do not reformat it.
CREATE FUNCTION public.auto_group_photos_into_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $fn$
declare ev uuid; photo_date date; existing_count int; nb uuid;
begin
  -- An explicit source capture awaiting a supplied review is not a work event.
  if NEW.ai_scan_metadata#>>'{processing_policy,mode}'='subscription_review' then return NEW; end if;
  if NEW.taken_at is null then return NEW; end if;
  photo_date := date(NEW.taken_at);

  if NEW.vehicle_id is null then
    -- session grouping: nearest same-user unfiled neighbour within 20 min that already has a pending event
    select vi.timeline_event_id into nb
      from vehicle_images vi
     where NEW.user_id is not null and vi.user_id = NEW.user_id and vi.vehicle_id is null and vi.timeline_event_id is not null
       and vi.taken_at between NEW.taken_at - interval '20 minutes' and NEW.taken_at + interval '20 minutes'
     order by abs(extract(epoch from vi.taken_at - NEW.taken_at)) limit 1;
    if nb is not null then
      select te.id into ev from timeline_events te where te.id = nb and te.vehicle_id is null and te.event_type = 'pending_analysis';
    end if;
  else
    select id into ev from timeline_events where vehicle_id = NEW.vehicle_id and event_date = photo_date limit 1;
  end if;

  if ev is not null then
    select coalesce(array_length(coalesce(image_urls, array[]::text[]), 1), 0) into existing_count from timeline_events where id = ev;
    update timeline_events set
      image_urls = coalesce(image_urls, array[]::text[]) || array[NEW.image_url],
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('photo_count', existing_count + 1, 'last_photo_added', now(),
                   'session_start', least(coalesce((metadata->>'session_start')::timestamptz, NEW.taken_at), NEW.taken_at),
                   'session_end', greatest(coalesce((metadata->>'session_end')::timestamptz, NEW.taken_at), NEW.taken_at)),
      title = (existing_count + 1) || ' photos from ' || to_char(photo_date, 'Mon DD, YYYY')
    where id = ev;
    NEW.timeline_event_id := ev;
  else
    insert into timeline_events (vehicle_id, user_id, event_type, source, event_date, title, description, image_urls, metadata)
    values (NEW.vehicle_id, NEW.user_id, 'pending_analysis', 'photo_upload', photo_date,
            '1 photo from ' || to_char(photo_date, 'Mon DD, YYYY'), 'AI analysis pending', array[NEW.image_url],
            jsonb_build_object('photo_count', 1, 'needs_ai_analysis', true, 'device_fingerprint', NEW.exif_data->'camera', 'created_at', now(),
                               'session_start', NEW.taken_at, 'session_end', NEW.taken_at,
                               'unresolved', NEW.vehicle_id is null))
    returning id into ev;
    NEW.timeline_event_id := ev;
  end if;
  return NEW;
end $fn$;
