-- sync_local_vision_tags v2: set-based + matched_ids (additive; same signature, same contract keys).
--
-- WHY (measured, 2026-07-01): v1 looped one UPDATE per batch item, and each item's
-- `exif_data->>'uuid' = local_id` predicate walks the caller's whole vehicle_images set
-- (~26,693 rows, ~170-400ms per item — EXPLAIN ANALYZE: Index Scan on user_id, 26,692 rows
-- removed by filter). The blur app pushes 200-item batches → ~34s ≫ the authenticated role's
-- 15s statement timeout, and plpgsql rolls the WHOLE batch back. v1 only ever succeeded on a
-- 1-item live test. v2 does ONE pass: hash-join the caller's rows against the whole batch.
--
-- Contract (Seam 1, frozen): REQUEST unchanged — array of {local_id, labels, is_vehicle,
-- is_personal, owner_verdict}. RESPONSE keeps {received, matched} and ADDS matched_ids
-- (jsonb array of the local_ids that landed) — additive, never renamed; clients that decode
-- only {received, matched} are unaffected. Fixes the v1 gap where the phone could never
-- learn WHICH items matched (unmatched tags were indistinguishable from landed ones).
--
-- Write semantics unchanged from v1: scoped to auth.uid(); apple_ml_labels filled only-if-empty
-- (never clobbers an existing machine-tag set); full verdict overwrites the
-- ai_scan_metadata.on_device_vision namespace (latest device state wins there).

create or replace function public.sync_local_vision_tags(p_batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  upd as (
    update vehicle_images vi
    set
      apple_ml_labels = case
        when (vi.apple_ml_labels is null or cardinality(vi.apple_ml_labels) = 0)
             and i.labels_arr is not null
        then i.labels_arr
        else vi.apple_ml_labels end,
      ai_scan_metadata = jsonb_set(
        coalesce(vi.ai_scan_metadata, '{}'::jsonb),
        '{on_device_vision}',
        jsonb_build_object(
          'source',        'blur_app_localstore',
          'labels',        coalesce(i.labels, '[]'::jsonb),
          'is_vehicle',    i.is_vehicle,
          'is_personal',   i.is_personal,
          'owner_verdict', i.owner_verdict,
          'synced_at',     to_jsonb(now())
        ),
        true)
    from items i
    where vi.user_id = v_user
      and vi.exif_data->>'uuid' = i.local_id
    returning i.local_id
  )
  select count(distinct local_id), array_agg(distinct local_id)
    into v_matched, v_matched_ids
  from upd;

  return jsonb_build_object(
    'received',    v_received,
    'matched',     coalesce(v_matched, 0),
    'matched_ids', to_jsonb(coalesce(v_matched_ids, array[]::text[]))
  );
end;
$$;

grant execute on function public.sync_local_vision_tags(jsonb) to authenticated;

comment on function public.sync_local_vision_tags(jsonb) is
  'Blur-app on-device Apple Vision tags → vehicle_images (v2, set-based). Batch of {local_id,labels,is_vehicle,is_personal,owner_verdict}; joins exif_data->>uuid == PHAsset localIdentifier in ONE pass, auth.uid()-scoped, additive (apple_ml_labels only-if-empty; verdict under ai_scan_metadata.on_device_vision). Returns {received,matched,matched_ids}.';
