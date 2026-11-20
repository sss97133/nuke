-- Contract: the row the intake really inserts for an automatic ("thin") photo reading passes guard_reviewed_image_analysis of
-- 20261120140000_image_reading_tiers.sql, and project_reviewed_image_analysis then stamps the photo.
-- The rows are not typed here. supabase/sql/fixtures/thin_real_rows.json holds the INSERT the actual ingest-observation handler makes
-- when the Mac reader's own envelope (scripts/photo-pipeline/deep-stage.mjs buildEnvelope + automaticProvenance) goes through the actual
-- producer (reviewedAnalysis.ts recordReviewedAnalysis), for the 4 accepted verdicts of
-- scripts/photo-pipeline/fixtures/automatic-thin-verdicts.json. supabase/functions/photo-pipeline-orchestrator/reviewedIntakeChain_test.ts
-- regenerates those rows on every run and fails when they differ from the file (its header has the command that rewrites it), so a key
-- added anywhere on that path fails there first and then here if the guard does not admit it.
-- test_image_reading_tiers.sql builds stored rows by hand (tt_obs); this file inserts the intake's own row with the intake's own columns.
-- Same setup as test_image_reading_tiers.sql. A failing ASSERT stops psql (ON_ERROR_STOP), so the file fails.
-- Not covered here: production's other triggers on vehicle_observations. Read from pg_trigger on 2026-11-20: of the 33 there, only
-- guard_reviewed_image_analysis assigns structured_data or extraction_metadata, and no other enabled insert trigger reads agent_tier
-- or agent_model, the two columns that tell this row from a reviewed reading the same path already lands.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
   RAISE EXCEPTION 'Requires empty disposable dm_refinement_* database';
 END IF;
END $$;

\ir fixtures/reviewed_image_analysis_base.sql
\ir ../migrations/20261110020000_reviewed_extractor_uuid_contract.sql
ALTER TABLE vehicle_observations ADD COLUMN superseded_by uuid REFERENCES vehicle_observations(id),
  ADD COLUMN superseded_at timestamptz, ADD COLUMN lineage_chain uuid[];
CREATE TABLE platform_config (config_key text PRIMARY KEY, config_value jsonb, description text);
-- the columns ingest-observation writes that the fixture's table lacks (types as on production, information_schema 2026-11-20;
-- kind and confidence are enums there, text here)
ALTER TABLE vehicle_observations
  ADD COLUMN vehicle_match_confidence numeric, ADD COLUMN vehicle_match_signals jsonb, ADD COLUMN content_hash text,
  ADD COLUMN confidence text, ADD COLUMN confidence_factors jsonb, ADD COLUMN observer_raw jsonb,
  ADD COLUMN agent_cost_cents numeric, ADD COLUMN agent_duration_ms integer,
  ADD COLUMN citation_document_id uuid, ADD COLUMN citation_secure_document_id uuid, ADD COLUMN citation_page_number integer,
  ADD COLUMN citation_excerpt text;

INSERT INTO observation_sources(slug) VALUES('photo_pipeline');
INSERT INTO vehicles VALUES('20000000-0000-4000-8000-000000000101','Fixture','Coupe',NULL);

\ir ../migrations/20261120140000_image_reading_tiers.sql

-- the generated cases, and 2 extra photos for the negative controls
\set rows `cat supabase/sql/fixtures/thin_real_rows.json`
CREATE TABLE tr_case AS SELECT (c->>'n')::int AS n, (c->>'image_id')::uuid AS image_id, c->>'image_url' AS image_url,
  c->>'expected_updated_at' AS expected_updated_at, c->'row' AS r FROM jsonb_array_elements(:'rows'::jsonb) c;
DO $$ BEGIN ASSERT (SELECT count(*) FROM tr_case) = 4, 'fixture holds the 4 accepted verdicts'; END $$;

-- photos exactly as the reader snapshotted them: same id, url and updated_at the envelope carries
INSERT INTO vehicle_images(id,vehicle_id,user_id,source,image_url,vision_gate_status,file_size,ai_scan_metadata,updated_at)
SELECT image_id,'20000000-0000-4000-8000-000000000101','40000000-0000-4000-8000-000000000101','iphoto',image_url,'approved',3500000,'{}',expected_updated_at::timestamptz
  FROM tr_case;
