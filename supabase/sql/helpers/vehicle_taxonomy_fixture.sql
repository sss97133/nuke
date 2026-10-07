-- Disposable PG17 shapes only; no production data or provider requests.
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'Disposable database required'; END IF; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,vin text,body_style text,deleted_at timestamptz,status text,fixture_updates integer DEFAULT 0);
CREATE INDEX idx_vehicles_vin_upper ON public.vehicles(upper(vin)) WHERE vin IS NOT NULL AND deleted_at IS NULL;
CREATE TABLE public.vin_decoded_data(vin text PRIMARY KEY,make text,model text,year integer,trim text,body_type text,doors integer,
 engine_size text,engine_cylinders integer,engine_displacement_liters text,fuel_type text,transmission text,drivetrain text,
 manufacturer text,plant_city text,plant_country text,vehicle_type text,provider text DEFAULT 'nhtsa',confidence numeric DEFAULT 100,
 decoded_at timestamptz DEFAULT now(),raw_response jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
-- Emulate the existing producer's typed mapping and complete raw source tuple.
-- Explicit supplied mismatches remain mismatches for the attack tests.
CREATE FUNCTION fixture_cache_source_tuple() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 NEW.raw_response:=jsonb_build_object('VIN',NEW.vin,'BodyClass',NEW.body_type,'VehicleType',NEW.vehicle_type)||coalesce(NEW.raw_response,'{}'); RETURN NEW;
END $$;
CREATE TRIGGER fixture_cache_source_tuple BEFORE INSERT ON vin_decoded_data FOR EACH ROW EXECUTE FUNCTION fixture_cache_source_tuple();
\ir ../../migrations/20260114000000_canonical_vehicle_types_and_body_styles.sql
\ir vehicle_taxonomy_owner_fixture.sql
CREATE FUNCTION public.fixture_count_vehicle_updates() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.fixture_updates:=OLD.fixture_updates+1; RETURN NEW; END $$;
CREATE TRIGGER fixture_count_vehicle_updates BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.fixture_count_vehicle_updates();
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,jobname text UNIQUE,schedule text,active boolean DEFAULT true,command text);
CREATE TABLE cron.job_run_details(runid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,jobid bigint,status text,start_time timestamptz,end_time timestamptz,return_message text);
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) RETURNING jobid $$;
CREATE TABLE public.write_receipts(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,at timestamptz DEFAULT now(),tbl text,op text,rows integer,writer text,db_role text,app_name text,txid bigint);
CREATE TABLE public.pipeline_registry(id uuid DEFAULT gen_random_uuid(),table_name text,column_name text,owned_by text,description text,
 valid_values text[],do_not_write_directly boolean,write_via text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE FUNCTION public.get_live_auction_health() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"closing_stream":{"status":"passed"}}'::jsonb $$;
CREATE FUNCTION public.assay_vehicle_metric_fold() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"status":"passed"}'::jsonb $$;
CREATE FUNCTION public.assay_sale_residual_fold() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"status":"passed"}'::jsonb $$;
\ir vehicle_taxonomy_health_fixture.sql
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT SELECT ON public.vin_decoded_data,public.canonical_body_styles,public.canonical_vehicle_types,public.vehicles TO anon,authenticated,service_role;
