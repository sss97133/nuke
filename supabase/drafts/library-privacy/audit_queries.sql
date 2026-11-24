-- Read-only queries behind the 2026-11-23 Library privacy numbers. Owner: 0b9f107a-d124-49de-9ded-94698f63c1c4.

-- 1. Flags on the owner's photos.
select count(*) total,
  count(*) filter (where is_sensitive) sensitive,
  count(*) filter (where vision_gate_status = 'rejected_personal') rejected_personal,
  count(*) filter (where vision_gate_status = 'rejected_personal' and not coalesce(is_sensitive,false)) rej_not_sensitive,
  count(*) filter (where is_sensitive and coalesce(vision_gate_status::text,'') <> 'rejected_personal') sensitive_not_rej,
  count(*) filter (where is_document or doc_flag) document,
  count(*) filter (where is_sensitive and image_url ilike '%/object/public/%') sensitive_public_url
from vehicle_images where user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- 2. Server-blocked photos that are on the phone, vs the phone's own synced verdict.
with s as materialized (
  select exif_data->>'uuid' lid, coalesce(is_sensitive,false) sens, vision_gate_status::text g,
         coalesce(is_document or doc_flag,false) doc, ai_scan_metadata->'on_device_vision' odv
  from vehicle_images where user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'),
b as (select *, (sens or g = 'rejected_personal' or doc) blocked from s)
select count(*) filter (where blocked) server_blocked,
  count(*) filter (where blocked and lid is not null) on_phone,
  count(*) filter (where blocked and (odv->>'is_personal') = 'true') phone_says_personal,
  count(*) filter (where blocked and (odv->>'is_personal') = 'false') phone_says_show,
  count(*) filter (where blocked and odv is null and lid is not null) phone_never_synced,
  count(*) filter (where not blocked and (odv->>'is_personal') = 'true') phone_personal_server_not
from b;

-- 3. Private photos readable by other active org members through the org policy.
with s as materialized (
  select id, vehicle_id from vehicle_images
  where user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
    and (is_sensitive or vision_gate_status = 'rejected_personal'))
select count(*) from s
where exists (select 1 from organization_vehicles ov join organization_contributors oc on oc.organization_id = ov.organization_id
              where ov.vehicle_id = s.vehicle_id and oc.status = 'active' and oc.user_id <> '0b9f107a-d124-49de-9ded-94698f63c1c4');
