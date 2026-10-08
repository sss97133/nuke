-- Oldest-first intake spent its first 8,000 keys on unsupported legacy sources.
-- Visit the same finite baseline from alternating ends: useful recent testimony
-- becomes reachable now, and older custody is still exhaustively replayed.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='project-retained-listing-properties' AND active
  AND schedule='* * * * *' AND encode(sha256(convert_to(command,'UTF8')),'base64')='ybRKxK2Ppko4zRiYYzl0xrdqiACcl4gs/ioXuicWpN4=') THEN
  RAISE EXCEPTION 'Listing intake command changed or owner paused';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.seed_retained_listing_properties()'::regprocedure),'UTF8')),'base64')
  NOT IN('YRzqr+0riBAw3pxlYDYJY9w2BmsiTrJbb4uQhbrKP8U=','EOgYZUhwfQTd1hhVJW7oZMjpunQXvby9nBXJlOiizh0=') THEN
  RAISE EXCEPTION 'Listing replay owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.enqueue_retained_listing_properties(uuid)'::regprocedure),'UTF8')),'base64')
  IS DISTINCT FROM 'lz7QSKcYsEX1TVkEPCaptGq8KvdCzz9CaUo728Mc8Ew=' THEN
  RAISE EXCEPTION 'Listing source qualification owner changed';END IF;
END $$;
ALTER TABLE public.retained_listing_property_replay
 ADD COLUMN IF NOT EXISTS reverse_cursor_recorded_at timestamptz,
 ADD COLUMN IF NOT EXISTS reverse_cursor_source_id uuid REFERENCES public.vehicle_observations(id),
 ADD COLUMN IF NOT EXISTS scan_direction text NOT NULL DEFAULT 'newest';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.retained_listing_property_replay'::regclass
  AND conname='retained_listing_replay_reverse_cursor') THEN
  ALTER TABLE public.retained_listing_property_replay ADD CONSTRAINT retained_listing_replay_reverse_cursor CHECK(
   (reverse_cursor_recorded_at IS NULL)=(reverse_cursor_source_id IS NULL)
   AND (reverse_cursor_recorded_at IS NULL OR (isfinite(reverse_cursor_recorded_at)
    AND (reverse_cursor_recorded_at,reverse_cursor_source_id)<=(upper_recorded_at,upper_source_id)))
   AND scan_direction IN('newest','oldest'));
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.seed_retained_listing_properties() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' SET statement_timeout='5s' AS $$
DECLARE s record;p record;n integer:=0;direction text;upper_operator text;
BEGIN
 IF (SELECT count(*) FROM public.retained_listing_property_work WHERE status IN('pending','claimed'))>=500 THEN RETURN 0;END IF;
 SELECT * INTO s FROM public.retained_listing_property_replay WHERE id FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR s.scan_completed_at IS NOT NULL THEN RETURN 0;END IF;
 -- Both tokens are closed constants. Literal ordering and bound operator let
 -- each direction use the existing (kind,ingested_at) index, avoiding a CASE
 -- sort over the baseline or a cached generic OR plan over the unvisited gap.
 direction:=CASE s.scan_direction WHEN 'newest' THEN 'DESC' ELSE 'ASC' END;
 upper_operator:=CASE WHEN s.reverse_cursor_source_id IS NULL THEN '<=' ELSE '<' END;
 FOR p IN EXECUTE format($query$
  SELECT id,ingested_at FROM public.vehicle_observations
  WHERE kind='listing' AND isfinite(ingested_at)
   AND (ingested_at,id)>($1,$2) AND (ingested_at,id) %s ($3,$4)
  ORDER BY ingested_at %s,id %s LIMIT 500$query$,upper_operator,direction,direction)
 USING coalesce(s.cursor_recorded_at,'-infinity'::timestamptz),
  coalesce(s.cursor_source_id,'00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(s.reverse_cursor_recorded_at,s.upper_recorded_at),
  coalesce(s.reverse_cursor_source_id,s.upper_source_id) LOOP
  PERFORM public.enqueue_retained_listing_properties(p.id);
  IF s.scan_direction='newest' THEN
   s.reverse_cursor_recorded_at:=p.ingested_at;s.reverse_cursor_source_id:=p.id;
  ELSE s.cursor_recorded_at:=p.ingested_at;s.cursor_source_id:=p.id;END IF;
  n:=n+1;
 END LOOP;
 UPDATE public.retained_listing_property_replay SET cursor_recorded_at=s.cursor_recorded_at,
  cursor_source_id=s.cursor_source_id,reverse_cursor_recorded_at=s.reverse_cursor_recorded_at,
  reverse_cursor_source_id=s.reverse_cursor_source_id,scan_direction=CASE s.scan_direction WHEN 'newest' THEN 'oldest' ELSE 'newest' END,
  keys_seen=keys_seen+n,last_seed_at=clock_timestamp(),
  scan_completed_at=CASE WHEN n<500 THEN clock_timestamp() END WHERE id;
 RETURN n;
END $$;
COMMENT ON TABLE public.retained_listing_property_replay IS 'Existing finite listing recording-clock/PK replay, now alternating newest and oldest500-key pages below500pending/claimed work. Forward cursor is the exclusive visited lower bound; reverse cursor is the exclusive visited upper bound, initially the immutable inclusive installation highwater. Fronts converge without skipping or revisiting keys; keys_seen counts actual source visits including unsupported rows, never new data. New inserts enqueue independently, including out-of-order clocks. Source qualification and canonical consumer custody remain mandatory.';
COMMENT ON COLUMN public.retained_listing_property_replay.reverse_cursor_recorded_at IS 'Exclusive upper recording clock reached by the newest-first replay front; paired with reverse_cursor_source_id. NULL uses the original immutable inclusive highwater. Not a source event or admission clock.';
COMMENT ON COLUMN public.retained_listing_property_replay.reverse_cursor_source_id IS 'Source PK paired with reverse_cursor_recorded_at to disambiguate tied recording clocks; previously visited keys at/above this tuple are excluded.';
COMMENT ON COLUMN public.retained_listing_property_replay.scan_direction IS 'Next500-key replay direction: newest reaches recent retained claims promptly, oldest preserves fair exhaustive baseline coverage. Alternates only after an admitted seed; existing backpressure leaves both fronts unchanged.';
NOTIFY pgrst,'reload schema';
COMMIT;
