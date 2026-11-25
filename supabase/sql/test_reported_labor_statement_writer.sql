-- reported_labor_hours_v1 writer: PG17 contract. Chains the check test (keys ratified, check installed, source rows),
-- adds the columns the writer reads as production has them (read 2026-11-25), installs the live
-- citation_required_write_check (pg_get_functiondef 2026-11-25), applies 20261125194500 twice, and drives
-- record_reported_labor_statement through admit, hold, refuse, replay, bypass and supersession.
-- Fixture rows below live in a disposable test database only.
\set ON_ERROR_STOP on
\ir test_reported_labor_statement_check.sql

ALTER TABLE public.auction_comments ADD COLUMN IF NOT EXISTS platform text, ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.build_posts ADD COLUMN IF NOT EXISTS posted_at timestamptz, ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.build_threads ADD COLUMN IF NOT EXISTS forum_source_id uuid;
CREATE TABLE IF NOT EXISTS public.forum_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL);
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS auction_source text, ADD COLUMN IF NOT EXISTS listing_source text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
CREATE TABLE IF NOT EXISTS public.observation_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
ALTER TABLE public.observation_sources ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.vehicle_observations
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.observation_properties(id),
  ADD COLUMN IF NOT EXISTS observed_at_basis text, ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.observation_sources(id),
  ADD COLUMN IF NOT EXISTS source_identifier text, ADD COLUMN IF NOT EXISTS raw_source_ref text, ADD COLUMN IF NOT EXISTS content_text text,
  ADD COLUMN IF NOT EXISTS content_hash text, ADD COLUMN IF NOT EXISTS extraction_method text, ADD COLUMN IF NOT EXISTS extraction_metadata jsonb,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.vehicle_observations(id), ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS lineage_chain uuid[], ADD COLUMN IF NOT EXISTS is_processed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_metadata jsonb, ADD COLUMN IF NOT EXISTS source_comment_id uuid REFERENCES public.auction_comments(id),
  ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid, ADD COLUMN IF NOT EXISTS subject_type text NOT NULL DEFAULT 'vehicle',
  ADD COLUMN IF NOT EXISTS subject_id uuid, ADD COLUMN IF NOT EXISTS subject_organization_id uuid;
-- the live citation check (every vehicle_observations write names a source or a signed-in person)
CREATE OR REPLACE FUNCTION public.citation_required_write_check() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.source_id IS NULL AND NEW.submitted_by_user_id IS NULL THEN
    RAISE EXCEPTION 'citation_required: vehicle_observations write must include source_id (system source) or submitted_by_user_id (authenticated human). Got kind=%, vehicle_id=%.',
      NEW.kind, NEW.vehicle_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $function$;
CREATE TRIGGER trg_citation_required_vehicle_observations BEFORE INSERT OR UPDATE ON public.vehicle_observations
  FOR EACH ROW EXECUTE FUNCTION public.citation_required_write_check();

INSERT INTO public.observation_sources (slug, display_name, category) VALUES ('bat', 'BaT', 'auction'), ('rennlist', 'Rennlist', 'forum');
INSERT INTO public.forum_sources (id, slug) VALUES ('34000000-0000-0000-0000-000000000001', 'rennlist');
UPDATE public.build_threads SET forum_source_id = '34000000-0000-0000-0000-000000000001';
UPDATE public.build_posts SET posted_at = '2024-03-02 10:00+00' WHERE id = '32000000-0000-0000-0000-000000000001';
UPDATE public.vehicles SET auction_source = 'bat' WHERE id = '30000000-0000-0000-0000-000000000001';
-- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
UPDATE public.auction_comments SET platform = 'bat', posted_at = '2024-05-01 18:00+00';
INSERT INTO public.auction_comments (id, comment_text, vehicle_id, is_seller, platform, posted_at) VALUES
  ('33000000-0000-0000-0000-000000000009', 'Did the LS3 swap last spring, it took me about 40 hours total.', '30000000-0000-0000-0000-000000000001', true, 'sbx_cars', now());

\ir ../migrations/20261125194500_reported_labor_statement_writer.sql
\ir ../migrations/20261125194500_reported_labor_statement_writer.sql

