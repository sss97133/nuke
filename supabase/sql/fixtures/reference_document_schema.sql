\set ON_ERROR_STOP on
-- Synthetic-only disposable database. No retained financial, vehicle or image testimony.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA public;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT null::uuid $$;
CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,version text,metadata jsonb,user_metadata jsonb,UNIQUE(bucket_id,name));
CREATE TABLE public.reference_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE NOT NULL,title text NOT NULL,category text NOT NULL,
 file_path text NOT NULL,file_hash text NOT NULL,file_size_bytes bigint,page_count int,year int,vehicle_scope_class text,vehicle_scope_specific jsonb,
 topics text[],base_trust_score numeric DEFAULT .85,extraction_method text,extraction_quality text,added_at timestamptz NOT NULL DEFAULT now(),
 extracted_at timestamptz,superseded_by uuid REFERENCES public.reference_documents(id),notes text);
CREATE TABLE public.document_pages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES public.reference_documents(id),
 page_number int NOT NULL,extracted_text text,text_search tsvector,has_diagrams boolean DEFAULT false,extraction_method text,extraction_notes text,
 topics text[],extracted_at timestamptz NOT NULL DEFAULT now(),UNIQUE(document_id,page_number));
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text);
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,year int,make text,model text,body_style text,is_public boolean,deleted_at timestamptz,user_id uuid,owner_id uuid,uploaded_by uuid);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid,kind text,vehicle_id uuid REFERENCES public.vehicles(id),subject_id uuid,
 is_superseded boolean DEFAULT false,extraction_method text,analysis_deferred boolean,confidence_score numeric,structured_data jsonb,
 citation_document_id uuid,citation_page_number int,citation_excerpt text,source_url text,raw_source_ref text,observed_at timestamptz,observer_raw jsonb,
 component_subject_id uuid,source_observation_id uuid REFERENCES public.vehicle_observations(id),property_id uuid,descriptor_id uuid,ingested_at timestamptz,content_text text);
CREATE TABLE public.component_assembly_map(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assembly_name text NOT NULL,assembly_category text NOT NULL,
 assembly_description text,sub_components jsonb DEFAULT '[]',catalog_part_map jsonb DEFAULT '{}',possible_states jsonb DEFAULT '[]',
 state_indicators jsonb DEFAULT '{}',application_years text,application_models text[],created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.catalog_parts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),part_number text,name text,price_current numeric);
CREATE TABLE public.subject_taxonomy(subject_id uuid PRIMARY KEY,subject_key text,display_name text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY,image_url text,taken_at timestamptz,exif_data jsonb);
CREATE TABLE public.observation_witnesses(observation_id uuid REFERENCES public.vehicle_observations(id),image_id uuid REFERENCES public.vehicle_images(id));
CREATE FUNCTION public.vehicle_user_has_access(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.component_reading_matches(public.vehicle_observations,public.vehicle_observations,public.vehicle_images) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
-- Roles referenced by migration REVOKE/GRANT statements
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
\i supabase/sql/fixtures/reference_component_fold_owner.sql
\i supabase/sql/fixtures/reference_assembly_owners.sql
\i supabase/migrations/20261111170449_source_bound_reference_assemblies.sql
