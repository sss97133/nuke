-- Disposable PG17 only. The base profile contract, then the 20261116056500 timeline patch on top of it.
-- Kept out of test_vehicle_profile_read.sql: two contracts include that file and pin its composed body.
\set ON_ERROR_STOP on
\ir test_vehicle_profile_read.sql
-- 20261116056500: a photo-upload placeholder day reads as a photo upload; every other kind and the coverage unchanged.
CREATE TABLE public.t_timeline_snap (vid uuid, doc jsonb);
INSERT INTO public.t_timeline_snap
SELECT v.id, public.vehicle_profile_read(v.id)->'sections'->2 FROM public.vehicles v;
-- ALLOW_RAW_TESTIMONY_WRITE (fixture in the throwaway contract database, not production)
INSERT INTO public.timeline_events (vehicle_id, event_type, event_date, created_at) VALUES
 ('10000000-0000-0000-0000-000000000001', 'pending_analysis', '2026-02-01', '2026-02-01T13:00:00Z');
\ir ../migrations/20261116056500_profile_read_timeline_photo_upload.sql
\ir ../migrations/20261116056500_profile_read_timeline_photo_upload.sql
DO $$
DECLARE d jsonb;
BEGIN
  PERFORM public.t_assert((length(pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure))
      - length(replace(pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure), 'profile_timeline_photo_upload_v1', '')))
      / length('profile_timeline_photo_upload_v1') = 1, 'timeline patched once');
  d := public.vehicle_profile_read('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(d->'sections'->2->'days'->0 = '{"day":"2026-02-01","kinds":{"photo_session":2,"photo_upload":1,"service":1}}'::jsonb,
    format('a pending_analysis event is a photo upload; got %s', d->'sections'->2->'days'->0));
  PERFORM public.t_assert(NOT (d->'sections'->2)::text LIKE '%pending_analysis%', 'no pending_analysis kind reaches the read');
  -- Every other vehicle's timeline section is byte-identical; vehicle 1 differs only by the added event.
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM public.t_timeline_snap s
    WHERE s.vid <> '10000000-0000-0000-0000-000000000001'
      AND s.doc IS DISTINCT FROM public.vehicle_profile_read(s.vid)->'sections'->2), 'other timelines unchanged');
  PERFORM public.t_assert(d->'sections'->2->'days'->1 = (SELECT doc->'days'->1 FROM public.t_timeline_snap
    WHERE vid = '10000000-0000-0000-0000-000000000001'), 'older days unchanged');
END $$;
SELECT 'profile_read timeline photo_upload contract: PASS' AS result;
