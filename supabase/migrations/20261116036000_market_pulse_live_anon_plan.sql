SET statement_timeout = '300s';
SET lock_timeout = '60s';
-- market_pulse_live: read the board's per-lot identity work in a plan that touches a tenth of the rows, and a
-- small partial index for the BaT lots' current episodes.
--
-- WHY. The home page's POST /rest/v1/rpc/market_pulse_live returned 500 at 2026-11-12 05:15:27Z (57014, the
-- function's 10 s statement_timeout). It runs as invoker, so as anon under row security.
-- Measured on prod 2026-11-12, EXPLAIN (ANALYZE, BUFFERS) of the body as anon (SET ROLE anon, request.jwt.claims),
-- warm: 670 ms, 39,531 buffers; anonymous HTTP ttfb 0.9-1.1 s warm, 5.9 s cold (lead's probe).
--   1. stable_links tested each of 77 candidates by re-expanding the 703 KB snapshot's auctions array:
--      185 ms (77 x 1,266 elements).
--   2. stable_candidates read the locator vehicle for all 1,266 inventory lots (14,295 buffers, each through the
--      vehicles row policy) before looking for the lot's current episode, which 1,137 of them do not have.
--   3. native joined each live auction event to its observation through a bitmap scan of every recent observation
--      of the vehicle (685 rows, each re-checking the vehicles policy), then filtered on the id the event names:
--      176 ms for 45 events.
--
-- WHAT. Same rows, same output: only the plan changes.
--   1. auction_refs: the snapshot's (vehicle id, lot url) pairs expanded once; the presentation test reads it.
--   2. stable_episodes: each lot's single current episode on another vehicle, found first (ep.vehicle_id is
--      compared with the inventory row's locator id, which the join already equates with locator.id); the
--      locator and canonical vehicles are then read for the 129 lots that have one.
--   3. native reads the event's observation by primary key in a LATERAL ... OFFSET 0 with the same two conditions.
--   4. idx_vehicle_events_bat_open_episode_url: btree (source_url) on BaT auction episodes that are active or live,
--      unsold and not duplicates (2,451 of 909,521 rows on 2026-11-12), the predicate both episode probes state.
--      The 1,266 probes read it instead of the 124 MB source_url index and its heap rows.
-- After (1-3), EXPLAIN as anon, warm: 261 ms, 18,684 buffers. Output byte-identical for anon, an untied
-- authenticated user and an owner on prod (md5 4970f2da..., 79a2cb67..., 6df10bfe... old = new, same statement).
-- CONTRACT: supabase/sql/test_market_pulse_live_anon_plan.sql (PG17 fixture of the BaT board contracts).
--
-- BUILD. vehicle_events is 1.4 GB (heap). CREATE INDEX CONCURRENTLY runs outside a transaction (the deploy applies
-- this file with psql -f in autocommit); statement_timeout above governs it over the deploy's 120 s PGOPTIONS. An
-- interrupted build leaves an INVALID index; the drop below clears it on a re-run.
-- Reversal: DROP INDEX CONCURRENTLY public.idx_vehicle_events_bat_open_episode_url; restore the body from
-- 20261109032705 (the patch below is fragment-for-fragment).

DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_events_bat_open_episode_url;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_events_bat_open_episode_url
  ON public.vehicle_events (source_url)
  WHERE source_platform = 'bat' AND event_type = 'auction' AND event_status IN ('active','live')
    AND sold_at IS NULL AND duplicate_of_event_id IS NULL;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicle_events_bat_open_episode_url') AND indisvalid) THEN
    RAISE EXCEPTION 'idx_vehicle_events_bat_open_episode_url is missing or INVALID after the build; DROP INDEX CONCURRENTLY it and re-run';
  END IF;
END $check$;

COMMENT ON INDEX public.idx_vehicle_events_bat_open_episode_url IS
'BaT auction episodes that are active or live, unsold and not duplicates, by source_url. market_pulse_live probes it for each board lot''s current episode. Built CONCURRENTLY 2026-11-12.';

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $patch$
DECLARE def text; change record;
BEGIN
 def:=pg_get_functiondef('public.market_pulse_live()'::regprocedure);
 IF strpos(def,'stable_episodes AS MATERIALIZED')>0 THEN RETURN; END IF;
 FOR change IN SELECT * FROM (VALUES
  ($old$ JOIN public.vehicle_observations o ON o.id=CASE WHEN pg_input_is_valid(e.raw_data#>>'{live_stream,observation_id}','uuid')
   THEN (e.raw_data#>>'{live_stream,observation_id}')::uuid END AND o.vehicle_id=v.id
$old$,
   $new$ -- The event names its live observation: read it by primary key (OFFSET 0 keeps the planner from scanning
 -- every recent observation of the vehicle and filtering on id).
 JOIN LATERAL (SELECT o.id,o.vehicle_id,o.kind,o.source_id,o.source_url,o.source_identifier,o.extraction_method,
     o.is_superseded,o.observed_at,o.ingested_at,o.structured_data,o.vehicle_match_signals
   FROM public.vehicle_observations o
   WHERE o.id=CASE WHEN pg_input_is_valid(e.raw_data#>>'{live_stream,observation_id}','uuid')
     THEN (e.raw_data#>>'{live_stream,observation_id}')::uuid END AND o.vehicle_id=v.id
   OFFSET 0) o ON true
$new$),
  ($old$ ), stable_inventory AS MATERIALIZED ($old$,
   $new$ ), auction_refs AS MATERIALIZED (
 -- The snapshot's lots expanded once, for the per-candidate presentation test below.
 SELECT a->>0 vehicle_ref, rtrim(a->>10,'/') lot_url FROM base CROSS JOIN LATERAL jsonb_array_elements(p->'auctions') a
), stable_inventory AS MATERIALIZED ($new$),
  ($old$), stable_candidates AS MATERIALIZED (
 SELECT i.locator_id,i.lot_url,c.id canonical_vehicle_id,ep.id episode_id,e.id auction_event_id,witness.id observation_id
 FROM stable_inventory i
 JOIN public.vehicles locator ON locator.id=i.locator_id
 CROSS JOIN LATERAL (
  SELECT ep.id,ep.vehicle_id FROM public.vehicle_events ep
  WHERE ep.source_platform='bat' AND ep.event_type='auction' AND ep.event_status IN('active','live')
   AND ep.sold_at IS NULL AND ep.duplicate_of_event_id IS NULL AND ep.ended_at>now()
   AND ep.source_url IN(i.lot_url,i.lot_url||'/') AND ep.vehicle_id<>locator.id
$old$,
   $new$), stable_episodes AS MATERIALIZED (
 -- The lot's single current episode on another vehicle, found before the locator is read: most lots have none.
 SELECT i.locator_id,i.lot_url,ep.id episode_id,ep.vehicle_id episode_vehicle_id
 FROM stable_inventory i
 CROSS JOIN LATERAL (
  SELECT ep.id,ep.vehicle_id FROM public.vehicle_events ep
  WHERE ep.source_platform='bat' AND ep.event_type='auction' AND ep.event_status IN('active','live')
   AND ep.sold_at IS NULL AND ep.duplicate_of_event_id IS NULL AND ep.ended_at>now()
   AND ep.source_url IN(i.lot_url,i.lot_url||'/') AND ep.vehicle_id<>i.locator_id
$new$),
  ($old$  OFFSET 0
 ) ep
 JOIN public.vehicles c ON c.id=ep.vehicle_id
$old$,
   $new$  OFFSET 0
 ) ep
), stable_candidates AS MATERIALIZED (
 SELECT i.locator_id,i.lot_url,c.id canonical_vehicle_id,i.episode_id,e.id auction_event_id,witness.id observation_id
 FROM stable_episodes i
 JOIN public.vehicles locator ON locator.id=i.locator_id
 JOIN public.vehicles c ON c.id=i.episode_vehicle_id
$new$),
  ($old$WHEN EXISTS(
   SELECT 1 FROM base CROSS JOIN LATERAL jsonb_array_elements(p->'auctions') other
   WHERE other->>0=candidate.canonical_vehicle_id::text
    AND rtrim(other->>10,'/') IS DISTINCT FROM candidate.lot_url)$old$,
   $new$WHEN EXISTS(
   SELECT 1 FROM auction_refs other
   WHERE other.vehicle_ref=candidate.canonical_vehicle_id::text
    AND other.lot_url IS DISTINCT FROM candidate.lot_url)$new$)
 ) changes(old_text,new_text) LOOP
  IF (length(def)-length(replace(def,change.old_text,'')))/length(change.old_text)<>1 THEN
   RAISE EXCEPTION 'market_pulse_live anchor drifted: %',left(change.old_text,80);
  END IF;
  def:=replace(def,change.old_text,change.new_text);
 END LOOP;
 EXECUTE def;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
