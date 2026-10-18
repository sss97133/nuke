-- OFFLINE ONLY: setup is inserted into the existing native-intake fixture.
ALTER TABLE public.vehicles ADD COLUMN is_public boolean DEFAULT true;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_public_vehicles ON public.vehicles FOR SELECT TO anon, authenticated
  USING (is_public AND deleted_at IS NULL);
CREATE POLICY fixture_service_vehicles ON public.vehicles FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.vehicles TO anon, authenticated;
CREATE TABLE public.comment_claims_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), comment_id uuid, vehicle_id uuid,
  claim_density_score numeric, llm_processed boolean, llm_model text, llm_cost_cents numeric,
  claims_extracted integer, field_evidence_ids uuid[], observation_ids uuid[],
  processed_at timestamptz, created_at timestamptz DEFAULT now(), extraction_version text,
  extraction_result jsonb
);
ALTER TABLE public.comment_claims_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY comment_claims_progress_public_read ON public.comment_claims_progress FOR SELECT TO public USING (true);
CREATE POLICY comment_claims_progress_service_write ON public.comment_claims_progress FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.comment_claims_progress TO anon, authenticated;
-- Even a pre-existing column grant must be removed alongside table privileges.
GRANT SELECT (extraction_result) ON public.comment_claims_progress TO anon, authenticated;
GRANT ALL ON public.comment_claims_progress TO service_role;

-- Acceptance cases: each admission/HTML statement commits separately, matching
-- a newer socket frame followed by a recovery request that started earlier.
RESET ROLE;
SET ROLE service_role;
-- Existing rows have only received_at from the original deployment. An older
-- first admission must preserve that legacy receipt before any newer frame.
SELECT ingest_bat_live_events(jsonb_build_array(
  (SELECT doc#>'{frames,0}' FROM fixture_frames) || jsonb_build_object(
    'received_at','2026-10-04T18:07:00Z','transport','missed_comments','content_hash',repeat('c',64))), '[]');
DO $$ BEGIN
  ASSERT (SELECT (raw_data#>>'{live_stream,last_frame_received_at}')::timestamptz='2026-10-04T18:08:46.683Z' FROM auction_events),
    'older admission preserves the legacy receipt when introducing the watermark';
END $$;
SELECT ingest_bat_live_events(jsonb_build_array(
  (SELECT doc#>'{frames,3}' FROM fixture_frames) || jsonb_build_object(
    'received_at','2026-10-04T18:10:00Z','content_hash',repeat('a',64))), '[]');
SELECT ingest_bat_live_events(jsonb_build_array(
  (SELECT doc#>'{frames,0}' FROM fixture_frames) || jsonb_build_object(
    'received_at','2026-10-04T18:09:00Z','transport','missed_comments','content_hash',repeat('b',64))), '[]');
DO $$ BEGIN
  ASSERT (SELECT (raw_data#>>'{live_stream,last_frame_received_at}')::timestamptz='2026-10-04T18:10:00Z' FROM auction_events),
    'auction cache keeps newest receipt watermark across admission batches';
  ASSERT (SELECT (raw_data#>>'{live_stream,received_at}')::timestamptz='2026-10-04T18:09:00Z' FROM auction_events),
    'per-frame receipt remains attributed to the older recovery';
  ASSERT (SELECT (stream_state->>'last_frame_received_at')::timestamptz='2026-10-04T18:10:00Z'
    FROM monitored_auctions WHERE id='00000000-0000-0000-0000-000000000001'), 'monitor watermark stays monotonic';
  ASSERT (SELECT (metadata#>>'{live_stream,last_frame_received_at}')::timestamptz='2026-10-04T18:10:00Z' FROM vehicle_events),
    'both caches keep the same newest receipt';
END $$;
UPDATE auction_events SET high_bid=100,total_bids=1,
  raw_data='{"source_read":{"at":"2026-10-04T18:09:30Z"}}';
UPDATE vehicle_events SET current_price=100,bid_count=1,
  metadata='{"source_read":{"at":"2026-10-04T18:09:30Z"}}';
DO $$ BEGIN
  ASSERT (SELECT high_bid=33000 AND total_bids>1 FROM auction_events),'intermediate stale HTML cannot regress auction bid/count';
  ASSERT (SELECT current_price=33000 AND bid_count>1 FROM vehicle_events),'intermediate stale HTML cannot regress UI bid/count';
END $$;
UPDATE auction_events SET high_bid=34000,total_bids=50,
  raw_data='{"source_read":{"at":"2026-10-04T18:11:00Z"}}';
UPDATE vehicle_events SET current_price=34000,bid_count=50,
  metadata='{"source_read":{"at":"2026-10-04T18:11:00Z"}}';
DO $$ BEGIN
  ASSERT (SELECT high_bid=34000 AND total_bids=50 FROM auction_events),'genuinely newer HTML remains eligible';
  ASSERT (SELECT current_price=34000 AND bid_count=50 FROM vehicle_events),'newer HTML reaches UI cache';
  ASSERT (SELECT count(*)=9 FROM vehicle_observations),'older recovery stays immutable testimony';
  ASSERT (SELECT count(*)=2 FROM auction_comments),'recovery retains native-comment deduplication';
END $$;
SELECT 'late recovery and HTML stale-read assays passed';

INSERT INTO comment_claims_progress(comment_id,vehicle_id,llm_processed,extraction_version,extraction_result)
SELECT id,vehicle_id,false,'public_comment_atoms_v1','{"content":"rejected raw extraction fixture"}' FROM auction_comments;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  ASSERT (SELECT count(*)=2 FROM comment_claims_progress),'public progress remains available';
  PERFORM comment_id,vehicle_id,llm_processed,extraction_version,processed_at FROM comment_claims_progress;
  BEGIN
    PERFORM extraction_result FROM comment_claims_progress;
    RAISE EXCEPTION 'anonymous raw-cache read unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM comment_claims_progress;
    RAISE EXCEPTION 'wildcard raw-cache read unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*)=2 FROM comment_claims_progress),'authenticated public progress remains available';
  BEGIN
    PERFORM extraction_result FROM comment_claims_progress;
    RAISE EXCEPTION 'authenticated raw-cache read unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE vehicles SET is_public=false;
SET ROLE anon;
DO $$ BEGIN ASSERT (SELECT count(*)=0 FROM comment_claims_progress),'public-to-private transition hides progress immediately'; END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN ASSERT (SELECT count(*)=0 FROM comment_claims_progress),'unrelated authenticated reader cannot see private progress'; END $$;
RESET ROLE;
UPDATE vehicles SET is_public=true,deleted_at=now();
SET ROLE anon;
DO $$ BEGIN ASSERT (SELECT count(*)=0 FROM comment_claims_progress),'deleted parent hides progress immediately'; END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN
  ASSERT (SELECT count(*)=2 FROM comment_claims_progress WHERE extraction_result->>'content'='rejected raw extraction fixture'),
    'service cache remains readable after privacy/deletion transitions';
END $$;
UPDATE comment_claims_progress SET extraction_result=extraction_result||'{"retry_fixture":true}';
DO $$ BEGIN
  ASSERT (SELECT count(*)=2 FROM comment_claims_progress WHERE extraction_result->>'retry_fixture'='true'),
    'service persistence retries retain raw-cache writes';
END $$;
RESET ROLE;
SELECT 'raw cache and parent authorization assays passed';
