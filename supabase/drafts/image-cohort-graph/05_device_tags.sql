-- DRAFT, NOT APPLIED. Free-first layer: what the phone already read lands as per-image metadata BEFORE any paid pass.
-- Spec: docs/library/PHOTO_COHORT_GRAPH.md §Free-first. Depends on 01 (image_cohort_edges, image_cohort_queue).
-- Written by the iOS lane in #3747 (flag deviceTags.v2Upload, off until this is applied).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- One row per image per device read: the verdicts, the model that made them, and the PhotoKit facts.
CREATE TABLE IF NOT EXISTS public.image_device_reads (
  image_id        uuid PRIMARY KEY,                 -- vehicle_images.id
  user_id         uuid NOT NULL,                    -- the uploader; RLS key
  local_id        text NOT NULL,                    -- PHAsset.localIdentifier (= exif_data->>'uuid')
  source          text NOT NULL DEFAULT 'apple_vision' CHECK (source IN ('apple_vision','apple_photos_mac')),
  model           text NOT NULL,                    -- 'VNClassifyImageRequest'
  model_revision  int  NOT NULL,
  os_version      text,
  method          text NOT NULL,                    -- 'nuke-device-tags-v1'
  is_vehicle      boolean,
  is_personal     boolean,
  has_person      boolean,
  owner_verdict   text CHECK (owner_verdict IN ('approved','rejected')),
  is_favorite     boolean,
  is_screenshot   boolean,
  is_live         boolean,
  is_hdr          boolean,
  is_panorama     boolean,
  has_depth       boolean,
  burst_id        text,
  pixel_width     int,
  pixel_height    int,
  device_taken_at timestamptz,
  device_latitude  double precision,
  device_longitude double precision,
  observed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS image_device_reads_user_idx ON public.image_device_reads (user_id, observed_at);

-- One row per image per label. Normalized: lower snake case, so 'Vehicle Engine' and 'engine_vehicle' stay
-- distinguishable but 'Machine'/'machine' collapse (today apple_ml_labels mixes both casings: 1,115 distinct strings).
CREATE TABLE IF NOT EXISTS public.image_device_tags (
  image_id        uuid NOT NULL,
  source          text NOT NULL DEFAULT 'apple_vision',
  tag             text NOT NULL CHECK (tag <> '' AND tag = lower(tag)),
  confidence      numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),   -- null until the phone sends scores
  model           text NOT NULL,
  model_revision  int  NOT NULL,
  observed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (image_id, source, tag)
);
CREATE INDEX IF NOT EXISTS image_device_tags_tag_idx ON public.image_device_tags (tag, image_id);

ALTER TABLE public.image_device_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_device_tags  ENABLE ROW LEVEL SECURITY;
-- Readers: the uploader only. Cohort edges derived from these carry their own visibility.
CREATE POLICY image_device_reads_owner_read ON public.image_device_reads FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));
CREATE POLICY image_device_tags_owner_read ON public.image_device_tags FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.image_device_reads r WHERE r.image_id = image_device_tags.image_id
                 AND r.user_id = (select auth.uid())));