DO $$
DECLARE
  task_q jsonb := '{"labor_scope":"task","labor_system_key":"engine","labor_speaker_role":"owner_seller","labor_statement_kind":"actual","labor_time_basis":"own"}';
  ok_q jsonb := '{"labor_scope":"whole_build","labor_speaker_role":"owner_seller","labor_statement_kind":"actual","labor_time_basis":"own"}';
  v1 uuid := '30000000-0000-0000-0000-000000000001';
  ls3 uuid := '33000000-0000-0000-0000-000000000002';
  r jsonb; r2 jsonb; o record; e record; n0 bigint; n1 bigint;
BEGIN
  SELECT count(*) INTO n0 FROM public.vehicle_observations;
  r := public.record_reported_labor_statement('auction_comments', ls3, 'Did the LS3 swap last spring, it took me about 40 hours total', 40, NULL,
         task_q, '{"model": "fixture"}');
  PERFORM pg_temp.ok('seller comment admitted, two rows: ' || r::text, r->>'disposition' = 'admitted' AND (r->>'writes')::int = 2);
  SELECT * INTO o FROM public.vehicle_observations WHERE id = (r->>'observation_id')::uuid;
  PERFORM pg_temp.ok('observation: no car, work_record, low property, the comment''s clock and house',
    o.vehicle_id IS NULL AND o.kind = 'work_record' AND o.property_id = (SELECT id FROM public.observation_properties WHERE property_key = 'labor_hours_reported_low')
    AND o.observed_at = '2024-05-01 18:00+00' AND o.observed_at_basis = 'source_publication_time'
    AND o.source_id = (SELECT id FROM public.observation_sources WHERE slug = 'bat') AND o.source_comment_id IS NULL
    AND o.content_text = 'Did the LS3 swap last spring, it took me about 40 hours total'
    AND o.structured_data->>'speaker_role' = 'owner_seller' AND o.extraction_metadata->'reader'->>'model' = 'fixture');
  SELECT * INTO e FROM public.reported_labor_statements WHERE observation_id = o.id;
  PERFORM pg_temp.ok('edge row: the comment, the page car, the system key, by FK',
    e.source_comment_id = ls3 AND e.page_vehicle_id = v1 AND e.system_key = 'engine' AND e.low = 40 AND e.disposition = 'admitted'
    AND e.speaker_role = 'owner_seller' AND e.source_build_post_id IS NULL AND e.subject_make_id IS NULL);

  r2 := public.record_reported_labor_statement('auction_comments', ls3, 'Did the LS3 swap last spring, it took me about 40 hours total', 40, NULL, task_q);
  PERFORM pg_temp.ok('replay returns the landed row and writes nothing: ' || r2::text,
    (r2->>'duplicate')::boolean AND r2->>'observation_id' = r->>'observation_id' AND (r2->>'writes')::int = 0);

  r := public.record_reported_labor_statement('auction_comments', '33000000-0000-0000-0000-000000000001',
         'I had 2500 hours in my 1970 Pontiac GTO without the paint', 2500, NULL,
         '{"labor_scope":"whole_build","labor_speaker_role":"commenter_other_car","labor_statement_kind":"actual","labor_time_basis":"own","labor_stated_subject":"1970 Pontiac GTO"}');
  SELECT * INTO e FROM public.reported_labor_statements WHERE observation_id = (r->>'observation_id')::uuid;
  PERFORM pg_temp.ok('another car''s hours: admitted with the subject make and model by FK and no car on the row: ' || r::text,
    r->>'disposition' = 'admitted' AND e.speaker_role = 'commenter_other_car'
    AND e.subject_make_id = (SELECT id FROM public.canonical_makes WHERE canonical_name = 'PONTIAC')
    AND e.subject_model_id = (SELECT id FROM public.canonical_models WHERE canonical_model = 'GTO')
    AND e.subject_make_alias_id IS NULL
    AND (SELECT vehicle_id FROM public.vehicle_observations WHERE id = e.observation_id) IS NULL);

  r := public.record_reported_labor_statement('auction_comments', '33000000-0000-0000-0000-000000000012',
         'I spent 90 hours welding my Pontiac too', 90, NULL,
         '{"labor_scope":"whole_build","labor_speaker_role":"commenter_other_car","labor_statement_kind":"actual","labor_time_basis":"own","labor_stated_subject":"Pontiac"}');
  SELECT * INTO e FROM public.reported_labor_statements WHERE observation_id = (r->>'observation_id')::uuid;
  PERFORM pg_temp.ok('a make alone: lands held subject_not_resolved with no subject keys and no role: ' || r::text,
    e.disposition = 'held' AND e.held_reasons = ARRAY['subject_not_resolved'] AND e.speaker_role IS NULL
    AND e.subject_make_id IS NULL AND e.subject_model_id IS NULL AND e.subject_make_alias_id IS NULL);

  r := public.record_reported_labor_statement('auction_comments', '33000000-0000-0000-0000-000000000007',
         'I drove 6 hours to see this car in person', 6, NULL, ok_q);
  SELECT * INTO e FROM public.reported_labor_statements WHERE observation_id = (r->>'observation_id')::uuid;
  PERFORM pg_temp.ok('no work word: lands held with its reason, role NULL with its reason: ' || r::text,
    r->>'disposition' = 'held' AND e.disposition = 'held' AND e.held_reasons = ARRAY['no_labor_context']
    AND e.speaker_role IS NULL AND e.speaker_role_null_reason = 'source_does_not_establish_speaker');

  SELECT count(*) INTO n1 FROM public.vehicle_observations;
  r := public.record_reported_labor_statement('auction_comments', '33000000-0000-0000-0000-000000000005',
         'Only 3 hours until this one closes', 3, NULL, ok_q);
  PERFORM pg_temp.ok('time left: refused, nothing written: ' || r::text, r->>'disposition' = 'refused'
    AND r->'reasons' ? 'quote_time_phrase' AND (SELECT count(*) FROM public.vehicle_observations) = n1);
  r := public.record_reported_labor_statement('auction_comments', '33000000-0000-0000-0000-000000000009',
         'Did the LS3 swap last spring, it took me about 40 hours total', 40, NULL, task_q);
  PERFORM pg_temp.ok('a house with no registry row: refused source_unregistered, nothing written: ' || r::text,
    r->'reasons' = '["source_unregistered"]'::jsonb AND (SELECT count(*) FROM public.vehicle_observations) = n1);

  r := public.record_reported_labor_statement('build_posts', '32000000-0000-0000-0000-000000000001',
         'Rebuilding the motor took about 40-60 hrs of my own time', 40, 60, task_q);
  SELECT * INTO e FROM public.reported_labor_statements WHERE observation_id = (r->>'observation_id')::uuid;
  PERFORM pg_temp.ok('build post: forum house, post clock, thread author is owner_seller: ' || r::text,
    r->>'disposition' = 'admitted' AND e.source_build_post_id = '32000000-0000-0000-0000-000000000001' AND e.high = 60
    AND e.source_id = (SELECT id FROM public.observation_sources WHERE slug = 'rennlist') AND e.speaker_role = 'owner_seller'
    AND (SELECT observed_at FROM public.vehicle_observations WHERE id = e.observation_id) = '2024-03-02 10:00+00');
  r := public.record_reported_labor_statement('build_posts', '32000000-0000-0000-0000-000000000002',
         'My own motor took about 80 hrs of evenings to rebuild', 80, NULL, task_q);
  PERFORM pg_temp.ok('a post with no posted_at takes its capture clock: ' || r::text, (SELECT observed_at_basis
    FROM public.vehicle_observations WHERE id = (r->>'observation_id')::uuid) = 'source_capture_time');
  r := public.record_reported_labor_statement('vehicles', v1, 'I put 1,200 hours into the body and paint over four years', 1200, NULL, ok_q);
  SELECT * INTO e FROM public.reported_labor_statements WHERE observation_id = (r->>'observation_id')::uuid;
  PERFORM pg_temp.ok('description: the listing house, the car as source and page, no speaker: ' || r::text,
    r->>'disposition' = 'admitted' AND e.source_vehicle_id = v1 AND e.page_vehicle_id = v1 AND e.speaker_role IS NULL
    AND e.source_id = (SELECT id FROM public.observation_sources WHERE slug = 'bat'));

  PERFORM pg_temp.ok('every landed statement has its edge row and no car',
    (SELECT count(*) FROM public.vehicle_observations WHERE extraction_method = 'reported_labor_hours_v1')
    = (SELECT count(*) FROM public.reported_labor_statements)
    AND NOT EXISTS (SELECT 1 FROM public.vehicle_observations WHERE extraction_method = 'reported_labor_hours_v1' AND vehicle_id IS NOT NULL));
  PERFORM pg_temp.ok('qualifiers: present only with a value; a whole-build statement carries no system key nor its reason',
    NOT EXISTS (SELECT 1 FROM public.vehicle_observations vo, jsonb_each(vo.structured_data) j
                 WHERE vo.extraction_method = 'reported_labor_hours_v1' AND j.value = 'null'::jsonb)
    AND NOT EXISTS (SELECT 1 FROM public.vehicle_observations vo WHERE vo.extraction_method = 'reported_labor_hours_v1'
                     AND vo.structured_data ->> 'labor_scope' = 'whole_build'
                     AND (vo.structured_data ? 'labor_system_key' OR vo.structured_data ? 'labor_system_key_null_reason'))
    AND (SELECT count(*) FROM public.vehicle_observations vo WHERE vo.extraction_method = 'reported_labor_hours_v1'
          AND vo.structured_data ->> 'labor_system_key' = 'engine') = 3);
  PERFORM pg_temp.ok('landed statements reach neither public reader', (SELECT disposition FROM public.proj_disposition WHERE vehicle_id = v1) = 'unknown'
    AND NOT EXISTS (SELECT 1 FROM public.vehicle_build_log_public(v1)));

  -- supersession: a later statement from the same source row supersedes; nothing else moves
  r := public.record_reported_labor_statement('auction_comments', ls3, 'it took me about 40 hours total', 40, NULL, task_q);
  PERFORM pg_temp.ok('a second quote from the same comment lands: ' || r::text, r->>'disposition' = 'admitted');
  -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
  UPDATE public.vehicle_observations SET is_superseded = true, superseded_by = (r->>'observation_id')::uuid, superseded_at = now()
   WHERE content_text = 'Did the LS3 swap last spring, it took me about 40 hours total';
  PERFORM pg_temp.ok('superseded by its successor', (SELECT is_superseded FROM public.vehicle_observations
    WHERE content_text = 'Did the LS3 swap last spring, it took me about 40 hours total'));
