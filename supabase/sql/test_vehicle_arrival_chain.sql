-- Synthetic PG17 contract for 20261029090000_vehicle_arrival_notifications_and_gap_testimony.sql. Never production.
-- Run in an empty disposable dm_refinement_* database (the included fixture refuses any other):
--   createdb dm_refinement_vehicle_arrival
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vehicle_arrival -f supabase/sql/test_vehicle_arrival_chain.sql
-- Builds on the capture-session contract, loads the live device_file_images_as and get_user_day_receipt read from
-- production on 2026-10-28, records the live receipt for an owner and a stranger, applies the migration, then proves:
--   (a) a capture_session profile sends one vehicle_profile_created notification whose title follows the relationship
--       (own vehicle; technician at a shop the GPS names; that shop's client), never again on replay;
--   (b) tag_only creates a private candidate (vin null, identity_status needs_identifier), files the frames and sends
--       vehicle_profile_needs_identifier; a replay with a later burst files it without a second notification;
--   (c) a gap testimony lands as an owner_testimony session, the receipt returns the gap with its testimony_id, an
--       overlapping second statement, a stranger, an interval holding photos and too many hours are refused;
--   (d) the receipt's money masking is unchanged: the new receipt minus its new keys equals the live one.
\ir test_device_capture_session_profiles.sql
RESET ROLE;
GRANT SELECT ON auth.users TO dm_contract_deployer;
SET ROLE dm_contract_deployer;

-- Live shapes the migration reads or writes (columns read from production 2026-10-28).
ALTER TABLE public.vehicle_images ADD COLUMN IF NOT EXISTS device_fingerprint text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text, ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE public.organization_contributors ADD COLUMN IF NOT EXISTS end_date date;
CREATE TABLE public.organizations (id uuid PRIMARY KEY, business_name text, name text);
CREATE TABLE public.organization_locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id), latitude numeric, longitude numeric);
CREATE TABLE public.clients (id uuid PRIMARY KEY, business_id uuid REFERENCES public.organizations (id));
CREATE TABLE public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  type text NOT NULL, title text NOT NULL, message text NOT NULL, metadata jsonb DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid REFERENCES public.organizations (id) ON DELETE CASCADE, notification_type text,
  vehicle_id uuid REFERENCES public.vehicles (id) ON DELETE CASCADE,
  image_id uuid REFERENCES public.vehicle_images (id) ON DELETE CASCADE,
  from_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL, action_url text, read_at timestamptz);
CREATE TABLE public.work_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, vehicle_id uuid NOT NULL,
  session_date date NOT NULL, start_time timestamptz NOT NULL, end_time timestamptz NOT NULL,
  duration_minutes integer NOT NULL, confidence_score numeric NOT NULL DEFAULT 0.0, image_count integer NOT NULL DEFAULT 0,
  work_description text, metadata jsonb, status text DEFAULT 'in_progress', title text, work_type text,
  total_job_cost numeric DEFAULT 0, session_type text DEFAULT 'auto_detected', evidence jsonb DEFAULT '{}'::jsonb,
  owner_confirmed_at timestamptz, owner_confirmed_by uuid, intent text, intent_source text NOT NULL DEFAULT 'ai_inferred',
  CONSTRAINT work_sessions_intent_source_check CHECK (intent_source = ANY (ARRAY['ai_inferred', 'owner_confirmed'])));
CREATE TABLE public.receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid,
  vendor_name text, total_amount numeric, transaction_date date, purchase_date date, receipt_date date);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, kind text,
  content_text text, structured_data jsonb, observed_at timestamptz, agent_model text, ingested_at timestamptz);
INSERT INTO public.canonical_makes (canonical_name, display_name, aliases) VALUES ('PONTIAC', 'Pontiac', ARRAY['pontiac']);
\ir helpers/device_file_images_as_live_20261028.sql
\ir helpers/get_user_day_receipt_live_20261028.sql
GRANT EXECUTE ON FUNCTION public.get_user_day_receipt(uuid, date) TO authenticated;
RESET ROLE;

