-- Existing acceptance owner and mappings; no changes or live data.
create or replace function public.cited_evidence_column(p_field text) returns text
language sql immutable set search_path = '' as $$
  select case p_field
    when 'exterior_color' then 'color' when 'color' then 'color'
    when 'interior_color' then 'interior_color'
    when 'displacement' then 'displacement' when 'engine_displacement_l' then 'displacement'
    when 'registration_plate' then 'license_plate' when 'license_plate' then 'license_plate'
    when 'engine_type' then 'engine_type' when 'transmission' then 'transmission'
    when 'body_style' then 'body_style' when 'trim' then 'trim'
    when 'drivetrain' then 'drivetrain' when 'fuel_type' then 'fuel_type'
    else null end
$$;

create or replace function public.cited_evidence_values_agree(p_field text, a text, b text) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_field in ('displacement','engine_displacement_l')
      and a ~ '^\s*\d+(\.\d+)?\s*$' and b ~ '^\s*\d+(\.\d+)?\s*$'
      then abs(a::numeric - b::numeric) <= 0.05
    else lower(regexp_replace(coalesce(a,''), '[^a-zA-Z0-9]', '', 'g'))
       = lower(regexp_replace(coalesce(b,''), '[^a-zA-Z0-9]', '', 'g')) end
$$;

