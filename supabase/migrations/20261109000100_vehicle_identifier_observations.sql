-- Photo-landing v3 (1/6): classifier-read plates/VINs become *candidate identifiers* with confidence and a
-- source image. They are promoted onto a vehicle profile only when the photo's capture set landed on that
-- vehicle with high confidence (and therefore passed the visual filing gate). Nothing is hard-coded: evidence
-- decides, observations are kept (never overwritten) and re-evaluated on later passes.
--
-- Also: vehicle_dedup_decisions, a re-evaluable record of "same car / distinct car / unknown" calls made with
-- cited evidence, so a "keep, don't merge" decision is stored instead of lost.

create table if not exists public.vehicle_identifier_observations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  image_id         uuid not null,
  kind             text not null check (kind in ('vin','plate')),
  value            text not null,
  value_norm       text not null,              -- vin: vin_match_key(value); plate: A-Z0-9 only
  confidence       numeric not null check (confidence >= 0 and confidence <= 1),
  source           text not null,              -- photo_extracted_fields | photo_text_lines
  source_row_id    uuid,
  quote            text,
  taken_at         timestamptz,
  status           text not null default 'candidate'
                     check (status in ('candidate','promoted','confirmed','conflict','rejected','superseded')),
  promoted_vehicle_id uuid,
  promoted_run_id  uuid,
  promoted_at      timestamptz,
  evidence         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (image_id, kind, value_norm, source)
);
create index if not exists vio_user_taken on public.vehicle_identifier_observations (user_id, taken_at);
create index if not exists vio_image on public.vehicle_identifier_observations (image_id);
create index if not exists vio_norm on public.vehicle_identifier_observations (kind, value_norm) where status <> 'rejected';
alter table public.vehicle_identifier_observations enable row level security;
drop policy if exists vio_owner_read on public.vehicle_identifier_observations;
create policy vio_owner_read on public.vehicle_identifier_observations for select using (user_id = auth.uid());

comment on table public.vehicle_identifier_observations is
  'Candidate VIN/plate reads from photos (classifier + OCR lines). Candidates feed capture_sets_score; promoted onto vehicles only via identifier_observations_promote after a set lands on the vehicle at high confidence.';

create table if not exists public.vehicle_dedup_decisions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  vehicle_a      uuid not null,
  vehicle_b      uuid not null,
  decision       text not null check (decision in ('same','distinct','unknown')),
  confidence     numeric not null check (confidence >= 0 and confidence <= 1),
  evidence       jsonb not null default '{}'::jsonb,   -- cited image ids, VINs, dates, what was compared
  decided_by     text not null,
  decided_at     timestamptz not null default now(),
  superseded_at  timestamptz,
  check (vehicle_a <> vehicle_b)
);
create index if not exists vdd_pair on public.vehicle_dedup_decisions (vehicle_a, vehicle_b) where superseded_at is null;
alter table public.vehicle_dedup_decisions enable row level security;