END $$;

-- bypasses and edits are refused
DO $$
DECLARE refused int := 0; sid uuid := (SELECT id FROM public.observation_sources WHERE slug = 'bat');
  prop uuid := (SELECT id FROM public.observation_properties WHERE property_key = 'labor_hours_reported_low');
BEGIN
  BEGIN
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    INSERT INTO public.vehicle_observations (kind, property_id, source_id, source_identifier, content_text, extraction_method, structured_data)
    VALUES ('work_record', prop, sid, 'reported_labor_hours_v1:x', 'I put 900 hours into it', 'reported_labor_hours_v1',
            '{"contract": "reported_labor_hours_v1", "disposition": "admitted"}');
  EXCEPTION WHEN check_violation THEN refused := refused + 1; END;
  BEGIN
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    INSERT INTO public.vehicle_observations (kind, source_id, structured_data) VALUES ('work_record', sid, '{"contract": "reported_labor_hours_v1"}');
  EXCEPTION WHEN check_violation THEN refused := refused + 1; END;
  BEGIN
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    UPDATE public.vehicle_observations SET content_text = 'I put 9000 hours into it' WHERE extraction_method = 'reported_labor_hours_v1'
       AND structured_data->>'source_table' = 'vehicles';
  EXCEPTION WHEN check_violation THEN refused := refused + 1; END;
  BEGIN
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    UPDATE public.vehicle_observations SET is_superseded = false, superseded_by = NULL, superseded_at = NULL WHERE is_superseded
       AND extraction_method = 'reported_labor_hours_v1';
  EXCEPTION WHEN check_violation THEN refused := refused + 1; END;
  BEGIN
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    UPDATE public.vehicle_observations SET is_superseded = true, superseded_at = now(),
           superseded_by = (SELECT id FROM public.vehicle_observations WHERE content_text = 'it took me about 40 hours total')
     WHERE extraction_method = 'reported_labor_hours_v1' AND structured_data->>'source_row_id' = '33000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN check_violation THEN refused := refused + 1; END;
  BEGIN
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    DELETE FROM public.vehicle_observations WHERE extraction_method = 'reported_labor_hours_v1';
  EXCEPTION WHEN check_violation THEN refused := refused + 1; END;
  -- a writer-shaped row with the setting forged by the owner itself: refused on the car, and without the setting
  BEGIN
    PERFORM set_config('nuke.reported_labor_writer', 'b0000000-0000-0000-0000-000000000001', true);
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    INSERT INTO public.vehicle_observations (id, vehicle_id, kind, property_id, source_id, source_identifier, content_text, content_hash, extraction_method, structured_data, observed_at, observed_at_basis)
    VALUES ('b0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'work_record', prop, sid, 'reported_labor_hours_v1:z',
            'I put 900 hours into it', md5('reported-labor:reported_labor_hours_v1:z'), 'reported_labor_hours_v1',
            '{"contract": "reported_labor_hours_v1", "disposition": "admitted"}', now(), 'source_publication_time');
  EXCEPTION WHEN check_violation THEN refused := refused + 1; END;
  BEGIN
    PERFORM set_config('nuke.reported_labor_writer', '', true);
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    INSERT INTO public.vehicle_observations (id, kind, property_id, source_id, source_identifier, content_text, content_hash, extraction_method, structured_data, observed_at, observed_at_basis)
    VALUES ('b0000000-0000-0000-0000-000000000002', 'work_record', prop, sid, 'reported_labor_hours_v1:w',
            'I put 900 hours into it', md5('reported-labor:reported_labor_hours_v1:w'), 'reported_labor_hours_v1',
            '{"contract": "reported_labor_hours_v1", "disposition": "admitted"}', now(), 'source_publication_time');
  EXCEPTION WHEN check_violation THEN refused := refused + 1; END;
  -- a row with another property is untouched by the gate
  -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
  INSERT INTO public.vehicle_observations (kind, property_id, source_id, content_text, extraction_method, structured_data)
  VALUES ('work_record', (SELECT id FROM public.observation_properties WHERE property_key NOT LIKE 'labor_hours_reported%' ORDER BY id LIMIT 1),
          sid, 'other property row', 'manual', '{}');
  -- keyed to a labor property by another method: a statement too (low and high), and a row moved onto the property
  BEGIN
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    INSERT INTO public.vehicle_observations (kind, property_id, source_id, content_text, extraction_method, structured_data)
    VALUES ('work_record', prop, sid, 'I put 900 hours into it', 'manual', '{}');
  EXCEPTION WHEN check_violation THEN refused := refused + 1; END;
  BEGIN
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    INSERT INTO public.vehicle_observations (kind, property_id, source_id, content_text, extraction_method, structured_data)
    VALUES ('work_record', (SELECT id FROM public.observation_properties WHERE property_key = 'labor_hours_reported_high'), sid,
            'I put 900 hours into it', 'manual', '{}');
  EXCEPTION WHEN check_violation THEN refused := refused + 1; END;
  BEGIN
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    UPDATE public.vehicle_observations SET property_id = prop WHERE content_text = 'other property row';
  EXCEPTION WHEN check_violation THEN refused := refused + 1; END;
  -- writer-shaped in every column but its clock basis (setting and owner forged by the owner itself): refused
  BEGIN
    PERFORM set_config('nuke.reported_labor_writer', 'b0000000-0000-0000-0000-000000000003', true);
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    INSERT INTO public.vehicle_observations (id, kind, property_id, source_id, source_identifier, content_text, content_hash, extraction_method, structured_data, observed_at)
    VALUES ('b0000000-0000-0000-0000-000000000003', 'work_record', prop, sid, 'reported_labor_hours_v1:v',
            'I put 900 hours into it', md5('reported-labor:reported_labor_hours_v1:v'), 'reported_labor_hours_v1',
            '{"contract": "reported_labor_hours_v1", "disposition": "admitted"}', now());
  EXCEPTION WHEN check_violation THEN refused := refused + 1; END;
  PERFORM set_config('nuke.reported_labor_writer', '', true);
  PERFORM pg_temp.ok('direct inserts (two malformed, one on the car, one without the writer setting, one without its clock basis, '
    || 'two by property), edit, move onto the property, un-supersede, supersede by another row''s statement and delete all refused: '
    || refused, refused = 12);
  PERFORM pg_temp.ok('a row keyed to another property lands and stays off the labor property',
    EXISTS (SELECT 1 FROM public.vehicle_observations WHERE content_text = 'other property row' AND property_id IS DISTINCT FROM prop));
