-- Actual source intake/profile and revisioned queue owners in isolated PG17.
\set ON_ERROR_STOP on
\i supabase/sql/test_registered_profile_source_claims.sql
RESET ROLE;
ALTER TABLE public.vehicles ADD COLUMN title text,ADD COLUMN condition_rating integer,ADD COLUMN sale_price integer,
 ADD COLUMN ownership_verified boolean,ADD COLUMN description text,ADD COLUMN sold_price integer,
 ADD COLUMN highlights text,ADD COLUMN equipment text,ADD COLUMN modifications text,ADD COLUMN known_flaws text,
 ADD COLUMN title_status text,ADD COLUMN deal_score numeric,ADD COLUMN heat_score numeric,
 ADD COLUMN price_confidence text,ADD COLUMN canonical_sold_price numeric;
ALTER TABLE public.vehicle_images ADD COLUMN ai_processing_status text,ADD COLUMN vehicle_zone text,
 ADD COLUMN is_external boolean,ADD COLUMN is_approved boolean,ADD COLUMN approval_status text,
 ADD COLUMN verification_status text,ADD COLUMN redaction_level text,ADD COLUMN user_id uuid,ADD COLUMN exif_data jsonb;
CREATE TABLE public.vehicle_documents(vehicle_id uuid);
CREATE TABLE public.timeline_events(vehicle_id uuid,event_type text);
CREATE TABLE public.nuke_estimates(vehicle_id uuid,estimated_value numeric,confidence_score integer,
 deal_score numeric,heat_score numeric,input_count integer,calculated_at timestamptz);
-- Closed unrelated BaT-pending and MVPS-zone branches; tested calculations use
-- approved fixture images and compare only the actual readiness market score.
CREATE FUNCTION public.bat_pending_image_has_listing(uuid,jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.check_mvps_zone_coverage(text[]) RETURNS TABLE(mvps_complete boolean,zones_missing text[])
 LANGUAGE sql AS $$SELECT false,'{}'::text[]$$;
CREATE TABLE public.analysis_widgets(slug text PRIMARY KEY,is_enabled boolean,trigger_on_observation_kinds text[],compute_mode text);
CREATE TABLE public.analysis_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid NOT NULL UNIQUE REFERENCES public.vehicles,
 trigger_source text,trigger_reasons text[],widget_slugs text[],status text NOT NULL,priority smallint,worker_id text,
 claimed_at timestamptz,widgets_computed smallint,widgets_failed smallint,compute_time_ms integer,completed_at timestamptz,
 created_at timestamptz DEFAULT now());
CREATE TABLE public.analysis_signals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,widget_slug text,
 score numeric,label text,severity text,value_json jsonb,reasons text[],evidence jsonb,confidence numeric,recommendations jsonb,
 previous_score numeric,previous_severity text,changed_at timestamptz,change_direction text,computed_at timestamptz,
 stale_at timestamptz,compute_time_ms integer,UNIQUE(vehicle_id,widget_slug));
CREATE TABLE public.analysis_signal_history(id uuid DEFAULT gen_random_uuid(),signal_id uuid,vehicle_id uuid,
 widget_slug text,score numeric,severity text,label text,reasons text[],computed_at timestamptz);
CREATE TABLE public.ars_recompute_queue(vehicle_id uuid PRIMARY KEY,dimension text);
INSERT INTO public.analysis_widgets VALUES('data-quality',true,NULL,'inline_sql'),('photo-coverage',true,NULL,'inline_sql'),
 ('requires-separate-authority',true,ARRAY['*'],'edge_function');
\i supabase/migrations/20261030150308_durable_observation_analysis_work.sql
CREATE TRIGGER trg_ars_on_observation_insert AFTER INSERT ON public.vehicle_observations
 FOR EACH ROW WHEN(NEW.vehicle_id IS NOT NULL) EXECUTE FUNCTION public.trigger_ars_on_observation();
\i supabase/sql/helpers/retained_analysis_readers_live_20261030.sql
\i supabase/migrations/20261030181201_dispatch_retained_analysis_work.sql
CREATE TEMP TABLE fixture_readiness AS SELECT public.compute_auction_readiness('11111111-1111-1111-1111-111111111111') AS answer;
SELECT pg_temp.ok('new automatic methods are registered on existing owners only',
 (SELECT count(*)=2 FROM public.analysis_widgets WHERE retained_dispatch_method IS NOT NULL));
SELECT pg_temp.ok('automatic result retains the actual source reader receipt without claiming quality or mechanical proof',
 (SELECT r->>'assessment_status'='not_assessed' AND r->>'score' IS NULL AND r#>>'{details,reader}'='get_vehicle_specs:source_claims_v1'
  AND jsonb_array_length(r#>'{evidence,record_ids}')>0 FROM(SELECT public.compute_retained_analysis_widget(
  '11111111-1111-1111-1111-111111111111','data-quality','registered_source_state_v1')r)x));
SELECT pg_temp.ok('photo state uses actual gallery eligibility and labels attribution/coverage unknown',
 (SELECT r#>>'{details,images_in_page}'='2' AND r#>>'{details,filing_correctness}'='not_assessed'
  AND r#>>'{details,capture_coverage}'='unknown' FROM(SELECT public.compute_retained_analysis_widget(
   '11111111-1111-1111-1111-111111111111','photo-coverage','filed_photo_state_v1')r)x));
