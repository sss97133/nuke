-- Contract for supabase/migrations/20261113150000_photo_landing_supersession.sql and its revert
-- (supabase/sql/revert_20261113150000_photo_landing_supersession.sql): a newer classifier reading of a photo replaces
-- what the fold landed, the old rows are kept, angle observations are only ever appended, stale vehicle-level claims
-- are found at query time, and a failed landing can be run again.
-- Empty disposable PostgreSQL database only. Synthetic rows; no network, no model.
--
-- Stand-ins carry the PRODUCTION columns, defaults and unique keys read by the lead on 2026-11-10:
--   photo_extracted_fields UNIQUE (image_id, field_name, source); photo_text_lines UNIQUE (image_id, line_idx, source);
--   image_descriptions and image_angle_observations: no unique key besides the primary key, the three foreign keys of
--   image_angle_observations; photo_land_progress PRIMARY KEY (image_id).
-- Assumed, not read from production: the default of photo_land_progress.landed_at; the columns of field_evidence and
-- vehicle_identifiers (from their creating migrations; the kind CHECK is left out because production holds plate_*
-- kinds no migration in the repo adds); trigger a07's definition (given by the lead earlier; it is in no migration).
-- land_identifier_claims is a stand-in that takes the real writer's locks in the real order (photo row FOR UPDATE, then
-- vehicle row FOR UPDATE: 20261109200000 lines 62-63 and 74), refuses a moved or superseded photo, and binds the
-- photo's URL as the real one does. The three landing owners come from fixtures/photo_landing_supersession_owners.sql
-- and are checked against the production md5(prosrc).
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned
\set QUIET on
set client_min_messages = warning;
do $$ begin
  if current_database() not like 'dm_refinement_%' or to_regclass('public.vehicles') is not null then
    raise exception 'needs an empty disposable dm_refinement_* database';
  end if;
  if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
-- production default privileges: new tables, sequences and functions in public are open to the three API roles
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema t;
create table t.passed(seq serial primary key, msg text not null);
create function t.ok(cond boolean, msg text) returns text language plpgsql as $$
begin
  if cond is not true then raise exception 'CHECK FAILED: %', msg; end if;
  insert into t.passed(msg) values (msg);
  return 'ok  ' || msg;
end $$;

-- ------------------------------------------------------------------ stand-ins (production columns and keys)
create table vehicles(id uuid primary key, owner_id uuid, user_id uuid, vin text, license_plate text, deleted_at timestamptz);
create table vehicle_images(id uuid primary key, vehicle_id uuid, user_id uuid, vision_gate_status text, ai_scan_metadata jsonb default '{}',
  ai_processing_status text default 'pending', image_url text, is_superseded boolean default false, taken_at timestamptz default now() - interval '3 days',
  created_at timestamptz not null default now());
create table photo_extracted_fields(id uuid primary key default gen_random_uuid(), image_id uuid not null, user_id uuid, vehicle_id uuid,
  field_name text not null, value text not null, quote text, confidence numeric, source text not null, prompt_version text,
  meta jsonb not null default '{}', created_at timestamptz not null default now(),
  constraint photo_extracted_fields_key unique (image_id, field_name, source));
create table photo_text_lines(id uuid primary key default gen_random_uuid(), image_id uuid not null, user_id uuid, vehicle_id uuid,
  line_idx integer not null, text text not null, region jsonb, confidence numeric, source text not null, prompt_version text,
  created_at timestamptz not null default now(), constraint photo_text_lines_key unique (image_id, line_idx, source));
create table image_descriptions(id uuid primary key default gen_random_uuid(), image_id uuid not null, vehicle_id uuid, session_id uuid,
  description text not null, description_type text not null, context_ymm_key text, context_session_type text, context_neighbor_ids uuid[],
  source text not null, source_version text, confidence numeric, pass_number smallint, evidence jsonb, created_at timestamptz default now());
create index on image_descriptions(image_id);
create table angle_taxonomy(angle_id uuid primary key default gen_random_uuid(), canonical_key text unique, deprecated_at timestamptz);
insert into angle_taxonomy(canonical_key) values ('exterior.front.center'), ('exterior.rear.center'), ('engine.bay'), ('detail.general');
create table image_angle_observations(id uuid primary key default gen_random_uuid(),
  image_id uuid not null references vehicle_images(id) on delete cascade, vehicle_id uuid not null references vehicles(id) on delete cascade,
  angle_id uuid not null references angle_taxonomy(angle_id), confidence numeric, source text not null, source_version text, evidence jsonb,
  observed_at timestamptz not null default now());
create index on image_angle_observations(image_id, observed_at desc);
create table photo_land_progress(image_id uuid primary key, landed_at timestamptz not null default now(), result jsonb);
create table field_evidence(id uuid primary key default gen_random_uuid(), vehicle_id uuid not null, field_name text not null, proposed_value text not null,
  source_type text not null, source_confidence integer, extraction_context text, extracted_at timestamptz default now(),
  supporting_signals jsonb default '[]', contradicting_signals jsonb default '[]', status text default 'pending', assigned_at timestamptz, assigned_by text,
  raw_extraction_data jsonb, created_at timestamptz default now(), unique (vehicle_id, field_name, source_type, proposed_value));
create table vehicle_identifiers(id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references vehicles(id) on delete cascade,
  kind text not null, value text, value_norm text generated always as (upper(regexp_replace(coalesce(value, ''), '[\s\-/.]', '', 'g'))) stored,
  make_canonical text, coachbuilder text, source_kind text not null, source_url text, source_image_id uuid, quote text, extractor text, run_id uuid,
  confidence numeric not null check (confidence between 0 and 1), rule_id bigint, rule_status text not null default 'unchecked',
  observed_at timestamptz not null default now(), superseded_at timestamptz, evidence_class text);
create unique index vehicle_identifiers_claim_uniq on vehicle_identifiers (vehicle_id, kind, value_norm, source_kind, coalesce(source_url, ''));
create table image_camera_position(image_id uuid, vehicle_id uuid, subject_key text, azimuth_deg numeric, elevation_deg numeric, distance_mm numeric,
  confidence numeric, source text, source_version text, evidence jsonb, unique (image_id, subject_key, source, source_version));

-- what the HEAD reader identifier_observations_ingest (20261109000100) needs besides the landed tables
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table capture_set_links(id uuid primary key default gen_random_uuid(), run_id uuid, set_key text, image_id uuid, vehicle_id uuid, confidence numeric, reverted_at timestamptz);
create table profile_fix_log(id bigserial primary key, run_id uuid, rule text, vehicle_id uuid, target_table text, target_pk uuid, column_name text, op text, before jsonb, after jsonb, evidence jsonb);

-- stand-in for the one reader whose catalog comment the migration extends (its body is not under test here)
create function public.assay_photo_reading_flow(p_raise boolean default true) returns jsonb language sql as $$ select '{}'::jsonb $$;
comment on function public.assay_photo_reading_flow(boolean) is 'Reading of whether user-owned photos are being read: first readings by prompt version.';