INSERT INTO vehicle_images(id,vehicle_id,user_id,source,image_url,vision_gate_status,file_size,ai_scan_metadata,updated_at)
SELECT ('30000000-0000-4000-8000-00000000010'||(4+g))::uuid,'20000000-0000-4000-8000-000000000101','40000000-0000-4000-8000-000000000101','iphoto',
  replace(image_url,'000000000101','00000000010'||(4+g)),'approved',3500000,'{}',expected_updated_at::timestamptz
  FROM tr_case, generate_series(1,2) g WHERE n=1;

-- the insert ingest-observation/index.ts makes (index.ts:1257-1311), column for column, from the generated row
CREATE FUNCTION tr_insert(r jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE oid uuid;
BEGIN
 INSERT INTO vehicle_observations(vehicle_id, vehicle_match_confidence, vehicle_match_signals, observed_at, source_id, source_url, source_identifier,
   kind, content_text, content_hash, structured_data, confidence, confidence_score, confidence_factors, observer_raw, extraction_metadata,
   analysis_deferred, agent_tier, agent_model, agent_cost_cents, agent_duration_ms, extraction_method, raw_source_ref,
   citation_document_id, citation_secure_document_id, citation_page_number, citation_excerpt)
 VALUES((r->>'vehicle_id')::uuid, (r->>'vehicle_match_confidence')::numeric, r->'vehicle_match_signals', (r->>'observed_at')::timestamptz,
   (SELECT id FROM observation_sources WHERE slug='photo_pipeline'), r->>'source_url', r->>'source_identifier',
   r->>'kind', r->>'content_text', r->>'content_hash', r->'structured_data', r->>'confidence', (r->>'confidence_score')::numeric,
   r->'confidence_factors', r->'observer_raw', r->'extraction_metadata',
   (r->>'analysis_deferred')::boolean, r->>'agent_tier', r->>'agent_model', (r->>'agent_cost_cents')::numeric, (r->>'agent_duration_ms')::integer,
   r->>'extraction_method', r->>'raw_source_ref',
   (r->>'citation_document_id')::uuid, (r->>'citation_secure_document_id')::uuid, (r->>'citation_page_number')::integer, r->>'citation_excerpt')
 RETURNING id INTO oid;
 RETURN oid;
END $$;

-- (a) both helpers say null, (b) the real trigger lets the insert land, (c) the projection succeeds and stamps the photo
DO $$ DECLARE c record; adm jsonb; oid uuid; res jsonb; stamp jsonb; r jsonb; d text; n int := 0; BEGIN
 SELECT config_value->'automatic'->'admits' INTO adm FROM platform_config WHERE config_key='image_reading_tiers';
 FOR c IN SELECT * FROM tr_case ORDER BY n LOOP
   r := c.r;
   ASSERT image_reading_thin_violation(r->'structured_data', adm) IS NULL,
     'case '||c.n||': image_reading_thin_violation refuses the real row: '||coalesce(image_reading_thin_violation(r->'structured_data', adm),'');
   ASSERT image_reading_thin_envelope_violation(r->'extraction_metadata', r->'structured_data') IS NULL,
     'case '||c.n||': image_reading_thin_envelope_violation refuses the real row: '||coalesce(image_reading_thin_envelope_violation(r->'extraction_metadata', r->'structured_data'),'');
   ASSERT NOT image_reading_tier_is_reviewed(r->>'agent_tier'), 'case '||c.n||': the automatic tier is thin';
   BEGIN
     oid := tr_insert(r);
   EXCEPTION WHEN OTHERS THEN
     GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL;
     RAISE EXCEPTION 'case %: the guard refused the real row: % (detail %)', c.n, SQLERRM, coalesce(d,'none');
   END;
   ASSERT oid IS NOT NULL, 'case '||c.n||': inserted';
   ASSERT EXISTS(SELECT 1 FROM observation_witnesses w WHERE w.observation_id=oid AND w.image_id=c.image_id AND w.witness_role='derived'),
     'case '||c.n||': the witness trigger placed the derived witness the projection needs';
   ASSERT (SELECT extraction_metadata ? 'prior_analysis' FROM vehicle_observations WHERE id=oid), 'case '||c.n||': the guard added prior_analysis';
   res := project_reviewed_image_analysis(oid);
   ASSERT res->>'success'='true' AND res->>'observation_id'=oid::text AND res->>'image_id'=c.image_id::text
     AND res->>'vehicle_id'='20000000-0000-4000-8000-000000000101' AND res->>'image_observation_id' IS NOT NULL
     AND res#>>'{cover,reason}'='thin_tier_reading', 'case '||c.n||': projection result '||res::text;
   SELECT ai_scan_metadata->'byok_deep_analysis' INTO stamp FROM vehicle_images WHERE id=c.image_id;
   ASSERT stamp IS NOT NULL AND stamp->>'observation_id'=oid::text AND stamp->>'agent_tier'='subscription automatic'
     AND stamp->>'scene_type'=r#>>'{structured_data,scene_type}' AND stamp->>'prompt_version'='reviewed_image_analysis_v1'
     AND stamp->>'source_identifier'=r->>'source_identifier', 'case '||c.n||': stamp '||stamp::text;
   n := n + 1;
   RAISE NOTICE 'PASS: real thin row % lands and projects (scene %, observation %)', c.n, r#>>'{structured_data,scene_type}', oid;
 END LOOP;
 ASSERT n = 4, 'all 4 cases ran';
 ASSERT (SELECT count(*) FROM vehicle_observations WHERE extraction_method='reviewed_image_analysis_v1')=4, '4 observations stored';
END $$;

-- negative controls: the same row (case 1, moved to a fresh photo) with one unexpected key must be refused by name
-- first the unmodified row on those photos passes the helpers, so the refusal below is caused by the key and by nothing else
-- move only the image id (the vehicle id also ends in 0101)
CREATE FUNCTION tr_moved(p_to text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT replace(r::text,'30000000-0000-4000-8000-000000000101','30000000-0000-4000-8000-'||p_to)::jsonb FROM tr_case WHERE n=1 $$;

DO $$ DECLARE adm jsonb; ok jsonb; bad jsonb; d text; BEGIN
 SELECT config_value->'automatic'->'admits' INTO adm FROM platform_config WHERE config_key='image_reading_tiers';
 -- control: unmodified, on photo 105 it passes both helpers
 ok := tr_moved('000000000105');
 ASSERT image_reading_thin_violation(ok->'structured_data',adm) IS NULL AND image_reading_thin_envelope_violation(ok->'extraction_metadata',ok->'structured_data') IS NULL,
   'unmodified row on a fresh photo passes the helpers';
 -- one unexpected key in structured_data
 bad := jsonb_set(ok,'{structured_data,extra_key}','"x"'::jsonb);
 BEGIN
   PERFORM tr_insert(bad);
   RAISE EXCEPTION 'a thin row with an extra structured_data key unexpectedly landed';
 EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL;
   ASSERT SQLERRM = 'thin_review_asserts_unchecked_field' AND d = 'key:extra_key', 'structured_data key refused as '||SQLERRM||' / '||coalesce(d,'null');
 END;
 -- one unexpected key in extraction_metadata
 ok := tr_moved('000000000106');
 ASSERT image_reading_thin_violation(ok->'structured_data',adm) IS NULL AND image_reading_thin_envelope_violation(ok->'extraction_metadata',ok->'structured_data') IS NULL,
   'unmodified row on the second fresh photo passes the helpers';
 bad := jsonb_set(ok,'{extraction_metadata,extra_key}','"x"'::jsonb);
 BEGIN
   PERFORM tr_insert(bad);
   RAISE EXCEPTION 'a thin row with an extra extraction_metadata key unexpectedly landed';
 EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL;
   ASSERT SQLERRM = 'thin_review_asserts_unchecked_field' AND d = 'extraction_metadata.extra_key', 'extraction_metadata key refused as '||SQLERRM||' / '||coalesce(d,'null');
 END;
 -- and the control lands once the key is gone (so the photos were insertable all along)
 PERFORM tr_insert(tr_moved('000000000105'));
 ASSERT (SELECT count(*) FROM vehicle_observations WHERE extraction_method='reviewed_image_analysis_v1')=5, 'refused rows left nothing behind; the control row landed';
 RAISE NOTICE 'PASS: one unexpected key in structured_data or extraction_metadata is refused with thin_review_asserts_unchecked_field';
END $$;