DO $$ DECLARE c public.analysis_queue; replacement public.analysis_queue; result jsonb; BEGIN
 PERFORM public.enqueue_analysis_work('11111111-1111-1111-1111-111111111111','observation','{}',NULL,70);
 SELECT * INTO c FROM public.claim_analysis_queue_batch(1,'retained','11111111-1111-1111-1111-111111111111',true);
 PERFORM pg_temp.ok('retained claim leaves paid dependencies outside its lease',c.claimed_widget_slugs=ARRAY['data-quality','photo-coverage']);
 BEGIN
  PERFORM public.record_analysis_queue_signal(c.id,'retained',c.claimed_revision,c.lease_token,
   jsonb_build_object('vehicle_id',c.vehicle_id,'widget_slug','data-quality','score',100,'value_json',
    jsonb_build_object('method_revision','registered_source_state_v1','assessment_status','not_assessed')));
  RAISE EXCEPTION 'Expected score authority refusal';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 result:=public.compute_retained_analysis_widget(c.vehicle_id,'data-quality','registered_source_state_v1');
 PERFORM public.record_analysis_queue_signal(c.id,'retained',c.claimed_revision,c.lease_token,
  jsonb_build_object('vehicle_id',c.vehicle_id,'widget_slug','data-quality','score',NULL,'severity','info','value_json',result,'evidence',result->'evidence'));
 -- Simulated process death after durable checkpoint: no finish call.
 UPDATE public.analysis_queue SET lease_expires_at=clock_timestamp()-interval '1s' WHERE id=c.id;
 SELECT * INTO replacement FROM public.claim_analysis_queue_batch(1,'retained',c.vehicle_id,true);
 PERFORM pg_temp.ok('expired retained lease resumes only unfinished extraction-free work',replacement.claimed_widget_slugs=ARRAY['photo-coverage']);
 PERFORM pg_temp.ok('old nonce cannot acknowledge replacement work',public.finish_analysis_queue_work(c.id,'retained',c.claimed_revision,c.lease_token,'{}')->>'status'='lease_lost');
 result:=public.compute_retained_analysis_widget(c.vehicle_id,'photo-coverage','filed_photo_state_v1');
 PERFORM public.record_analysis_queue_signal(replacement.id,'retained',replacement.claimed_revision,replacement.lease_token,
  jsonb_build_object('vehicle_id',c.vehicle_id,'widget_slug','photo-coverage','score',NULL,'severity','info','value_json',result,'evidence',result->'evidence'));
 PERFORM public.finish_analysis_queue_work(replacement.id,'retained',replacement.claimed_revision,replacement.lease_token,ARRAY['photo-coverage']);
 PERFORM pg_temp.ok('paid work remains durable and cannot hot-loop the retained drain',
  (SELECT status='pending' AND widget_slugs=ARRAY['requires-separate-authority'] FROM public.analysis_queue WHERE id=c.id)
  AND NOT EXISTS(SELECT FROM public.claim_analysis_queue_batch(1,'retained',c.vehicle_id,true)));
END $$;
INSERT INTO public.analysis_signals(vehicle_id,widget_slug,score,severity,value_json)
 VALUES('11111111-1111-1111-1111-111111111111','another-unscored-diagnostic',NULL,'info','{}');
SELECT pg_temp.ok('three diagnostic receipts cannot advance the actual readiness market rung',
 (SELECT public.compute_auction_readiness('11111111-1111-1111-1111-111111111111')->'market_score'=answer->'market_score' FROM fixture_readiness));
BEGIN;
UPDATE public.vehicle_images SET image_vehicle_match_status='mismatch' WHERE id='44444444-4444-4444-4444-000000000001';
SELECT pg_temp.ok('wrong attribution is excluded and changes invalidate both dependent readers',
 public.compute_retained_analysis_widget('11111111-1111-1111-1111-111111111111','photo-coverage','filed_photo_state_v1')#>>'{details,images_in_page}'='1'
 AND (SELECT widget_slugs @> ARRAY['data-quality','photo-coverage'] FROM public.analysis_queue WHERE vehicle_id='11111111-1111-1111-1111-111111111111')
 AND (SELECT bool_and(stale_at<=clock_timestamp()) FROM public.analysis_signals WHERE widget_slug IN ('data-quality','photo-coverage')));
ROLLBACK;
BEGIN;
UPDATE public.vehicles SET is_public=false WHERE id='11111111-1111-1111-1111-111111111111';
SELECT pg_temp.ok('automatic claim preserves private subject scope',NOT EXISTS(SELECT FROM public.claim_analysis_queue_batch(
 1,'retained','11111111-1111-1111-1111-111111111111',true)));
ROLLBACK;
BEGIN;
UPDATE public.vehicle_observations SET is_superseded=true WHERE id='55555555-5555-5555-5555-000000000001';
SELECT pg_temp.ok('source withdrawal durably invalidates the current dependent calculations',
 (SELECT widget_slugs @> ARRAY['data-quality','photo-coverage'] FROM public.analysis_queue WHERE vehicle_id='11111111-1111-1111-1111-111111111111'));
ROLLBACK;
SELECT public.enqueue_analysis_work('11111111-1111-1111-1111-111111111111','observation','{}',NULL,70,true);
SELECT pg_temp.ok('periodic retained mode cannot lift deferred authority',NOT EXISTS(SELECT FROM public.claim_analysis_queue_batch(
 1,'retained','11111111-1111-1111-1111-111111111111',true)));
SELECT pg_temp.ok('new claim and compute RPCs stay service only',
 NOT has_function_privilege('anon','public.compute_retained_analysis_widget(uuid,text,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.claim_analysis_queue_batch(integer,text,uuid,boolean)','EXECUTE'));
