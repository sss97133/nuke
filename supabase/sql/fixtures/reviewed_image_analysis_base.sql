-- Shared setup of the reviewed-analysis contracts (test_reviewed_image_analysis.sql, test_image_reading_tiers.sql, test_thin_real_row.sql): roles, the tables the
-- intake and its triggers read, the real ingest_image_observation, and the migrations through 20261109213000. Included with \ir; an empty
-- disposable database, checked by the including contract.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
SET request.jwt.claim.role='service_role';
CREATE TABLE vehicles(id uuid PRIMARY KEY,make text,model text,primary_image_url text);
CREATE TABLE vehicle_images(id uuid PRIMARY KEY,vehicle_id uuid,user_id uuid,source text,image_url text,
 updated_at timestamptz DEFAULT clock_timestamp(),created_at timestamptz DEFAULT now(),taken_at timestamptz,
 is_primary boolean DEFAULT false,is_sensitive boolean DEFAULT false,is_duplicate boolean DEFAULT false,
 is_superseded boolean DEFAULT false,is_document boolean DEFAULT false,doc_flag boolean DEFAULT false,
 vision_gate_status text,image_vehicle_match_status text,ai_scan_metadata jsonb DEFAULT '{}',file_size bigint,
 vehicle_zone text,user_confirmed_vehicle boolean DEFAULT false,ai_processing_status text DEFAULT 'completed',
 file_name text,filename text,storage_path text,image_type text,ai_avg_confidence numeric,ai_detected_angle text,
 ai_detected_angle_confidence numeric,ai_processing_started_at timestamptz,ai_processing_completed_at timestamptz);
CREATE TABLE observation_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE);
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,kind text,
 source_id uuid,source_url text,source_identifier text UNIQUE,observed_at timestamptz NOT NULL,
 content_text text,confidence_score numeric,agent_model text,agent_tier text,extraction_method text,extractor_id uuid,
 raw_source_ref text,structured_data jsonb,extraction_metadata jsonb,analysis_deferred boolean,
 property_id uuid,is_superseded boolean DEFAULT false,submitted_by_user_id uuid,
 ingested_at timestamptz DEFAULT now());
CREATE TABLE observation_witnesses(id uuid DEFAULT gen_random_uuid(),observation_id uuid,image_id uuid,
 witness_role text,capture_method text,image_timestamp timestamptz,attestation_notes text,
 added_by_user_id uuid,added_by_agent_key text,UNIQUE(observation_id,image_id,witness_role));
CREATE TABLE emergent_vehicle_clusters(id uuid PRIMARY KEY);
CREATE TABLE reattribution_audit(id uuid PRIMARY KEY);
CREATE TABLE image_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),image_id uuid NOT NULL REFERENCES vehicle_images(id),
 vehicle_id uuid REFERENCES vehicles(id),cluster_id uuid,role text NOT NULL,confidence numeric NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 confidence_basis jsonb NOT NULL DEFAULT '{}',layer_version jsonb NOT NULL DEFAULT '{}',observed_by text NOT NULL,
 agent_version text,observed_at timestamptz NOT NULL DEFAULT now(),superseded_by uuid REFERENCES image_observations(id),
 is_active boolean NOT NULL DEFAULT true,
 is_high_confidence_subject boolean GENERATED ALWAYS AS(role='subject' AND confidence>0.85 AND is_active) STORED);
-- Load the real current intake owner, not a spy. Its protected multi-source
-- branches are outside this fixture; caller-byok uses its ordinary revision path.
-- The existing DB-contract runner executes from the repository root.
\set search_owner `sed -n '/^CREATE OR REPLACE FUNCTION public.ingest_image_observation(/,/^\$function\$;/p' supabase/migrations/20261018203000_private_subject_source_qualification.sql`
SELECT :'search_owner' \gexec
CREATE TABLE vehicle_image_attribution_queue(image_id uuid PRIMARY KEY);
CREATE FUNCTION enqueue_vehicle_image_attribution() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.role='subject' AND NEW.vehicle_id IS NOT NULL AND NEW.confidence>=0.85
   AND (NEW.is_active OR (TG_OP='UPDATE' AND OLD.is_active)) THEN
   INSERT INTO vehicle_image_attribution_queue(image_id) VALUES(NEW.image_id) ON CONFLICT DO NOTHING;
 END IF; RETURN NEW; END$$;
CREATE TRIGGER trg_enqueue_vehicle_image_attribution AFTER INSERT OR UPDATE OF vehicle_id,confidence,is_active,role
 ON image_observations FOR EACH ROW EXECUTE FUNCTION enqueue_vehicle_image_attribution();
