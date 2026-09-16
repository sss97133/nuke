-- Receive on-device (blur app) Apple Vision tags and land them on cloud vehicle_images.
--
-- The blur app tags the WHOLE PhotoKit library locally (LocalStore GRDB `appearance` table,
-- keyed by PHAsset localIdentifier). Nothing synced those tags up — they were trapped on-device.
-- This RPC is the backend receiver: the app pages its appearance rows and POSTs batches of
-- {local_id, labels, is_vehicle, is_personal, owner_verdict}; we upsert them onto the matching
-- cloud row via exif_data->>'uuid' == localIdentifier (the same bridge get_owner_image_verdicts
-- uses in reverse), scoped to the caller. Additive + namespaced: apple_ml_labels is filled only
-- when empty (never clobbers an existing machine-tag set), and the full on-device verdict is
-- recorded under ai_scan_metadata.on_device_vision so nothing is lost.
--
-- COVERAGE NOTE: exif_data.uuid is present on capture-relay rows (~5.5k) and a few iphoto rows.
-- The large iphoto/user_upload buckets carry neither uuid nor file_hash, so those need a content
-- (phash) bridge — a follow-up. This lands everything the localIdentifier bridge can reach today.

create or replace function public.sync_local_vision_tags(p_batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_item    jsonb;
  v_local   text;
  v_labels  text[];
  v_matched int := 0;
begin
  if v_user is null then
    raise exception 'sync_local_vision_tags: authentication required';
  end if;
  if jsonb_typeof(p_batch) <> 'array' then
    raise exception 'sync_local_vision_tags: p_batch must be a JSON array';
  end if;

  for v_item in select * from jsonb_array_elements(p_batch)
  loop
    v_local := v_item->>'local_id';
    if v_local is null or v_local = '' then continue; end if;

    v_labels := case
      when jsonb_typeof(v_item->'labels') = 'array'
      then array(select jsonb_array_elements_text(v_item->'labels'))
      else null end;

    update vehicle_images vi
    set
      apple_ml_labels = case
        when (vi.apple_ml_labels is null or cardinality(vi.apple_ml_labels) = 0) and v_labels is not null
        then v_labels
        else vi.apple_ml_labels end,
      ai_scan_metadata = jsonb_set(
        coalesce(vi.ai_scan_metadata, '{}'::jsonb),
        '{on_device_vision}',
        jsonb_build_object(
          'source',        'blur_app_localstore',
          'labels',        coalesce(v_item->'labels', '[]'::jsonb),
          'is_vehicle',    v_item->'is_vehicle',
          'is_personal',   v_item->'is_personal',
          'owner_verdict', v_item->'owner_verdict',
          'synced_at',     to_jsonb(now())
        ),
        true)
    where vi.user_id = v_user
      and vi.exif_data->>'uuid' = v_local;

    if found then v_matched := v_matched + 1; end if;
  end loop;

  return jsonb_build_object('received', jsonb_array_length(p_batch), 'matched', v_matched);
end;
$$;

grant execute on function public.sync_local_vision_tags(jsonb) to authenticated;

comment on function public.sync_local_vision_tags(jsonb) is
  'Blur-app on-device Apple Vision tags → vehicle_images. Batch of {local_id,labels,is_vehicle,is_personal,owner_verdict}; joins exif_data->>uuid == PHAsset localIdentifier, auth.uid()-scoped, additive. Returns {received,matched}.';
