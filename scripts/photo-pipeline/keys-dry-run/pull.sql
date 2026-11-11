-- One vehicle's stored photo statements and receipt-part answers, as one JSON value.
-- Read-only. Replace {{vehicle_id}} and {{user_id}}, run it (scripts/data/q.sh or the SQL console), and save the
-- result as raw.json in the private data folder. The result is private: it never goes in the repository.
-- Run as written on 2026-11-10 against the proof vehicle (1,157 statements on 433 photos, 115 receipt items).
with imgs as (
  select i.id, coalesce(i.taken_at, i.created_at) shot,
         i.ai_scan_metadata->'byok_deep_analysis' deep,
         i.ai_scan_metadata->'classification' cls
  from vehicle_images i
  where i.vehicle_id = '{{vehicle_id}}' and i.user_id = '{{user_id}}'
),
ids as (select array_agg(id) a from imgs)
select jsonb_build_object(
 'as_of', now(),
 'vehicle', (select jsonb_build_object('year', year, 'make', make, 'model', model) from vehicles where id = '{{vehicle_id}}'),
 'photos_total', (select count(*) from imgs),
 'photos', (select jsonb_agg(jsonb_build_object(
      'id', id, 'day', to_char(shot, 'YYYY-MM-DD'), 'ts', to_char(shot, 'YYYY-MM-DD"T"HH24:MI'),
      'phase', deep->>'build_phase_guess', 'intent', deep->>'intent', 'scene', deep->>'scene_type',
      'paint', deep#>>'{state_observations,paint_state}', 'rust', deep#>>'{state_observations,rust_severity}', 'compl', deep#>>'{state_observations,completeness}',
      'callouts', case when jsonb_typeof(deep#>'{state_observations,damage_callouts}') = 'array' then deep#>'{state_observations,damage_callouts}' else '[]'::jsonb end,
      'loc', case when jsonb_typeof(deep->'damage_localized') = 'array' then deep->'damage_localized' else '[]'::jsonb end,
      'parts', (select coalesce(jsonb_agg(distinct lower(e->>'label')), '[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(deep->'components_seen') = 'array' then deep->'components_seen' else '[]'::jsonb end) e),
      'line', left(coalesce(deep->>'narrative_one_line', cls->>'description', ''), 220)
   ) order by shot) from imgs where jsonb_typeof(deep) = 'object'),
 'witnessed', (select jsonb_build_object('n', count(*), 'with_descriptor', count(vo.descriptor_id), 'with_property', count(vo.property_id))
               from observation_witnesses w join vehicle_observations vo on vo.id = w.observation_id
               where w.image_id = any((select a from ids)::uuid[])),
 'judgment', (select jsonb_agg(jsonb_build_object('id', left(j.id::text, 8), 'subject_table', j.subject_table, 'subject_id', j.subject_id, 'status', j.status, 'params', left(j.params::text, 500), 'answer', j.answer))
              from evidence_judgment_requests j where j.vehicle_id = '{{vehicle_id}}')
) as r;