END $$;

-- a caller who forges the writer's setting but is not the writer's owner is refused
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fx_forger') THEN CREATE ROLE fx_forger; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO fx_forger;
GRANT INSERT, SELECT ON public.vehicle_observations TO fx_forger;
GRANT SELECT ON public.observation_properties TO fx_forger;  -- as service_role has it
DO $$
DECLARE refused boolean := false; fid uuid := gen_random_uuid();
  prop uuid := (SELECT id FROM public.observation_properties WHERE property_key = 'labor_hours_reported_low');
  sid uuid := (SELECT id FROM public.observation_sources WHERE slug = 'bat');
BEGIN
  PERFORM set_config('nuke.reported_labor_writer', fid::text, true);
  SET LOCAL ROLE fx_forger;
  BEGIN
    -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
    INSERT INTO public.vehicle_observations (id, kind, property_id, source_id, source_identifier, content_text, content_hash, extraction_method, structured_data, observed_at, observed_at_basis)
    VALUES (fid, 'work_record', prop, sid, 'reported_labor_hours_v1:y', 'I put 900 hours into it',
            md5('reported-labor:reported_labor_hours_v1:y'), 'reported_labor_hours_v1',
            '{"contract": "reported_labor_hours_v1", "disposition": "admitted"}', now(), 'source_publication_time');
  EXCEPTION WHEN check_violation THEN refused := true; END;
  RESET ROLE;
  PERFORM pg_temp.ok('a forged writer setting from another role is refused', refused);