-- Ingest: idempotent, bounded by user and (optionally) a taken_at window. Never touches a vehicle.
create or replace function public.identifier_observations_ingest(
  p_user uuid, p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql security definer
set search_path to 'public','pg_temp'
set statement_timeout to '120s'
as $function$
declare n_f int := 0; n_t int := 0; n_p int := 0;
begin
  if p_user is null then raise exception 'identifier_observations_ingest: p_user required'; end if;

  -- 1) classifier-read fields (photo_extracted_fields: license_plate / vin)
  with ins as (
    insert into vehicle_identifier_observations (user_id, image_id, kind, value, value_norm, confidence, source, source_row_id, quote, taken_at, evidence)
    select distinct on (f.image_id, case f.field_name when 'vin' then 'vin' else 'plate' end,
                        case f.field_name when 'vin' then vin_match_key(f.value) else regexp_replace(upper(f.value),'[^A-Z0-9]','','g') end)
           p_user, f.image_id,
           case f.field_name when 'vin' then 'vin' else 'plate' end,
           btrim(f.value),
           case f.field_name when 'vin' then vin_match_key(f.value) else regexp_replace(upper(f.value),'[^A-Z0-9]','','g') end,
           least(1, greatest(0, coalesce(f.confidence, 0.5))),
           'photo_extracted_fields', f.id, f.quote, vi.taken_at,
           jsonb_build_object('field_name', f.field_name, 'extractor', f.source, 'prompt_version', f.prompt_version)
    from photo_extracted_fields f
    join vehicle_images vi on vi.id = f.image_id and vi.user_id = p_user
    where f.user_id = p_user and f.field_name in ('license_plate','vin') and nullif(btrim(f.value),'') is not null
      and (p_from is null or vi.taken_at >= p_from) and (p_to is null or vi.taken_at < p_to)
      and length(case f.field_name when 'vin' then coalesce(vin_match_key(f.value),'') else regexp_replace(upper(f.value),'[^A-Z0-9]','','g') end) >= 3
    order by f.image_id, case f.field_name when 'vin' then 'vin' else 'plate' end,
             case f.field_name when 'vin' then vin_match_key(f.value) else regexp_replace(upper(f.value),'[^A-Z0-9]','','g') end, f.confidence desc nulls last
    on conflict (image_id, kind, value_norm, source) do update
      set confidence = greatest(vehicle_identifier_observations.confidence, excluded.confidence), updated_at = now()
    returning 1)
  select count(*) into n_f from ins;

  -- 2) OCR text lines: 17-char VIN-shaped tokens (always), and plate tokens only when they equal a plate already
  --    on this user's roster (free text is too noisy to mint new plates from).
  with vin_hits as (
    select tl.id, tl.image_id, tl.text, coalesce(tl.confidence,0.5) c, vi.taken_at, m[1] vin
    from photo_text_lines tl
    join vehicle_images vi on vi.id = tl.image_id and vi.user_id = p_user
    cross join lateral regexp_matches(upper(regexp_replace(tl.text,'[\s-]','','g')), '([A-HJ-NPR-Z0-9]{17})', 'g') m
    where tl.user_id = p_user and (p_from is null or vi.taken_at >= p_from) and (p_to is null or vi.taken_at < p_to)
      and m[1] ~ '[0-9]' and m[1] ~ '[A-Z]'
  ), ins as (
    insert into vehicle_identifier_observations (user_id, image_id, kind, value, value_norm, confidence, source, source_row_id, quote, taken_at, evidence)
    select distinct on (image_id, vin_match_key(vin)) p_user, image_id, 'vin', vin, vin_match_key(vin), least(0.85, c*0.9), 'photo_text_lines', id, left(text,200), taken_at,
           jsonb_build_object('match','17-char token in OCR line')
    from vin_hits
    order by image_id, vin_match_key(vin), c desc
    on conflict (image_id, kind, value_norm, source) do update
      set confidence = greatest(vehicle_identifier_observations.confidence, excluded.confidence), updated_at = now()
    returning 1)
  select count(*) into n_t from ins;

  with roster_plates as (
    select distinct regexp_replace(upper(v.license_plate),'[^A-Z0-9]','','g') pk
    from vehicles v where (v.owner_id = p_user or v.user_id = p_user) and v.deleted_at is null
      and length(regexp_replace(upper(coalesce(v.license_plate,'')),'[^A-Z0-9]','','g')) >= 5
  ), ins as (
    insert into vehicle_identifier_observations (user_id, image_id, kind, value, value_norm, confidence, source, source_row_id, quote, taken_at, evidence)
    select distinct on (tl.image_id, rp.pk) p_user, tl.image_id, 'plate', rp.pk, rp.pk, least(0.7, coalesce(tl.confidence,0.5)*0.8), 'photo_text_lines', tl.id, left(tl.text,200), vi.taken_at,
           jsonb_build_object('match','OCR line equals a plate already on this user''s roster')
    from photo_text_lines tl
    join vehicle_images vi on vi.id = tl.image_id and vi.user_id = p_user
    join roster_plates rp on regexp_replace(upper(tl.text),'[^A-Z0-9]','','g') = rp.pk
    where tl.user_id = p_user and (p_from is null or vi.taken_at >= p_from) and (p_to is null or vi.taken_at < p_to)
    order by tl.image_id, rp.pk, tl.confidence desc nulls last
    on conflict (image_id, kind, value_norm, source) do update
      set confidence = greatest(vehicle_identifier_observations.confidence, excluded.confidence), updated_at = now()
    returning 1)
  select count(*) into n_p from ins;

  return jsonb_build_object('user', p_user, 'from_extracted_fields', n_f, 'vin_from_text_lines', n_t, 'roster_plate_from_text_lines', n_p);
end $function$;

-- Promote: a candidate becomes a vehicle identifier only when the photo's capture set landed on exactly one vehicle
-- at >= p_min_set_conf via a non-reverted capture_set_links row (links exist only after the visual gate passed).
-- Never overwrites an existing VIN/plate; disagreements are recorded as status='conflict'. Logged to
-- profile_fix_log (revert with profile_fix_revert(p_run)).
create or replace function public.identifier_observations_promote(
  p_user uuid, p_run uuid, p_dry boolean default true,
  p_min_set_conf numeric default 0.9, p_min_obs_conf numeric default 0.8)
returns jsonb
language plpgsql security definer
set search_path to 'public','pg_temp'
set statement_timeout to '120s'
as $function$
declare r record; v record; promoted int := 0; confirmed int := 0; conflicts int := 0; skipped int := 0; col text; before_val text; newval text;
  detail jsonb := '[]';
