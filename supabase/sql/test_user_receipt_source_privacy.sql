-- Existing upload/source/profile filing RPCs, then actual user receipt readers.
-- The included fixture refuses a non-disposable PostgreSQL17 database.
\set ON_ERROR_STOP on
\i supabase/sql/test_device_capture_session_profiles.sql
RESET ROLE;
ALTER TABLE public.vehicle_images ADD COLUMN IF NOT EXISTS thumbnail_url text,ADD COLUMN IF NOT EXISTS file_name text,
 ADD COLUMN IF NOT EXISTS doc_flag boolean DEFAULT false,ADD COLUMN IF NOT EXISTS vehicle_image_gallery_eligible boolean DEFAULT true;
-- Gallery eligibility is a closed boolean dependency here; explicit source flags
-- must still fence a conflicting eligible=true row. No classifier is simulated.
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,kind text,structured_data jsonb,content_text text,
 observed_at timestamptz,agent_model text,ingested_at timestamptz);
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,vehicle_id uuid,
 session_date date,title text,work_type text,session_type text,start_time timestamptz,end_time timestamptz,duration_minutes integer,total_job_cost numeric);
CREATE TABLE public.receipts(id uuid PRIMARY KEY,user_id uuid,vehicle_id uuid,vendor_name text,total_amount numeric,
 transaction_date date,purchase_date date,receipt_date date);
CREATE TABLE public.vehicle_timeline_events(user_id uuid,vehicle_id uuid,event_date date);
\i supabase/sql/helpers/user_contribution_readers_live_20261030.sql
GRANT EXECUTE ON FUNCTION public.get_user_day_receipt(uuid,date),public.get_user_contribution_calendar(uuid),
 public.get_user_contribution_days(uuid) TO anon,authenticated;
INSERT INTO public.vehicles(id,uploaded_by,is_public,deleted_at) VALUES
 (pg_temp.v('receipt-public'),pg_temp.u('capture'),true,NULL),
 (pg_temp.v('receipt-private'),pg_temp.u('capture'),false,NULL),
 (pg_temp.v('receipt-deleted'),pg_temp.u('capture'),true,now());
INSERT INTO public.vehicle_images(id,user_id,vehicle_id,image_url,taken_at,is_sensitive,is_document,doc_flag,vehicle_image_gallery_eligible)
SELECT pg_temp.i('receipt-'||n),pg_temp.u('capture'),
 CASE WHEN n=2 THEN pg_temp.v('receipt-private') WHEN n=7 THEN NULL
 WHEN n=8 THEN pg_temp.v('receipt-deleted') ELSE pg_temp.v('receipt-public') END,
 'https://fixture.invalid/receipt-'||n,'2000-02-01T00:00:00Z'::timestamptz+n*interval '2 hours',n=3,n=4,n=5,n<>6
FROM generate_series(1,9)n;
INSERT INTO public.work_sessions(user_id,vehicle_id,session_date,title,total_job_cost,session_type,start_time,end_time)
 SELECT pg_temp.u('capture'),pg_temp.v('receipt-'||scope),'2000-02-01',scope||' work',123,
 CASE WHEN scope='private' THEN 'owner_testimony' ELSE 'work' END,'2000-02-01T00:00:00Z','2000-02-01T23:59:00Z'
 FROM unnest(ARRAY['public','private','deleted'])scope;
INSERT INTO public.vehicle_timeline_events
 SELECT pg_temp.u('capture'),pg_temp.v('receipt-'||scope),'2000-02-01'
 FROM unnest(ARRAY['public','private','deleted'])scope;
SET ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',false);
SELECT public.get_user_day_receipt(pg_temp.u('capture'),'2000-02-01') AS r \gset before_
RESET ROLE;
SELECT pg_temp.ok('baseline reproduces the live reader gap without exposing any real source',
 jsonb_array_length(:'before_r'::jsonb->'photos')>2 AND jsonb_array_length(:'before_r'::jsonb->'work_sessions')=3
 AND jsonb_array_length(:'before_r'::jsonb->'gaps')>0);
CREATE TEMP TABLE reader_grants AS SELECT oid,proacl FROM pg_proc WHERE oid IN(
 'public.get_user_day_receipt(uuid,date)'::regprocedure,'public.get_user_contribution_calendar(uuid)'::regprocedure,
 'public.get_user_contribution_days(uuid)'::regprocedure);