CREATE OR REPLACE FUNCTION public.accept_cited_field_evidence(p_run_id uuid, p_limit integer DEFAULT 200, p_vehicle_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record; col text; cur text; img uuid; doc text; prov jsonb; act text;
  n_filled int := 0; n_agreed int := 0; n_conflict int := 0; n_prov int := 0;
begin
  perform set_config('lock_timeout', '3s', true);
  if p_run_id is null then raise exception 'accept_cited_field_evidence: run_id required'; end if;
  for r in
    select fe.* from field_evidence fe
    where fe.status = 'pending'
      and (p_vehicle_id is null or fe.vehicle_id = p_vehicle_id)
      and coalesce(btrim(fe.proposed_value), '') <> ''
      and (fe.raw_extraction_data ? 'photo_id' or fe.raw_extraction_data ? 'image_id' or fe.raw_extraction_data ? 'document_id')
    order by fe.created_at, fe.id
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    for update of fe skip locked
  loop
    img := null; doc := null;
    if coalesce(r.raw_extraction_data->>'photo_id', r.raw_extraction_data->>'image_id')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select i.id into img from vehicle_images i
       where i.id = coalesce(r.raw_extraction_data->>'photo_id', r.raw_extraction_data->>'image_id')::uuid
         and i.vehicle_id = r.vehicle_id and i.is_superseded is not true;
    end if;
    doc := nullif(btrim(r.raw_extraction_data->>'document_id'), '');
    continue when img is null and doc is null;   -- citation not resolvable: leave pending

    col := cited_evidence_column(r.field_name);
    select to_jsonb(p) into prov from vehicle_field_provenance p
     where p.vehicle_id = r.vehicle_id and p.field_name = coalesce(col, r.field_name);
    if col is not null then
      execute format('select %I::text from vehicles where id = $1', col) into cur using r.vehicle_id;
    else
      cur := null;
    end if;

    act := case when col is null then 'provenance_only'
                when coalesce(btrim(cur), '') = '' then 'filled'
                when cited_evidence_values_agree(r.field_name, cur, r.proposed_value) then 'agreed'
                else 'conflict' end;

    insert into cited_evidence_accept_log(run_id, evidence_id, vehicle_id, field_name, column_name, action,
      proposed_value, prev_column_value, prev_evidence_status, prev_raw_extraction_data, prev_provenance)
    values (p_run_id, r.id, r.vehicle_id, r.field_name, col, act, r.proposed_value, cur, r.status,
      r.raw_extraction_data, prov);

    if act = 'conflict' then
      update field_evidence set status = 'conflicted',
        contradicting_signals = coalesce(contradicting_signals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'rule', 'cited_evidence_auto_accept_v1', 'run_id', p_run_id, 'existing_value', cur, 'column', col, 'at', now()))
       where id = r.id;
      insert into vehicle_field_provenance(vehicle_id, field_name, current_value, conflicting_sources, updated_at)
      values (r.vehicle_id, col, cur, jsonb_build_array(jsonb_build_object('evidence_id', r.id, 'value', r.proposed_value,
        'image_id', img, 'document_id', doc, 'run_id', p_run_id)), now())
      on conflict (vehicle_id, field_name) do update set
        conflicting_sources = coalesce(vehicle_field_provenance.conflicting_sources, '[]'::jsonb) || excluded.conflicting_sources,
        updated_at = now();
      n_conflict := n_conflict + 1;
      continue;
    end if;

    if act = 'filled' then
      execute format('update vehicles set %I = $1 where id = $2', col) using r.proposed_value, r.vehicle_id;
    end if;

    update field_evidence set status = 'accepted', assigned_at = now(), assigned_by = 'cited_evidence_auto_accept_v1',
      -- an aliased field (registration_plate) is filed under its column so the field's provenance lists it
      field_name = case when col is not null and col <> r.field_name and not exists (select 1 from field_evidence x
        where x.vehicle_id = r.vehicle_id and x.field_name = col and x.source_type = r.source_type
          and x.proposed_value = r.proposed_value) then col else field_name end,
      raw_extraction_data = case when img is not null and not (coalesce(raw_extraction_data, '{}'::jsonb) ? 'photo_id')
        then coalesce(raw_extraction_data, '{}'::jsonb) || jsonb_build_object('photo_id', img) else raw_extraction_data end,
      supporting_signals = coalesce(supporting_signals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'rule', 'cited_evidence_auto_accept_v1', 'run_id', p_run_id, 'action', act, 'image_id', img, 'document_id', doc, 'at', now()))
     where id = r.id;

    insert into vehicle_field_provenance(vehicle_id, field_name, current_value, total_confidence, confidence_factors,
      primary_source, supporting_sources, last_verified_at, last_verified_by, updated_at)
    values (r.vehicle_id, coalesce(col, r.field_name), case when act = 'agreed' then cur else r.proposed_value end,
      least(greatest(coalesce(r.source_confidence, 70), 0), 100),
      jsonb_build_object('rule', 'cited_evidence_auto_accept_v1', 'run_id', p_run_id, 'evidence_id', r.id,
        'image_id', img, 'document_id', doc, 'source_type', r.source_type),
      'field_evidence:' || r.source_type, array[coalesce('image:' || img::text, 'document:' || doc)], now(),
      'cited_evidence_auto_accept_v1', now())
    on conflict (vehicle_id, field_name) do update set
      current_value = excluded.current_value,
      total_confidence = greatest(coalesce(vehicle_field_provenance.total_confidence, 0), excluded.total_confidence),
      confidence_factors = coalesce(vehicle_field_provenance.confidence_factors, '{}'::jsonb) || excluded.confidence_factors,
      primary_source = coalesce(vehicle_field_provenance.primary_source, excluded.primary_source),
      supporting_sources = (select array_agg(distinct s) from unnest(coalesce(vehicle_field_provenance.supporting_sources, '{}') || excluded.supporting_sources) s),
      last_verified_at = now(), last_verified_by = excluded.last_verified_by, updated_at = now();

    if act = 'filled' then n_filled := n_filled + 1;
    elsif act = 'agreed' then n_agreed := n_agreed + 1;
    else n_prov := n_prov + 1; end if;
  end loop;
  return jsonb_build_object('run_id', p_run_id, 'filled', n_filled, 'agreed', n_agreed,
    'provenance_only', n_prov, 'accepted', n_filled + n_agreed + n_prov, 'conflicts', n_conflict);
end $function$;
