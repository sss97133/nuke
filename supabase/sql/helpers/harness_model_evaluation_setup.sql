-- Empty disposable PG17 only. Reuse the real physical-grain/visibility regression fixture.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_schematic_model.sql

CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('test.auth_jwt',true),'')::jsonb,'{}'::jsonb);
$$;
-- The historical reshape fixture predates physical segment qualification.
UPDATE public.harness_segments SET design_status='decided' WHERE NOT is_superseded;
CREATE FUNCTION public.vein_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'append only'; END $$;
CREATE TABLE IF NOT EXISTS public.harness_build_events(id uuid DEFAULT gen_random_uuid(),vehicle_id uuid REFERENCES public.vehicles(id),
 circuit_id uuid REFERENCES public.vehicle_custom_circuits(id),to_state text);
GRANT SELECT ON public.harness_build_events TO anon,authenticated;
CREATE FUNCTION public.model_fold_config() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT '{"enabled":true,"signals_enabled":true,"max_attempts":3,"max_vehicles":2,"settle_seconds":1,"max_delay_seconds":60}'::jsonb;
$$;
-- Minimal boundaries of the already-tested generic worker; this contract exercises the real new domain fold.
CREATE TABLE public.model_fold_signal(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vehicle_id uuid REFERENCES public.vehicles(id),reason text,priority integer,at timestamptz DEFAULT now());
CREATE TABLE public.model_fold_work(vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id),state text);
CREATE FUNCTION public.model_fold_absorb_signals(p_limit integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 INSERT INTO public.model_fold_work(vehicle_id,state) SELECT DISTINCT vehicle_id,'pending' FROM public.model_fold_signal
 ON CONFLICT(vehicle_id) DO UPDATE SET state='pending';
 GET DIAGNOSTICS n=ROW_COUNT;
 DELETE FROM public.model_fold_signal;
 RETURN n;
END $$;
CREATE FUNCTION public.model_fold_one(p_tick uuid,p_vehicle uuid,p_cfg jsonb,p_edited uuid[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  -- labor_fold_v1_end
 RETURN '{}'::jsonb;
END $$;
CREATE PROCEDURE public.model_fold_tick() LANGUAGE plpgsql AS $$
DECLARE v_sig integer; x record;
BEGIN
  v_sig := public.model_fold_absorb_signals(100);
 FOR x IN SELECT vehicle_id FROM public.model_fold_work WHERE state='pending' LOOP
  PERFORM public.model_fold_one(gen_random_uuid(),x.vehicle_id,public.model_fold_config(),'{}');
  UPDATE public.model_fold_work SET state='done' WHERE vehicle_id=x.vehicle_id;
 END LOOP;
END $$;
-- Match hosted function default privileges: producer revokes must remove explicit role grants too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
\i supabase/migrations/20261125233922_harness_model_evaluation_loop.sql

