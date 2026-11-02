\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'Disposable contract database only'; END IF;
END $$;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, model text, year integer, trim text, body_style text, is_public boolean, deleted_at timestamptz);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_vehicles ON public.vehicles FOR SELECT TO anon, authenticated USING (is_public AND deleted_at IS NULL);
GRANT SELECT ON public.vehicles TO anon, authenticated, service_role;
CREATE TABLE public.vehicle_identity_marks (id uuid PRIMARY KEY, brand text, family text, year_start integer, year_end integer, mark_kind text, display_label text, vetted boolean);
GRANT SELECT ON public.vehicle_identity_marks TO anon, authenticated, service_role;
-- Dependency fixture deliberately admits unknown year: the new reader must refuse it itself.
CREATE FUNCTION public.resolve_vehicle_identity_marks(p_brand text,p_family text,p_year integer,p_series text,p_trim text,p_body text)
RETURNS SETOF public.vehicle_identity_marks LANGUAGE sql STABLE AS $$
  SELECT * FROM public.vehicle_identity_marks WHERE vetted AND brand = p_brand AND family = p_family
    AND (p_year IS NULL OR p_year BETWEEN year_start AND year_end);
$$;
\i supabase/migrations/20261031034021_vehicle_identity_mark_assets.sql

INSERT INTO public.vehicles VALUES
 ('10000000-0000-4000-8000-000000000001','Example','Model',1977,NULL,NULL,true,NULL),
 ('10000000-0000-4000-8000-000000000002','Example','Model',NULL,NULL,NULL,true,NULL),
 ('10000000-0000-4000-8000-000000000003','Example','Other model',1977,NULL,NULL,true,NULL),
 ('10000000-0000-4000-8000-000000000004','Example','Model',1977,NULL,NULL,false,NULL),
 ('10000000-0000-4000-8000-000000000005','Example','Model',1977,NULL,NULL,true,now());
INSERT INTO public.vehicle_identity_marks VALUES ('20000000-0000-4000-8000-000000000001','Example','Model',1970,1980,'model_wordmark','Example model',true);

CREATE FUNCTION pg_temp.asset(id text, kind text DEFAULT 'source', parent text DEFAULT NULL, mark text DEFAULT NULL, state text DEFAULT 'reference', previous text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('id',id,'identity_mark_id',mark,'source_asset_id',parent,'supersedes_id',previous,
   'asset_kind',kind,'label','Synthetic reference','asset_path','/stacks/makes/emblems/synthetic.' || CASE WHEN kind='vector' THEN 'svg' ELSE 'jpg' END,
   'sha256_base64',encode(decode(repeat('00',32),'hex'),'base64'),'mime_type',CASE WHEN kind='vector' THEN 'image/svg+xml' ELSE 'image/jpeg' END,
   'width',200,'height',80,'source_url',NULL,'source_context','Synthetic fixture; not a factory fitment claim',
   'observed_at',NULL,'method','contract_fixture','method_parameters','{}'::jsonb,'review_state',state,
   'applicability_evidence',CASE WHEN mark IS NOT NULL THEN 'Synthetic application witness' ELSE NULL END);
$$;
SELECT public.record_vehicle_identity_mark_asset(pg_temp.asset('30000000-0000-4000-8000-000000000001'));
SELECT public.record_vehicle_identity_mark_asset(pg_temp.asset('30000000-0000-4000-8000-000000000001'));
SELECT public.record_vehicle_identity_mark_asset(pg_temp.asset('30000000-0000-4000-8000-000000000002','vector','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','usable'));
SELECT public.record_vehicle_identity_mark_asset(pg_temp.asset('30000000-0000-4000-8000-000000000003','vector','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','draft'));

DO $$ BEGIN
 IF has_function_privilege('anon','public.record_vehicle_identity_mark_asset(jsonb)','EXECUTE') OR
    has_function_privilege('authenticated','public.record_vehicle_identity_mark_asset(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Browser can register artwork'; END IF;
 IF has_table_privilege('service_role','public.vehicle_identity_mark_assets','INSERT') THEN RAISE EXCEPTION 'Raw registration bypass'; END IF;
 IF (SELECT count(*) FROM public.vehicle_identity_mark_assets WHERE asset_kind='source' AND observed_at IS NULL) <> 7 THEN RAISE EXCEPTION 'Original capture clock or source evidence lost'; END IF;
 BEGIN
  UPDATE public.vehicle_identity_mark_assets SET label='Rewritten';
  RAISE EXCEPTION 'Expected immutable rejection';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Identity artwork revisions are immutable; record a superseding revision' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.record_vehicle_identity_mark_asset(pg_temp.asset('30000000-0000-4000-8000-000000000001') || '{"label":"Changed evidence"}'::jsonb);
  RAISE EXCEPTION 'Expected id collision rejection';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Artwork id already records different evidence' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.record_vehicle_identity_mark_asset(pg_temp.asset('30000000-0000-4000-8000-000000000004','vector','30000000-0000-4000-8000-000000000002'));
  RAISE EXCEPTION 'Expected derivative-as-source rejection';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'A vector must cite an original source asset' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.record_vehicle_identity_mark_asset(pg_temp.asset('30000000-0000-4000-8000-000000000004','vector','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','usable') || '{"applicability_evidence":null}'::jsonb);
  RAISE EXCEPTION 'Expected missing application rejection';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

SET ROLE anon;
DO $$ BEGIN
 IF jsonb_array_length(public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000001')->'marks') <> 1 THEN RAISE EXCEPTION 'Verified artwork unavailable'; END IF;
 IF jsonb_array_length(public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000001')->'marks'->0->'assets') <> 1 THEN RAISE EXCEPTION 'Draft artwork reached vehicle'; END IF;
 IF jsonb_array_length(public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000002')->'marks') <> 0 THEN RAISE EXCEPTION 'Unknown year inherited badge'; END IF;
 IF jsonb_array_length(public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000003')->'marks') <> 0 THEN RAISE EXCEPTION 'Wrong model inherited badge'; END IF;
 IF public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000004') IS NOT NULL OR
    public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000005') IS NOT NULL THEN RAISE EXCEPTION 'Private/deleted vehicle exposed'; END IF;
END $$;
RESET ROLE;
SELECT public.record_vehicle_identity_mark_asset(pg_temp.asset('30000000-0000-4000-8000-000000000005','vector','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','withdrawn','30000000-0000-4000-8000-000000000002'));
SET ROLE anon;
DO $$ BEGIN
 IF jsonb_array_length(public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000001')->'marks') <> 0 THEN RAISE EXCEPTION 'Withdrawal did not propagate'; END IF;
END $$;
RESET ROLE;
SELECT 'identity artwork registration, source custody, public reader and withdrawal PASS' AS result;
