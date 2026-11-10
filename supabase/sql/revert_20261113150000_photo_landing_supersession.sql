-- Revert of supabase/migrations/20261113150000_photo_landing_supersession.sql.
--
-- Puts back the three previous owners byte for byte (photo_land_classification(uuid, boolean),
-- photo_land_classification(uuid), photo_land_trigger(); bodies copied verbatim from
-- 20261109213000_reviewed_image_analysis.sql lines 20-191, the ones production carried on 2026-11-10), puts the
-- catalog comments of the fold and of assay_photo_reading_flow(boolean) back to what they were before the migration,
-- and removes what the migration added.
--
-- Two modes.
--   FULL (default). Drops the three tables and the five functions. It REFUSES, changing nothing, while
--     photo_land_superseded_rows holds rows: those are the only copy of what superseded readings had landed.
--     photo_land_failures (open failures included) and ledger rows without before-images are dropped; the counts are
--     printed first.
--   KEEP HISTORY. Run "set photo_land.keep_history = 'on';" in the session before this file, e.g.
--       psql "$DB" -v ON_ERROR_STOP=1 -c "set photo_land.keep_history = 'on'" -f supabase/sql/revert_20261113150000_photo_landing_supersession.sql
--     Only the three bodies and the two comments change. Every table, its rows, its guards and the five functions stay.
--     The previous fold does not maintain the ledger, so while it runs: a re-read photo is a stale mix again, an
--     open failure is not closed by a later good run, and photo_land_retry_failures() only counts retries. When the
--     migration is applied again, a photo whose classification is no longer the reading the ledger calls current is
--     superseded on its next landing; what the previous fold mixed in meanwhile is kept as that landing's before-image.
--
-- Not undone in either mode, because they are rows in tables this change does not own: image_angle_observations rows
-- the new fold inserted (they carry evidence.reading_id) and field_evidence proposals carrying
-- raw_extraction_data.reading_id. Both are valid rows for the previous fold.
-- One transaction: when a guard raises, nothing below it runs. No lock on vehicle_images or on a landed table.
begin;
set local statement_timeout = '10s';
set local lock_timeout = '3s';

do $guard$
declare
  c_fold_live    constant text := '7c95e1ac5d5832ca68b4690b92f365f0';
  c_fold_this    constant text := '1625d1e78b0bc5511d5f4dbfab4c28ef';
  c_wrapper_live constant text := '6c8b7cddc606cca4dfeb557d7e6f5c1c';
  c_trigger_live constant text := '307261071b2aa3fef7a83297d63a9638';
  c_trigger_this constant text := '550ba1336d544010215b221aace47748';
  v_fold text; v_wrapper text; v_trigger text; v_n bigint;
begin
  select md5(prosrc) into v_fold    from pg_proc where oid = to_regprocedure('public.photo_land_classification(uuid,boolean)');
  select md5(prosrc) into v_wrapper from pg_proc where oid = to_regprocedure('public.photo_land_classification(uuid)');
  select md5(prosrc) into v_trigger from pg_proc where oid = to_regprocedure('public.photo_land_trigger()');
  -- the owners must be the ones the migration installed (or already the previous ones): a later change is not ours to undo
  if v_fold is null or v_fold not in (c_fold_live, c_fold_this)
     or v_wrapper is distinct from c_wrapper_live
     or v_trigger is null or v_trigger not in (c_trigger_live, c_trigger_this) then
    raise exception 'photo landing owners are not the ones this revert knows (fold %, wrapper %, trigger %); nothing changed',
      coalesce(v_fold, 'missing'), coalesce(v_wrapper, 'missing'), coalesce(v_trigger, 'missing');
  end if;
  if coalesce(current_setting('photo_land.keep_history', true), '') not in ('on', 'true', '1') then
    if to_regclass('public.photo_land_superseded_rows') is not null then
      select count(*) into v_n from public.photo_land_superseded_rows;
      if v_n > 0 then
        raise exception 'photo_land_superseded_rows holds % rows of superseded readings; a full revert would drop them. Nothing changed. To put the previous fold back and keep every table, run this file with photo_land.keep_history = on', v_n;
      end if;
    end if;
  end if;
end $guard$;

