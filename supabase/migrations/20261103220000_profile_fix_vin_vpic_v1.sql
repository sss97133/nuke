-- NHTSA vPIC VIN decode -> fill EMPTY vehicle fields only, with field_evidence citation (source_type nhtsa_vpic). Logged/reversible via profile_fix_log.
create table if not exists public.profile_fix_vpic_queue (
  vehicle_id uuid not null, vin text not null, request_id bigint, requested_at timestamptz default now(),
  response jsonb, applied_at timestamptz, result jsonb, primary key (vehicle_id, vin));
alter table public.profile_fix_vpic_queue enable row level security;
revoke all on public.profile_fix_vpic_queue from anon, authenticated;

-- uses the existing public.vin_check_digit_ok(text)

create or replace function public.profile_fix_vin_vpic_apply_v1(p_vehicle uuid, p_res jsonb, p_dry boolean default true, p_run uuid default gen_random_uuid())
returns jsonb language plpgsql set search_path to 'public','pg_temp' set statement_timeout = '120s' as $f$
declare v record; out jsonb := '[]'::jsonb; m record; cur text; fe_id uuid; r jsonb; disp numeric; cyl text; cfg text; eng text; tr text; cite text;
begin
  select * into v from vehicles where id = p_vehicle;
  if not found then return jsonb_build_object('error','vehicle not found'); end if;
  if upper(btrim(v.vin)) is distinct from upper(p_res->>'VIN') or not vin_check_digit_ok(v.vin) or v.year < 1981 then return jsonb_build_object('skip','vin mismatch/invalid'); end if;
  if coalesce(p_res->>'ErrorCode','') !~ '^0' then return jsonb_build_object('skip','vpic error '||coalesce(p_res->>'ErrorCode','')); end if;
  if nullif(p_res->>'ModelYear','')::int is distinct from v.year then return jsonb_build_object('skip','model year disagrees'); end if;
  if replace(lower(coalesce(p_res->>'Make','')),'-',' ') not like '%'||split_part(replace(lower(coalesce(v.make,'')),'-',' '),' ',1)||'%' or coalesce(v.make,'') = '' then
    return jsonb_build_object('skip','make disagrees'); end if;
  cite := 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/'||upper(v.vin)||'?format=json&modelyear='||v.year;
  disp := nullif(p_res->>'DisplacementL','')::numeric; cyl := nullif(p_res->>'EngineCylinders',''); cfg := lower(coalesce(p_res->>'EngineConfiguration',''));
  if disp is not null then
    eng := round(disp,1)::text || 'L' || case when cyl is null then '' when cfg like 'v%' then ' V'||cyl when cfg like 'in%' then ' I'||cyl else ' '||cyl||'-cyl' end;
  end if;
  tr := nullif(btrim(coalesce(nullif(p_res->>'TransmissionSpeeds','')||'-speed ','') || lower(coalesce(p_res->>'TransmissionStyle',''))),'');
  if tr is not null and p_res->>'TransmissionStyle' in ('','Not Applicable') then tr := null; end if;
  for m in select * from (values
      ('model', nullif(btrim(p_res->>'Model'),'')),
      ('trim', nullif(btrim(p_res->>'Trim'),'')),
      ('series', nullif(btrim(p_res->>'Series'),'')),
      ('engine_size', eng),
      ('transmission', tr),
      ('drivetrain', nullif(btrim(p_res->>'DriveType'),'')),
      ('body_style', nullif(btrim(p_res->>'BodyClass'),'')),
      ('fuel_type', nullif(btrim(p_res->>'FuelTypePrimary'),''))) t(col, val)
  loop
    continue when m.val is null;
    execute format('select %I::text from vehicles where id = $1', m.col) into cur using p_vehicle;
    if nullif(btrim(cur),'') is null then
      -- empty: fill
      r := _pf_update(p_run, 'vin_vpic_fill_v1', 'vehicles', p_vehicle, m.col, to_jsonb(m.val), p_vehicle,
             jsonb_build_object('source','nhtsa_vpic','citation',cite,'confidence',0.9), p_dry);
      if r is not null then out := out || jsonb_build_array(jsonb_build_object('col',m.col,'val',m.val,'op','fill')); end if;
    elsif m.col in ('model','trim','engine_size','transmission') and (_pf_norm(cur) = _pf_norm(m.val)
          or (m.col='engine_size' and engine_displacement_ci(cur) is not null and engine_displacement_ci(cur) = engine_displacement_ci(m.val))) then
      null; -- agrees: add corroborating evidence below
    else
      continue;  -- existing value differs: never overwrite, no conflicting evidence added
    end if;
    if not p_dry and m.col in ('model','trim','engine_size','transmission','drivetrain','body_style','fuel_type','series') then
      insert into field_evidence(vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, status, assigned_by, raw_extraction_data)
      values (p_vehicle, m.col, m.val, 'nhtsa_vpic', 90, cite, 'accepted', 'profile_fix_vin_vpic_apply_v1', jsonb_build_object('run', p_run))
      on conflict (vehicle_id, field_name, source_type, proposed_value) do nothing returning id into fe_id;
      if fe_id is not null then
        insert into profile_fix_log(run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
        values (p_run, 'vin_vpic_evidence_v1', p_vehicle, 'field_evidence', fe_id, m.col, 'insert', null, to_jsonb(m.val), jsonb_build_object('citation',cite));
        out := out || jsonb_build_array(jsonb_build_object('col',m.col,'val',m.val,'op','evidence'));
      end if;
      fe_id := null;
    end if;
  end loop;
  if not p_dry then
    update profile_fix_vpic_queue set applied_at = now(), result = out where vehicle_id = p_vehicle and vin = upper(btrim(v.vin));
  end if;
  return jsonb_build_object('vehicle', p_vehicle, 'dry', p_dry, 'changes', out);
end $f$;

-- reusable async path for new vehicles: enqueue vPIC GETs via pg_net, then apply responses
create or replace function public.vin_vpic_enqueue_v1(p_limit int default 20) returns int
language plpgsql set search_path to 'public','pg_temp' as $f$
declare r record; n int := 0;
begin
  for r in select v.id, upper(btrim(v.vin)) vin, v.year from vehicles v
           where v.merged_into_vehicle_id is null and v.deleted_at is null and v.year >= 1981 and vin_check_digit_ok(v.vin)
             and upper(v.vin) !~ '(123456|000000)$'
             and not exists (select 1 from profile_fix_vpic_queue d where d.vehicle_id = v.id and d.vin = upper(btrim(v.vin)))
           order by v.created_at desc limit p_limit loop
    insert into profile_fix_vpic_queue(vehicle_id, vin, request_id)
    values (r.id, r.vin, net.http_get('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/'||r.vin||'?format=json&modelyear='||r.year));
    n := n + 1;
  end loop;
  return n;
end $f$;

create or replace function public.vin_vpic_collect_v1() returns int
language plpgsql set search_path to 'public','pg_temp' as $f$
declare r record; n int := 0; res jsonb;
begin
  for r in select d.vehicle_id, d.request_id, h.content, h.status_code from profile_fix_vpic_queue d join net._http_response h on h.id = d.request_id
           where d.response is null and d.applied_at is null loop
    begin
      res := case when r.status_code = 200 then (r.content::jsonb)->'Results'->0 end;
    exception when others then res := null; end;
    update profile_fix_vpic_queue set response = coalesce(res, jsonb_build_object('http_status', r.status_code)) where vehicle_id = r.vehicle_id and request_id = r.request_id;
    if res is not null then
      perform profile_fix_vin_vpic_apply_v1(r.vehicle_id, res, false, ('c0de2026-1103-4000-8000-00000001'||to_char(now(),'MMDD'))::uuid);
    end if;
    n := n + 1;
  end loop;
  return n;
end $f$;

revoke all on function public.profile_fix_vin_vpic_apply_v1(uuid,jsonb,boolean,uuid), public.vin_vpic_enqueue_v1(int), public.vin_vpic_collect_v1() from public, anon, authenticated;