-- Synthetic people, a shop, its client and frames (coordinates are fixture values, not a real place).
INSERT INTO auth.users (id) VALUES (pg_temp.u('arrival')), (pg_temp.u('tech')) ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id) VALUES (pg_temp.u('arrival')), (pg_temp.u('tech')) ON CONFLICT DO NOTHING;
INSERT INTO public.organizations (id, business_name) VALUES (pg_temp.v('shop'), 'Fixture Shop');
INSERT INTO public.organization_locations (organization_id, latitude, longitude) VALUES (pg_temp.v('shop'), 10.0, 20.0);
INSERT INTO public.organization_contributors (organization_id, user_id, role, status) VALUES
  (pg_temp.v('shop'), pg_temp.u('arrival'), 'owner', 'active'),
  (pg_temp.v('shop'), pg_temp.u('tech'), 'technician', 'active');
INSERT INTO public.clients (id, business_id) VALUES (pg_temp.v('client'), pg_temp.v('shop'));
-- arrival: burst A 17:00 (serial anchor a1), burst T 17:30 (tag anchor t1), burst T2 22:44 (tag anchor t4).
-- tech: burst S 17:10 (s1 anchor) and burst C 17:40 (c1 anchor).
INSERT INTO public.vehicle_images (id, user_id, image_url, file_hash, taken_at, latitude, longitude, device_fingerprint,
  vision_gate_status, is_document, is_sensitive)
SELECT pg_temp.i(x.label), pg_temp.u(x.who), 'https://fixture.invalid/' || x.label, md5(x.label) || md5(x.label),
  x.at, 10.0, 20.0, 'device-' || x.who, 'approved', false, false
FROM (VALUES
  ('a1','arrival','2026-10-28T17:00:30Z'::timestamptz), ('a2','arrival','2026-10-28T17:01:00Z'), ('a3','arrival','2026-10-28T17:01:30Z'),
  ('t1','arrival','2026-10-28T17:30:00Z'), ('t2','arrival','2026-10-28T17:30:30Z'), ('t3','arrival','2026-10-28T17:31:00Z'),
  ('t4','arrival','2026-10-28T22:44:00Z'), ('t5','arrival','2026-10-28T22:45:00Z'),
  ('s1','tech','2026-10-28T17:10:00Z'), ('s2','tech','2026-10-28T17:10:30Z'),
  ('c1','tech','2026-10-28T17:40:00Z'), ('c2','tech','2026-10-28T17:40:30Z')) x(label, who, at);
CREATE FUNCTION pg_temp.capture(who text, anchor text, member text, serial text, make text, model text, extra jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('basis','capture_session','serial',serial,'year',1966,'make',make,'model',model,
   'image_ids',jsonb_build_array(pg_temp.i(anchor),pg_temp.i(member)),
   'evidence',jsonb_build_object('context_method','vin_capture_session_v1','anchor_image_id',pg_temp.i(anchor),
     'anchor_source_sha256',md5(anchor)||md5(anchor),'identifier_read',serial,'edit_distance','0',
     'identifier_legibility','clear')) || extra $$;
CREATE FUNCTION pg_temp.tag(anchor text, members text[]) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('basis','tag_only','year',1973,'make','Pontiac','model','Firebird',
   'image_ids',(SELECT jsonb_agg(pg_temp.i(m)) FROM unnest(members) m),
   'evidence',jsonb_build_object('context_method','cowl_tag_session_v1','anchor_image_id',pg_temp.i(anchor),
     'anchor_source_sha256',md5(anchor)||md5(anchor),'tag_legibility','clear',
     'tag',jsonb_build_object('body_number','100001','series_code','2FS87','paint','75','trim','232'))) $$;
CREATE FUNCTION pg_temp.as_user(who text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.u(who))::text,false); $$;