CREATE TABLE pipeline_registry(table_name text,column_name text,owned_by text,description text,do_not_write_directly boolean,write_via text);
CREATE TABLE image_descriptions(image_id uuid,vehicle_id uuid,description text,description_type text,source text,source_version text,confidence numeric,evidence jsonb);
CREATE TABLE photo_extracted_fields(image_id uuid,user_id uuid,vehicle_id uuid,field_name text,value text,quote text,confidence numeric,source text,prompt_version text,meta jsonb,UNIQUE(image_id,field_name,source,prompt_version));
CREATE TABLE photo_text_lines(image_id uuid,user_id uuid,vehicle_id uuid,line_idx int,text text,region jsonb,confidence numeric,source text,prompt_version text,UNIQUE(image_id,line_idx,source,prompt_version));
CREATE TABLE field_evidence(vehicle_id uuid,field_name text,proposed_value text,source_type text,source_confidence numeric,extraction_context text,raw_extraction_data jsonb,UNIQUE(vehicle_id,field_name,source_type,proposed_value));
CREATE TABLE vehicle_identifiers(vehicle_id uuid,source_image_id uuid,kind text,evidence_class text);
CREATE TABLE angle_taxonomy(angle_id uuid,canonical_key text,deprecated_at timestamptz);
CREATE TABLE image_angle_observations(image_id uuid,vehicle_id uuid,angle_id uuid,confidence numeric,source text,source_version text,evidence jsonb);
CREATE TABLE image_camera_position(image_id uuid,vehicle_id uuid,subject_key text,azimuth_deg numeric,elevation_deg numeric,distance_mm numeric,confidence numeric,source text,source_version text,evidence jsonb,UNIQUE(image_id,subject_key,source,source_version));
CREATE TABLE photo_land_progress(image_id uuid PRIMARY KEY,result jsonb,landed_at timestamptz DEFAULT now());
CREATE TABLE image_vehicle_mismatches(image_id uuid,current_vehicle_id uuid,detected_vehicle jsonb,expected_vehicle jsonb,validation_status text,confidence_score numeric,mismatch_reason text,mismatch_source text,resolved boolean,resolved_at timestamptz,resolution_action text,resolution_notes text);
CREATE TABLE capture_upload_status(image_id uuid PRIMARY KEY,user_id uuid,vehicle_id uuid,attached boolean,filename text,storage_path text,stage text,stage_detail jsonb,error_class text,http_status int,image_type text,confidence numeric,current_step text,step_detail jsonb,step_updated_at timestamptz,created_at timestamptz,updated_at timestamptz);
CREATE TABLE capture_analysis_events(image_id uuid,user_id uuid,step text,detail jsonb,reported_by text);
CREATE TABLE user_image_counts(user_id uuid,taken_day date,created_day date,n_all bigint,n_owned bigint,n_capture bigint,n_capture_analyzed bigint,n_capture_pending bigint,n_capture_filed bigint,n_capture_taken bigint);
CREATE TABLE user_image_deep_reads(image_id uuid PRIMARY KEY,user_id uuid,updated_at timestamptz);
-- Out-of-scope identifier/field taxonomy helpers are spies. They must not run on
-- a BYOK-only change; the full-classifier control deliberately exercises them.
CREATE TABLE fixture_helper_calls(name text);
CREATE FUNCTION photo_plate_code_kind(text) RETURNS TABLE(kind text,code text) LANGUAGE plpgsql AS $$BEGIN INSERT INTO fixture_helper_calls VALUES('plate'); RETURN; END$$;
CREATE FUNCTION photo_field_not_about_vehicle(text,text,text,text) RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$;
CREATE FUNCTION land_identifier_claims(uuid,jsonb,text,text,text,uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN INSERT INTO fixture_helper_calls VALUES('identifiers'); END$$;
CREATE FUNCTION vehicle_hint_contradiction(text,text,text,text,numeric) RETURNS text LANGUAGE sql AS $$SELECT CASE WHEN $1 IS NOT NULL AND $1<>$3 THEN 'fixture mismatch' END$$;
CREATE FUNCTION update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=clock_timestamp(); RETURN NEW; END$$;
\ir reviewed_image_prior_owners.sql
CREATE TRIGGER update_vehicle_images_updated_at BEFORE UPDATE ON vehicle_images FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_ensure_single_primary_image BEFORE INSERT OR UPDATE ON vehicle_images FOR EACH ROW EXECUTE FUNCTION ensure_single_primary_image();
CREATE TRIGGER b10_trg_capture_relay_hint_guard BEFORE UPDATE OF ai_scan_metadata ON vehicle_images FOR EACH ROW
 WHEN(NEW.vehicle_id IS NOT NULL AND NEW.source='capture_relay_ios' AND NOT coalesce(NEW.user_confirmed_vehicle,false) AND NEW.ai_scan_metadata IS DISTINCT FROM OLD.ai_scan_metadata) EXECUTE FUNCTION capture_relay_hint_guard_fn();
CREATE TRIGGER a06_trg_land_classification AFTER UPDATE OF ai_processing_status,ai_scan_metadata ON vehicle_images FOR EACH ROW
 WHEN(NEW.ai_processing_status='completed' AND NEW.ai_scan_metadata ? 'classification' AND
 (OLD.ai_processing_status IS DISTINCT FROM 'completed' OR OLD.ai_scan_metadata->'classification' IS DISTINCT FROM NEW.ai_scan_metadata->'classification' OR OLD.ai_scan_metadata->'byok_deep_analysis' IS DISTINCT FROM NEW.ai_scan_metadata->'byok_deep_analysis')) EXECUTE FUNCTION photo_land_trigger();
CREATE TRIGGER z_trg_capture_upload_status_upd AFTER UPDATE OF ai_processing_status,vehicle_id,image_type,ai_scan_metadata,ai_processing_started_at,ai_processing_completed_at,ai_avg_confidence,ai_detected_angle,file_name ON vehicle_images FOR EACH ROW
 WHEN(NEW.source='capture_relay_ios') EXECUTE FUNCTION capture_upload_status_fn();
CREATE TRIGGER trg_user_image_counts_upd AFTER UPDATE ON vehicle_images REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION track_user_image_counts();
CREATE TRIGGER trg_sync_vehicle_primary_image AFTER UPDATE OF is_primary,is_duplicate,image_vehicle_match_status,image_url,is_superseded ON vehicle_images FOR EACH ROW EXECUTE FUNCTION sync_vehicle_primary_image();
CREATE TRIGGER trg_project_observation_image_witness AFTER INSERT ON vehicle_observations FOR EACH ROW WHEN(NEW.structured_data ? 'image_id') EXECUTE FUNCTION project_observation_image_witness();
\ir ../../migrations/20260619170000_get_image_deep_analysis.sql
\ir ../../migrations/20261109213000_reviewed_image_analysis.sql