-- The phone's writer. Matches the caller's own rows by exif uuid on ANY source (sync_local_vision_tags only
-- reaches capture_relay rows: 7,560 of 30,399). Capped at 200 items. Never touches vehicle_images.
CREATE OR REPLACE FUNCTION public.record_device_tags(p_batch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_user uuid := auth.uid();
  v_matched int := 0;
begin
  if v_user is null then raise exception 'record_device_tags: authentication required'; end if;
  if jsonb_typeof(p_batch) <> 'array' or jsonb_array_length(p_batch) > 200 then
    raise exception 'record_device_tags: p_batch must be an array of at most 200';
  end if;

  drop table if exists _dt;   -- two calls in one transaction must not collide
  create temp table _dt on commit drop as
  select vi.id as image_id, x.*
  from jsonb_to_recordset(p_batch) as x(local_id text, labels jsonb, is_vehicle boolean, is_personal boolean,
         has_person boolean, owner_verdict text, source text, model text, model_revision int, os_version text,
         method text, photokit jsonb)
  join public.vehicle_images vi on vi.exif_data->>'uuid' = x.local_id and vi.user_id = v_user
  where x.local_id <> '' and coalesce(vi.is_superseded, false) = false;

  insert into public.image_device_reads as r (image_id, user_id, local_id, source, model, model_revision, os_version, method,
    is_vehicle, is_personal, has_person, owner_verdict, is_favorite, is_screenshot, is_live, is_hdr, is_panorama, has_depth,
    burst_id, pixel_width, pixel_height, device_taken_at, device_latitude, device_longitude, observed_at)
  select image_id, v_user, local_id, 'apple_vision', coalesce(model,'VNClassifyImageRequest'), coalesce(model_revision,0),
    left(os_version,40), coalesce(left(method,40),'nuke-device-tags-v1'),
    is_vehicle, is_personal, has_person, nullif(owner_verdict,''),
    (photokit->>'is_favorite')::boolean, (photokit->>'is_screenshot')::boolean, (photokit->>'is_live')::boolean,
    (photokit->>'is_hdr')::boolean, (photokit->>'is_panorama')::boolean, (photokit->>'has_depth')::boolean,
    left(photokit->>'burst_id',80), (photokit->>'pixel_width')::int, (photokit->>'pixel_height')::int,
    (photokit->>'taken_at')::timestamptz, (photokit->>'latitude')::float8, (photokit->>'longitude')::float8, now()
  from _dt
  on conflict (image_id) do update set
    is_vehicle = excluded.is_vehicle, is_personal = excluded.is_personal, has_person = excluded.has_person,
    owner_verdict = coalesce(excluded.owner_verdict, r.owner_verdict),   -- owner-proven: never cleared by a later auto read
    model_revision = excluded.model_revision, os_version = excluded.os_version, method = excluded.method,
    is_favorite = excluded.is_favorite, is_screenshot = excluded.is_screenshot, is_live = excluded.is_live,
    is_hdr = excluded.is_hdr, is_panorama = excluded.is_panorama, has_depth = excluded.has_depth,
    burst_id = excluded.burst_id, pixel_width = excluded.pixel_width, pixel_height = excluded.pixel_height,
    device_taken_at = excluded.device_taken_at, device_latitude = excluded.device_latitude,
    device_longitude = excluded.device_longitude, observed_at = now();

  insert into public.image_device_tags (image_id, source, tag, model, model_revision)
  select distinct d.image_id, 'apple_vision', lower(regexp_replace(btrim(l), '\s+', '_', 'g')),
         coalesce(d.model,'VNClassifyImageRequest'), coalesce(d.model_revision,0)
  from _dt d, jsonb_array_elements_text(case when jsonb_typeof(d.labels)='array' then d.labels else '[]' end) l
  where btrim(l) <> ''
  on conflict (image_id, source, tag) do update set model_revision = excluded.model_revision, observed_at = now();

  -- Hand the photo to the cohort deriver (02) so the free edges exist before any paid pass is scheduled.
  insert into public.image_cohort_queue (image_id, reason) select image_id, 'device_tags' from _dt on conflict do nothing;

  select count(*) into v_matched from _dt;
  return jsonb_build_object('received', jsonb_array_length(p_batch), 'matched', v_matched);
end $$;
REVOKE ALL ON FUNCTION public.record_device_tags(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_device_tags(jsonb) TO authenticated;

-- Free edges from device reads (called by image_cohort_derive in 02 for each drained image).
-- Rule versions are stamped so a rule change re-derives without touching the reads.
CREATE OR REPLACE FUNCTION public.image_device_edges(p_ids uuid[])
RETURNS TABLE (image_id uuid, cohort_kind text, cohort_key text, basis text, confidence numeric, visibility text, rule_version text)
LANGUAGE sql STABLE SET search_path = public AS $$
  with r as (select * from public.image_device_reads where image_id = any(p_ids)),
  t as (select image_id, array_agg(tag) tags from public.image_device_tags where image_id = any(p_ids) group by image_id)
  -- photo kind: owner verdict beats the device gate; the gate beats labels.
  select r.image_id, 'photo_kind',
         case when r.owner_verdict = 'rejected' then 'personal'
              when r.is_screenshot then 'screenshot'
              when t.tags && array['document','paper','text','receipt','handwriting'] then 'document_like'
              when r.is_vehicle then 'vehicle'
              when r.is_vehicle = false then 'not_vehicle'
              else 'unknown' end,
         'image_device_reads', case when r.owner_verdict is not null then 1.0 else 0.8 end, 'inherit', 'device-kind-v1'
  from r left join t using (image_id)
  union all
  -- people present: feeds privacy, never shown publicly as a cohort.
  select r.image_id, 'person_present', 'person', 'image_device_reads.has_person', 0.7, 'private', 'device-person-v1'
  from r left join t using (image_id)
  where r.has_person or t.tags && array['people','person','adult','child','baby','selfie']
  union all
  select r.image_id, 'burst', r.burst_id, 'image_device_reads.burst_id', 1.0, 'inherit', 'device-burst-v1'
  from r where r.burst_id is not null
$$;

-- The gate in front of paid vision. Returns null when the free reads already answer the question,
-- else the question a paid pass is for. The orchestrator (photo-pipeline-orchestrator) would call it
-- before classifyImageRouted; that edge change is not drafted as a deploy.
CREATE OR REPLACE FUNCTION public.paid_vision_question(p_image_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  select case
    when r.image_id is null then 'no_device_read'                          -- nothing free yet: today's behavior
    when r.owner_verdict = 'rejected' then null                            -- owner hid it: never send pixels out
    when r.is_personal and coalesce(r.owner_verdict,'') <> 'approved' then null
    when r.is_vehicle = false and coalesce(r.owner_verdict,'') <> 'approved' then null   -- device says not a vehicle
    when vi.vehicle_id is not null then 'vehicle_detail'                   -- filed already: only angle/parts/text remain
    else 'which_vehicle' end                                               -- a vehicle photo nobody has filed
  from public.vehicle_images vi
  left join public.image_device_reads r on r.image_id = vi.id
  where vi.id = p_image_id
$$;
commit;
