-- Cited photo/document evidence auto-accepts into vehicle fields (cited_evidence_auto_accept_v1).
-- A pending field_evidence row is "cited" when raw_extraction_data names a live image of the same vehicle
-- (photo_id or image_id) or a document (document_id). For each cited row:
--   field empty            -> write value to the vehicle column + vehicle_field_provenance, evidence 'accepted' (filled)
--   value agrees           -> provenance + evidence 'accepted' (agreed)
--   value disagrees        -> evidence 'conflicted', existing value kept, conflict recorded on provenance (conflict)
--   field has no column    -> provenance + evidence 'accepted' (provenance_only)
-- Every change is logged with its prior state in cited_evidence_accept_log by run_id;
-- revert_cited_evidence_run(run_id) restores it. Bounded: p_limit rows per call, lock_timeout 3s.
-- Automatic: cron 'cited-evidence-accept' every 10 minutes, 200 rows per call.
-- Revert: select cron.unschedule('cited-evidence-accept'); then revert_cited_evidence_run per run_id.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

create table if not exists public.cited_evidence_accept_log (
  id bigserial primary key,
  run_id uuid not null,
  evidence_id uuid not null,
  vehicle_id uuid not null,
  field_name text not null,
  column_name text,
  action text not null check (action in ('filled','agreed','conflict','provenance_only')),
  proposed_value text,
  prev_column_value text,
  prev_evidence_status text,
  prev_raw_extraction_data jsonb,
  prev_provenance jsonb,
  reverted_at timestamptz,
  created_at timestamptz not null default now());
create index if not exists cited_evidence_accept_log_run on public.cited_evidence_accept_log(run_id);
create index if not exists cited_evidence_accept_log_evidence on public.cited_evidence_accept_log(evidence_id);
alter table public.cited_evidence_accept_log enable row level security;

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

create or replace function public.accept_cited_field_evidence(
  p_run_id uuid, p_limit int default 200, p_vehicle_id uuid default null)
returns jsonb language plpgsql security definer set search_path = 'public', 'pg_temp' as $fn$
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
end $fn$;

create or replace function public.revert_cited_evidence_run(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = 'public', 'pg_temp' as $fn$
declare l record; n int := 0;
begin
  perform set_config('lock_timeout', '3s', true);
  for l in select * from cited_evidence_accept_log where run_id = p_run_id and reverted_at is null order by id desc loop
    if l.action = 'filled' and l.column_name is not null then
      execute format('update vehicles set %I = $1 where id = $2 and %I::text is not distinct from $3', l.column_name, l.column_name)
        using l.prev_column_value, l.vehicle_id, l.proposed_value;
    end if;
    update field_evidence set status = l.prev_evidence_status, raw_extraction_data = nullif(l.prev_raw_extraction_data, 'null'::jsonb),
      field_name = l.field_name,
      supporting_signals = coalesce(supporting_signals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'rule', 'cited_evidence_auto_accept_v1', 'reverted_run_id', p_run_id, 'at', now()))
     where id = l.evidence_id;
    if l.prev_provenance is null then
      -- the run created the provenance row; empty its values instead of deleting
      update vehicle_field_provenance set current_value = null, total_confidence = null, confidence_factors = null,
        primary_source = null, supporting_sources = null, conflicting_sources = null, last_verified_by = null, updated_at = now()
       where vehicle_id = l.vehicle_id and field_name = coalesce(l.column_name, l.field_name);
    else
      update vehicle_field_provenance p set
        current_value = l.prev_provenance->>'current_value',
        total_confidence = (l.prev_provenance->>'total_confidence')::int,
        confidence_factors = nullif(l.prev_provenance->'confidence_factors', 'null'::jsonb),
        primary_source = l.prev_provenance->>'primary_source',
        supporting_sources = (select array_agg(x) from jsonb_array_elements_text(nullif(l.prev_provenance->'supporting_sources', 'null'::jsonb)) x),
        conflicting_sources = nullif(l.prev_provenance->'conflicting_sources', 'null'::jsonb),
        last_verified_at = (l.prev_provenance->>'last_verified_at')::timestamptz,
        last_verified_by = l.prev_provenance->>'last_verified_by', updated_at = now()
       where p.vehicle_id = l.vehicle_id and p.field_name = coalesce(l.column_name, l.field_name);
    end if;
    update cited_evidence_accept_log set reverted_at = now() where id = l.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('run_id', p_run_id, 'reverted', n);
end $fn$;

revoke all on function public.accept_cited_field_evidence(uuid, int, uuid) from public, anon, authenticated;
revoke all on function public.revert_cited_evidence_run(uuid) from public, anon, authenticated;

DO $u$ BEGIN PERFORM cron.unschedule('cited-evidence-accept'); EXCEPTION WHEN OTHERS THEN NULL; END $u$;
SELECT cron.schedule('cited-evidence-accept', '*/10 * * * *',
  $cmd$ set statement_timeout = '55s'; select public.accept_cited_field_evidence(
    ('00000000-0000-4000-8000-' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MI'))::uuid, 200) $cmd$);
DO $check$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cited-evidence-accept' AND active) THEN
    RAISE EXCEPTION 'cited-evidence-accept cron not scheduled';
  END IF;
END $check$;
COMMIT;
