-- Read back what land.sql landed for one vehicle, and fold it: the same descriptor, part, side and capture day is
-- one claim with every photo behind it. Read-only. Replace {{vehicle_id}} and {{user_id}}.
-- The writer's answers are in net._http_response (kept six hours) under the request ids land.sql returned:
--   select status_code, count(*) from net._http_response where id between <first> and <last> group by 1;
with k as (
  select vo.id, vo.observed_at, vo.descriptor_id, ct.canonical_key descriptor, vo.confidence_score, vo.analysis_deferred, vo.is_superseded,
         vo.structured_data->>'part_key' part_key, vo.structured_data->>'part_side' part_side, vo.structured_data->>'part_key_status' part_status,
         (vo.structured_data->>'image_id')::uuid image_id,
         (select count(*) from observation_witnesses w where w.observation_id = vo.id) witnesses
  from vehicle_observations vo left join condition_taxonomy ct on ct.descriptor_id = vo.descriptor_id
  where vo.vehicle_id = '{{vehicle_id}}' and vo.extraction_method = 'photo_map_harvest_v1'
),
folds as (
  select descriptor, part_key, part_side, (observed_at at time zone 'UTC')::date capture_day, count(*) row_count, count(distinct image_id) photos
  from k where is_superseded is not true group by 1, 2, 3, 4
)
select jsonb_build_object(
 'as_of', now(),
 'landed', (select jsonb_build_object('rows', count(*), 'with_descriptor', count(descriptor_id), 'with_one_witness', count(*) filter (where witnesses = 1), 'max_confidence', max(confidence_score), 'deferred', count(*) filter (where analysis_deferred), 'photos', count(distinct image_id), 'descriptors', count(distinct descriptor), 'parts_named', count(distinct part_key), 'part_in_registry', count(*) filter (where part_status like 'registry%'), 'part_not_named', count(*) filter (where part_key is null), 'first_day', min(observed_at)::date, 'last_day', max(observed_at)::date) from k),
 -- rule 7 of the photo direction: witnessed observations on the owner's photos, and how many carry a key
 'keyed', (select jsonb_build_object('witnessed', count(*), 'keyed', count(*) filter (where (vo.descriptor_id is not null or vo.property_id is not null) and vo.is_superseded is not true))
   from observation_witnesses w join vehicle_observations vo on vo.id = w.observation_id join vehicle_images i on i.id = w.image_id
   where i.vehicle_id = '{{vehicle_id}}' and i.user_id = '{{user_id}}'),
 'folds', (select jsonb_build_object('folded_claims', count(*), 'carried_by_2plus_photos', count(*) filter (where photos > 1), 'largest', max(photos)) from folds),
 'top_folds', (select jsonb_agg(x) from (select descriptor, part_key, part_side, capture_day, photos from folds where part_key is not null order by photos desc, descriptor limit 12) x),
 'by_day', (select jsonb_object_agg(d, n) from (select (observed_at at time zone 'UTC')::date d, count(*) n from k group by 1) x)
) as r;