-- The identifier writer: the real one's locks, in the real order, and its source checks (20261109200000 lines 61-75).
-- It can be made to fail.
create function land_identifier_claims(p_vehicle_id uuid, p_read jsonb, p_source_url text, p_extractor text,
  p_source_kind text default 'listing_text', p_source_image_id uuid default null, p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare image_row record; v record; c jsonb; n int; identifiers_written int := 0;
begin
  if current_setting('fixture.fail_identifiers', true) = 'on' then raise exception 'fixture: identifier writer unavailable'; end if;
  if p_source_kind = 'photo' then
    select id, vehicle_id, image_url, is_superseded into image_row from vehicle_images where id = p_source_image_id for update;
    if image_row.id is null or image_row.vehicle_id is distinct from p_vehicle_id or image_row.is_superseded is true
       or (p_source_url is not null and image_row.image_url is distinct from p_source_url) then
      return jsonb_build_object('status', 'source_image_changed');
    end if;
    p_source_url := image_row.image_url;
  end if;
  select id from vehicles where id = p_vehicle_id for update into v;
  if v.id is null then return jsonb_build_object('status', 'no_vehicle'); end if;
  for c in select * from jsonb_array_elements(coalesce(p_read->'identifiers', '[]')) loop
    insert into vehicle_identifiers(vehicle_id, kind, value, source_kind, source_url, source_image_id, quote, extractor, run_id, confidence)
    values (p_vehicle_id, c->>'kind', c->>'value', p_source_kind, p_source_url, p_source_image_id, left(c->>'quote', 400), p_extractor, p_run_id,
            least(1, greatest(0, (c->>'confidence')::numeric)))
    on conflict do nothing;
    get diagnostics n = row_count; identifiers_written := identifiers_written + n;
  end loop;
  return jsonb_build_object('status', 'ok', 'field_evidence', 0, 'identifiers', identifiers_written);
end $$;
-- a landed table that can be made to fail, or to wait at a gate, in the middle of a landing
create function t.text_line_hook() returns trigger language plpgsql as $$
begin
  if current_setting('fixture.fail_text_lines', true) = 'on' then raise exception 'fixture: photo_text_lines unavailable'; end if;
  if current_setting('fixture.gate_text_lines', true) = 'on' then perform pg_advisory_xact_lock(777); end if;
  return coalesce(new, old);
end $$;
create trigger fixture_text_line_hook before insert or update or delete on photo_text_lines for each row execute function t.text_line_hook();

-- the repo's captured helpers, the three live owners, then the migration that followed them and a HEAD reader
\ir fixtures/photo_field_source_role_owners.sql
\ir fixtures/photo_landing_supersession_owners.sql
\ir ../migrations/20261109223000_photo_field_source_roles.sql
\ir ../migrations/20261109000100_vehicle_identifier_observations.sql
create function t.md5s() returns text language sql as $$
  select (select md5(prosrc) from pg_proc where oid = 'public.photo_land_classification(uuid,boolean)'::regprocedure) || ' '
      || (select md5(prosrc) from pg_proc where oid = 'public.photo_land_classification(uuid)'::regprocedure) || ' '
      || (select md5(prosrc) from pg_proc where oid = 'public.photo_land_trigger()'::regprocedure) $$;
\set live_md5s '7c95e1ac5d5832ca68b4690b92f365f0 6c8b7cddc606cca4dfeb557d7e6f5c1c 307261071b2aa3fef7a83297d63a9638'
select t.ok(t.md5s() = :'live_md5s', '00 the three owners loaded from the fixture have the md5(prosrc) production had on 2026-11-10');
-- a comment the fold carried before the migration (production''s was not read): the revert must put it back exactly
comment on function public.photo_land_classification(uuid, boolean) is 'fixture: the comment the fold carried before';

-- the two triggers on vehicle_images that call the fold
create trigger a06_trg_land_classification after update of ai_processing_status, ai_scan_metadata on vehicle_images for each row
  when (new.ai_processing_status = 'completed' and new.ai_scan_metadata ? 'classification' and (old.ai_processing_status is distinct from 'completed'
    or (old.ai_scan_metadata -> 'classification') is distinct from (new.ai_scan_metadata -> 'classification')
    or (old.ai_scan_metadata -> 'byok_deep_analysis') is distinct from (new.ai_scan_metadata -> 'byok_deep_analysis')))
  execute function photo_land_trigger();
create trigger a07_trg_land_on_filing after update of vehicle_id, vision_gate_status on vehicle_images for each row
  when (new.ai_processing_status = 'completed' and new.vehicle_id is not null and new.ai_scan_metadata ? 'classification'
    and (old.vehicle_id is null or old.vision_gate_status is distinct from new.vision_gate_status))
  execute function photo_land_trigger();

-- ------------------------------------------------------------------ readings
create table t.r(name text primary key, j jsonb);
insert into t.r values
('legacy_plain', '{"image_type":"other","is_automotive":false,"confidence":0.283,"description":"Legacy read of an object."}'),
('legacy_rich', '{"image_type":"document","is_automotive":true,"confidence":0.61,"description":"Legacy rich read of a build sheet.",
  "v2":{"document_type":"build_sheet","vehicle_fields":[
     {"field_name":"color","value":"Red","evidence":"visible red body paint","confidence":0.9},
     {"field_name":"trim","value":"GT","evidence":"build sheet lists trim GT","confidence":0.8},
     {"field_name":"mileage","value":"42000","evidence":"odometer reads 42000","confidence":0.7}],
   "text_lines":[{"text":"GT","confidence":0.8},{"text":"42000 MI","confidence":0.7},{"text":"DEALER TAG","confidence":0.6}],
   "angle":{"value":"exterior_front","confidence":0.5}}}'),
('v98n', '{"image_type":"vehicle_exterior","is_automotive":true,"confidence":0.93,"description":"Side of a maroon coupe.",
  "classifier_receipt":{"model":"provider-model","prompt_version":"v98"},
  "v2":{"prompt_version":"v98","vehicle_fields":[
     {"field_name":"color","value":"Maroon","evidence":"visible maroon body paint","confidence":0.88},
     {"field_name":"mileage","value":"42000","evidence":"odometer reads 42000","confidence":0.7},
     {"field_name":"body_style","value":"Coupe","evidence":"visible two-door coupe body shape","confidence":0.9}],
   "text_lines":[{"text":"GT SPORT","confidence":0.9},{"text":"42000 MI","confidence":0.7}],
   "angle":{"value":"exterior_rear","confidence":0.8}}}'),
('v98a', '{"image_type":"vehicle_exterior","is_automotive":true,"confidence":0.93,"description":"Front of a red coupe with its plate visible.",
  "classifier_receipt":{"model":"provider-model","prompt_version":"v98"},
  "v2":{"prompt_version":"v98","vehicle_fields":[
     {"field_name":"color","value":"Red","evidence":"visible red body paint","confidence":0.9},
     {"field_name":"license_plate","value":"ABC1234","evidence":"front registration reads ABC1234","confidence":0.92},
     {"field_name":"body_code","value":"65A","evidence":"plate text ''65A'' under body","confidence":0.95},
     {"field_name":"paint_code","value":"M","evidence":"plate text ''M'' under color","confidence":0.9}],
   "text_lines":[{"text":"ABC1234","confidence":0.9,"region":{"x":0.1,"y":0.2}},{"text":"1FTFW1E50NFA00001","confidence":0.8}],
   "vin":{"value":"1FTFW1E50NFA00001","evidence":"VIN decal","confidence":0.85,"checksum_ok":true},
   "angle":{"value":"exterior_front","confidence":0.9}}}'),
('v98b', '{"image_type":"engine_bay","is_automotive":true,"confidence":0.88,"description":"Engine bay of a maroon coupe.",
  "classifier_receipt":{"model":"reader:subscription","prompt_version":"v98"},
  "v2":{"prompt_version":"v98","vehicle_fields":[
     {"field_name":"color","value":"Maroon","evidence":"visible maroon body paint","confidence":0.8},
     {"field_name":"license_plate","value":"ABC1284","evidence":"front registration reads ABC1284","confidence":0.7},
     {"field_name":"body_code","value":"65A","evidence":"plate text ''65A'' under body","confidence":0.9}],
   "text_lines":[{"text":"ABC1284","confidence":0.7}],
   "vin":{"value":"1FTFW1E50NFA00009","evidence":"VIN decal","confidence":0.6,"checksum_ok":false},
   "angle":{"value":"engine_bay","confidence":0.95}}}'),
('v98c', '{"image_type":"vehicle_exterior","is_automotive":true,"confidence":0.7,"description":"",
  "classifier_receipt":{"model":"provider-model","prompt_version":"v98"},
  "v2":{"prompt_version":"v98","vehicle_fields":[{"field_name":"color","value":"Maroon","evidence":"visible maroon body paint","confidence":0.8}],
   "text_lines":[],"angle":{"value":"exterior_three_quarter","confidence":0.9}}}'),
('v98d', '{"image_type":"detail_closeup","is_automotive":true,"confidence":0.8,"description":"Close view of a maroon fender.",
  "classifier_receipt":{"model":"provider-model","prompt_version":"v98"},
  "v2":{"prompt_version":"v98","vehicle_fields":[{"field_name":"color","value":"Maroon","evidence":"visible maroon body paint","confidence":0.8}],
   "text_lines":[{"text":"FENDER","confidence":0.5}],"angle":{"value":"detail_shot","confidence":0.6}}}'),
('standin', '{"image_type":"other","confidence":0.2,"is_automotive":true,"description":"Unclassified - classifier unavailable; retained for review",
  "classifier_ok":false,"classifier_receipt":{"model":null,"error_class":"classifier_rate_limited"}}'),
('bad', '{"image_type":"vehicle_exterior","confidence":"high","description":"A confidence that is not a number."}'),
('bad2', '{"image_type":"vehicle_exterior","confidence":"very high","description":"Another confidence that is not a number."}');
-- the same content as v98a from another reader: a different reading that makes the same claims
insert into t.r select 'v98a_r2', jsonb_set(j, '{classifier_receipt,model}', '"reader:subscription"') from t.r where name = 'v98a';
create function t.cls(p_name text) returns jsonb language sql as $$ select jsonb_build_object('classification', (select j from t.r where name = p_name)) $$;
create function t.put(p_image uuid, p_name text) returns void language sql as $$
  update vehicle_images set ai_processing_status = 'completed', ai_scan_metadata = coalesce(ai_scan_metadata, '{}'::jsonb) || t.cls(p_name) where id = p_image $$;

-- digests and readers of the state (some helpers name objects the migration creates later, so their bodies are not
-- checked at creation)
set check_function_bodies = off;
create function t.rid(p_name text) returns text language sql as $$ select public.photo_classifier_reading_id((select j from t.r where name = p_name)) $$;
create function t.landed(p_image uuid) returns text language sql as $$
  select md5(coalesce(string_agg(x, E'\n' order by x), '')) from (
    select 'f ' || to_jsonb(f)::text x from photo_extracted_fields f where f.image_id = p_image
    union all select 'l ' || to_jsonb(l)::text from photo_text_lines l where l.image_id = p_image
    union all select 'd ' || to_jsonb(d)::text from image_descriptions d where d.image_id = p_image
    union all select 'a ' || to_jsonb(a)::text from image_angle_observations a where a.image_id = p_image) q $$;
create function t.world() returns text language sql as $$
  select md5(coalesce(string_agg(x, E'\n' order by x), '')) from (
    select 'f ' || to_jsonb(f)::text x from photo_extracted_fields f
    union all select 'l ' || to_jsonb(l)::text from photo_text_lines l
    union all select 'd ' || to_jsonb(d)::text from image_descriptions d
    union all select 'a ' || to_jsonb(a)::text from image_angle_observations a
    union all select 'e ' || to_jsonb(e)::text from field_evidence e
    union all select 'i ' || to_jsonb(i)::text from vehicle_identifiers i
    union all select 'c ' || to_jsonb(c)::text from image_camera_position c
    union all select 'g ' || to_jsonb(g)::text from public.photo_classifier_landings g
    union all select 'h ' || to_jsonb(h)::text from public.photo_land_superseded_rows h) q $$;
-- every angle row of an image, whole: the fold may add to this set and must never change or remove a member
create function t.angles(p_image uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb) from image_angle_observations a where a.image_id = p_image $$;
-- what a reader that takes the newest classifier_v2 row sees (the resolveAngle.ts change, as SQL)
create function t.newest_angle(p_image uuid) returns text language sql as $$
  select t2.canonical_key from image_angle_observations o join angle_taxonomy t2 using (angle_id)
   where o.image_id = p_image and o.source = 'classifier_v2' order by o.observed_at desc, o.id desc limit 1 $$;
create function t.angle_keys(p_image uuid) returns text language sql as $$
  select coalesce(string_agg(t2.canonical_key || '/' || coalesce(o.source_version, '?'), ' ' order by o.observed_at, t2.canonical_key), '')
    from image_angle_observations o join angle_taxonomy t2 using (angle_id) where o.image_id = p_image and o.source = 'classifier_v2' $$;
-- snapshots of the rows of the three projection tables taken before a supersession, to prove the before-images are
-- complete and exact
create table t.snap(tag text, source_table text, row_id uuid, row_data jsonb);
create function t.snapshot(p_tag text, p_image uuid) returns void language sql as $$
  insert into t.snap
  select p_tag, 'photo_extracted_fields', f.id, to_jsonb(f) from photo_extracted_fields f where f.image_id = p_image and f.source = 'classifier_v2'
  union all select p_tag, 'photo_text_lines', l.id, to_jsonb(l) from photo_text_lines l where l.image_id = p_image and l.source = 'classifier_v2'
  union all select p_tag, 'image_descriptions', d.id, to_jsonb(d) from image_descriptions d where d.image_id = p_image and d.description_type = 'classifier_v2' $$;
-- true when the before-images of one supersession are exactly the snapshot: nothing missing, nothing extra, nothing altered
create function t.kept(p_tag text, p_by bigint) returns boolean language sql as $$
  select (select count(*) from t.snap where tag = p_tag) > 0
     and not exists ((select source_table, row_id, row_data from t.snap where tag = p_tag)
                     except
                     (select source_table, row_id, row_data from public.photo_land_superseded_rows
                       where superseded_by_landing_id = p_by and disposition in ('replaced', 'removed')))
     and not exists ((select source_table, row_id, row_data from public.photo_land_superseded_rows
                       where superseded_by_landing_id = p_by and disposition in ('replaced', 'removed'))
                     except
                     (select source_table, row_id, row_data from t.snap where tag = p_tag)) $$;
create function t.current_landing(p_image uuid) returns bigint language sql as $$
  select id from public.photo_classifier_landings where image_id = p_image and superseded_at is null $$;
create function t.result(p_image uuid) returns jsonb language sql as $$ select result from photo_land_progress where image_id = p_image $$;
create function t.fields(p_image uuid) returns text language sql as $$
  select coalesce(string_agg(field_name || '=' || value || '/' || coalesce(prompt_version, '?'), ' ' order by field_name), '')
    from photo_extracted_fields where image_id = p_image and source = 'classifier_v2' $$;
create function t.lines(p_image uuid) returns text language sql as $$
  select coalesce(string_agg(line_idx || ':' || text || '/' || coalesce(prompt_version, '?'), ' ' order by line_idx), '')
    from photo_text_lines where image_id = p_image and source = 'classifier_v2' $$;
-- what the current landing row of an image says its reading asserts
create function t.claims(p_image uuid) returns text language sql as $$
  select coalesce(right(g.claims_vehicle_id::text, 3), 'no vehicle')
      || ' fe[' || coalesce((select string_agg(fe.field_name || '=' || fe.proposed_value, ' ' order by fe.field_name, fe.proposed_value)
                               from field_evidence fe where fe.id = any (g.claimed_field_evidence)), '') || ']'
      || ' id[' || coalesce((select string_agg((e->>'kind') || '=' || (e->>'value'), ' ' order by e->>'kind', e->>'value')
                               from jsonb_array_elements(g.claimed_identifiers) e), '') || ']'
      || ' vin[' || coalesce(g.claimed_vin, '') || ']'
    from public.photo_classifier_landings g where g.image_id = p_image and g.superseded_at is null $$;
-- the claims of superseded readings that nothing asserts any more, as photo_land_outstanding() lists them
create function t.outstanding(p_image uuid) returns text language sql as $$
  select coalesce(string_agg(o.claim_table || ':' || o.name || '=' || o.value, ' ' order by o.claim_table, o.name, o.value), '(none)')
    from public.photo_land_outstanding(null, p_image, 1000) o $$;
reset check_function_bodies;

\set U  '''40000000-0000-4000-8000-000000000001'''
\set V1 '''20000000-0000-4000-8000-000000000001'''
\set V2 '''20000000-0000-4000-8000-000000000002'''
\set V3 '''20000000-0000-4000-8000-000000000003'''
\set V4 '''20000000-0000-4000-8000-000000000004'''
\set V5 '''20000000-0000-4000-8000-000000000005'''
\set V6 '''20000000-0000-4000-8000-000000000006'''
\set V7 '''20000000-0000-4000-8000-000000000007'''
\set V8 '''20000000-0000-4000-8000-000000000008'''
\set V9 '''20000000-0000-4000-8000-000000000009'''
\set V10 '''20000000-0000-4000-8000-00000000000a'''
\set V11 '''20000000-0000-4000-8000-00000000000b'''
\set V12 '''20000000-0000-4000-8000-00000000000c'''
\set V13 '''20000000-0000-4000-8000-00000000000d'''
\set A1 '''10000000-0000-4000-8000-0000000000a1'''
\set A2 '''10000000-0000-4000-8000-0000000000a2'''
\set A3 '''10000000-0000-4000-8000-0000000000a3'''
\set A4 '''10000000-0000-4000-8000-0000000000a4'''
\set B1 '''10000000-0000-4000-8000-0000000000b1'''
\set B2 '''10000000-0000-4000-8000-0000000000b2'''
\set C1 '''10000000-0000-4000-8000-0000000000c1'''
\set D1 '''10000000-0000-4000-8000-0000000000d1'''
\set E1 '''10000000-0000-4000-8000-0000000000e1'''
\set E2 '''10000000-0000-4000-8000-0000000000e2'''
\set F1 '''10000000-0000-4000-8000-0000000000f1'''
\set G1 '''10000000-0000-4000-8000-0000000000aa'''
\set H1 '''10000000-0000-4000-8000-0000000000ab'''
\set K1 '''10000000-0000-4000-8000-0000000000ac'''
\set L1 '''10000000-0000-4000-8000-0000000000ad'''
insert into vehicles(id) values (:V1), (:V2), (:V3), (:V4), (:V5), (:V6), (:V7), (:V8), (:V9), (:V10), (:V11), (:V12), (:V13);
insert into vehicle_images(id, vehicle_id, user_id, vision_gate_status, image_url) values
  (:A1, :V2, :U, 'approved', 'https://example.invalid/a1.jpg'),
  (:A2, :V3, :U, 'approved', 'https://example.invalid/a2.jpg'),
  (:A3, :V4, :U, 'approved', 'https://example.invalid/a3.jpg'),
  (:A4, null, :U, null,      'https://example.invalid/a4.jpg'),
  (:B1, :V1, :U, null,       'https://example.invalid/b1.jpg'),
  (:B2, :V1, :U, 'approved', 'https://example.invalid/b2.jpg'),
  (:C1, :V5, :U, 'approved', 'https://example.invalid/c1.jpg'),
  (:D1, null, :U, null,      'https://example.invalid/d1.jpg'),
  (:E1, :V8, :U, 'approved', 'https://example.invalid/e1.jpg'),
  (:E2, :V12, :U, 'approved', 'https://example.invalid/e2.jpg'),
  (:F1, :V7, :U, 'approved', 'https://example.invalid/f1.jpg'),
  (:G1, :V9, :U, 'approved', 'https://example.invalid/g1.jpg'),
  (:H1, :V10, :U, 'approved', 'https://example.invalid/h1.jpg'),
  (:K1, :V11, :U, 'approved', 'https://example.invalid/k1.jpg'),
  (:L1, :V13, :U, 'approved', 'https://example.invalid/l1.jpg');

\echo '== 01 before the change: four images landed by the LIVE fold (rows with no stored reading identity)'
select t.put(:A1, 'v98a') \gset _
select t.put(:A2, 'legacy_plain') \gset _
select t.put(:A2, 'v98a') \gset _
select t.put(:A3, 'legacy_plain') \gset _
select t.put(:A4, 'legacy_plain') \gset _
-- as an older body that rounded to two decimals would have stored it
update photo_extracted_fields set confidence = round(confidence, 2) where image_id = :A4;
update image_descriptions set confidence = round(confidence, 2) where image_id = :A4;
select t.ok(
  (select value || '/' || prompt_version from photo_extracted_fields where image_id = :A2 and field_name = 'core.image_type') = 'other/legacy'
  and (select value || '/' || prompt_version from photo_extracted_fields where image_id = :A2 and field_name = 'color') = 'Red/v98'
  and (select description || '/' || source_version from image_descriptions where image_id = :A2 and description_type = 'classifier_v2') = 'Legacy read of an object./legacy'
  and t.angle_keys(:A2) = 'exterior.front.center/v98',
  '01 the live fold under production keys leaves a stale mix after a re-read (core.* and the description stay legacy beside v98 fields and a v98 angle)');
select t.snapshot('A2 pre-ledger', :A2) \gset _
select t.snapshot('A3 pre-ledger', :A3) \gset _
create table t.keep as select 'A1 landed' k, t.landed(:A1) v;
insert into t.keep select 'A4 landed', t.landed(:A4);
create table t.keep_angles as select 'A2 before' k, t.angles(:A2) v;

\echo '== 02 the guard refuses a drifted owner, a different unique key and a foreign key onto a landed table, and changes nothing'
create or replace function public.photo_land_trigger() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  -- drifted by hand
  perform public.photo_land_classification(new.id, true);
  return null;
end;
$function$;
\set ON_ERROR_STOP off
\ir ../migrations/20261113150000_photo_landing_supersession.sql
\set ON_ERROR_STOP on
select t.ok(to_regclass('public.photo_classifier_landings') is null and to_regclass('public.photo_land_superseded_rows') is null
  and to_regclass('public.photo_land_failures') is null and split_part(t.md5s(), ' ', 1) = '7c95e1ac5d5832ca68b4690b92f365f0',
  '02a a drifted photo_land_trigger() body: the migration is refused; no table created, fold body untouched');
\ir fixtures/photo_landing_supersession_owners.sql
select t.ok(t.md5s() = :'live_md5s', '02b live owners put back for the rest of the contract');
alter table photo_text_lines drop constraint photo_text_lines_key, add constraint photo_text_lines_key_v unique (image_id, line_idx, source, prompt_version);
\set ON_ERROR_STOP off
\ir ../migrations/20261113150000_photo_landing_supersession.sql
\set ON_ERROR_STOP on
select t.ok(to_regclass('public.photo_classifier_landings') is null and t.md5s() = :'live_md5s',
  '02c photo_text_lines keyed with prompt_version (the old test stand-in key): the migration is refused');
alter table photo_text_lines drop constraint photo_text_lines_key_v, add constraint photo_text_lines_key unique (image_id, line_idx, source);
-- must-fix 2: a foreign key onto a landed table (none exists in production today)
create table t.fk_child(field_id uuid references public.photo_extracted_fields(id) on delete cascade);
\set ON_ERROR_STOP off
\ir ../migrations/20261113150000_photo_landing_supersession.sql
\set ON_ERROR_STOP on
select t.ok(to_regclass('public.photo_classifier_landings') is null and to_regclass('public.photo_land_failures') is null and t.md5s() = :'live_md5s',
  '02d a foreign key references photo_extracted_fields: the migration is refused; no table created, no body replaced');
drop table t.fk_child;
create table t.fk_child(angle_obs_id uuid references public.image_angle_observations(id));
\set ON_ERROR_STOP off
\ir ../migrations/20261113150000_photo_landing_supersession.sql
\set ON_ERROR_STOP on
select t.ok(to_regclass('public.photo_classifier_landings') is null and t.md5s() = :'live_md5s',
  '02e a foreign key references image_angle_observations: refused as well (all four landed tables are guarded)');
drop table t.fk_child;

\echo '== 03 apply; objects, RLS and grants'
\ir ../migrations/20261113150000_photo_landing_supersession.sql
select t.ok(split_part(t.md5s(), ' ', 1) <> '7c95e1ac5d5832ca68b4690b92f365f0'
  and split_part(t.md5s(), ' ', 2) = '6c8b7cddc606cca4dfeb557d7e6f5c1c' and split_part(t.md5s(), ' ', 3) <> '307261071b2aa3fef7a83297d63a9638',
  '03a the fold and photo_land_trigger() are replaced; the one-argument wrapper is the live one, untouched');
create table t.this_md5 as select t.md5s() v;
select t.ok((select bool_and(c.relrowsecurity) and count(*) = 3 from pg_class c
              where c.oid in ('public.photo_classifier_landings'::regclass, 'public.photo_land_superseded_rows'::regclass, 'public.photo_land_failures'::regclass)),
  '03b row level security is on for the three new tables');
select t.ok(not exists (
    select 1 from unnest(array['public.photo_classifier_landings', 'public.photo_land_superseded_rows', 'public.photo_land_failures']) tb,
                  unnest(array['anon', 'authenticated', 'public']) ro, unnest(array['select', 'insert', 'update', 'delete', 'truncate']) pr
     where has_table_privilege(ro, tb, pr))
  and not exists (
    select 1 from unnest(array['public.photo_classifier_landings', 'public.photo_land_superseded_rows', 'public.photo_land_failures']) tb,
                  unnest(array['insert', 'update', 'delete', 'truncate']) pr where has_table_privilege('service_role', tb, pr))
  and (select bool_and(has_table_privilege('service_role', tb, 'select'))
         from unnest(array['public.photo_classifier_landings', 'public.photo_land_superseded_rows', 'public.photo_land_failures']) tb)
  and not exists (
    select 1 from unnest(array['public.photo_classifier_landings_id_seq', 'public.photo_land_superseded_rows_id_seq', 'public.photo_land_failures_id_seq']) sq,
                  unnest(array['anon', 'authenticated', 'service_role']) ro where has_sequence_privilege(ro, sq, 'usage')),
  '03c public, anon and authenticated hold nothing on the new tables; service_role holds SELECT only; no API role holds the sequences');
select t.ok(not has_function_privilege('anon', 'public.photo_land_classification(uuid,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.photo_land_classification(uuid,boolean)', 'execute')
  and has_function_privilege('service_role', 'public.photo_land_classification(uuid,boolean)', 'execute')
  and not exists (select 1 from unnest(array['anon', 'authenticated', 'public']) ro,
                    unnest(array['public.photo_classifier_reading_id(jsonb)', 'public.photo_land_retry_failures(integer,integer)',
                                 'public.photo_land_outstanding(uuid,uuid,integer)',
                                 'public.photo_land_note_failure(uuid,text,text,text,text,text,text,boolean)', 'public.photo_land_history_guard()']) fn
                   where has_function_privilege(ro, fn, 'execute'))
  and has_function_privilege('service_role', 'public.photo_classifier_reading_id(jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.photo_land_retry_failures(integer,integer)', 'execute')
  and has_function_privilege('service_role', 'public.photo_land_outstanding(uuid,uuid,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.photo_land_note_failure(uuid,text,text,text,text,text,text,boolean)', 'execute')
  and not has_function_privilege('service_role', 'public.photo_land_history_guard()', 'execute'),
  '03d the fold, the reading identity, the retry and the outstanding-claims reader are service-role only; the two internal helpers are callable by no API role');
select t.ok((select c like 'fixture: the comment the fold carried before [photo landing supersession 20261113150000] Lands the classifier reading%'
               from (select obj_description('public.photo_land_classification(uuid,boolean)'::regprocedure, 'pg_proc') c) q),
  '03e the fold''s catalog comment keeps what was there and says what the fold does now');
select t.ok(public.photo_classifier_reading_id(null) is null and public.photo_classifier_reading_id('"x"') is null
  and public.photo_classifier_reading_id('{"description":"no image type"}') is null
  and t.rid('v98a') ~ '^[0-9a-f]{32}$' and t.rid('v98a') <> t.rid('v98a_r2') and t.rid('v98a') <> t.rid('v98b')
  and public.photo_classifier_reading_id((select j || '{"vehicle_hints":{"make":"Ford"},"classifier_ok":true}' from t.r where name = 'v98a')) = t.rid('v98a')
  and public.photo_classifier_reading_id((select jsonb_set(j, '{classifier_receipt,attempts}', '2') from t.r where name = 'v98a')) = t.rid('v98a')
  and (select provolatile = 's' from pg_proc where oid = 'public.photo_classifier_reading_id(jsonb)'::regprocedure),
  '03f must-fix 3: the reading identity is a stable SQL function of the classification: NULL for what the fold does not land, another reader is another reading, hints and receipt counters are outside it');

\echo '== 04 full revert while no before-image exists, then apply again; then a replay on top'
\ir revert_20261113150000_photo_landing_supersession.sql
select t.ok(t.md5s() = :'live_md5s' and to_regclass('public.photo_classifier_landings') is null and to_regclass('public.photo_land_superseded_rows') is null
  and to_regclass('public.photo_land_failures') is null and to_regprocedure('public.photo_land_note_failure(uuid,text,text,text,text,text,text,boolean)') is null
  and to_regprocedure('public.photo_land_history_guard()') is null and to_regprocedure('public.photo_classifier_reading_id(jsonb)') is null
  and to_regprocedure('public.photo_land_retry_failures(integer,integer)') is null and to_regprocedure('public.photo_land_outstanding(uuid,uuid,integer)') is null,
  '04a revert: the three previous bodies byte for byte, and every added object gone');
select t.ok(obj_description('public.photo_land_classification(uuid,boolean)'::regprocedure, 'pg_proc') = 'fixture: the comment the fold carried before'
  and obj_description('public.assay_photo_reading_flow(boolean)'::regprocedure, 'pg_proc') = 'Reading of whether user-owned photos are being read: first readings by prompt version.',
  '04b must-fix 6: revert puts the fold''s catalog comment, and the reader comment, back exactly as they were');
\ir ../migrations/20261113150000_photo_landing_supersession.sql
\ir ../migrations/20261113150000_photo_landing_supersession.sql
select t.ok(t.md5s() = (select v from t.this_md5) and (select count(*) from public.photo_classifier_landings) = 0,
  '04c applied again after the revert, then replayed on top of itself: both accepted, same bodies');
select t.ok((select c like 'Reading of whether user-owned photos are being read: first readings by prompt version. [photo landing supersession]%CURRENT reading%'
                and length(c) - length(replace(c, '[photo landing supersession]', '')) = length('[photo landing supersession]')
               from (select obj_description('public.assay_photo_reading_flow(boolean)'::regprocedure, 'pg_proc') c) q)
  and (select c like 'fixture: the comment the fold carried before [photo landing supersession 20261113150000] %'
                and length(c) - length(replace(c, '[photo landing supersession 20261113150000]', '')) = length('[photo landing supersession 20261113150000]')
               from (select obj_description('public.photo_land_classification(uuid,boolean)'::regprocedure, 'pg_proc') c) q),
  '04d the reader comment says its first_* keys now count the current reading; both comments are extended once, not again on replay');

\echo '== 05 rows landed before the change, on their first run afterwards'
select public.photo_land_classification(:A1) \gset a1_
select t.ok((:'a1_photo_land_classification')::jsonb->>'landing' = 'adopted'
  and t.landed(:A1) = (select v from t.keep where k = 'A1 landed')
  and (select count(*) from public.photo_classifier_landings where image_id = :A1) = 1
  and (select basis = 'adopted' and reading_id = t.rid('v98a') and superseded_at is null and supersedes is null and prompt_version = 'v98' and reader = 'provider-model'
         from public.photo_classifier_landings where image_id = :A1)
  and not exists (select 1 from public.photo_land_superseded_rows where image_id = :A1),
  '05a landed rows that equal what the current reading lands are adopted: identity recorded, no row rewritten (the angle row included), nothing superseded');
select t.ok(t.claims(:A1) = '002 fe[color=Red license_plate=ABC1234] id[plate_body_code=65A plate_paint_code=M] vin[1FTFW1E50NFA00001]',
  '05a2 must-fix 4: the adopted landing row carries what its reading asserts for the vehicle: the two proposals that were already there, the two plate codes, the VIN');
select public.photo_land_classification(:A1) \gset a1_
select t.ok((:'a1_photo_land_classification')::jsonb->>'landing' = 'unchanged' and (select count(*) from public.photo_classifier_landings where image_id = :A1) = 1
  and t.landed(:A1) = (select v from t.keep where k = 'A1 landed'),
  '05b the next run for that image sees the same reading');

select public.photo_land_classification(:A2) \gset a2_
select t.ok((:'a2_photo_land_classification')::jsonb->>'landing' = 'superseded'
  and t.fields(:A2) = 'body_code=65A/v98 color=Red/v98 core.classifier_confidence=0.93/v98 core.description=Front of a red coupe with its plate visible./v98 core.image_type=vehicle_exterior/v98 core.is_automotive=true/v98 license_plate=ABC1234/v98 paint_code=M/v98 vin=1FTFW1E50NFA00001/v98'
  and t.lines(:A2) = '0:ABC1234/v98 1:1FTFW1E50NFA00001/v98'
  and (select count(*) = 1 and min(description) = 'Front of a red coupe with its plate visible.' and min(source_version) = 'v98'
         from image_descriptions where image_id = :A2 and description_type = 'classifier_v2'),
  '05c the stale mix (legacy core.* beside v98 fields) is not this reading: it is superseded and the image holds the v98 reading only');
select t.ok((select count(*) = 2 from public.photo_classifier_landings where image_id = :A2)
  and (select basis = 'pre_ledger' and reading_id is null and prompt_version = 'legacy,v98' and superseded_at is not null
         from public.photo_classifier_landings where image_id = :A2 and supersedes is null)
  and (select basis = 'landed' and superseded_at is null and supersedes = (select id from public.photo_classifier_landings where image_id = :A2 and basis = 'pre_ledger')
         from public.photo_classifier_landings where id = t.current_landing(:A2))
  and t.kept('A2 pre-ledger', t.current_landing(:A2))
  and (select bool_and(prior_reading is null and superseding_reading = t.rid('v98a')) from public.photo_land_superseded_rows where image_id = :A2),
  '05d the rows found are recorded as one reading of unknown identity (pre_ledger, versions legacy,v98) and every one of them is kept whole');
select t.ok(t.angles(:A2) = (select v from t.keep_angles where k = 'A2 before') and ((:'a2_photo_land_classification')::jsonb->>'angles')::int = 0,
  '05e must-fix 5: the angle row the live fold had landed from this very reading is left exactly as it was, and no second row is added for it');
select t.ok((select count(*) = 2 and bool_and(disposition = 'claim') from public.photo_land_superseded_rows where image_id = :A2 and source_table = 'field_evidence')
  and (select count(*) = 2 and bool_and(disposition = 'claim') from public.photo_land_superseded_rows where image_id = :A2 and source_table = 'vehicle_identifiers')
  and t.outstanding(:A2) = '(none)',
  '05f the claims that mix had made (Red, ABC1234, plate codes 65A and M) are copied as claims; none is outstanding, because the v98 reading asserts all four');

select t.put(:A3, 'v98a') \gset _
select t.ok(t.result(:A3)->>'landing' = 'superseded'
  and t.fields(:A3) = t.fields(:A2) and t.lines(:A3) = '0:ABC1234/v98 1:1FTFW1E50NFA00001/v98'
  and not exists (select 1 from photo_extracted_fields where image_id = :A3 and (prompt_version = 'legacy' or value in ('other', 'false')))
  and t.kept('A3 pre-ledger', t.current_landing(:A3))
  and (select count(*) = 4 and bool_and(disposition = 'replaced') from public.photo_land_superseded_rows where image_id = :A3 and source_table = 'photo_extracted_fields')
  and (select count(*) = 1 and bool_and(disposition = 'replaced') from public.photo_land_superseded_rows where image_id = :A3 and source_table = 'image_descriptions')
  and t.angle_keys(:A3) = 'exterior.front.center/v98'
  and (select evidence->>'reading_id' = t.rid('v98a') from image_angle_observations where image_id = :A3),
  '05g a legacy "other" image re-read under v98 through the trigger: more fields and lines land, the four legacy core rows and the description are replaced and kept, its first angle row is added');

select public.photo_land_classification(:A4) \gset a4_
select t.ok((:'a4_photo_land_classification')::jsonb->>'landing' = 'adopted' and t.landed(:A4) = (select v from t.keep where k = 'A4 landed')
  and (select confidence = 0.28 from image_descriptions where image_id = :A4)
  and not exists (select 1 from public.photo_land_superseded_rows where image_id = :A4)
  and t.claims(:A4) = 'no vehicle fe[] id[] vin[]',
  '05h a legacy reading whose stored confidence was rounded to two decimals (0.283 kept as 0.28) is still recognised as the same reading and adopted; unfiled, it asserts nothing');

\echo '== 06 first landing, then the same reading again'
select t.put(:B1, 'v98a') \gset _
select t.ok(t.result(:B1)->>'landing' = 'first' and (t.result(:B1)->>'fields')::int = 9 and (t.result(:B1)->>'text_lines')::int = 2
  and (t.result(:B1)->>'descriptions')::int = 1 and (t.result(:B1)->>'angles')::int = 1 and (t.result(:B1)->>'field_evidence')::int = 2
  and t.fields(:B1) = t.fields(:A2)
  and (select region = '{"x":0.1,"y":0.2}'::jsonb from photo_text_lines where image_id = :B1 and line_idx = 0)
  and (select region is null from photo_text_lines where image_id = :B1 and line_idx = 1)
  and (select meta = jsonb_build_object('photo_id', :B1::uuid, 'checksum_ok', true) from photo_extracted_fields where image_id = :B1 and field_name = 'vin')
  and (select string_agg(field_name || '=' || proposed_value, ' ' order by field_name) from field_evidence where vehicle_id = :V1) = 'color=Red license_plate=ABC1234'
  and (select string_agg(kind || '=' || value || '/' || evidence_class, ' ' order by kind) from vehicle_identifiers where source_image_id = :B1) = 'plate_body_code=65A/plate_stamping plate_paint_code=M/plate_stamping'
  and (select count(*) = 1 and bool_and(basis = 'landed' and superseded_at is null and supersedes is null and vehicle_id = :V1 and reading_id = t.rid('v98a')
                                      and yields = '{"fields":9,"text_lines":2,"description":true,"angle":"exterior.front.center"}'::jsonb)
         from public.photo_classifier_landings where image_id = :B1)
  and not exists (select 1 from public.photo_land_superseded_rows where image_id = :B1),
  '06a first landing: the reading lands as before (9 fields, 2 lines, description, angle, 2 proposals, 2 plate codes) and the ledger records it');
select t.ok((select count(*) = 2 and bool_and(raw_extraction_data->>'reading_id' = t.rid('v98a') and raw_extraction_data->>'image_id' = :B1::text
                                          and raw_extraction_data->>'extractor' = 'photo_land_classification' and raw_extraction_data ? 'quote')
               from field_evidence where vehicle_id = :V1)
  and (select evidence->>'reading_id' = t.rid('v98a') and evidence->>'classifier_angle' = 'exterior_front' and observed_at is not null
         from image_angle_observations where image_id = :B1)
  and t.claims(:B1) = '001 fe[color=Red license_plate=ABC1234] id[plate_body_code=65A plate_paint_code=M] vin[1FTFW1E50NFA00001]',
  '06b graft + must-fix 4: new proposals and the new angle row carry reading_id; the landing row lists what the reading asserts');
select public.identifier_observations_ingest(:U) \gset ing1_
select t.ok((select string_agg(kind || '=' || value || '/' || source, ' ' order by source, kind, value) from vehicle_identifier_observations where image_id = :B1)
  = 'plate=ABC1234/photo_extracted_fields vin=1FTFW1E50NFA00001/photo_extracted_fields vin=1FTFW1E50NFA00001/photo_text_lines',
  '06c identifier_observations_ingest (HEAD reader, real body) mints the reading''s plate and VIN as candidates');
-- what photo-pipeline-orchestrator's landCitedEvidence adds from the same reading after the UPDATE: a VIN proposal and a VIN identifier
insert into field_evidence(vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, raw_extraction_data)
values (:V1, 'vin', '1FTFW1E50NFA00001', 'ai_visual', 79, 'photo-pipeline VIN (modern_checksum): VIN decal',
        jsonb_build_object('photo_id', :B1::uuid, 'image_id', :B1::uuid, 'quote', 'VIN decal', 'extractor', 'photo-pipeline-orchestrator', 'prompt_version', 'v98'));
insert into vehicle_identifiers(vehicle_id, source_image_id, kind, value, extractor, source_kind, source_url, quote, confidence)
values (:V1, :B1, 'vin', '1FTFW1E50NFA00001', 'photo-pipeline-orchestrator-v99', 'photo', 'https://example.invalid/b1.jpg', 'VIN decal', 0.79);
insert into t.keep select 'world after B1 first', t.world();
select public.photo_land_classification(:B1) \gset _
select public.photo_land_classification(:B1, true) \gset _
update vehicle_images set vision_gate_status = 'approved' where id = :B1;   -- fires a07 (gate changed), same reading
select t.ok(t.world() = (select v from t.keep where k = 'world after B1 first') and t.result(:B1)->>'landing' = 'unchanged'
  and (t.result(:B1)->>'fields')::int = 0 and (t.result(:B1)->>'angles')::int = 0 and (t.result(:B1)->>'superseded_rows')::int = 0,
  '06d the same reading again by hand call, by the two-argument call and by trigger a07: no landed row, angle row, claim, ledger row or before-image changes');

\echo '== 07 a legacy reading replaced by a v98 reading with fewer, more and different fields and text lines'
select t.put(:C1, 'legacy_rich') \gset _
select t.ok(t.fields(:C1) = 'color=Red/legacy core.classifier_confidence=0.61/legacy core.description=Legacy rich read of a build sheet./legacy core.image_type=document/legacy core.is_automotive=true/legacy doc.type=build_sheet/legacy mileage=42000/legacy trim=GT/legacy'
  and t.lines(:C1) = '0:GT/legacy 1:42000 MI/legacy 2:DEALER TAG/legacy' and t.angle_keys(:C1) = 'exterior.front.center/legacy',
  '07a the legacy reading is landed (8 fields, 3 lines, an angle)');
select t.snapshot('C1 legacy', :C1) \gset _
create table t.c1_fields as select * from photo_extracted_fields where image_id = :C1;
create table t.c1_lines  as select * from photo_text_lines where image_id = :C1;
create table t.c1_descs  as select * from image_descriptions where image_id = :C1;
create table t.c1_angles as select * from image_angle_observations where image_id = :C1;
create table t.c1_prior as select id, reading_id from public.photo_classifier_landings where id = t.current_landing(:C1);
select t.put(:C1, 'v98n') \gset _
select t.ok(t.result(:C1)->>'landing' = 'superseded'
  and t.fields(:C1) = 'body_style=Coupe/v98 color=Maroon/v98 core.classifier_confidence=0.93/v98 core.description=Side of a maroon coupe./v98 core.image_type=vehicle_exterior/v98 core.is_automotive=true/v98 mileage=42000/v98'
  and t.lines(:C1) = '0:GT SPORT/v98 1:42000 MI/v98'
  and (select count(*) = 1 and min(description) = 'Side of a maroon coupe.' and min(source_version) = 'v98' and min(evidence->>'model') = 'provider-model'
         from image_descriptions where image_id = :C1 and description_type = 'classifier_v2'),
  '07b afterwards the three projection tables hold exactly the v98 reading (7 fields, 2 lines, its description); nothing legacy is left in them');
select t.ok(
  (select count(*) = 2 from image_angle_observations where image_id = :C1 and source = 'classifier_v2')
  and (select to_jsonb(o) = to_jsonb(s) from image_angle_observations o join t.c1_angles s on s.id = o.id)
  and t.angle_keys(:C1) = 'exterior.front.center/legacy exterior.rear.center/v98'
  and t.newest_angle(:C1) = 'exterior.rear.center'
  and (select o.evidence->>'reading_id' = t.rid('v98n') and o.confidence = 0.8 and o.vehicle_id = :V5 and o.observed_at > s.observed_at
         from image_angle_observations o, t.c1_angles s where o.image_id = :C1 and o.id <> s.id)
  and not exists (select 1 from public.photo_land_superseded_rows where source_table = 'image_angle_observations'),
  '07c must-fix 5: the angle is appended, never replaced: the legacy reading''s row is byte for byte what it was, a new classifier_v2 row carries the v98 angle, and the newest row is the current reading''s');
select t.ok(t.kept('C1 legacy', t.current_landing(:C1))
  and (select string_agg(row_key || ':' || disposition, ' ' order by row_key) from public.photo_land_superseded_rows where image_id = :C1 and source_table = 'photo_extracted_fields')
      = 'color:replaced core.classifier_confidence:replaced core.description:replaced core.image_type:replaced core.is_automotive:replaced doc.type:removed mileage:replaced trim:removed'
  and (select string_agg(row_key || ':' || disposition, ' ' order by row_key) from public.photo_land_superseded_rows where image_id = :C1 and source_table = 'photo_text_lines')
      = '0:replaced 1:replaced 2:removed'
  and (select bool_and(h.landing_id = p.id and h.prior_reading = p.reading_id and h.superseded_by_landing_id = t.current_landing(:C1)
                       and h.superseding_reading = t.rid('v98n') and h.superseded_at is not null)
         from public.photo_land_superseded_rows h, t.c1_prior p where h.image_id = :C1)
  and (select l.superseded_at is not null and n.supersedes = l.id and n.superseded_at is null
         from public.photo_classifier_landings l join t.c1_prior p on p.id = l.id join public.photo_classifier_landings n on n.id = t.current_landing(:C1)),
  '07d every prior row of the three tables is kept whole with its disposition, when it was superseded, the prior reading and the superseding reading');
select t.ok(
  not exists ((select * from t.c1_fields) except (select (jsonb_populate_record(null::public.photo_extracted_fields, h.row_data)).* from public.photo_land_superseded_rows h where h.image_id = :C1 and h.source_table = 'photo_extracted_fields'))
  and not exists ((select (jsonb_populate_record(null::public.photo_extracted_fields, h.row_data)).* from public.photo_land_superseded_rows h where h.image_id = :C1 and h.source_table = 'photo_extracted_fields') except (select * from t.c1_fields))
  and not exists ((select * from t.c1_lines) except (select (jsonb_populate_record(null::public.photo_text_lines, h.row_data)).* from public.photo_land_superseded_rows h where h.image_id = :C1 and h.source_table = 'photo_text_lines'))
  and not exists ((select * from t.c1_descs) except (select (jsonb_populate_record(null::public.image_descriptions, h.row_data)).* from public.photo_land_superseded_rows h where h.image_id = :C1 and h.source_table = 'image_descriptions'))
  and (select count(*) from t.c1_fields) = 8 and (select count(*) from t.c1_lines) = 3 and (select count(*) from t.c1_descs) = 1,
  '07e jsonb_populate_record over the before-images gives back the typed rows exactly as they were (8 fields, 3 lines, 1 description)');
select t.ok(
  (select bool_and(f.id = s.id and f.created_at > s.created_at) and count(*) = 6
     from photo_extracted_fields f join t.c1_fields s on s.field_name = f.field_name where f.image_id = :C1)
  and (select f.id not in (select id from t.c1_fields) from photo_extracted_fields f where f.image_id = :C1 and f.field_name = 'body_style')
  and (select d.id = s.id and d.created_at > s.created_at from image_descriptions d, t.c1_descs s where d.image_id = :C1 and d.description_type = 'classifier_v2'),
  '07f replaced in place: the six continuing fields and the description keep their row ids and carry the new landing time; the new field is a new row');
select t.ok(
  (select string_agg(row_key || ':' || disposition, ' ' order by row_key) from public.photo_land_superseded_rows where image_id = :C1 and source_table = 'field_evidence')
    = 'color=Red:claim mileage=42000:claim trim=GT:claim'
  and (select string_agg(field_name || '=' || proposed_value || ':' || status, ' ' order by field_name, proposed_value) from field_evidence where vehicle_id = :V5)
    = 'body_style=Coupe:pending color=Maroon:pending color=Red:pending mileage=42000:pending trim=GT:pending'
  and t.outstanding(:C1) = 'field_evidence:color=Red field_evidence:trim=GT'
  and t.claims(:C1) = '005 fe[body_style=Coupe color=Maroon mileage=42000] id[] vin[]',
  '07g the legacy reading''s proposals are not withdrawn (Red and GT still pending beside Maroon); Red and GT are outstanding, 42000 is not: the v98 reading asserts it');

\echo '== 08 a v98 reading replaced by another v98 reading from a different reader'
select t.snapshot('B1 v98a', :B1) \gset _
create table t.b1_ids as select (select id from image_descriptions where image_id = :B1 and description_type = 'classifier_v2') d,
                                (select id from image_angle_observations where image_id = :B1 and source = 'classifier_v2') a,
                                (select id from photo_extracted_fields where image_id = :B1 and field_name = 'vin') v;
insert into t.keep_angles select 'B1 after v98a', t.angles(:B1);
select t.put(:B1, 'v98b') \gset _
select t.ok(t.result(:B1)->>'landing' = 'superseded'
  and t.fields(:B1) = 'body_code=65A/v98 color=Maroon/v98 core.classifier_confidence=0.88/v98 core.description=Engine bay of a maroon coupe./v98 core.image_type=engine_bay/v98 core.is_automotive=true/v98 license_plate=ABC1284/v98 vin=1FTFW1E50NFA00009/v98'
  and t.lines(:B1) = '0:ABC1284/v98'
  and (select region is null from photo_text_lines where image_id = :B1 and line_idx = 0)
  and t.kept('B1 v98a', t.current_landing(:B1))
  and (select count(*) = 2 and count(distinct reading_id) = 2 and count(distinct prompt_version) = 1
              and string_agg(reader, ' > ' order by id) = 'provider-model > reader:subscription'
         from public.photo_classifier_landings where image_id = :B1),
  '08a same prompt version, different reader: a different reading; the second reader''s rows replace the first''s, which are kept');
select t.ok(
  (select d.id = i.d and d.description = 'Engine bay of a maroon coupe.' and d.evidence->>'model' = 'reader:subscription' and d.evidence->>'image_type' = 'engine_bay'
     from image_descriptions d, t.b1_ids i where d.image_id = :B1 and d.description_type = 'classifier_v2')
  and (select count(*) = 1 from image_descriptions where image_id = :B1 and description_type = 'classifier_v2')
  and (select f.id = i.v and f.meta->>'checksum_ok' = 'false' from photo_extracted_fields f, t.b1_ids i where f.image_id = :B1 and f.field_name = 'vin')
  and t.angle_keys(:B1) = 'exterior.front.center/v98 engine.bay/v98' and t.newest_angle(:B1) = 'engine.bay'
  and (select t.angles(:B1) @> v and jsonb_array_length(t.angles(:B1)) = 2 from t.keep_angles where k = 'B1 after v98a')
  and (select o.confidence = 0.95 and o.evidence->>'reading_id' = t.rid('v98b') from image_angle_observations o, t.b1_ids i where o.image_id = :B1 and o.id <> i.a),
  '08b the description is the new reading''s in the same row; the first reader''s angle row is untouched and the second reader''s is added after it');
select t.ok(
  (select string_agg(source_table || ':' || row_key, ' ' order by source_table, row_key) from public.photo_land_superseded_rows
    where image_id = :B1 and superseded_by_landing_id = t.current_landing(:B1) and disposition = 'claim')
   = 'field_evidence:color=Red field_evidence:license_plate=ABC1234 field_evidence:vin=1FTFW1E50NFA00001 vehicle_identifiers:plate_body_code=65A vehicle_identifiers:plate_paint_code=M vehicle_identifiers:vin=1FTFW1E50NFA00001'
  and (select string_agg(field_name || '=' || proposed_value, ' ' order by field_name, proposed_value) from field_evidence where vehicle_id = :V1)
   = 'color=Maroon color=Red license_plate=ABC1234 license_plate=ABC1284 vin=1FTFW1E50NFA00001'
  and (select row_data->>'status' = 'pending' and row_data->>'proposed_value' = 'Red' from public.photo_land_superseded_rows
        where image_id = :B1 and source_table = 'field_evidence' and row_key = 'color=Red')
  and t.claims(:B1) = '001 fe[color=Maroon license_plate=ABC1284] id[plate_body_code=65A] vin[1FTFW1E50NFA00009]'
  and t.outstanding(:B1) = 'field_evidence:color=Red field_evidence:license_plate=ABC1234 field_evidence:vin=1FTFW1E50NFA00001 vehicle_identifiers:plate_paint_code=M vehicle_identifiers:vin=1FTFW1E50NFA00001',
  '08c the first reader''s claims stand beside the second''s and are copied (the orchestrator''s VIN proposal and VIN identifier with them); Red, ABC1234, paint code M and both VIN claims are outstanding, body code 65A is not');

\echo '== 08 must-fix 4: outstanding is decided when asked, over the current readings of every photo'
-- a second photo of the same vehicle whose current reading makes the first reader's claims
select t.put(:B2, 'v98a') \gset _
select t.ok(t.result(:B2)->>'landing' = 'first' and (t.result(:B2)->>'field_evidence')::int = 0
  and t.claims(:B2) = '001 fe[color=Red license_plate=ABC1234] id[plate_body_code=65A plate_paint_code=M] vin[1FTFW1E50NFA00001]'
  and t.outstanding(:B1) = '(none)',
  '08d another photo of the vehicle reads Red, ABC1234, paint code M and that VIN: the claims the first photo''s old reading made are no longer outstanding');
update vehicle_images set vehicle_id = null where id = :B2;      -- unfiled; no trigger runs the fold for this
select t.ok(t.result(:B2)->>'landing' = 'first'
  and t.outstanding(:B1) = 'field_evidence:color=Red field_evidence:license_plate=ABC1234 field_evidence:vin=1FTFW1E50NFA00001 vehicle_identifiers:plate_paint_code=M vehicle_identifiers:vin=1FTFW1E50NFA00001',
  '08e that photo is unfiled without a run of the fold: its reading no longer counts, and the five claims are outstanding again');
update vehicle_images set vehicle_id = :V1 where id = :B2;       -- filed again: a07 runs the fold, same reading
select t.ok(t.result(:B2)->>'landing' = 'unchanged' and t.outstanding(:B1) = '(none)', '08f filed again: not outstanding');
update vehicle_images set vehicle_id = null where id = :B2;      -- left unfiled for the rest of the contract
-- a reading superseded while the photo is gate-rejected, by a reading that makes the same claims; then approved again
select t.put(:G1, 'v98a') \gset _
update vehicle_images set vision_gate_status = 'rejected_not_vehicle' where id = :G1;   -- a07: same reading, no vehicle to assert about
select t.ok(t.result(:G1)->>'landing' = 'unchanged' and t.claims(:G1) = 'no vehicle fe[] id[] vin[]',
  '08g a photo that becomes gate-rejected: its current reading asserts nothing any more');
select t.put(:G1, 'v98a_r2') \gset _
select t.ok(t.result(:G1)->>'landing' = 'superseded' and t.claims(:G1) = 'no vehicle fe[] id[] vin[]'
  and t.outstanding(:G1) = 'field_evidence:color=Red field_evidence:license_plate=ABC1234 vehicle_identifiers:plate_body_code=65A vehicle_identifiers:plate_paint_code=M'
  and t.angle_keys(:G1) = 'exterior.front.center/v98',
  '08h superseded while rejected: the old reading''s four claims are outstanding (no reading of a filed, accepted photo asserts them) and no angle row is added');
update vehicle_images set vision_gate_status = 'approved' where id = :G1;               -- a07: the same reading, filed and accepted
select t.ok(t.result(:G1)->>'landing' = 'unchanged'
  and t.claims(:G1) = '009 fe[color=Red license_plate=ABC1234] id[plate_body_code=65A plate_paint_code=M] vin[1FTFW1E50NFA00001]'
  and (select claims_refreshed_at is not null and vehicle_id is null from public.photo_classifier_landings where id = t.current_landing(:G1))
  and t.outstanding(:G1) = '(none)',
  '08i approved again: the landing row is refreshed with what the reading asserts, and nothing is outstanding (decided at query time, not frozen at the supersession)');
select t.ok(t.angle_keys(:G1) = 'exterior.front.center/v98 exterior.front.center/v98'
  and (select string_agg(evidence->>'reading_id', ' > ' order by observed_at) = t.rid('v98a') || ' > ' || t.rid('v98a_r2') from image_angle_observations where image_id = :G1),
  '08j the same angle from a different reading is a new observation: the second reader''s row is added once the photo is accepted, the first reader''s stays');

select public.identifier_observations_ingest(:U) \gset ing2_
create view t.stale_candidates as
  select o.image_id, o.kind, o.value, o.source, o.status
    from vehicle_identifier_observations o
   where exists (select 1 from public.photo_land_superseded_rows h where h.source_table = o.source and h.row_id = o.source_row_id)
     and not exists (select 1 from photo_extracted_fields f where o.source = 'photo_extracted_fields' and f.id = o.source_row_id and btrim(f.value) = o.value)
     and not exists (select 1 from photo_text_lines l where o.source = 'photo_text_lines' and l.id = o.source_row_id
                        and position(o.value in regexp_replace(upper(l.text), '[^A-Z0-9]', '', 'g')) > 0);
select t.ok(
  (select string_agg(kind || '=' || value || '/' || source, ' ' order by source, kind, value) from vehicle_identifier_observations o
    where o.image_id = :B1 and not exists (select 1 from t.stale_candidates s where s.image_id = o.image_id and s.kind = o.kind and s.value = o.value and s.source = o.source))
   = 'plate=ABC1284/photo_extracted_fields vin=1FTFW1E50NFA00009/photo_extracted_fields'
  and (select string_agg(kind || '=' || value || '/' || source, ' ' order by source, kind, value) from t.stale_candidates where image_id = :B1)
   = 'plate=ABC1234/photo_extracted_fields vin=1FTFW1E50NFA00001/photo_extracted_fields vin=1FTFW1E50NFA00001/photo_text_lines'
  and not exists (select 1 from t.stale_candidates where image_id not in (:B1, :C1)),
  '08k after the re-read the HEAD reader mints only the second reader''s plate and VIN; the three candidates it minted from the superseded rows are found by one query');

\echo '== 09 a reading whose new version has no description (and no mappable angle, no text lines)'
select t.snapshot('B1 v98b', :B1) \gset _
insert into t.keep_angles select 'B1 after v98b', t.angles(:B1);
select t.put(:B1, 'v98c') \gset _
select t.ok(t.result(:B1)->>'landing' = 'superseded'
  and t.fields(:B1) = 'color=Maroon/v98 core.classifier_confidence=0.7/v98 core.image_type=vehicle_exterior/v98 core.is_automotive=true/v98'
  and t.lines(:B1) = ''
  and not exists (select 1 from image_descriptions where image_id = :B1 and description_type = 'classifier_v2')
  and t.kept('B1 v98b', t.current_landing(:B1))
  and (select string_agg(source_table || ':' || disposition, ' ' order by source_table) from public.photo_land_superseded_rows
        where image_id = :B1 and superseded_by_landing_id = t.current_landing(:B1) and source_table in ('image_descriptions', 'photo_text_lines'))
      = 'image_descriptions:removed photo_text_lines:removed'
  and (select h.row_id = i.d and h.row_data->>'description' = 'Engine bay of a maroon coupe.' from public.photo_land_superseded_rows h, t.b1_ids i
        where h.image_id = :B1 and h.superseded_by_landing_id = t.current_landing(:B1) and h.source_table = 'image_descriptions'),
  '09a no description and no lines in the new reading: those rows leave the current tables and are kept as removed');
select t.ok(t.angles(:B1) = (select v from t.keep_angles where k = 'B1 after v98b') and (t.result(:B1)->>'angles')::int = 0
  and (select yields->>'angle' is null from public.photo_classifier_landings where id = t.current_landing(:B1)),
  '09b must-fix 5: the new reading has no mappable angle: no angle row is deleted, changed or added (both earlier rows are byte for byte what they were); the ledger row says this reading yields no angle');
select t.put(:B1, 'v98d') \gset _
select t.ok(t.result(:B1)->>'landing' = 'superseded'
  and (select count(*) = 1 and min(description) = 'Close view of a maroon fender.' and bool_and(d.id <> i.d) from image_descriptions d, t.b1_ids i where d.image_id = :B1 and d.description_type = 'classifier_v2')
  and t.angle_keys(:B1) = 'exterior.front.center/v98 engine.bay/v98 detail.general/v98' and t.newest_angle(:B1) = 'detail.general'
  and t.lines(:B1) = '0:FENDER/v98'
  and (select count(*) = 4 from public.photo_classifier_landings where image_id = :B1)
  and (select count(*) = 1 from public.photo_classifier_landings where image_id = :B1 and superseded_at is null),
  '09c the next reading has a description and an angle again: the description lands as a new row, the angle as a third observation; four readings in the ledger, one current');

\echo '== 10 filing change with the same reading (trigger a07)'
select t.put(:D1, 'v98a') \gset _
select t.ok(t.result(:D1)->>'landing' = 'first' and (select count(*) = 9 and count(vehicle_id) = 0 from photo_extracted_fields where image_id = :D1)
  and not exists (select 1 from image_angle_observations where image_id = :D1) and not exists (select 1 from field_evidence where vehicle_id = :V6)
  and (select vehicle_id is null and claims_refreshed_at is null from public.photo_classifier_landings where image_id = :D1)
  and t.claims(:D1) = 'no vehicle fe[] id[] vin[]',
  '10a read while unfiled: fields, lines and description land without a vehicle; no proposal, no angle (as before); the reading asserts nothing');
insert into t.keep select 'D1 fields lines description', (select md5(string_agg(x, '|' order by x)) from (
  select to_jsonb(f)::text x from photo_extracted_fields f where f.image_id = :D1 union all select to_jsonb(l)::text from photo_text_lines l where l.image_id = :D1
  union all select to_jsonb(d)::text from image_descriptions d where d.image_id = :D1) q);
update vehicle_images set vehicle_id = :V6, vision_gate_status = 'approved' where id = :D1;   -- fires a07
select t.ok(t.result(:D1)->>'landing' = 'unchanged'
  and (select count(*) = 1 from public.photo_classifier_landings where image_id = :D1)
  and not exists (select 1 from public.photo_land_superseded_rows where image_id = :D1)
  and (select v from t.keep where k = 'D1 fields lines description') = (select md5(string_agg(x, '|' order by x)) from (
        select to_jsonb(f)::text x from photo_extracted_fields f where f.image_id = :D1 union all select to_jsonb(l)::text from photo_text_lines l where l.image_id = :D1
        union all select to_jsonb(d)::text from image_descriptions d where d.image_id = :D1) q)
  and (select count(*) = 1 from image_angle_observations where image_id = :D1 and source = 'classifier_v2' and vehicle_id = :V6)
  and (select count(*) = 2 from field_evidence where vehicle_id = :V6)
  and (select count(*) = 2 from vehicle_identifiers where source_image_id = :D1),
  '10b filed afterwards: the same reading, so nothing is superseded and no landed row changes; the proposals, plate codes and the angle land now (as before)');
select t.ok(t.claims(:D1) = '006 fe[color=Red license_plate=ABC1234] id[plate_body_code=65A plate_paint_code=M] vin[1FTFW1E50NFA00001]'
  and (select claims_refreshed_at is not null and vehicle_id is null and claims_vehicle_id = :V6 from public.photo_classifier_landings where image_id = :D1),
  '10c must-fix 4: the same ledger row is refreshed at filing with the claims the reading now asserts for the vehicle');
insert into t.keep select 'world after D1 filed', t.world();
update vehicle_images set vision_gate_status = 'pending' where id = :D1;    -- a07 again
update vehicle_images set vision_gate_status = 'approved' where id = :D1;   -- and again
select t.ok(t.world() = (select v from t.keep where k = 'world after D1 filed') and t.result(:D1)->>'landing' = 'unchanged',
  '10d two more gate changes fire a07 twice: nothing changes, not even the ledger row');

\echo '== 11 a deep-result-only update leaves the classifier rows alone'
insert into t.keep select 'world before deep', (select md5(string_agg(x, '|' order by x)) from (
  select to_jsonb(f)::text x from photo_extracted_fields f union all select to_jsonb(l)::text from photo_text_lines l
  union all select to_jsonb(d)::text from image_descriptions d union all select to_jsonb(a)::text from image_angle_observations a
  union all select to_jsonb(e)::text from field_evidence e union all select to_jsonb(i)::text from vehicle_identifiers i
  union all select to_jsonb(g)::text from public.photo_classifier_landings g union all select to_jsonb(h)::text from public.photo_land_superseded_rows h) q);
update vehicle_images set ai_scan_metadata = ai_scan_metadata || '{"byok_deep_analysis":{"camera_pose":{"azimuth_deg":45,"distance_est":"~3m"},"confidence":0.8,"prompt_version":"deep-v1"}}'
 where id = :B1;   -- a06 fires with p_include_classifier = false (classification unchanged)
select t.ok((select v from t.keep where k = 'world before deep') = (select md5(string_agg(x, '|' order by x)) from (
        select to_jsonb(f)::text x from photo_extracted_fields f union all select to_jsonb(l)::text from photo_text_lines l
        union all select to_jsonb(d)::text from image_descriptions d union all select to_jsonb(a)::text from image_angle_observations a
        union all select to_jsonb(e)::text from field_evidence e union all select to_jsonb(i)::text from vehicle_identifiers i
        union all select to_jsonb(g)::text from public.photo_classifier_landings g union all select to_jsonb(h)::text from public.photo_land_superseded_rows h) q)
  and (select count(*) = 1 and min(azimuth_deg) = 45 and min(distance_mm) = 3000 from image_camera_position where image_id = :B1)
  and t.result(:B1) = '{"descriptions":0,"fields":0,"text_lines":0,"field_evidence":0,"angles":0,"camera":1}'::jsonb,
  '11 deep-only update: the camera position lands; no classifier row, angle row, claim, ledger row or before-image is touched');

\echo '== 12 a failed landing leaves a trace, can be found, and can be run again'
-- must not raise
select t.put(:E1, 'bad') \gset _
select t.ok((select ai_processing_status = 'completed' and ai_scan_metadata#>>'{classification,confidence}' = 'high' from vehicle_images where id = :E1)
  and (select count(*) = 1 and bool_and(stage = 'landing' and sqlstate = '22P02' and step = 'shape reading' and occurrences = 1 and resolved_at is null
                                      and include_classifier and message like '%numeric%' and context like '%photo_land_classification%'
                                      and reading_id = t.rid('bad') and retries = 0)
         from public.photo_land_failures where image_id = :E1)
  and t.result(:E1) is null and t.landed(:E1) = md5('') and not exists (select 1 from public.photo_classifier_landings where image_id = :E1),
  '12a a classification the fold cannot land: the UPDATE succeeds, nothing is landed, and photo_land_failures holds the reason (stage, step, SQLSTATE, message, reading)');
select t.ok((select public.photo_classifier_reading_id(v.ai_scan_metadata->'classification') is distinct from
                    (select g.reading_id from public.photo_classifier_landings g where g.image_id = v.id and g.superseded_at is null)
               from vehicle_images v where v.id = :E1)
  and not exists (select 1 from vehicle_images v join public.photo_classifier_landings g on g.image_id = v.id and g.superseded_at is null
                   where v.id in (:A1, :A2, :A3, :B1, :C1, :D1)
                     and public.photo_classifier_reading_id(v.ai_scan_metadata->'classification') is distinct from g.reading_id),
  '12b must-fix 3: for a list of photos, the reading identity of the stored classification against the current ledger row tells which reading is not landed (E1) and which are');
select public.photo_land_classification(:E1) \gset e1_
select t.ok((:'e1_photo_land_classification')::jsonb->>'state' = '22P02' and (:'e1_photo_land_classification')::jsonb ? 'error'
  and (select count(*) = 1 and min(occurrences) = 2 and bool_and(last_failed_at > first_failed_at) from public.photo_land_failures where image_id = :E1),
  '12c the same failure again raises the counter on the same row; the function still returns the error and does not raise');
select t.put(:E1, 'bad2') \gset _
select t.ok((select count(*) = 1 and min(occurrences) = 3 and bool_and(resolved_at is null and message like '%very high%')
               from public.photo_land_failures where image_id = :E1),
  '12d must-fix 3: one open row per (image, stage, SQLSTATE): another reading failing the same way, with another message, is the same open failure, with the latest message');
select t.ok((select reading_id = t.rid('bad2') from public.photo_land_failures where image_id = :E1 and resolved_at is null),
  '12d2 and it names the latest reading that failed');
update vehicle_images set ai_scan_metadata = ai_scan_metadata || '{"byok_deep_analysis":{"camera_pose":{"azimuth_deg":10},"confidence":0.5,"prompt_version":"deep-v1"}}' where id = :E1;
select t.ok((select count(*) = 1 from image_camera_position where image_id = :E1) and t.result(:E1)->>'camera' = '1'
  and (select count(*) = 1 and bool_and(resolved_at is null) from public.photo_land_failures where image_id = :E1),
  '12e a deep-only run that goes through does not close a classifier failure it never retried');
select t.put(:E1, 'v98d') \gset _
select t.ok(t.result(:E1)->>'landing' = 'first' and (select count(*) = 1 and bool_and(resolved_at is not null) from public.photo_land_failures where image_id = :E1),
  '12f once the image lands, its failure is stamped resolved');
insert into t.keep select 'E1 landed before deep failure', t.landed(:E1);
update vehicle_images set ai_scan_metadata = ai_scan_metadata || '{"byok_deep_analysis":{"camera_pose":{"azimuth_deg":20},"confidence":"sure","prompt_version":"deep-v2"}}' where id = :E1;
select t.ok(t.landed(:E1) = (select v from t.keep where k = 'E1 landed before deep failure')
  and (select count(*) = 1 and bool_and(stage = 'landing' and step = 'land camera position' and sqlstate = '22P02' and include_classifier = false and reading_id is null)
         from public.photo_land_failures where image_id = :E1 and resolved_at is null)
  and (select count(*) = 1 from image_camera_position where image_id = :E1),
  '12g a deep-only update that fails is traced as well (p_include_classifier false) and leaves the classifier rows alone');
update vehicle_images set ai_scan_metadata = ai_scan_metadata || '{"byok_deep_analysis":{"camera_pose":{"azimuth_deg":20},"confidence":0.6,"prompt_version":"deep-v2"}}' where id = :E1;
select t.ok((select count(*) = 2 from image_camera_position where image_id = :E1)
  and not exists (select 1 from public.photo_land_failures where image_id = :E1 and resolved_at is null),
  '12h and the next deep-only run that goes through closes it');

insert into t.keep select 'world before failed supersession', t.world();
set fixture.fail_text_lines = 'on';
-- a different reading: the supersession starts, then photo_text_lines fails; must not raise
select t.put(:B1, 'v98a') \gset _
select t.ok(t.world() = (select v from t.keep where k = 'world before failed supersession')
  and (select count(*) = 1 and bool_and(stage = 'landing' and step = 'replace landed rows' and message = 'fixture: photo_text_lines unavailable'
                                      and reading_id = t.rid('v98a') and resolved_at is null)
         from public.photo_land_failures where image_id = :B1 and resolved_at is null)
  and (select ai_scan_metadata#>>'{classification,description}' = 'Front of a red coupe with its plate visible.' from vehicle_images where id = :B1),
  '12i a failure in the middle of a supersession: the UPDATE succeeds, every landed row, angle row, claim, ledger row and before-image is as it was, and the trace says where it stopped');
reset fixture.fail_text_lines;
select t.snapshot('B1 v98d', :B1) \gset _
select public.photo_land_classification(:B1) \gset b1_
select t.ok((:'b1_photo_land_classification')::jsonb->>'landing' = 'superseded' and t.fields(:B1) = t.fields(:A2)
  and t.kept('B1 v98d', t.current_landing(:B1))
  and not exists (select 1 from public.photo_land_failures where image_id = :B1 and resolved_at is null)
  and t.angle_keys(:B1) = 'exterior.front.center/v98 engine.bay/v98 detail.general/v98 exterior.front.center/v98'
  and t.outstanding(:B1) = 'field_evidence:color=Maroon field_evidence:license_plate=ABC1284',
  '12j the next run lands the reading that had failed and closes the trace; the reading that returns adds its angle as a new observation; the VIN claims it reads again are no longer outstanding, the other reader''s Maroon and ABC1284 are');

set fixture.fail_identifiers = 'on';
select t.put(:F1, 'v98a') \gset _
select t.ok(t.result(:F1)->>'landing' = 'first' and (t.result(:F1)->>'fields')::int = 9 and (t.result(:F1)->>'angles')::int = 1
  and not exists (select 1 from vehicle_identifiers where source_image_id = :F1)
  and (select count(*) = 1 and bool_and(stage = 'identifiers' and step = 'land identifiers' and message = 'fixture: identifier writer unavailable' and resolved_at is null)
         from public.photo_land_failures where image_id = :F1),
  '12k an identifier hand-off failure no longer disappears: the rest lands as before and the failure is recorded');
reset fixture.fail_identifiers;
select public.photo_land_classification(:F1) \gset f1_
select t.ok((:'f1_photo_land_classification')::jsonb->>'landing' = 'unchanged' and (select count(*) = 2 from vehicle_identifiers where source_image_id = :F1)
  and not exists (select 1 from public.photo_land_failures where image_id = :F1 and resolved_at is null),
  '12l the next run (same reading) lands the plate codes and closes that trace');

\echo '== 12 graft: a failure that never reaches the fold; must-fix 3: run the open failures again'
alter function public.photo_land_classification(uuid, boolean) rename to photo_land_classification_away;
-- must not raise: the trigger cannot call the fold at all
select t.put(:H1, 'v98n') \gset _
alter function public.photo_land_classification_away(uuid, boolean) rename to photo_land_classification;
select t.ok((select ai_scan_metadata#>>'{classification,description}' = 'Side of a maroon coupe.' from vehicle_images where id = :H1)
  and t.result(:H1) is null and t.landed(:H1) = md5('')
  and (select count(*) = 1 and bool_and(stage = 'trigger' and step = 'call fold' and sqlstate = '42883' and resolved_at is null and include_classifier
                                      and reading_id = t.rid('v98n') and message like '%photo_land_classification%')
         from public.photo_land_failures where image_id = :H1),
  '12m the trigger function fails before the fold runs: the UPDATE still succeeds, and the failure is recorded as stage trigger with the reading that was not landed');
select t.put(:E2, 'bad') \gset _
select t.ok((select count(*) = 2 and count(distinct image_id) = 2 from public.photo_land_failures where resolved_at is null), '12n two photos have an open failure: H1 (never reached the fold) and E2 (a reading that cannot be landed)');
select public.photo_land_retry_failures(0) as retry0 \gset
select public.photo_land_retry_failures(10) as retry1 \gset
select t.ok((:'retry0')::jsonb = '{"picked":0,"landed":0,"failed_again":0,"still_open":0,"skipped_locked":0,"open_failures":2,"given_up":0}'::jsonb
  and (:'retry1')::jsonb = '{"picked":2,"landed":1,"failed_again":1,"still_open":0,"skipped_locked":0,"open_failures":1,"given_up":0}'::jsonb
  and t.result(:H1)->>'landing' = 'first' and t.fields(:H1) = t.fields(:C1)
  and (select bool_and(resolved_at is not null and retries = 0) from public.photo_land_failures where image_id = :H1)
  and (select count(*) = 1 and bool_and(resolved_at is null and retries = 1 and occurrences = 2 and last_retry_at is not null) from public.photo_land_failures where image_id = :E2),
  '12o photo_land_retry_failures(10): the reading that never reached the fold is landed and its failure closed; the unlandable one fails again and is counted; a limit of 0 picks nothing');
select public.photo_land_retry_failures(10, 2) as retry2 \gset
select public.photo_land_retry_failures(10, 2) as retry3 \gset
select t.ok((:'retry2')::jsonb = '{"picked":1,"landed":0,"failed_again":1,"still_open":0,"skipped_locked":0,"open_failures":1,"given_up":1}'::jsonb
  and (:'retry3')::jsonb = '{"picked":0,"landed":0,"failed_again":0,"still_open":0,"skipped_locked":0,"open_failures":1,"given_up":1}'::jsonb
  and (select retries = 2 and occurrences = 3 from public.photo_land_failures where image_id = :E2 and resolved_at is null),
  '12p a failure that keeps failing is given up after p_max_retries and no longer picked: it cannot starve the others or loop for ever');
update vehicle_images set ai_processing_status = 'pending' where id = :E2;   -- the pipeline took the photo back
select public.photo_land_retry_failures(10, 5) as retry4 \gset
select t.ok((:'retry4')::jsonb = '{"picked":1,"landed":0,"failed_again":0,"still_open":1,"skipped_locked":0,"open_failures":1,"given_up":0}'::jsonb
  and (select retries = 3 and occurrences = 3 from public.photo_land_failures where image_id = :E2 and resolved_at is null),
  '12q a photo that is no longer completed cannot be landed: the retry is counted (still_open), the failure stays open for the run that completes it');
update vehicle_images set ai_processing_status = 'completed' where id = :E2;   -- a06 fires: status changed; the reading still cannot be landed
select t.ok((select occurrences = 4 and retries = 3 from public.photo_land_failures where image_id = :E2 and resolved_at is null), '12r completed again with the same unlandable reading: the same open failure, once more');
select t.put(:E2, 'v98n') \gset _
select t.ok(t.result(:E2)->>'landing' = 'first' and not exists (select 1 from public.photo_land_failures where resolved_at is null),
  '12s a reading that can be landed arrives: it lands and closes the failure; no open failure is left');

\echo '== 13 a failed stand-in is not a reading: it never supersedes'
insert into t.keep select 'world before stand-in', t.world();
select t.put(:B1, 'standin') \gset _
select t.ok(t.world() = (select v from t.keep where k = 'world before stand-in') and t.result(:B1)->>'landing' = 'held_not_a_reading'
  and t.result(:B1)->>'reading' = (select reading_id from public.photo_classifier_landings where id = t.current_landing(:B1)),
  '13 classification.classifier_ok = false over a landed reading: nothing is superseded; the progress row says the landing was held');
select t.put(:B1, 'v98a') \gset _
select t.ok(t.world() = (select v from t.keep where k = 'world before stand-in') and t.result(:B1)->>'landing' = 'unchanged',
  '13b the reading that was landed is stored again: unchanged');

\echo '== 14 the history is append-only, enforced'
select coalesce(max(seq), 0) as last_seq from t.passed \gset
do $$
declare v_sql text; v_refused int := 0; v_res jsonb; v_denied int := 0;
begin
  foreach v_sql in array array[
    'update public.photo_land_superseded_rows set disposition = ''removed'' where id = (select min(id) from public.photo_land_superseded_rows)',
    'delete from public.photo_land_superseded_rows where id = (select min(id) from public.photo_land_superseded_rows)',
    'truncate public.photo_land_superseded_rows',
    'delete from public.photo_classifier_landings where id = (select min(id) from public.photo_classifier_landings)',
    'update public.photo_classifier_landings set reading_id = ''x'' where superseded_at is null',
    'update public.photo_classifier_landings set superseded_at = now() + interval ''1 day'' where superseded_at is not null',
    'update public.photo_classifier_landings set superseded_at = now(), reader = ''x'' where superseded_at is null',
    'update public.photo_classifier_landings set superseded_at = now() - interval ''1 year'' where superseded_at is null',
    'update public.photo_classifier_landings set claimed_vin = ''x'' where superseded_at is not null',
    'update public.photo_classifier_landings set claimed_vin = ''x'', vehicle_id = null where superseded_at is null and vehicle_id is not null',
    'update public.photo_classifier_landings set superseded_at = now(), claimed_vin = ''x'' where superseded_at is null',
    'truncate public.photo_classifier_landings cascade'] loop
    begin
      execute v_sql;
      raise exception 'not refused: %', v_sql;
    exception when restrict_violation then v_refused := v_refused + 1;
    end;
  end loop;
  perform t.ok(v_refused = 12, '14a UPDATE, DELETE and TRUNCATE of the history and of ledger rows are refused (12 attempts): only the one-time superseded_at stamp at the time of the superseding transaction, and the claims columns of a current row, may change');

  set local role service_role;
  v_res := public.photo_land_classification('10000000-0000-4000-8000-0000000000a1'::uuid, true);   -- definer: the service role can run the fold
  perform public.photo_land_retry_failures(1);
  perform count(*) from public.photo_land_outstanding(null, null, 5);
  perform public.photo_classifier_reading_id('{"image_type":"other"}');
  foreach v_sql in array array[
    'insert into public.photo_land_failures(image_id, stage, sqlstate, message) values (gen_random_uuid(), ''landing'', ''XX000'', ''x'')',
    'insert into public.photo_classifier_landings(image_id, reading_id, basis) values (gen_random_uuid(), ''x'', ''landed'')',
    'delete from public.photo_land_superseded_rows',
    'update public.photo_classifier_landings set claimed_vin = ''x'' where superseded_at is null',
    'select public.photo_land_note_failure(gen_random_uuid(), ''landing'', ''x'', ''XX000'', ''x'', null, null, true)'] loop
    begin execute v_sql; raise exception 'not denied: %', v_sql;
    exception when insufficient_privilege then v_denied := v_denied + 1; end;
  end loop;
  set local role anon;
  foreach v_sql in array array[
    'select 1 from public.photo_classifier_landings',
    'select 1 from public.photo_land_failures',
    'select public.photo_land_classification(''10000000-0000-4000-8000-0000000000a1''::uuid, true)',
    'select public.photo_land_retry_failures(1)',
    'select * from public.photo_land_outstanding()',
    'select public.photo_classifier_reading_id(''{}'')'] loop
    begin execute v_sql; raise exception 'not denied: %', v_sql;
    exception when insufficient_privilege then v_denied := v_denied + 1; end;
  end loop;
  reset role;
  perform t.ok(v_res->>'landing' = 'unchanged' and v_denied = 11,
    '14b as service_role the fold, the retry, the outstanding reader and the reading identity run, but the new tables and the failure recorder cannot be written directly; anon can read or run none of them');
end $$;
select 'ok  ' || msg from t.passed where seq > :last_seq order by seq;

\echo '== 15 what existing readers see (their read shapes, as SQL)'
select t.ok(
  not exists (select 1 from photo_extracted_fields where source = 'classifier_v2' group by image_id, field_name having count(*) > 1)
  and not exists (select 1 from photo_text_lines where source = 'classifier_v2' group by image_id, line_idx having count(*) > 1)
  and not exists (select 1 from image_descriptions where description_type = 'classifier_v2' group by image_id having count(*) > 1),
  '15a one current row per key in the three projection tables');
select t.ok(
  not exists (select 1 from public.photo_classifier_landings g join photo_extracted_fields f on f.image_id = g.image_id and f.source = 'classifier_v2'
               where g.superseded_at is null and f.prompt_version is distinct from g.prompt_version)
  and not exists (select 1 from public.photo_classifier_landings g join photo_text_lines l on l.image_id = g.image_id and l.source = 'classifier_v2'
               where g.superseded_at is null and l.prompt_version is distinct from g.prompt_version)
  and not exists (select 1 from public.photo_classifier_landings g join image_descriptions d on d.image_id = g.image_id and d.description_type = 'classifier_v2'
               where g.superseded_at is null and (d.source_version is distinct from g.prompt_version or d.evidence->>'model' is distinct from g.reader))
  and (select count(*) = 13 from public.photo_classifier_landings where superseded_at is null)
  and (select count(*) = 13 from (select image_id from photo_extracted_fields where source = 'classifier_v2' group by image_id) q),
  '15b no stale mix anywhere: every row of the three tables, for the 13 landed images, carries its image''s current reading (version, and reader on the description)');
select t.ok(
  -- the reader after its change: the newest classifier_v2 row is the current reading''s, wherever the current reading yields an angle
  not exists (select 1 from public.photo_classifier_landings g
               where g.superseded_at is null and g.yields->>'angle' is not null and g.claims_vehicle_id is not null
                 and (t.newest_angle(g.image_id) is distinct from g.yields->>'angle'
                      or (select coalesce(o.evidence->>'reading_id', g.reading_id) <> g.reading_id from image_angle_observations o
                           where o.image_id = g.image_id and o.source = 'classifier_v2' order by o.observed_at desc, o.id desc limit 1)))
  and t.newest_angle(:B1) = 'exterior.front.center'
  -- the reader as it is today (order by confidence desc limit 1): on a re-read photo it shows a superseded reading''s angle
  and (select t2.canonical_key from image_angle_observations o join angle_taxonomy t2 using (angle_id) where o.image_id = :B1 order by o.confidence desc limit 1) = 'engine.bay'
  and (select count(*) = 4 from image_angle_observations where image_id = :B1 and source = 'classifier_v2'),
  '15c angle rows accumulate (B1 holds four): a reader that takes the NEWEST classifier_v2 row sees the current reading''s angle (front); resolveAngle.ts as it is today, highest confidence first, would show the superseded reader''s engine bay');
select t.ok(
  -- assay_photo_reading_flow: count(DISTINCT image_id) per source_version over classifier_v2 descriptions
  (select sum(n) from (select count(distinct image_id) n from image_descriptions where description_type = 'classifier_v2' group by source_version) q)
    = (select count(distinct image_id) from image_descriptions where description_type = 'classifier_v2')
  -- profile_fix_review_resolve_v1: NOT EXISTS a core.is_automotive = 'false' row
  and not exists (select 1 from photo_extracted_fields where image_id in (:A2, :A3) and field_name = 'core.is_automotive' and value = 'false')
  -- identifier_observations_ingest: every vin / license_plate row of the image is a candidate
  and (select string_agg(field_name || '=' || value, ' ' order by field_name) from photo_extracted_fields where image_id = :C1 and field_name in ('vin', 'license_plate')) is null
  and (select string_agg(field_name || '=' || value, ' ' order by field_name) from photo_extracted_fields where image_id = :B1 and field_name in ('vin', 'license_plate'))
      = 'license_plate=ABC1234 vin=1FTFW1E50NFA00001'
  -- photo_analysis_yield_daily_refresh: one photo_land_progress row per image, landed_at = the last run
  and (select count(*) = count(distinct image_id) and count(*) = 13 from photo_land_progress),
  '15d other reader shapes: each image counts under one prompt version; the automotive flag and the VIN / plate fields read are the current reading''s; progress keeps one row per image');

\echo '== 16 the claims of superseded readings nothing asserts any more, for every photo, one call'
select t.ok((select string_agg(right(o.image_id::text, 2) || ' ' || o.claim_table || ' ' || o.name || '=' || o.value || ' ' || o.claim_status, '; '
                               order by o.image_id, o.claim_table, o.name, o.value)
     from public.photo_land_outstanding() o)
  = 'b1 field_evidence color=Maroon pending; b1 field_evidence license_plate=ABC1284 pending; c1 field_evidence color=Red pending; c1 field_evidence trim=GT pending'
  and (select string_agg(o.name || '=' || o.value, ' ' order by o.name) from public.photo_land_outstanding(:V5) o) = 'color=Red trim=GT'
  and not exists (select 1 from public.photo_land_outstanding(:V2) o)
  and (select count(*) = 1 from public.photo_land_outstanding(null, null, 1) o),
  '16 photo_land_outstanding(): B1 (the first reader''s reading again) leaves the other reader''s Maroon and ABC1284; C1 leaves Red and GT; by vehicle, and bounded by its limit');

\echo '== 16 one transaction that lands two readings of one photo'
begin;
select t.put(:L1, 'v98a') \gset _
select t.put(:L1, 'v98b') \gset _
commit;
select t.ok(t.result(:L1)->>'landing' = 'superseded' and t.angle_keys(:L1) = 'exterior.front.center/v98 engine.bay/v98' and t.newest_angle(:L1) = 'engine.bay'
  and (select count(*) = 2 and count(distinct observed_at) = 2 from image_angle_observations where image_id = :L1)
  and (select o.evidence->>'reading_id' = t.rid('v98b') from image_angle_observations o where o.image_id = :L1 order by o.observed_at desc limit 1)
  and t.outstanding(:L1) = 'field_evidence:color=Red field_evidence:license_plate=ABC1234 vehicle_identifiers:plate_paint_code=M',
  '16b two readings landed inside one transaction keep their order: the angle rows carry the clock, so the newest row is the second reading''s');

\echo '== 17 two sessions on one image: the photo row is the lock'
create extension dblink;
create function t.conn() returns text language sql as $$
  select format('dbname=%L host=%L port=%L user=%L', current_database(), split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_user) $$;
-- true once the backend behind a dblink connection is waiting for a lock (pg_locks is live; pg_stat_activity is frozen per transaction)
create function t.waits(p_pid int, p_types text[]) returns boolean language plpgsql as $$
declare w boolean := false;
begin
  for j in 1..500 loop
    select exists (select from pg_locks l where l.pid = p_pid and not l.granted and l.locktype = any (p_types)) into w;
    exit when w; perform pg_sleep(0.01);
  end loop;
  return w;
end $$;
-- closes sessions a block that stopped half-way (a failed check) left open, so they cannot hold a photo row for the next block
create function t.hang_up() returns void language plpgsql as $$
declare c text;
begin
  foreach c in array coalesce(dblink_get_connections(), '{}'::text[]) loop perform dblink_disconnect(c); end loop;
  perform pg_advisory_unlock_all();
end $$;
select coalesce(max(seq), 0) as last_seq from t.passed \gset
do $$
declare
  r jsonb; s text; n_before bigint; w2_pid int; c1 uuid := '10000000-0000-4000-8000-0000000000c1';
begin
  perform t.hang_up();
  select count(*) into n_before from public.photo_classifier_landings where image_id = c1;
  -- (a) the UPDATE's trigger is superseding in an open transaction; a hand call for the same image waits for the row
  perform dblink_connect('w1', t.conn());
  perform dblink_connect('w2', t.conn());
  select x.pid into w2_pid from dblink('w2', 'select pg_backend_pid()') as x(pid int);
  perform dblink_exec('w1', 'begin');
  perform dblink_exec('w1', format($q$update vehicle_images set ai_scan_metadata = ai_scan_metadata || t.cls('v98d') where id = %L$q$, c1));
  perform dblink_send_query('w2', format('select public.photo_land_classification(%L)', c1));
  perform t.ok(t.waits(w2_pid, array['transactionid', 'tuple']) and not exists (select from pg_locks where locktype = 'advisory'),
    '17a while a trigger run supersedes an image in an open transaction, a hand call for it waits on the photo row (no advisory lock is involved)');
  perform dblink_exec('w1', 'commit');
  select value into r from dblink_get_result('w2') as x(value jsonb);
  perform t.ok(r->>'landing' = 'unchanged'
    and r->>'reading' = (select reading_id from public.photo_classifier_landings where image_id = c1 and superseded_at is null)
    and (select count(*) from public.photo_classifier_landings where image_id = c1) = n_before + 1
    and (select count(*) from public.photo_classifier_landings where image_id = c1 and superseded_at is null) = 1
    and (select description from image_descriptions where image_id = c1 and description_type = 'classifier_v2') = 'Close view of a maroon fender.',
    '17b then it sees the reading that was committed meanwhile as landed (unchanged): the two runs did not interleave');
  perform dblink_disconnect('w2');

  -- (b) a hand call holds the image in an open transaction; an UPDATE with a new reading waits for the row, then supersedes
  perform dblink_connect('w2', t.conn());
  select x.pid into w2_pid from dblink('w2', 'select pg_backend_pid()') as x(pid int);
  perform dblink_exec('w1', 'begin');
  perform x.value from dblink('w1', format('select public.photo_land_classification(%L)', c1)) as x(value jsonb);
  perform dblink_send_query('w2', format($q$update vehicle_images set ai_scan_metadata = ai_scan_metadata || t.cls('v98n') where id = %L$q$, c1));
  perform t.ok(t.waits(w2_pid, array['transactionid', 'tuple']), '17c while a hand call holds the image, an UPDATE of the photo with a new reading waits on the photo row');
  perform dblink_exec('w1', 'commit');
  select value into s from dblink_get_result('w2') as x(value text);
  perform t.ok(s = 'UPDATE 1'
    and (select result->>'landing' from photo_land_progress where image_id = c1) = 'superseded'
    and (select count(*) from public.photo_classifier_landings where image_id = c1) = n_before + 2
    and (select count(*) from public.photo_classifier_landings where image_id = c1 and superseded_at is null) = 1
    and (select description from image_descriptions where image_id = c1 and description_type = 'classifier_v2') = 'Side of a maroon coupe.'
    and not exists (select 1 from public.photo_land_failures where image_id = c1),
    '17d then it goes through and its trigger run supersedes; no failure, one current reading');
  perform dblink_disconnect('w1'); perform dblink_disconnect('w2');
end $$;
select 'ok  ' || msg from t.passed where seq > :last_seq order by seq;

-- (c) must-fix 1. The order that deadlocked: a hand call is past its first read and has not yet reached the identifier
--     writer (which locks the photo row FOR UPDATE, then the vehicle row); an UPDATE of the same photo with a new
--     reading arrives.
select t.put(:K1, 'v98a') \gset _
select t.ok(t.result(:K1)->>'landing' = 'first' and (select count(*) = 2 from vehicle_identifiers where source_image_id = :K1),
  '17e a photo with plate codes is landed, so the hand call below reaches the identifier writer');
select coalesce(max(seq), 0) as last_seq from t.passed \gset
do $$
declare
  r jsonb; s text; w1_pid int; w2_pid int; k1 uuid := '10000000-0000-4000-8000-0000000000ac';
begin
  perform t.hang_up();
  perform dblink_connect('w1', t.conn());
  perform dblink_connect('w2', t.conn());
  select x.pid into w1_pid from dblink('w1', 'select pg_backend_pid()') as x(pid int);
  select x.pid into w2_pid from dblink('w2', 'select pg_backend_pid()') as x(pid int);
  perform pg_advisory_lock(777);                                    -- the gate: this session holds it
  perform dblink_exec('w1', 'set fixture.gate_text_lines = ''on''');
  perform dblink_exec('w1', 'begin');
  perform dblink_send_query('w1', format('select public.photo_land_classification(%L)', k1));
  -- the hand call has read the photo and stands at the gate, before the identifier writer
  perform t.ok((select exists (select from pg_locks l where l.pid = w1_pid and l.locktype = 'advisory' and l.objid = 777 and not l.granted)
                  from (select t.waits(w1_pid, array['advisory'])) q),
    '17f the hand call is inside its landing, before the identifier writer');
  perform dblink_send_query('w2', format($q$update vehicle_images set ai_scan_metadata = ai_scan_metadata || t.cls('v98a_r2') where id = %L$q$, k1));
  -- the UPDATE is blocked: by the photo row here (by the fold's advisory lock in the draft that deadlocked)
  perform t.ok(t.waits(w2_pid, array['transactionid', 'tuple', 'advisory']), '17g the UPDATE that arrives meanwhile is waiting');
  perform pg_advisory_unlock(777);                                  -- open the gate: the hand call goes on to the identifier writer
  begin
    select value into r from dblink_get_result('w1') as x(value jsonb);
  exception when others then r := jsonb_build_object('raised', sqlerrm);
  end;
  begin perform x.value from dblink_get_result('w1') as x(value jsonb); exception when others then null; end;   -- drain the async state
  begin perform dblink_exec('w1', 'commit'); exception when others then r := coalesce(r, '{}'::jsonb) || jsonb_build_object('commit', sqlerrm); end;
  begin
    select value into s from dblink_get_result('w2') as x(value text);
  exception when others then s := 'ERROR ' || sqlerrm;
  end;
  perform t.ok(r->>'landing' = 'unchanged' and not (r ? 'error') and not (r ? 'raised') and not (r ? 'commit') and s = 'UPDATE 1'
    and not exists (select 1 from public.photo_land_failures where image_id = k1)
    and (select result->>'landing' from photo_land_progress where image_id = k1) = 'superseded'
    and (select count(*) from public.photo_classifier_landings where image_id = k1 and superseded_at is null) = 1
    and (select reader from public.photo_classifier_landings where image_id = k1 and superseded_at is null) = 'reader:subscription'
    and (select evidence->>'model' from image_descriptions where image_id = k1 and description_type = 'classifier_v2') = 'reader:subscription',
    '17h must-fix 1: no deadlock. The hand call finishes through the identifier writer''s row lock, the UPDATE then lands its reading; no 40P01, no failure row, and the stored reading is the landed one');
  perform dblink_disconnect('w1'); perform dblink_disconnect('w2');
end $$;
select 'ok  ' || msg from t.passed where seq > :last_seq order by seq;

-- (d) the retry never waits behind a writer of the photo row
select t.put(:E1, 'bad') \gset _
select coalesce(max(seq), 0) as last_seq from t.passed \gset
do $$
declare r jsonb; e1 uuid := '10000000-0000-4000-8000-0000000000e1';
begin
  perform t.hang_up();
  perform dblink_connect('w1', t.conn());
  perform dblink_exec('w1', 'begin');
  perform dblink_exec('w1', format('update vehicle_images set taken_at = taken_at where id = %L', e1));
  r := public.photo_land_retry_failures(5);
  perform dblink_exec('w1', 'commit');
  perform t.ok(r = '{"picked":1,"landed":0,"failed_again":0,"still_open":0,"skipped_locked":1,"open_failures":1,"given_up":0}'::jsonb
    and (select retries = 0 and occurrences = 1 from public.photo_land_failures where image_id = e1 and resolved_at is null),
    '17i photo_land_retry_failures skips a photo another session holds, without waiting and without counting a retry');
  perform dblink_disconnect('w1');
end $$;
select 'ok  ' || msg from t.passed where seq > :last_seq order by seq;
select t.put(:E1, 'v98d') \gset _
select t.ok(not exists (select 1 from public.photo_land_failures where resolved_at is null), '17j the reading that was landed before is stored again; no open failure is left');

\echo '== 18 revert with before-images present: refused; previous owners with history kept; migration applied again'
create table t.counts as select (select count(*) from public.photo_land_superseded_rows) h, (select count(*) from public.photo_classifier_landings) g,
                                (select count(*) from public.photo_land_failures) f, t.world() w;
\set ON_ERROR_STOP off
\ir revert_20261113150000_photo_landing_supersession.sql
\set ON_ERROR_STOP on
select t.ok(t.md5s() = (select v from t.this_md5) and (select h > 0 and w = t.world() from t.counts)
  and obj_description('public.photo_land_classification(uuid,boolean)'::regprocedure, 'pg_proc') like '%[photo landing supersession 20261113150000]%',
  '18a must-fix 6: a full revert is refused while before-images exist: the new owners, their comment and every table are still there');
set photo_land.keep_history = 'on';
\ir revert_20261113150000_photo_landing_supersession.sql
reset photo_land.keep_history;
select t.ok(t.md5s() = :'live_md5s'
  and (select h = (select count(*) from public.photo_land_superseded_rows) and g = (select count(*) from public.photo_classifier_landings)
          and f = (select count(*) from public.photo_land_failures) and w = t.world() from t.counts)
  and to_regprocedure('public.photo_land_retry_failures(integer,integer)') is not null and to_regprocedure('public.photo_land_outstanding(uuid,uuid,integer)') is not null
  and to_regprocedure('public.photo_classifier_reading_id(jsonb)') is not null
  and (select count(*) = 4 from pg_trigger where tgrelid in ('public.photo_classifier_landings'::regclass, 'public.photo_land_superseded_rows'::regclass) and not tgisinternal and tgenabled = 'A')
  and obj_description('public.photo_land_classification(uuid,boolean)'::regprocedure, 'pg_proc') = 'fixture: the comment the fold carried before'
  and obj_description('public.assay_photo_reading_flow(boolean)'::regprocedure, 'pg_proc') = 'Reading of whether user-owned photos are being read: first readings by prompt version.',
  '18b must-fix 6: with photo_land.keep_history on, only the three bodies and the two comments go back; the ledger, the before-images, the failures, their guards and the functions are kept');
comment on function public.photo_land_classification(uuid, boolean) is null;   -- as in the repo: the fold carries no comment
\ir ../migrations/20261113150000_photo_landing_supersession.sql
select t.ok(t.md5s() = (select v from t.this_md5) and (select w = t.world() from t.counts)
  and obj_description('public.photo_land_classification(uuid,boolean)'::regprocedure, 'pg_proc') like '[photo landing supersession 20261113150000] Lands the classifier reading%',
  '18c the migration applies again over its own tables; ledger and before-images unchanged');
select t.snapshot('B1 v98a again', :B1) \gset _
select t.put(:B1, 'v98b') \gset _
select t.ok(t.result(:B1)->>'landing' = 'superseded' and t.kept('B1 v98a again', t.current_landing(:B1)) and t.lines(:B1) = '0:ABC1284/v98'
  and t.newest_angle(:B1) = 'engine.bay' and (select count(*) = 5 from image_angle_observations where image_id = :B1),
  '18d and supersedes as before');
set photo_land.keep_history = 'on';
\ir revert_20261113150000_photo_landing_supersession.sql
reset photo_land.keep_history;
select t.ok(t.md5s() = :'live_md5s' and obj_description('public.photo_land_classification(uuid,boolean)'::regprocedure, 'pg_proc') is null,
  '18e a fold that carried no comment before the migration carries none after the revert');
\ir ../migrations/20261113150000_photo_landing_supersession.sql

select 'PASS  photo landing supersession contract: ' || (select count(*) from t.passed) || ' checks; ' || count(*) || ' landings, '
       || (select count(*) from public.photo_land_superseded_rows) || ' history rows, '
       || (select count(*) from image_angle_observations) || ' angle observations, '
       || (select count(*) from public.photo_land_failures) || ' failure rows (' || (select count(*) from public.photo_land_failures where resolved_at is null) || ' open)'
  from public.photo_classifier_landings;