begin
  if p_run is null then raise exception 'run id required'; end if;
  for r in
    with landed as (
      select o.id oid, o.image_id, o.kind, o.value, o.value_norm, o.confidence, o.source, o.quote,
             (select array_agg(distinct l2.vehicle_id) from capture_set_links l1
                join capture_set_links l2 on l2.set_key = l1.set_key and l2.reverted_at is null and l2.confidence >= p_min_set_conf
               where l1.image_id = o.image_id and l1.reverted_at is null) vids,
             (select max(l2.run_id::text) from capture_set_links l1
                join capture_set_links l2 on l2.set_key = l1.set_key and l2.reverted_at is null
               where l1.image_id = o.image_id and l1.reverted_at is null) src_run
      from vehicle_identifier_observations o
      where o.user_id = p_user and o.status in ('candidate','conflict') and o.confidence >= p_min_obs_conf
        and (o.kind = 'vin' and length(o.value_norm) >= 8 or o.kind = 'plate' and length(o.value_norm) between 5 and 8))
    select * from landed where vids is not null and cardinality(vids) = 1 order by confidence desc loop
    select * into v from vehicles where id = r.vids[1] and deleted_at is null and merged_into_vehicle_id is null
       and (owner_id = p_user or user_id = p_user) and id not in ('7b0e02b9-42af-4998-b27d-69e3459b452b'::uuid,'1e9fdf16-b453-44a9-8b74-46bbe886625a'::uuid);
    if not found then skipped := skipped + 1; continue; end if;
    col := case r.kind when 'vin' then 'vin' else 'license_plate' end;
    before_val := case r.kind when 'vin' then v.vin else v.license_plate end;
    newval := upper(btrim(r.value));
    if r.kind = 'vin' and nullif(btrim(coalesce(before_val,'')),'') is null and exists (
         select 1 from vehicles x where x.id <> v.id and x.deleted_at is null and x.merged_into_vehicle_id is null and vin_match_key(x.vin) = r.value_norm) then
      -- same VIN already on a different live vehicle: that is a duplicate-profile question, not a promotion
      if not p_dry then update vehicle_identifier_observations set status = 'conflict', updated_at = now(),
          evidence = evidence || jsonb_build_object('conflict', 'VIN already on another live vehicle (possible duplicate profile)') where id = r.oid; end if;
      conflicts := conflicts + 1; continue;
    end if;
    if nullif(btrim(coalesce(before_val,'')),'') is null then
      -- competing readings for the same vehicle/kind: promote only if no other eligible value disagrees
      if exists (select 1 from vehicle_identifier_observations o2
                 where o2.user_id = p_user and o2.kind = r.kind and o2.value_norm <> r.value_norm and o2.confidence >= p_min_obs_conf
                   and o2.status in ('candidate','conflict','promoted')
                   and exists (select 1 from capture_set_links a join capture_set_links b on b.set_key = a.set_key and b.vehicle_id = v.id and b.reverted_at is null
                                where a.image_id = o2.image_id and a.reverted_at is null)) then
        if not p_dry then update vehicle_identifier_observations set status = 'conflict', updated_at = now(),
            evidence = evidence || jsonb_build_object('conflict', 'competing '||r.kind||' readings on vehicle '||v.id) where id = r.oid; end if;
        conflicts := conflicts + 1; continue;
      end if;
      if not p_dry then
        if r.kind = 'vin' then update vehicles set vin = newval where id = v.id; else update vehicles set license_plate = newval where id = v.id; end if;
        insert into profile_fix_log (run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
        values (p_run, 'identifier_promote_v1', v.id, 'vehicles', v.id, col, 'update', to_jsonb(before_val), to_jsonb(newval),
                jsonb_build_object('observation_id', r.oid, 'image_id', r.image_id, 'obs_confidence', r.confidence, 'source', r.source, 'quote', r.quote));
        update vehicle_identifier_observations set status = 'promoted', promoted_vehicle_id = v.id, promoted_run_id = p_run, promoted_at = now(), updated_at = now() where id = r.oid;
      end if;
      promoted := promoted + 1;
      detail := detail || jsonb_build_array(jsonb_build_object('vehicle', v.id, 'kind', r.kind, 'value', newval, 'obs', r.oid));
    else
      if (r.kind = 'vin' and vin_match_key(before_val) = r.value_norm)
         or (r.kind = 'plate' and regexp_replace(upper(before_val),'[^A-Z0-9]','','g') = r.value_norm) then
        if not p_dry then update vehicle_identifier_observations set status = 'confirmed', promoted_vehicle_id = v.id, promoted_run_id = p_run, promoted_at = now(), updated_at = now() where id = r.oid; end if;
        confirmed := confirmed + 1;
      else
        if not p_dry then update vehicle_identifier_observations set status = 'conflict', updated_at = now(),
            evidence = evidence || jsonb_build_object('conflict', 'vehicle '||v.id||' already has '||col||' '||before_val) where id = r.oid; end if;
        conflicts := conflicts + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('run_id', p_run, 'dry', p_dry, 'promoted', promoted, 'confirmed', confirmed, 'conflicts', conflicts, 'skipped', skipped, 'promotions', detail);
end $function$;

create index if not exists csl_image on public.capture_set_links (image_id);
create index if not exists csl_set_key on public.capture_set_links (set_key) where reverted_at is null;