\i supabase/migrations/20261030201742_protect_user_receipt_public_sources.sql
SELECT pg_temp.ok('existing reader permissions remain unchanged',
 NOT EXISTS(SELECT FROM pg_proc p JOIN reader_grants g USING(oid) WHERE p.proacl IS DISTINCT FROM g.proacl));
SET ROLE anon;
SELECT public.get_user_day_receipt(pg_temp.u('capture'),'2000-02-01') AS r \gset public_
SELECT pg_temp.ok('public receipt returns only the visible non-sensitive non-document source and public work',
 jsonb_array_length(:'public_r'::jsonb->'photos')=2
 AND :'public_r'::jsonb#>>'{photos,0,id}'=pg_temp.i('receipt-1')::text
 AND jsonb_array_length(:'public_r'::jsonb->'work_sessions')=1
 AND :'public_r'::jsonb#>>'{work_sessions,0,title}'='public work'
 AND :'public_r'::jsonb#>>'{work_sessions,0,total_job_cost}' IS NULL
 AND :'public_r'::jsonb->'gaps'='[]'::jsonb);
SELECT pg_temp.ok('public calendar and day drill share the visible source/activity scope',
 (SELECT x->>'photos'='2' AND x->>'events'='1' AND x->>'work'='1' AND x->>'work_cost' IS NULL
  FROM jsonb_array_elements(public.get_user_contribution_calendar(pg_temp.u('capture')))x WHERE x->>'day'='2000-02-01')
 AND (SELECT count(*)=3 AND bool_and(n=CASE WHEN kind='photo' THEN 2 ELSE 1 END) FROM public.get_user_contribution_days(pg_temp.u('capture')) WHERE day='2000-02-01'));
SET ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u('capture'),'role','authenticated')::text,false);
SELECT public.get_user_day_receipt(pg_temp.u('capture'),'2000-02-01') AS r \gset owner_
SELECT pg_temp.ok('the real signed-in source owner retains private/orphan/document history and work money',
 jsonb_array_length(:'owner_r'::jsonb->'photos')=9 AND jsonb_array_length(:'owner_r'::jsonb->'work_sessions')=3
 AND :'owner_r'::jsonb#>>'{work_sessions,0,total_job_cost}'='123'
 AND jsonb_array_length(:'owner_r'::jsonb->'gaps')=8);
SELECT pg_temp.ok('owner calendar retains its private source population',
 (SELECT x->>'photos'='9' AND x->>'events'='3' AND x->>'work'='3'
  FROM jsonb_array_elements(public.get_user_contribution_calendar(pg_temp.u('capture')))x WHERE x->>'day'='2000-02-01'));
SELECT public.get_user_day_receipt(pg_temp.u('capture'),'2026-01-01') AS r \gset filed_
RESET ROLE;
SELECT pg_temp.ok('actual retained capture/profile filing reaches the existing day receipt with the same source and vehicle',
 EXISTS(SELECT FROM jsonb_array_elements(:'filed_r'::jsonb->'photos')p JOIN public.vehicle_images i
  ON i.id=(p->>'id')::uuid WHERE i.id=pg_temp.i('capture-1') AND i.vehicle_id IS NOT NULL
  AND p->>'vehicle_id'=i.vehicle_id::text)
 AND (SELECT vehicle_id IS NOT NULL FROM public.vehicle_images WHERE id=pg_temp.i('capture-2')));
-- A signed-in stranger cannot gain the owner's private source population.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u('receipt-stranger'),'role','authenticated')::text,false);
SELECT pg_temp.ok('another signed-in account has only the same public receipt',
 (public.get_user_day_receipt(pg_temp.u('capture'),'2000-02-01')->'photos')=(:'public_r'::jsonb->'photos')
 AND (public.get_user_day_receipt(pg_temp.u('capture'),'2000-02-01')->'work_sessions')=(:'public_r'::jsonb->'work_sessions'));
RESET ROLE;
\i supabase/migrations/20261030201742_protect_user_receipt_public_sources.sql
SELECT pg_temp.ok('privacy owner migration reapplies without replacing current grants',
 NOT EXISTS(SELECT FROM pg_proc p JOIN reader_grants g USING(oid) WHERE p.proacl IS DISTINCT FROM g.proacl));
