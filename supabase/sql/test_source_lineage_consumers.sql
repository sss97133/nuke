-- HELD local synthetic full writer/consumer contract. No actual source, model, network or production effects.
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture setup in an empty disposable PG17 database only.
\ir helpers/photo_lineage_contract_schema.sql
CREATE TABLE emergent_vehicle_clusters(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cluster_label text,candidate_year integer,candidate_make text,candidate_model text,
 earliest_image timestamptz,latest_image timestamptz,image_count integer NOT NULL DEFAULT 0,
 resolved_to_vehicle_id uuid REFERENCES vehicles(id),resolved_at timestamptz,resolved_by text,resolution_evidence jsonb,
 visual_centroid jsonb,confidence numeric,cluster_label_history jsonb NOT NULL DEFAULT '[]',is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE image_observations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),image_id uuid NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
 vehicle_id uuid REFERENCES vehicles(id),cluster_id uuid REFERENCES emergent_vehicle_clusters(id),role text NOT NULL,
 confidence numeric NOT NULL CHECK(confidence BETWEEN 0 AND 1),confidence_basis jsonb NOT NULL DEFAULT '{}',
 bbox jsonb,visual_signature jsonb DEFAULT '{}',layer_version jsonb NOT NULL DEFAULT '{}',observed_by text NOT NULL,
 agent_version text,observed_at timestamptz NOT NULL DEFAULT now(),superseded_by uuid REFERENCES image_observations(id),
 is_active boolean NOT NULL DEFAULT true,
 is_high_confidence_subject boolean GENERATED ALWAYS AS (role='subject' AND confidence>0.85 AND is_active) STORED,
 CHECK(vehicle_id IS NOT NULL OR cluster_id IS NOT NULL OR observed_by IS NOT NULL),
 CHECK(role IN ('subject','background','incidental','plate','odometer','vin','document','part'))
);
ALTER TABLE image_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergent_vehicle_clusters ENABLE ROW LEVEL SECURITY;
-- Exact old signature and execution boundary: CREATE OR REPLACE must preserve it.
CREATE FUNCTION ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb DEFAULT '{}',boolean DEFAULT NULL,jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT NULL::uuid $$;
REVOKE ALL ON FUNCTION ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb) TO service_role;
\ir ../migrations/20261018165532_bind_visual_subject_observations.sql


\ir ../migrations/20261018203000_private_subject_source_qualification.sql
CREATE FUNCTION pg_temp.u(label text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5(label)::uuid $$;
CREATE TABLE source_lineage_scenario(owner_id uuid,original_ids uuid[],envelope jsonb);
INSERT INTO vehicles(id) VALUES(pg_temp.u('wrong historical attachment'));
INSERT INTO vehicle_images(id,vehicle_id,user_id,image_url,file_hash,storage_path,source,taken_at,created_at,exif_data,
 vision_gate_status,ai_processing_status,is_approved,is_primary)
SELECT pg_temp.u(k),pg_temp.u('wrong historical attachment'),pg_temp.u('photographer'),
 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-photos/users/'||pg_temp.u('photographer')||'/capture-relay/'||md5(k)||md5(k)||'/fixture.JPG',
 md5(k)||md5(k),'users/'||pg_temp.u('photographer')||'/capture-relay/'||md5(k)||md5(k)||'/fixture.JPG',
 'capture_relay_ios','2026-10-15T00:00:00.000001Z','2026-10-16T00:00:00.000001Z',
 jsonb_build_object('uuid',k,'camera_make','Synthetic','camera_model','Synthetic'),
 'approved','completed',true,false
FROM unnest(ARRAY['original exterior','original detail']) k;
INSERT INTO source_lineage_scenario
SELECT pg_temp.u('photographer'),ARRAY[pg_temp.u('original exterior'),pg_temp.u('original detail')],
 jsonb_build_object('user_id',pg_temp.u('photographer'),'method','visual_subjects_v1','run_key','synthetic-retained-original',
 'provider','synthetic','model','offline','read_at',clock_timestamp()-interval '1 minute',
 'inputs',(SELECT jsonb_agg(jsonb_build_object('image_id',id,'source_url',image_url,'input_url',image_url,
  'source_sha256',file_hash,'input_sha256',file_hash,'source_qualified',true,'source_bytes_qualified',true,'representation','source',
  'mime_type','image/jpeg','byte_length',4,'taken_at',taken_at,'created_at',created_at)) FROM vehicle_images),
 'frames',(SELECT jsonb_agg(jsonb_build_object('image_id',id,'medium','photograph','primary_subject','vehicle',
  'view',CASE WHEN id=pg_temp.u('original exterior') THEN 'exterior' ELSE 'detail' END,'bbox','[0,0,1,1]'::jsonb)) FROM vehicle_images),
 'subjects',jsonb_build_array(jsonb_build_object('anchor_image_id',pg_temp.u('original exterior'),
  'member_image_ids',jsonb_build_array(pg_temp.u('original exterior'),pg_temp.u('original detail')),
  'physical_identity','unresolved','asserted_identity',jsonb_build_object('make','Visual make','model_family','Coupe'),
  'contradictions','[]'::jsonb,'correspondences',jsonb_build_array(jsonb_build_object(
   'left_image_id',pg_temp.u('original exterior'),'right_image_id',pg_temp.u('original detail'),
   'features',jsonb_build_array(jsonb_build_object('kind','body_geometry','left_witness','particular seam','right_witness','corresponding seam'),
    jsonb_build_object('kind','fixed_wear','left_witness','scar crossing seam','right_witness','same scar crossing seam')))))),
 'contradictions','[]'::jsonb,'unresolved','[]'::jsonb,
 'candidate_scope',jsonb_build_object('kind','account_associated_terminal_vehicles','vehicle_ids','[]'::jsonb,
  'retrieved',0,'exhausted',false,'truncated',true,'reference_photos_assessed',0,'unavailable_references','[]'::jsonb,'global_novelty_asserted',false));
SELECT ingest_image_observation(id,NULL,'part',0,'visual_subject_reading_v1','visual_subject_reading_v1',
 jsonb_build_object('visual_subject_reading_v1',jsonb_build_object('envelope',envelope)),false,'{}')
FROM source_lineage_scenario s CROSS JOIN unnest(s.original_ids) id;
SELECT ingest_image_observation(id,NULL,'subject',0,'visual_subjects_v1','visual_subjects_v1',
 jsonb_build_object('visual_subjects_v1',jsonb_build_object('anchor_image_id',s.original_ids[1],'envelope',envelope)),false,'{}')
FROM source_lineage_scenario s CROSS JOIN unnest(s.original_ids) id;
\setenv PGDATABASE :DBNAME
\! deno run --allow-env=PGDATABASE,PGHOST,PGPORT,PGUSER,CI,DB_CONTRACT_PSQL --allow-run="$DB_CONTRACT_PSQL" supabase/functions/check-image-vehicle-match/sourceLineageContract.ts
\if :SHELL_ERROR
 SELECT 1/0;
\endif
SELECT pg_temp.ok('no pipeline or paid analysis scheduled during source correction',(SELECT count(*) FROM pipeline_calls)=0);
SELECT 'source writer through protected observation to actual private reader: synthetic contract passed' AS result;