-- (d, before) the live receipt for its owner and for a stranger, with a costed session and a receipt on the day.
INSERT INTO public.vehicles (id, uploaded_by, year, make, model, is_public) VALUES (pg_temp.v('costed'), pg_temp.u('arrival'), 1970, 'Ford', 'Fixture', true);
INSERT INTO public.vehicle_images (id, user_id, vehicle_id, image_url, file_hash, taken_at)
  VALUES (pg_temp.i('pub1'), pg_temp.u('arrival'), pg_temp.v('costed'), 'https://fixture.invalid/pub1', md5('pub1'), '2026-10-28T08:00:00Z');
INSERT INTO public.work_sessions (user_id, vehicle_id, session_date, start_time, end_time, duration_minutes, title,
  total_job_cost, session_type, status)
VALUES (pg_temp.u('arrival'), pg_temp.v('costed'), '2026-10-28', '2026-10-28T08:00:00Z', '2026-10-28T08:30:00Z', 30,
  'fixture session', 500, 'capture_derived', 'derived');
INSERT INTO public.receipts (user_id, vendor_name, total_amount, receipt_date) VALUES (pg_temp.u('arrival'), 'Fixture Vendor', 42, '2026-10-28');
SELECT pg_temp.as_user('arrival');
SET ROLE authenticated;
SELECT public.get_user_day_receipt(pg_temp.u('arrival'), '2026-10-28') AS r \gset live_owner_
RESET ROLE;
SELECT pg_temp.as_user('tech');
SET ROLE authenticated;
SELECT public.get_user_day_receipt(pg_temp.u('arrival'), '2026-10-28') AS r \gset live_stranger_
RESET ROLE;
SELECT pg_temp.ok('the live receipt masks money for a stranger (fixture sanity)',
 (:'live_owner_r'::jsonb #>> '{work_sessions,0,total_job_cost}')::numeric = 500
 AND jsonb_array_length(:'live_owner_r'::jsonb -> 'receipts') = 1
 AND :'live_stranger_r'::jsonb #> '{work_sessions,0,total_job_cost}' = 'null'::jsonb
 AND jsonb_array_length(:'live_stranger_r'::jsonb -> 'receipts') = 0);

SET ROLE dm_contract_deployer;
\ir ../migrations/20261029090000_vehicle_arrival_notifications_and_gap_testimony.sql
RESET ROLE;

-- (d) the mask is unchanged: strip the new keys and the receipts are equal.
CREATE FUNCTION pg_temp.strip_new(r jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT (r - 'gaps') || jsonb_build_object('facets', (r -> 'facets') - 'gaps',
   'work_sessions', (SELECT coalesce(jsonb_agg(w - 'session_type' ORDER BY o), '[]'::jsonb)
                     FROM jsonb_array_elements(r -> 'work_sessions') WITH ORDINALITY e(w, o))) $$;
SELECT pg_temp.as_user('arrival');
SET ROLE authenticated;
SELECT public.get_user_day_receipt(pg_temp.u('arrival'), '2026-10-28') AS r \gset new_owner_
RESET ROLE;
SELECT pg_temp.as_user('tech');
SET ROLE authenticated;
SELECT public.get_user_day_receipt(pg_temp.u('arrival'), '2026-10-28') AS r \gset new_stranger_
RESET ROLE;
SELECT pg_temp.ok('owner-only money masking is unchanged for the owner and for a stranger',
 pg_temp.strip_new(:'new_owner_r'::jsonb) = :'live_owner_r'::jsonb
 AND pg_temp.strip_new(:'new_stranger_r'::jsonb) = :'live_stranger_r'::jsonb
 AND :'new_stranger_r'::jsonb #> '{work_sessions,0,total_job_cost}' = 'null'::jsonb
 AND jsonb_array_length(:'new_stranger_r'::jsonb -> 'receipts') = 0);
SELECT pg_temp.ok('a stranger sees no gaps of private frames',
 jsonb_array_length(:'new_stranger_r'::jsonb -> 'gaps') = 0);

-- The repaired notification writer stays service-role only.
SELECT pg_temp.ok('create_notification is not callable by clients',
 NOT has_function_privilege('anon','public.create_notification(uuid,text,text,text,uuid,uuid,jsonb,integer)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.create_notification(uuid,text,text,text,uuid,uuid,jsonb,integer)','EXECUTE')
 AND has_function_privilege('service_role','public.create_notification(uuid,text,text,text,uuid,uuid,jsonb,integer)','EXECUTE'));

-- (a) capture_session: own vehicle at the caller's own shop.
SELECT pg_temp.as_user('arrival');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.capture('arrival','a1','a2','7R01C100001','Ford','Mustang')) AS r \gset own_
SELECT public.device_create_vehicle_profile(pg_temp.capture('arrival','a1','a2','7R01C100001','Ford','Mustang')) AS r \gset own_replay_
RESET ROLE;
SELECT pg_temp.ok('a capture_session profile sends one owner notification with the anchor frame and the profile link',
 :'own_r'::jsonb ->> 'status' = 'created' AND :'own_r'::jsonb ->> 'relationship' = 'owner'
 AND :'own_r'::jsonb ->> 'notification_error' IS NULL
 AND :'own_replay_r'::jsonb ->> 'vehicle_id' = :'own_r'::jsonb ->> 'vehicle_id'
 AND :'own_replay_r'::jsonb ->> 'notification_id' IS NULL
 AND (SELECT count(*) FROM public.user_notifications WHERE vehicle_id = (:'own_r'::jsonb ->> 'vehicle_id')::uuid) = 1
 AND EXISTS (SELECT 1 FROM public.user_notifications n
   WHERE n.id = (:'own_r'::jsonb ->> 'notification_id')::uuid AND n.user_id = pg_temp.u('arrival')
     AND n.type = 'vehicle_profile_created' AND n.notification_type = 'vehicle_profile_created'
     AND n.title = 'Your new vehicle profile: 1966 Ford Mustang'
     AND n.vehicle_id = (:'own_r'::jsonb ->> 'vehicle_id')::uuid AND n.image_id = pg_temp.i('a1')
     AND n.action_url = '/vehicle/' || (:'own_r'::jsonb ->> 'vehicle_id')
     AND n.organization_id = pg_temp.v('shop')
     AND n.metadata ->> 'basis' = 'capture_session' AND n.metadata ->> 'relationship' = 'owner'
     AND (n.metadata #>> '{evidence_summary,filed}')::int = 2 AND n.is_read = false));

-- (a) a technician at the shop, then that shop's client vehicle.
SELECT pg_temp.as_user('tech');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.capture('tech','s1','s2','7R01C100002','Ford','Mustang')) AS r \gset shop_
SELECT public.device_create_vehicle_profile(pg_temp.capture('tech','c1','c2','7R01C100003','Ford','Falcon',
  jsonb_build_object('client_id', pg_temp.v('client')))) AS r \gset client_
RESET ROLE;
SELECT pg_temp.ok('the relationship decides the words: technician at the shop, then the shop''s client',
 (SELECT title FROM public.user_notifications WHERE id = (:'shop_r'::jsonb ->> 'notification_id')::uuid)
   = 'New vehicle at Fixture Shop: 1966 Ford Mustang'
 AND (SELECT title FROM public.user_notifications WHERE id = (:'client_r'::jsonb ->> 'notification_id')::uuid)
   = 'Client vehicle profile: 1966 Ford Falcon'
 AND :'client_r'::jsonb ->> 'relationship' = 'client'
 AND (SELECT user_id FROM public.user_notifications WHERE id = (:'client_r'::jsonb ->> 'notification_id')::uuid) = pg_temp.u('tech'));

-- (b) tag_only: a candidate without an identifier, then the later burst on replay.
SELECT pg_temp.as_user('arrival');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.tag('t1', ARRAY['t1','t2']) || jsonb_build_object('serial','2S87R3N100001')) AS r \gset tag_with_serial_
SELECT public.device_create_vehicle_profile(jsonb_set(pg_temp.tag('t1', ARRAY['t1','t2']), '{evidence,tag_legibility}', '"partial"')) AS r \gset tag_partial_
SELECT public.device_create_vehicle_profile(pg_temp.tag('t1', ARRAY['t1','t2','t3'])) AS r \gset tag_
SELECT public.device_create_vehicle_profile(pg_temp.tag('t1', ARRAY['t1','t2','t3'])) AS r \gset tag_replay_
SELECT public.device_create_vehicle_profile(pg_temp.tag('t4', ARRAY['t4','t5'])) AS r \gset tag_later_
RESET ROLE;
SELECT pg_temp.ok('tag_only refuses an identifier read and an unclear tag',
 :'tag_with_serial_r'::jsonb ->> 'status' = 'invalid_input' AND :'tag_partial_r'::jsonb ->> 'status' = 'insufficient_evidence');
SELECT pg_temp.ok('a decoded tag without a VIN creates a private candidate that files the session',
 :'tag_r'::jsonb ->> 'status' = 'created' AND :'tag_r'::jsonb ->> 'identity_status' = 'needs_identifier'
 AND (SELECT vin IS NULL AND is_public = false AND year = 1973 AND make = 'Pontiac' AND model = 'Firebird'
        AND make_source = 'device_cowl_tag' AND vin_source IS NULL AND vin_confidence IS NULL
        AND origin_metadata ->> 'identity_status' = 'needs_identifier'
        AND origin_metadata #>> '{device_evidence,key}' = 'tag:PONTIAC:100001'
        AND origin_metadata #>> '{device_evidence,tag,series_code}' = '2FS87'
      FROM public.vehicles WHERE id = (:'tag_r'::jsonb ->> 'vehicle_id')::uuid)
 AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = (:'tag_r'::jsonb ->> 'vehicle_id')::uuid
      AND id IN (pg_temp.i('t1'), pg_temp.i('t2'), pg_temp.i('t3'))) = 3
 AND (:'tag_r'::jsonb #>> '{filing,counts,filed}')::int = 3);
SELECT pg_temp.ok('the candidate asks for the one missing frame, once; the later burst files on replay',
 EXISTS (SELECT 1 FROM public.user_notifications n
   WHERE n.id = (:'tag_r'::jsonb ->> 'notification_id')::uuid AND n.type = 'vehicle_profile_needs_identifier'
     AND n.title = 'Take one photo of the VIN plate to finish 1973 Pontiac Firebird'
     AND n.image_id = pg_temp.i('t1') AND n.metadata ->> 'identity_status' = 'needs_identifier')
 AND :'tag_replay_r'::jsonb ->> 'vehicle_id' = :'tag_r'::jsonb ->> 'vehicle_id'
 AND :'tag_later_r'::jsonb ->> 'vehicle_id' = :'tag_r'::jsonb ->> 'vehicle_id'
 AND (:'tag_later_r'::jsonb ->> 'replay')::boolean
 AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = (:'tag_r'::jsonb ->> 'vehicle_id')::uuid) = 5
 AND (SELECT count(*) FROM public.user_notifications WHERE vehicle_id = (:'tag_r'::jsonb ->> 'vehicle_id')::uuid) = 1);

-- (c) the gap between 17:31 and 22:44 on the candidate, and the owner's statement for it.
SELECT :'tag_r'::jsonb ->> 'vehicle_id' AS id \gset cand_
SELECT pg_temp.as_user('arrival');
SET ROLE authenticated;
SELECT public.get_user_day_receipt(pg_temp.u('arrival'), '2026-10-28') AS r \gset before_
SELECT public.record_work_session_testimony(:'cand_id', '2026-10-28', '2026-10-28T17:20:00Z', '2026-10-28T17:40:00Z', 'polish', 0.2) AS r \gset holds_photos_
SELECT public.record_work_session_testimony(:'cand_id', '2026-10-28', '2026-10-28T17:32:00Z', '2026-10-28T22:40:00Z', 'cut and polish', 6) AS r \gset too_long_
SELECT public.record_work_session_testimony(:'cand_id', '2026-10-28', '2026-10-28T17:32:00Z', '2026-10-28T22:40:00Z', 'cut and polish', 3) AS r \gset said_
SELECT public.record_work_session_testimony(:'cand_id', '2026-10-28', '2026-10-28T18:00:00Z', '2026-10-28T19:00:00Z', 'more polish', 1) AS r \gset again_
SELECT public.get_user_day_receipt(pg_temp.u('arrival'), '2026-10-28') AS r \gset after_
RESET ROLE;
SELECT pg_temp.as_user('tech');
SET ROLE authenticated;
SELECT public.record_work_session_testimony(:'cand_id', '2026-10-28', '2026-10-28T17:32:00Z', '2026-10-28T22:40:00Z', 'not mine', 1) AS r \gset stranger_
RESET ROLE;
SELECT pg_temp.ok('the receipt shows the gaps over an hour before any statement',
 jsonb_array_length(:'before_r'::jsonb -> 'gaps') = 2
 AND (:'before_r'::jsonb #>> '{facets,gaps}')::int = 2
 AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'before_r'::jsonb -> 'gaps') g
   WHERE (g ->> 'start')::timestamptz = '2026-10-28T17:31:00Z' AND (g ->> 'end')::timestamptz = '2026-10-28T22:44:00Z'
     AND (g ->> 'minutes')::int = 313 AND g ->> 'vehicle_id' = :'cand_id' AND g ->> 'testimony_id' IS NULL));
SELECT pg_temp.ok('statements that are not a gap, longer than the interval, or from a stranger are refused',
 :'holds_photos_r'::jsonb ->> 'status' = 'not_a_gap' AND :'too_long_r'::jsonb ->> 'status' = 'invalid_input'
 AND :'stranger_r'::jsonb ->> 'status' = 'not_authorized');
SELECT pg_temp.ok('the statement lands as a confirmed owner_testimony session',
 :'said_r'::jsonb ->> 'status' = 'recorded'
 AND EXISTS (SELECT 1 FROM public.work_sessions ws WHERE ws.id = (:'said_r'::jsonb ->> 'session_id')::uuid
   AND ws.user_id = pg_temp.u('arrival') AND ws.vehicle_id = :'cand_id'::uuid AND ws.session_type = 'owner_testimony'
   AND ws.intent_source = 'owner' AND ws.status = 'confirmed' AND ws.duration_minutes = 180
   AND ws.owner_confirmed_by = pg_temp.u('arrival') AND ws.owner_confirmed_at IS NOT NULL
   AND ws.start_time = '2026-10-28T17:32:00Z' AND ws.end_time = '2026-10-28T22:40:00Z'));
SELECT pg_temp.ok('an overlapping second statement is refused',
 :'again_r'::jsonb ->> 'status' = 'overlap' AND :'again_r'::jsonb ->> 'existing_session_id' = :'said_r'::jsonb ->> 'session_id'
 AND (SELECT count(*) FROM public.work_sessions WHERE session_type = 'owner_testimony') = 1);
SELECT pg_temp.ok('the receipt returns the gap with its testimony_id and the testimony session',
 EXISTS (SELECT 1 FROM jsonb_array_elements(:'after_r'::jsonb -> 'gaps') g
   WHERE (g ->> 'start')::timestamptz = '2026-10-28T17:31:00Z' AND g ->> 'testimony_id' = :'said_r'::jsonb ->> 'session_id')
 AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'after_r'::jsonb -> 'work_sessions') w
   WHERE w ->> 'id' = :'said_r'::jsonb ->> 'session_id' AND w ->> 'session_type' = 'owner_testimony'));
SELECT pg_temp.ok('writer access: signed-in callers only',
 NOT has_function_privilege('anon','public.record_work_session_testimony(uuid,date,timestamptz,timestamptz,text,numeric)','EXECUTE')
 AND has_function_privilege('authenticated','public.record_work_session_testimony(uuid,date,timestamptz,timestamptz,text,numeric)','EXECUTE')
 AND NOT has_function_privilege('anon','public.device_create_vehicle_profile(jsonb)','EXECUTE'));
SELECT 'vehicle arrival chain contract: PASS' AS result;
