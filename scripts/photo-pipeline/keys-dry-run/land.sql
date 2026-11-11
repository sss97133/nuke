-- Land one packed part of keyed claims through the sanctioned writer, ingest-observation.
--
-- This statement inserts nothing itself. It asks the database to POST each claim to the edge function, the way
-- the project's own scheduled jobs do (net.http_post with public.get_service_role_key_for_cron()), so every row
-- gets the writer's checks: the descriptor must be a live condition_taxonomy key, the photo must belong to the
-- vehicle, the photo becomes the row's witness, and agent testimony is capped at 0.6.
--
-- Fill in: {{payload}} (the text of land-part<N>.json from pack_claims.py, unchanged), {{md5}} (the checksum that
-- script printed; nothing is sent if the pasted payload differs by a byte), {{vehicle_id}}, {{user_id}} and
-- {{placed_by_model}} (the model that placed the words on the keys). Send ONE claim first and read it back with
-- fold.sql before sending a part. A second identical run writes nothing: the writer answers duplicate.
--
-- What each row is: kind condition from source photo_pipeline; descriptor_key; observed_at is the photo's capture
-- time (upload time when a photo has none, and the row says which); content_text is the reader's own sentence;
-- extraction_method photo_map_harvest_v1; agent_model is the reader that looked at the pixels; who placed the
-- words is in structured_data.placed_by. The part is carried in structured_data (part_key, part_side,
-- part_key_status) because a part has no place on an observation yet.
with raw as (select $J${{payload}}$J$::text t),
src as (select t::jsonb j from raw where md5(t) = '{{md5}}'),
claims as (
  select ph.key img8, (c->>0)::int idx, src.j->'d'->>((c->>1)::int) descriptor,
         case when (c->>2)::int < 0 then null else src.j->'p'->>((c->>2)::int) end part,
         (array['driver','passenger','center'])[(c->>3)::int] side,
         (array['registry','registry (side not said)','decided this run','decided this run (which one not said)','drafted','unknown'])[(c->>4)::int] part_status
  from src, jsonb_each(src.j->'c') ph, jsonb_array_elements(ph.value) c
),
img as (
  select i.id, i.taken_at, i.created_at, i.image_url, i.ai_scan_metadata->'byok_deep_analysis' deep
  from vehicle_images i
  where i.vehicle_id = '{{vehicle_id}}' and i.user_id = '{{user_id}}'
),
src_obs as (   -- the stored reading as an observation, where the reviewed lane landed one
  select distinct on (vo.structured_data->>'image_id') vo.structured_data->>'image_id' image_id, vo.id, vo.agent_model
  from vehicle_observations vo
  where vo.vehicle_id = '{{vehicle_id}}' and vo.extraction_method = 'reviewed_image_analysis_v1' and vo.is_superseded is not true
  order by vo.structured_data->>'image_id', vo.ingested_at desc
),
rws as (
  select c.*, i.id image_id, i.taken_at, i.created_at, i.image_url, i.deep,
         i.deep#>>array['state_observations','damage_callouts', c.idx::text] statement,
         so.id src_id, so.agent_model src_model, ct.descriptor_id
  from claims c
  join img i on left(i.id::text, 8) = c.img8
  left join src_obs so on so.image_id = i.id::text
  left join condition_taxonomy ct on ct.canonical_key = c.descriptor and ct.deprecated_at is null
),
ready as (select * from rws where statement is not null and descriptor_id is not null),
posted as (
  select r.image_id, r.idx, r.descriptor,
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest-observation',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_service_role_key_for_cron()),
      body := jsonb_build_object(
        'source_slug','photo_pipeline','kind','condition','vehicle_id','{{vehicle_id}}',
        'observed_at', to_char(coalesce(r.taken_at, r.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'source_url', r.image_url,
        'source_identifier', 'photo_map_harvest_v1:' || r.image_id || ':' || r.idx || ':' || r.descriptor || ':' || coalesce(r.part,'-') || ':' || coalesce(r.side,'-'),
        'content_text', r.statement,
        'descriptor_key', r.descriptor,
        'agent_inferred', true, 'defer_analysis', true,
        'agent_model', coalesce(r.src_model, r.deep#>>'{provenance,agent_model}', 'stored deep reading; model not recorded'),
        'extraction_method','photo_map_harvest_v1',
        'raw_source_ref', case when r.src_id is not null then 'vehicle_observations:' || r.src_id else 'vehicle_images:' || r.image_id end,
        'structured_data', jsonb_build_object(
          'image_id', r.image_id::text,
          'analysis_kind','photo_map_harvest','answer_basis','stored_reading','claim_role','inferred','is_inferred', true,
          'descriptor_key', r.descriptor, 'part_key', r.part, 'part_side', r.side, 'part_key_status', r.part_status,
          'source_text', r.statement,
          'statement_path', 'vehicle_images.ai_scan_metadata.byok_deep_analysis.state_observations.damage_callouts[' || r.idx || ']',
          'reader', jsonb_build_object('model', coalesce(r.src_model, r.deep#>>'{provenance,agent_model}'), 'prompt', r.deep->>'prompt_version', 'observation_id', r.src_id),
          'placed_by', jsonb_build_object('model','{{placed_by_model}}','role','skills/image-keys/SKILL.md','decisions','scripts/photo-pipeline/keys-dry-run/decisions.pending.2026-11-10.json','check','scripts/photo-pipeline/keys-dry-run/check_units.py','run','2026-11-10 dry run; docs/ledger/theory/image-keys-test.md'),
          'capture_at', case when r.taken_at is not null then to_char(r.taken_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
          'observed_at_basis', case when r.taken_at is not null then 'photo_capture_time' else 'photo_upload_time' end,
          'limitation', 'One reader''s statement about one photo, placed on existing keys by an agent. The part is carried as text until a part has a place on an observation. Not confirmed by a second reader, a receipt or the owner.')
      ),
      timeout_milliseconds := 60000) request_id
  from ready r
)
select jsonb_build_object(
  'as_of', now(), 'payload_ok', (select count(*) from src),
  'claims', (select count(*) from claims), 'matched_photo', (select count(*) from rws), 'ready', (select count(*) from ready),
  'no_capture_time', (select count(*) from ready where taken_at is null),
  'not_ready', (select jsonb_agg(jsonb_build_object('img8', img8, 'idx', idx, 'descriptor', descriptor, 'statement_found', statement is not null, 'descriptor_live', descriptor_id is not null)) from rws where statement is null or descriptor_id is null),
  'posted', (select jsonb_build_object('n', count(*), 'first_request', min(request_id), 'last_request', max(request_id)) from posted)
) as r;
