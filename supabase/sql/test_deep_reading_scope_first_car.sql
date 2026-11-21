-- Contract: 20261121071700 turns the deep-reading and keyed-values stages on for one car with one open item a stage,
-- and keeps a thin reading (any tier the intake did not let state its tools) out of the two "frames analysed" counts.
-- Disposable PG17 only. Chained on the provider availability contract, whose provider_profile_read is production's
-- body; user_tool_action_shots_read comes from its own migration and is production's body too (both md5s below are
-- the live ones, read on 2026-11-20). The stage ledger's enqueue is a stand-in that records how it was called.
\ir test_provider_availability_area.sql

-- What the two readers and the migration use that the chained fixture omits.
ALTER TABLE public.vehicle_observations ADD COLUMN agent_tier text;
ALTER TABLE public.vehicle_images ADD COLUMN thumbnail_url text, ADD COLUMN medium_url text;
ALTER TABLE public.vehicles ADD COLUMN deleted_at timestamptz;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
-- Live helper (subset): the fixture keeps only the superseded and URL checks.
CREATE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(($1).is_superseded, false) = false AND nullif(btrim(($1).image_url), '') IS NOT NULL $$;
-- As in production: row security on, no policy, so only the owner (and a reader that runs as the owner) reads it.
CREATE TABLE public.platform_config(config_key text PRIMARY KEY, config_value jsonb NOT NULL, description text, updated_at timestamptz DEFAULT now());
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;
-- Production's body (20261120140000), and production's grants: not callable by the anonymous role.
CREATE FUNCTION public.image_reading_tier_is_reviewed(p_tier text, p_if_no_config boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  select case when coalesce(p_tier, '') = '' then true
              else coalesce((select case when jsonb_typeof(c.config_value -> 'reviewed_tiers') = 'array'
                                         then (c.config_value -> 'reviewed_tiers') ? p_tier end
                               from public.platform_config c where c.config_key = 'image_reading_tiers'), p_if_no_config) end $$;
REVOKE EXECUTE ON FUNCTION public.image_reading_tier_is_reviewed(text, boolean) FROM PUBLIC;
INSERT INTO public.platform_config(config_key, config_value) VALUES
 ('image_reading_tiers', '{"automatic": {"tier": "subscription automatic"}, "reviewed_tiers": ["caller-byok", "caller-byok subscription"]}'),
 ('image_stage_deep_reading', '{"enabled": false,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "vehicle_ids": ["67127bcb-1f2b-4472-ae4f-a2b86825027b", "20d21fb0-4651-4469-a0ba-e751309a1e54"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}');
-- The ledger's enqueue, standing in: it records the photos it was handed, the lane and the scope row it could see.
CREATE TABLE public.t_enqueue_calls(photos int, lane text, scope_seen jsonb);
CREATE FUNCTION public.enqueue_image_stage_work(p_image_ids uuid[], p_lane text DEFAULT NULL) RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.t_enqueue_calls VALUES (coalesce(array_length(p_image_ids, 1), 0), p_lane,
    (SELECT config_value FROM public.platform_config WHERE config_key = 'image_stage_deep_reading'));
  RETURN coalesce(nullif(current_setting('test.enqueue_returns', true), '')::int, 1);
END $$;

\ir ../migrations/20261020104500_tool_action_shots_read.sql

CREATE FUNCTION public.t_md5(fn text) RETURNS text LANGUAGE sql AS $$ SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure(fn) $$;
CREATE FUNCTION public.t_marks(fn text) RETURNS int LANGUAGE sql AS $$
  SELECT ((length(d) - length(replace(d, '(20261121071700)', ''))) / length('(20261121071700)'))::int
    FROM (SELECT pg_get_functiondef(to_regprocedure(fn)) d) x $$;
CREATE FUNCTION public.t_scope() RETURNS jsonb LANGUAGE sql AS $$ SELECT config_value FROM public.platform_config WHERE config_key = 'image_stage_deep_reading' $$;
CREATE TABLE public.t_def AS
  SELECT 'shots'::text AS name, pg_get_functiondef('public.user_tool_action_shots_read(uuid,text,integer)'::regprocedure) AS def;
CREATE TABLE public.t_row(name text PRIMARY KEY, v jsonb);
INSERT INTO public.t_row VALUES
 ('off', '{"enabled": false,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "vehicle_ids": ["67127bcb-1f2b-4472-ae4f-a2b86825027b", "20d21fb0-4651-4469-a0ba-e751309a1e54"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}'),
 ('on', '{"enabled": true, "max_open": 1,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "vehicle_ids": ["67127bcb-1f2b-4472-ae4f-a2b86825027b"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}');

SELECT t_assert(t_md5('public.user_tool_action_shots_read(uuid,text,integer)') = '9489f6d398c44dfe5d35e122e1b3eb42'
  AND t_md5('public.provider_profile_read(uuid,uuid)') = '1631cb05c272ca13f282100ae15c7e69',
  'fixture: both readers are production''s bodies of 2026-11-20');
SELECT t_assert(NOT has_function_privilege('anon', 'public.image_reading_tier_is_reviewed(text,boolean)', 'EXECUTE'),
  'fixture: the anonymous role cannot call the tier check itself, as in production');

-- A public profile's photos on a public car. A: a reviewed reading. B: an automatic reading only. C: a reviewed
-- reading and a newer automatic one (the intake refuses that pair; the readers must not depend on it). D: a reading
-- with no tier (a legacy reading, which states its tools). E: a reading under a tier nobody has listed, which the
-- intake also holds to the thin shape.
INSERT INTO public.vehicles(id, year, make, model, is_public) VALUES ('c1000000-0000-0000-0000-000000000001', 1966, 'Ford', 'Mustang', true);
INSERT INTO public.vehicle_images(id, vehicle_id, user_id, image_url, taken_at, is_external, is_sensitive, vision_gate_status) VALUES
 ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000f', 'https://img.example/a.jpg', '2026-10-01', false, false, 'approved'),
 ('c2000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000f', 'https://img.example/b.jpg', '2026-10-02', false, false, 'approved'),
 ('c2000000-0000-0000-0000-00000000000c', 'c1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000f', 'https://img.example/c.jpg', '2026-10-03', false, false, 'approved'),
 ('c2000000-0000-0000-0000-00000000000d', 'c1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000f', 'https://img.example/d.jpg', '2026-10-04', false, false, 'approved'),
 ('c2000000-0000-0000-0000-00000000000e', 'c1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000f', 'https://img.example/e.jpg', '2026-10-07', false, false, 'approved'),
 -- the canary car's photos: the ids the migration hands to the enqueue (its vehicle row is not in this fixture)
 ('c3000000-0000-0000-0000-000000000001', '67127bcb-1f2b-4472-ae4f-a2b86825027b', '10000000-0000-0000-0000-00000000000f', 'https://img.example/m1.jpg', '2026-10-05', false, false, 'approved'),
 ('c3000000-0000-0000-0000-000000000002', '67127bcb-1f2b-4472-ae4f-a2b86825027b', '10000000-0000-0000-0000-00000000000f', 'https://img.example/m2.jpg', '2026-10-06', false, false, 'approved');
INSERT INTO public.vehicle_observations(vehicle_id, kind, source_id, observed_at, structured_data, agent_tier) VALUES
 ('c1000000-0000-0000-0000-000000000001', 'condition', '90000000-0000-0000-0000-0000000000c1', '2026-10-10',
  '{"analysis_kind":"image_deep_byok","image_id":"c2000000-0000-0000-0000-00000000000a","workshop_signals":{"tools_visible":["floor jack"]}}', 'caller-byok subscription'),
 ('c1000000-0000-0000-0000-000000000001', 'condition', '90000000-0000-0000-0000-0000000000c1', '2026-10-11',
  '{"analysis_kind":"image_deep_byok","image_id":"c2000000-0000-0000-0000-00000000000b","workshop_signals":{"tools_visible":[]}}', 'subscription automatic'),
 ('c1000000-0000-0000-0000-000000000001', 'condition', '90000000-0000-0000-0000-0000000000c1', '2026-10-10',
  '{"analysis_kind":"image_deep_byok","image_id":"c2000000-0000-0000-0000-00000000000c","workshop_signals":{"tools_visible":["two-post lift"]}}', 'caller-byok subscription'),
 ('c1000000-0000-0000-0000-000000000001', 'condition', '90000000-0000-0000-0000-0000000000c1', '2026-10-20',
  '{"analysis_kind":"image_deep_byok","image_id":"c2000000-0000-0000-0000-00000000000c","workshop_signals":{"tools_visible":[]}}', 'subscription automatic'),
 ('c1000000-0000-0000-0000-000000000001', 'condition', '90000000-0000-0000-0000-0000000000c1', '2026-10-12',
  '{"analysis_kind":"image_deep_byok","image_id":"c2000000-0000-0000-0000-00000000000d","workshop_signals":{"tools_visible":["bench vise"]}}', NULL),
 ('c1000000-0000-0000-0000-000000000001', 'condition', '90000000-0000-0000-0000-0000000000c1', '2026-10-13',
  '{"analysis_kind":"image_deep_byok","image_id":"c2000000-0000-0000-0000-00000000000e","workshop_signals":{"tools_visible":[]}}', 'a tier nobody listed');

SELECT as_user(NULL);
CREATE TABLE public.t_read AS
  SELECT 'before'::text AS at, user_tool_action_shots_read('10000000-0000-0000-0000-00000000000f') AS shots,
         provider_profile_read('10000000-0000-0000-0000-00000000000f') #> '{tools,seen_in_frame}' AS seen;
SELECT t_assert((SELECT shots #> '{coverage}' @> '{"images_scanned":5,"frames_analyzed":5,"photos_with_tools":2}' AND NOT shots::text ~ 'two-post lift'
                   FROM t_read WHERE at = 'before'),
  'before: a thin reading is a frame, and as the newest reading of a photo it hides the tools an older one saw');
SELECT t_assert((SELECT seen @> '{"frames_analyzed":6,"frames_with_tools":3,"occurrences":3}' FROM t_read WHERE at = 'before'),
  'before: the profile counts all three thin readings as analysed frames');

-- ===== the migration
\ir ../migrations/20261121071700_deep_reading_scope_first_car.sql

INSERT INTO public.t_read SELECT 'after', user_tool_action_shots_read('10000000-0000-0000-0000-00000000000f'),
  provider_profile_read('10000000-0000-0000-0000-00000000000f') #> '{tools,seen_in_frame}';
SELECT t_assert((SELECT shots #> '{coverage}' @> '{"images_scanned":5,"frames_analyzed":3,"photos_with_tools":3}'
                        AND shots -> 'groups' @> '[{"label":"two-post lift","photos":1},{"label":"floor jack","photos":1},{"label":"bench vise","photos":1}]'
                   FROM t_read WHERE at = 'after'),
  'after: photos with only a thin reading (automatic, or an unlisted tier) are not frames; the older reviewed reading is the frame again; a reading with no tier still counts');
SELECT t_assert((SELECT seen @> '{"frames_analyzed":3,"frames_with_tools":3,"occurrences":3}' FROM t_read WHERE at = 'after'),
  'after: the profile counts the three readings whose tools were read');
-- The same two calls as the anonymous role, which cannot call the tier check itself: the readers run with their
-- owner's rights (a patched body that lost them would fail here, not on the live page).
GRANT INSERT ON public.t_read TO anon;
SET ROLE anon;
INSERT INTO public.t_read SELECT 'after as anon', public.user_tool_action_shots_read('10000000-0000-0000-0000-00000000000f'),
  public.provider_profile_read('10000000-0000-0000-0000-00000000000f') #> '{tools,seen_in_frame}';
RESET ROLE;
SELECT t_assert((SELECT a.shots #> '{coverage}' = b.shots #> '{coverage}' AND a.seen = b.seen
                   FROM t_read a, t_read b WHERE a.at = 'after as anon' AND b.at = 'after'),
  'after, called as the anonymous role: the same counts');
SELECT t_assert(t_marks('public.user_tool_action_shots_read(uuid,text,integer)') = 1 AND t_marks('public.provider_profile_read(uuid,uuid)') = 1,
  'each reader carries the marker once');
-- The digests the migration names for its own bodies (production's bodies of 2026-11-20 with the one line added).
SELECT t_assert(t_md5('public.user_tool_action_shots_read(uuid,text,integer)') = 'ac064c62d65f81c3b041b107b55a6941'
  AND t_md5('public.provider_profile_read(uuid,uuid)') = '9532ff0e15b8b434ec92014cc9b64da8',
  'both readers are the bodies the migration names');
SELECT t_assert(has_function_privilege('anon', 'public.user_tool_action_shots_read(uuid,text,integer)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.provider_profile_read(uuid,uuid)', 'EXECUTE')
  AND (SELECT bool_and(prosecdef) FROM pg_proc WHERE oid IN ('public.user_tool_action_shots_read(uuid,text,integer)'::regprocedure, 'public.provider_profile_read(uuid,uuid)'::regprocedure)),
  'both readers keep their grants and stay security definer');
SELECT t_assert(t_scope() = (SELECT v FROM t_row WHERE name = 'on'), 'the scope row is on for the one car with one open item a stage');
SELECT t_assert((SELECT count(*) = 1 AND bool_and(photos = 2 AND lane = 'backfill' AND scope_seen = (SELECT v FROM t_row WHERE name = 'on')) FROM t_enqueue_calls),
  'the car''s photos were handed to the ledger''s enqueue once, in the backfill lane, after the row was on');

-- ===== with the tiers row missing, both readers count every reading, as before the migration
BEGIN;
DELETE FROM public.platform_config WHERE config_key = 'image_reading_tiers';
SELECT t_assert((SELECT user_tool_action_shots_read('10000000-0000-0000-0000-00000000000f') #> '{coverage}' @> '{"frames_analyzed":5}')
  AND (SELECT provider_profile_read('10000000-0000-0000-0000-00000000000f') #> '{tools,seen_in_frame}' @> '{"frames_analyzed":6}'),
  'tiers row missing: nothing is hidden');
ROLLBACK;

-- ===== replay: nothing moves
CREATE TABLE public.t_md5_after AS SELECT t_md5('public.user_tool_action_shots_read(uuid,text,integer)') AS shots, t_md5('public.provider_profile_read(uuid,uuid)') AS prof;
\ir ../migrations/20261121071700_deep_reading_scope_first_car.sql
SELECT t_assert((SELECT shots = t_md5('public.user_tool_action_shots_read(uuid,text,integer)') AND prof = t_md5('public.provider_profile_read(uuid,uuid)') FROM t_md5_after)
  AND t_scope() = (SELECT v FROM t_row WHERE name = 'on') AND (SELECT count(*) = 1 FROM t_enqueue_calls),
  'replay: readers, scope row and queue are left as they are');

-- ===== a later row that is on (the car widened) is not replaced, and nothing is queued by a replay
UPDATE public.platform_config SET config_value = config_value || '{"max_open": 60}' WHERE config_key = 'image_stage_deep_reading';
\ir ../migrations/20261121071700_deep_reading_scope_first_car.sql
SELECT t_assert(t_scope() = (SELECT v || '{"max_open": 60}' FROM t_row WHERE name = 'on') AND (SELECT count(*) = 1 FROM t_enqueue_calls),
  'replay over a widened row: the row is kept and nothing is queued');

-- ===== revert: a widened row is switched off with its keys kept; the readers are production's bodies again
\ir revert_20261121071700_deep_reading_scope_first_car.sql
SELECT t_assert(t_scope() = (SELECT v || '{"max_open": 60, "enabled": false}' FROM t_row WHERE name = 'on'), 'revert: a widened row is switched off, its other keys kept');
SELECT t_assert(t_md5('public.user_tool_action_shots_read(uuid,text,integer)') = '9489f6d398c44dfe5d35e122e1b3eb42'
  AND t_md5('public.provider_profile_read(uuid,uuid)') = '1631cb05c272ca13f282100ae15c7e69', 'revert: both readers are production''s earlier bodies');
\ir revert_20261121071700_deep_reading_scope_first_car.sql
SELECT t_assert(t_scope() = (SELECT v || '{"max_open": 60, "enabled": false}' FROM t_row WHERE name = 'on')
  AND t_marks('public.user_tool_action_shots_read(uuid,text,integer)') = 0 AND t_marks('public.provider_profile_read(uuid,uuid)') = 0, 'revert twice: nothing more');

-- ===== refused: a row that is off but is not the one 20261120130000 inserted (the readers' patch is rolled back with it)
\set ON_ERROR_STOP off
\ir ../migrations/20261121071700_deep_reading_scope_first_car.sql
\set ON_ERROR_STOP on
SELECT t_assert(t_scope() = (SELECT v || '{"max_open": 60, "enabled": false}' FROM t_row WHERE name = 'on')
  AND t_marks('public.user_tool_action_shots_read(uuid,text,integer)') = 0 AND t_marks('public.provider_profile_read(uuid,uuid)') = 0
  AND (SELECT count(*) = 1 FROM t_enqueue_calls),
  'refused: an off row that differs is not replaced, and the readers are rolled back with the switch');

-- ===== refused: the switch queued nothing
UPDATE public.platform_config SET config_value = (SELECT v FROM t_row WHERE name = 'off') WHERE config_key = 'image_stage_deep_reading';
SELECT set_config('test.enqueue_returns', '0', false);
\set ON_ERROR_STOP off
\ir ../migrations/20261121071700_deep_reading_scope_first_car.sql
\set ON_ERROR_STOP on
SELECT t_assert(t_scope() = (SELECT v FROM t_row WHERE name = 'off')
  AND t_marks('public.user_tool_action_shots_read(uuid,text,integer)') = 0 AND t_marks('public.provider_profile_read(uuid,uuid)') = 0
  AND (SELECT count(*) = 1 FROM t_enqueue_calls),
  'refused: a switch that queued nothing leaves the scope off and the readers as they were');
SELECT set_config('test.enqueue_returns', '2', false);
\set ON_ERROR_STOP off
\ir ../migrations/20261121071700_deep_reading_scope_first_car.sql
\set ON_ERROR_STOP on
SELECT t_assert(t_scope() = (SELECT v FROM t_row WHERE name = 'off') AND (SELECT count(*) = 1 FROM t_enqueue_calls),
  'refused: a switch that queued more than one item leaves the scope off');
SELECT set_config('test.enqueue_returns', '1', false);

-- ===== refused: a reader that is no longer the body the migration was written against (the scope stays off, and
-- the other reader is not replaced either)
DO $$ BEGIN
  EXECUTE replace((SELECT def FROM t_def WHERE name = 'shots'), 'ORDER BY ob.observed_at DESC NULLS LAST, ob.id LIMIT 1) o', 'ORDER BY ob.observed_at DESC NULLS LAST, ob.id DESC LIMIT 1) o');
END $$;
CREATE TABLE public.t_md5_moved AS SELECT t_md5('public.user_tool_action_shots_read(uuid,text,integer)') AS shots;
\set ON_ERROR_STOP off
\ir ../migrations/20261121071700_deep_reading_scope_first_car.sql
\set ON_ERROR_STOP on
SELECT t_assert(t_scope() = (SELECT v FROM t_row WHERE name = 'off') AND (SELECT count(*) = 1 FROM t_enqueue_calls)
  AND t_md5('public.user_tool_action_shots_read(uuid,text,integer)') = (SELECT shots FROM t_md5_moved)
  AND t_md5('public.provider_profile_read(uuid,uuid)') = '1631cb05c272ca13f282100ae15c7e69',
  'refused: a reader that moved since is not overwritten, and the refusal takes the other reader and the scope with it');
DO $$ BEGIN EXECUTE (SELECT def FROM t_def WHERE name = 'shots'); END $$;

-- ===== applied again from the reverted state: the true inverse round trip
\ir ../migrations/20261121071700_deep_reading_scope_first_car.sql
SELECT t_assert(t_scope() = (SELECT v FROM t_row WHERE name = 'on') AND (SELECT count(*) = 2 FROM t_enqueue_calls)
  AND (SELECT shots = t_md5('public.user_tool_action_shots_read(uuid,text,integer)') AND prof = t_md5('public.provider_profile_read(uuid,uuid)') FROM t_md5_after),
  'applied again: the same row, the same bodies, one more enqueue');
\ir revert_20261121071700_deep_reading_scope_first_car.sql
SELECT t_assert(t_scope() = (SELECT v FROM t_row WHERE name = 'off')
  AND t_md5('public.user_tool_action_shots_read(uuid,text,integer)') = '9489f6d398c44dfe5d35e122e1b3eb42'
  AND t_md5('public.provider_profile_read(uuid,uuid)') = '1631cb05c272ca13f282100ae15c7e69',
  'revert of the migration''s own row: the row 20261120130000 inserted and production''s earlier bodies');

-- ===== revert over a reader that drifted but kept the marker: the scope goes off all the same; the readers are left
\ir ../migrations/20261121071700_deep_reading_scope_first_car.sql
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.user_tool_action_shots_read(uuid,text,integer)'::regprocedure),
                  'a thin reading''s tools were not read', 'a thin reading''s tools were not read; edited later');
END $$;
CREATE TABLE public.t_md5_drift AS SELECT t_md5('public.user_tool_action_shots_read(uuid,text,integer)') AS shots;
\set ON_ERROR_STOP off
\ir revert_20261121071700_deep_reading_scope_first_car.sql
\set ON_ERROR_STOP on
SELECT t_assert(t_scope() = (SELECT v FROM t_row WHERE name = 'off') AND (SELECT count(*) = 3 FROM t_enqueue_calls)
  AND t_md5('public.user_tool_action_shots_read(uuid,text,integer)') = (SELECT shots FROM t_md5_drift)
  AND t_marks('public.user_tool_action_shots_read(uuid,text,integer)') = 1 AND t_marks('public.provider_profile_read(uuid,uuid)') = 1,
  'revert over a drifted reader: the scope is off; both readers are left as they are');
DO $$ BEGIN EXECUTE (SELECT def FROM t_def WHERE name = 'shots'); END $$;
\ir revert_20261121071700_deep_reading_scope_first_car.sql
SELECT t_assert(t_scope() = (SELECT v FROM t_row WHERE name = 'off')
  AND t_md5('public.user_tool_action_shots_read(uuid,text,integer)') = '9489f6d398c44dfe5d35e122e1b3eb42'
  AND t_md5('public.provider_profile_read(uuid,uuid)') = '1631cb05c272ca13f282100ae15c7e69',
  'the drifted reader put back by hand, the revert restores the other: production''s earlier bodies');