-- ---------------------------------------------------------------- the previous owners, verbatim
CREATE OR REPLACE FUNCTION public.photo_land_classification(p_image_id uuid, p_include_classifier boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  vi record; cls jsonb; x jsonb; pv text; conf numeric; descr text; vid uuid;
  n_desc int := 0; n_f int := 0; n_t int := 0; n_fe int := 0; n_ang int := 0; n_cam int := 0; rc int;
  ang_key text; ang_id uuid; pose jsonb; byok jsonb; dist numeric; az numeric; el numeric; res jsonb; dq text; pl jsonb;
begin
  select v.id, v.user_id, v.vehicle_id, v.vision_gate_status::text as gate, v.ai_scan_metadata as md
    into vi from public.vehicle_images v where v.id = p_image_id and v.ai_processing_status = 'completed';
  if not found then return jsonb_build_object('skipped', 'not_completed'); end if;
  vid := case when vi.vehicle_id is not null and coalesce(vi.gate, '') not like 'rejected%' then vi.vehicle_id end;
  cls := vi.md->'classification';
  if p_include_classifier and cls is not null and jsonb_typeof(cls) = 'object' and cls->>'image_type' is not null then
    x := case when jsonb_typeof(cls->'v2') = 'object' then cls->'v2' else '{}'::jsonb end;
    pv := coalesce(x->>'prompt_version', cls#>>'{classifier_receipt,prompt_version}', 'legacy');
    conf := least(greatest(coalesce(nullif(cls->>'confidence','')::numeric, 0), 0), 1);
    descr := nullif(btrim(coalesce(cls->>'description', '')), '');

    if descr is not null and not exists (select 1 from public.image_descriptions d where d.image_id = p_image_id and d.description_type = 'classifier_v2') then
      insert into public.image_descriptions(image_id, vehicle_id, description, description_type, source, source_version, confidence, evidence)
      values (p_image_id, vid, descr, 'classifier_v2', 'photo-pipeline-classifier', pv, conf,
              jsonb_build_object('photo_id', p_image_id, 'image_type', cls->>'image_type', 'is_automotive', cls->'is_automotive', 'model', cls#>>'{classifier_receipt,model}'));
      n_desc := 1;
    end if;

    insert into public.photo_extracted_fields(image_id, user_id, vehicle_id, field_name, value, quote, confidence, source, prompt_version, meta)
    select distinct on (s.fn) p_image_id, vi.user_id, vid, s.fn, s.val, s.qt, s.cf, 'classifier_v2', pv, s.meta
    from (
      select e->>'field_name' fn, nullif(btrim(e->>'value'), '') val, nullif(e->>'evidence','') qt,
             least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf, jsonb_build_object('photo_id', p_image_id) meta
        from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e
      union all
      select 'vin', nullif(btrim(x#>>'{vin,value}'), ''), nullif(x#>>'{vin,evidence}',''),
             least(greatest(nullif(x#>>'{vin,confidence}','')::numeric, 0), 1),
             jsonb_build_object('photo_id', p_image_id, 'checksum_ok', x#>'{vin,checksum_ok}')
        where jsonb_typeof(x->'vin') = 'object'
    ) s where s.fn is not null and s.val is not null
    order by s.fn, s.cf desc nulls last
    on conflict do nothing;
    get diagnostics rc = row_count; n_f := n_f + rc;

    insert into public.photo_extracted_fields(image_id, user_id, vehicle_id, field_name, value, quote, confidence, source, prompt_version, meta)
    select p_image_id, vi.user_id, vid, c.fn, c.val, c.qt, c.cf, 'classifier_v2', pv, jsonb_build_object('photo_id', p_image_id)
    from (values
      ('core.image_type', cls->>'image_type', left(descr, 300), conf),
      ('core.is_automotive', cls->>'is_automotive', left(descr, 300), conf),
      ('core.classifier_confidence', cls->>'confidence', null, conf),
      ('core.description', descr, descr, conf),
      ('doc.type', nullif(x->>'document_type', ''), left(descr, 300), conf),
      ('doc.kind', nullif(x->>'document_kind', ''), left(descr, 300), conf)
    ) c(fn, val, qt, cf) where c.val is not null
    on conflict do nothing;
    get diagnostics rc = row_count; n_f := n_f + rc;

    insert into public.photo_text_lines(image_id, user_id, vehicle_id, line_idx, text, region, confidence, source, prompt_version)
    select p_image_id, vi.user_id, vid, (t.ord - 1)::int, btrim(t.e->>'text'),
           case when t.e ? 'region' then t.e->'region' end,
           least(greatest(nullif(t.e->>'confidence','')::numeric, 0), 1), 'classifier_v2', pv
    from jsonb_array_elements(case when jsonb_typeof(x->'text_lines') = 'array' then x->'text_lines' else '[]'::jsonb end) with ordinality t(e, ord)
    where nullif(btrim(coalesce(t.e->>'text', '')), '') is not null
    on conflict do nothing;
    get diagnostics rc = row_count; n_t := rc;

    if vid is not null then
      insert into public.field_evidence(vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, raw_extraction_data)
      select vid, s.fn, s.val, 'ai_visual', round(s.cf * 100)::int, left('photo-pipeline landing v1: ' || s.qt, 400),
             jsonb_build_object('photo_id', p_image_id, 'image_id', p_image_id, 'quote', s.qt, 'confidence', s.cf, 'extractor', 'photo_land_classification', 'prompt_version', pv)
      from (
        select distinct on (fn, val) e->>'field_name' fn, btrim(e->>'value') val, e->>'evidence' qt, least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf
          from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e
         order by fn, val
      ) s
      where s.cf >= 0.6 and nullif(s.qt, '') is not null and nullif(s.val, '') is not null and s.fn is not null
        -- plate stamping codes are identifiers, not attributes; other-vehicle / non-body readings are not evidence about this car
        and not exists (select 1 from public.photo_plate_code_kind(s.qt))
        and public.photo_field_not_about_vehicle(s.fn, s.val, s.qt, descr) is null
      on conflict (vehicle_id, field_name, source_type, proposed_value) do nothing;
      get diagnostics rc = row_count; n_fe := rc;

      begin
        select jsonb_agg(jsonb_build_object('kind', k.kind, 'value', k.code, 'quote', left(k.qt, 400), 'confidence', k.cf)) into pl
        from (select distinct on (pk.kind, pk.code) pk.kind, pk.code, s2.qt, s2.cf
                from (select e->>'evidence' qt, least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf
                        from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e) s2
                cross join lateral public.photo_plate_code_kind(s2.qt) pk
               where s2.cf >= 0.6
               order by pk.kind, pk.code) k;
        if pl is not null then
          perform public.land_identifier_claims(vid, jsonb_build_object('identifiers', pl), null, 'photo_land_classification', 'photo', p_image_id, null);
          update public.vehicle_identifiers set evidence_class = 'plate_stamping'
           where vehicle_id = vid and source_image_id = p_image_id and kind like 'plate\_%' and evidence_class is null;
        end if;
      exception when others then null;
      end;

      ang_key := case x#>>'{angle,value}'
        when 'exterior_front' then 'exterior.front.center'
        when 'exterior_rear' then 'exterior.rear.center'
        when 'interior_dashboard' then 'interior.dash.full'
        when 'engine_bay' then 'engine.bay'
        when 'undercarriage' then 'undercarriage.general'
        when 'detail_shot' then 'detail.general'
        else null end;
      if ang_key is not null and not exists (select 1 from public.image_angle_observations o where o.image_id = p_image_id and o.source = 'classifier_v2') then
        select a.angle_id into ang_id from public.angle_taxonomy a where a.canonical_key = ang_key and a.deprecated_at is null limit 1;
        if ang_id is not null then
          insert into public.image_angle_observations(image_id, vehicle_id, angle_id, confidence, source, source_version, evidence)
          values (p_image_id, vid, ang_id, least(greatest(coalesce(nullif(x#>>'{angle,confidence}','')::numeric, conf), 0), 1), 'classifier_v2', pv,
                  jsonb_build_object('photo_id', p_image_id, 'classifier_angle', x#>>'{angle,value}', 'quote', left(descr, 300)));
          n_ang := 1;
        end if;
      end if;
    end if;
  end if;

  byok := vi.md->'byok_deep_analysis';
  if byok is not null and jsonb_typeof(byok->'camera_pose') = 'object' then
    pose := byok->'camera_pose';
    az := case when (pose->>'azimuth_deg') ~ '^-?[0-9.]+$' then (pose->>'azimuth_deg')::numeric end;
    el := case when (pose->>'elevation_deg') ~ '^-?[0-9.]+$' then (pose->>'elevation_deg')::numeric end;
    dq := pose->>'distance_est';
    dist := case when dq ~* '^[~ ]*[0-9.]+ ?m$' then round((regexp_replace(dq, '[^0-9.]', '', 'g'))::numeric * 1000) end;
    if (az is not null or el is not null) then
      insert into public.image_camera_position(image_id, vehicle_id, subject_key, azimuth_deg, elevation_deg, distance_mm, confidence, source, source_version, evidence)
      values (p_image_id, vid, 'vehicle', az, el, dist,
              least(greatest(coalesce(nullif(byok->>'confidence','')::numeric, 0.5), 0), 1), 'byok_deep_analysis',
              coalesce('review:' || (byok->>'observation_id'), byok->>'prompt_version', 'unknown'),
              jsonb_strip_nulls(jsonb_build_object('photo_id', p_image_id, 'camera_pose', pose, 'run_id', byok->>'run_id',
                'observation_id', byok->>'observation_id', 'source_identifier', byok->>'source_identifier')))
      on conflict (image_id, subject_key, source, source_version) do nothing;
      get diagnostics rc = row_count; n_cam := rc;
    end if;
  end if;

  res := jsonb_build_object('descriptions', n_desc, 'fields', n_f, 'text_lines', n_t, 'field_evidence', n_fe, 'angles', n_ang, 'camera', n_cam);
  insert into public.photo_land_progress(image_id, result) values (p_image_id, res)
    on conflict (image_id) do update set landed_at = now(), result = excluded.result;
  return res;
exception when others then
  return jsonb_build_object('error', sqlerrm, 'state', sqlstate);
end;
$function$
;

-- Compatibility entry retains the former full landing contract.
CREATE OR REPLACE FUNCTION public.photo_land_classification(p_image_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT public.photo_land_classification(p_image_id, true) $$;
REVOKE ALL ON FUNCTION public.photo_land_classification(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.photo_land_classification(uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.photo_land_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  -- A deep-result-only update changes camera testimony, not the classifier.
  -- Keep classifier/filing transitions on the original full landing path.
  PERFORM public.photo_land_classification(NEW.id,
    OLD.ai_processing_status IS DISTINCT FROM 'completed'
    OR OLD.ai_scan_metadata->'classification' IS DISTINCT FROM NEW.ai_scan_metadata->'classification'
    OR OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id
    OR OLD.vision_gate_status IS DISTINCT FROM NEW.vision_gate_status);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'photo_land_trigger failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------- the two comments the migration extended
do $comments$
declare
  c_mark constant text := '[photo landing supersession 20261113150000]';
  v_oid oid; v_comment text;
begin
  -- the fold: back to the comment it carried before the migration (none, if it had none)
  v_comment := obj_description('public.photo_land_classification(uuid,boolean)'::regprocedure, 'pg_proc');
  if position(c_mark in coalesce(v_comment, '')) > 0 then
    execute format('comment on function public.photo_land_classification(uuid, boolean) is %L',
                   nullif(rtrim(left(v_comment, position(c_mark in v_comment) - 1)), ''));
  end if;
  -- the reader whose wording the migration extended
  v_oid := to_regprocedure('public.assay_photo_reading_flow(boolean)');
  if v_oid is not null then
    v_comment := obj_description(v_oid, 'pg_proc');
    if v_comment like '%[photo landing supersession]%' then
      begin
        execute format('comment on function public.assay_photo_reading_flow(boolean) is %L',
                       nullif(left(v_comment, position(' [photo landing supersession]' in v_comment) - 1), ''));
      exception when others then
        raise notice 'assay_photo_reading_flow comment not restored: %', sqlerrm;
      end;
    end if;
  end if;
end $comments$;

-- ---------------------------------------------------------------- what the migration added
do $drop$
declare v_landings bigint := 0; v_failures bigint := 0; v_open bigint := 0;
begin
  if coalesce(current_setting('photo_land.keep_history', true), '') in ('on', 'true', '1') then
    raise notice 'photo_land.keep_history is on: previous owners and comments restored; photo_classifier_landings, photo_land_superseded_rows, photo_land_failures and the five functions are kept';
    return;
  end if;
  if to_regclass('public.photo_classifier_landings') is not null then
    select count(*) into v_landings from public.photo_classifier_landings;
  end if;
  if to_regclass('public.photo_land_failures') is not null then
    select count(*), count(*) filter (where resolved_at is null) into v_failures, v_open from public.photo_land_failures;
  end if;
  raise notice 'dropping photo_classifier_landings (% rows, none superseded with a before-image), photo_land_failures (% rows, % open), photo_land_superseded_rows (empty)',
    v_landings, v_failures, v_open;
  drop function if exists public.photo_land_outstanding(uuid, uuid, integer);
  drop function if exists public.photo_land_retry_failures(integer, integer);
  drop table if exists public.photo_land_superseded_rows;
  drop table if exists public.photo_land_failures;
  drop table if exists public.photo_classifier_landings;
  drop function if exists public.photo_land_note_failure(uuid, text, text, text, text, text, text, boolean);
  drop function if exists public.photo_land_history_guard();
  drop function if exists public.photo_classifier_reading_id(jsonb);
end $drop$;

do $verify$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.photo_land_classification(uuid,boolean)'::regprocedure) <> '7c95e1ac5d5832ca68b4690b92f365f0'
     or (select md5(prosrc) from pg_proc where oid = 'public.photo_land_classification(uuid)'::regprocedure) <> '6c8b7cddc606cca4dfeb557d7e6f5c1c'
     or (select md5(prosrc) from pg_proc where oid = 'public.photo_land_trigger()'::regprocedure) <> '307261071b2aa3fef7a83297d63a9638' then
    raise exception 'revert did not restore the previous photo landing owners byte for byte; nothing changed';
  end if;
end $verify$;
commit;
