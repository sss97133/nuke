-- Empty local/CI PostgreSQL 17 database only. Included contract guards the database name.
-- Real curator review/apply, admission triggers and readers; no customer testimony.
-- Synthetic source and derived observations enter through the actual Edge handler.
\set ON_ERROR_STOP on
\ir test_schema_proposal_add_source_contract.sql
CREATE TYPE vfc_rank AS ENUM('preferred','normal','deprecated');
CREATE TABLE vehicles(id uuid PRIMARY KEY,is_public boolean,deleted_at timestamptz,listing_kind text,
 user_id uuid,owner_id uuid,uploaded_by uuid);
CREATE TABLE vehicle_observations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid REFERENCES vehicles(id),kind observation_kind,
 is_superseded boolean DEFAULT false,superseded_by uuid,superseded_at timestamptz,updated_at timestamptz,
 is_processed boolean,processed_at timestamptz,property_id uuid REFERENCES observation_properties(id),
 subject_type text DEFAULT 'vehicle',subject_id uuid,source_id uuid REFERENCES observation_sources(id),
 source_url text,source_identifier text,raw_source_ref text,observed_at timestamptz,ingested_at timestamptz DEFAULT now(),
 extraction_method text,confidence_score numeric,structured_data jsonb,content_hash text UNIQUE,content_text text,
 agent_model text,confidence text,extraction_metadata jsonb,rank vfc_rank DEFAULT 'normal',changeset_id uuid,
 source_observation_id uuid REFERENCES vehicle_observations(id),vehicle_match_confidence numeric,
 vehicle_match_signals jsonb,confidence_factors jsonb,observer_raw jsonb,extractor_id uuid,
 agent_tier text,agent_cost_cents numeric DEFAULT 0,agent_duration_ms numeric,citation_document_id uuid,
 citation_secure_document_id uuid,citation_page_number integer,citation_excerpt text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT null::uuid$$;
CREATE TABLE vehicle_field_provenance(vehicle_id uuid,field_name text,primary_source text,total_confidence numeric);
CREATE TABLE vehicle_images(id uuid,vehicle_id uuid,image_url text,is_sensitive boolean,is_superseded boolean,is_duplicate boolean,vision_gate_status text,image_vehicle_match_status text);
CREATE TABLE observation_witnesses(id uuid,observation_id uuid,image_id uuid,witness_role text);
CREATE TABLE vehicle_field_sources(vehicle_id uuid,field_name text,field_value text,source_type text,confidence_score numeric,is_verified boolean,ai_reasoning text,source_image_id uuid,created_at timestamptz);
CREATE TABLE field_evidence(vehicle_id uuid,field_name text,proposed_value text,source_type text,source_confidence numeric,status text,extraction_context text,raw_extraction_data jsonb,created_at timestamptz);
\ir fixtures/retained_engine_family_baseline_20261011.sql
CREATE TRIGGER trg_retained_listing_property_source BEFORE INSERT OR UPDATE ON vehicle_observations
 FOR EACH ROW EXECUTE FUNCTION validate_retained_listing_property_source();
-- Existing public SELECT policies, inspected 2026-10-11; no production access changes.
ALTER TABLE observation_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY observation_properties_read ON observation_properties FOR SELECT USING(true);
ALTER TABLE schema_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY schema_proposals_read ON schema_proposals FOR SELECT USING(true);
GRANT USAGE ON SCHEMA public,auth TO service_role,anon;
GRANT SELECT ON vehicles,observation_sources,observation_properties,schema_proposals,vehicle_observations,vehicle_canonical TO service_role,anon;
GRANT INSERT ON vehicle_observations TO service_role;
-- The actual insert trigger locks its parent FOR SHARE, which requires UPDATE privilege.
GRANT UPDATE ON vehicle_observations TO service_role;
REVOKE ALL ON FUNCTION retained_listing_property_result_matches(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION retained_listing_property_result_matches(uuid,uuid,uuid) TO service_role;
INSERT INTO vehicles(id,is_public,listing_kind) VALUES('22222222-2222-4222-8222-222222222222',true,'vehicle');
INSERT INTO observation_sources(id,slug,display_name,category,base_trust_score,supported_observations)
 VALUES('4cdc735c-f117-42f2-889f-ba33805639a5','bat','Bring a Trailer','auction',0.85,ARRAY['listing','specification']::observation_kind[]);