END $$;

-- another role's row keyed to another property passes the property gate (the gate runs as the caller)
DO $$
DECLARE sid uuid := (SELECT id FROM public.observation_sources WHERE slug = 'bat');
  other uuid := (SELECT id FROM public.observation_properties WHERE property_key NOT LIKE 'labor_hours_reported%' ORDER BY id LIMIT 1);
BEGIN
  SET LOCAL ROLE fx_forger;
  -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
  INSERT INTO public.vehicle_observations (kind, property_id, source_id, content_text, extraction_method, structured_data)
  VALUES ('work_record', other, sid, 'another role, another property', 'manual', '{}');
  RESET ROLE;
  PERFORM pg_temp.ok('another role lands a row keyed to another property',
    EXISTS (SELECT 1 FROM public.vehicle_observations WHERE content_text = 'another role, another property'));
END $$;

DO $$ BEGIN
  PERFORM pg_temp.ok('anon cannot call the writer', NOT has_function_privilege('anon',
    'public.record_reported_labor_statement(text,uuid,text,numeric,numeric,jsonb,jsonb)', 'EXECUTE'));
  PERFORM pg_temp.ok('anon cannot read the edges', NOT has_table_privilege('anon', 'public.reported_labor_statements', 'SELECT'));
  PERFORM pg_temp.ok('service_role cannot write the edges directly', NOT has_table_privilege('service_role', 'public.reported_labor_statements', 'INSERT'));
