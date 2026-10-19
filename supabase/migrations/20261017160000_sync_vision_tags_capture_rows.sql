-- sync_local_vision_tags (the phone's tag push, LocalTagPush.swift) finds its rows through the capture apps' rows only.
--
-- MEASURED 2026-10-15 (edge_logs, pg_class, scripts/data/q.sh):
--   - The owner's phone (NukeCapture/116) called it at 19:35:42Z with a 43 KB batch; it returned 500 after 15.2 s
--     (PostgREST error 57014, statement timeout). The push stops at the first failed batch, so no tags landed.
--   - The lookup joined on exif_data->>'uuid' with only user_id = auth.uid() to narrow it: every row the account
--     holds, each fetched from the 49 GB heap (52.5M rows) to read exif_data.
--   - exif_data.uuid holds a PHAsset localIdentifier only on rows the capture apps write: source capture_relay_ios
--     (iOS, Config.sourceTag) and capture_relay (Mac). The owner has 5,480 capture_relay_ios rows, all with a uuid.
--     The Mac osxphotos scripts write bare library UUIDs, never the phone's "<id>/L0/001" form, so they could not
--     match before either.
--   - The function's join restricted to those two sources, with 200 of the owner's local_ids: 200 of 200 matched,
--     2.4 s execution (EXPLAIN ANALYZE; 5,480 rows hashed, most of the time spent reading exif_data).
--
-- The lookup adds source in ('capture_relay_ios', 'capture_relay'), which the planner serves from
-- idx_vehicle_images_user_capture_stats (user_id, source, ...). Nothing else changes. No index is built: a build
-- would scan the 49 GB heap.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.sync_local_vision_tags(p_batch jsonb, p_source text DEFAULT 'blur_app_localstore'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user        uuid := auth.uid();
  v_received    int;
  v_matched     int;
  v_matched_ids text[];
begin
  if v_user is null then
    raise exception 'sync_local_vision_tags: authentication required';
  end if;
  if jsonb_typeof(p_batch) <> 'array' then
    raise exception 'sync_local_vision_tags: p_batch must be a JSON array';
  end if;

  v_received := jsonb_array_length(p_batch);

  with items as (
    select
      x.local_id,
      x.labels,
      case when jsonb_typeof(x.labels) = 'array'
           then array(select jsonb_array_elements_text(x.labels))
           else null end as labels_arr,
      x.is_vehicle,
      x.is_personal,
      x.owner_verdict
    from jsonb_to_recordset(p_batch)
      as x(local_id text, labels jsonb, is_vehicle boolean, is_personal boolean, owner_verdict text)
    where x.local_id is not null and x.local_id <> ''
  ),
  hits as (
    -- every row found for a local_id, with the vision payload the push writes (all keys but synced_at)
    select
      vi.id,
      i.local_id,
      i.labels_arr,
      jsonb_build_object(
        'source',        coalesce(p_source, 'blur_app_localstore'),
        'labels',        coalesce(i.labels, '[]'::jsonb),
        'is_vehicle',    i.is_vehicle,
        'is_personal',   i.is_personal,
        'owner_verdict', i.owner_verdict) as vision
    from vehicle_images vi
    join items i on vi.exif_data->>'uuid' = i.local_id
    where vi.user_id = v_user
      -- only the capture apps write exif_data.uuid = PHAsset.localIdentifier; this source list is what reaches
      -- idx_vehicle_images_user_capture_stats instead of every row the account holds
      and vi.source in ('capture_relay_ios', 'capture_relay')
  ),
  upd as (
    update vehicle_images vi
    set
      apple_ml_labels = case
        when (vi.apple_ml_labels is null or cardinality(vi.apple_ml_labels) = 0)
             and h.labels_arr is not null
        then h.labels_arr
        else vi.apple_ml_labels end,
      ai_scan_metadata = case
        -- bulk backfill must never clobber a live phone push; live pushes still refresh their own
        when coalesce(p_source,'') <> 'blur_app_localstore' and vi.ai_scan_metadata ? 'on_device_vision'
          then vi.ai_scan_metadata
        else jsonb_set(
          coalesce(vi.ai_scan_metadata, '{}'::jsonb),
          '{on_device_vision}',
          h.vision || jsonb_build_object('synced_at', to_jsonb(now())),
          true) end
    from hits h
    where vi.id = h.id
      -- only rows the push changes: labels it fills, or a vision payload that differs apart from synced_at
      and (
        ((vi.apple_ml_labels is null or cardinality(vi.apple_ml_labels) = 0)
          and h.labels_arr is not null
          and h.labels_arr is distinct from vi.apple_ml_labels)
        or (not (coalesce(p_source,'') <> 'blur_app_localstore'
                 and coalesce(vi.ai_scan_metadata ? 'on_device_vision', false))
            and h.vision is distinct from case jsonb_typeof(vi.ai_scan_metadata -> 'on_device_vision')
                  when 'object' then (vi.ai_scan_metadata -> 'on_device_vision') - 'synced_at'
                  else vi.ai_scan_metadata -> 'on_device_vision' end))
    returning h.local_id
  )
  select count(distinct local_id), array_agg(distinct local_id)
    into v_matched, v_matched_ids
  from hits;

  begin
    insert into analysis_events (user_id, stage, detail)
    values (v_user, 'tag_sync_batch', jsonb_build_object(
      'received', v_received,
      'matched', coalesce(v_matched, 0),
      'source', coalesce(p_source, 'blur_app_localstore'),
      'sample_local_id', p_batch->0->>'local_id'
    ));
  exception when others then null;
  end;

  return jsonb_build_object(
    'received',    v_received,
    'matched',     coalesce(v_matched, 0),
    'matched_ids', to_jsonb(coalesce(v_matched_ids, array[]::text[]))
  );
end;
$function$;