END $$;
-- two sessions write one statement at once: exactly one row lands, the second answers its replay (ta-pipeline)
CREATE EXTENSION IF NOT EXISTS dblink;
DO $$
DECLARE conn text := format('dbname=%s host=%s port=%s user=%s', current_database(),
    split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_user);
  a jsonb; b jsonb; n int;
  call text := $c$SELECT public.record_reported_labor_statement('auction_comments', '33000000-0000-0000-0000-000000000016',
    'I spent 40 hours welding a Pontiac GTO engine into my truck', %s, NULL,
    '{"labor_scope":"whole_build","labor_speaker_role":"commenter_other_car","labor_statement_kind":"actual","labor_time_basis":"own","labor_stated_subject":"Pontiac GTO"}',
    '{}')::text$c$;
BEGIN
  PERFORM dblink_connect('rl_a', conn);
  PERFORM dblink_connect('rl_b', conn);
  PERFORM dblink_exec('rl_a', 'BEGIN');
  -- the second session writes the figure as 40.0: one statement, one lock (ta-skeptic2)
  SELECT x::jsonb INTO a FROM dblink('rl_a', format(call, '40')) AS t(x text);
  PERFORM dblink_send_query('rl_b', format(call, '40.0'));
  PERFORM pg_sleep(0.3);
  PERFORM dblink_exec('rl_a', 'COMMIT');
  SELECT x::jsonb INTO b FROM dblink_get_result('rl_b') AS t(x text);
  PERFORM dblink_disconnect('rl_a');
  PERFORM dblink_disconnect('rl_b');
  n := (SELECT count(*) FROM public.reported_labor_statements WHERE source_comment_id = '33000000-0000-0000-0000-000000000016');
  PERFORM pg_temp.ok(format('concurrent writes of one statement land one row (%s), the second is its replay: %s / %s', n, a, b),
    n = 1 AND (a ->> 'duplicate')::boolean IS NOT TRUE AND (b ->> 'duplicate')::boolean
    AND b ->> 'observation_id' = a ->> 'observation_id');
  PERFORM pg_temp.ok('the landed row carries its clock basis', (SELECT o.observed_at_basis FROM public.vehicle_observations o
    WHERE o.id = (a ->> 'observation_id')::uuid) = 'source_publication_time');
END $$;
\echo reported_labor_statement_writer: ok
