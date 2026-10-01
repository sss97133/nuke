-- C7 backfill (PROPOSED as a PR, 2026-10-01; the writers' stamp shipped separately in the C7 commit).
-- vehicles.platform_source is the platform key (source_registry.slug). It is NULL on 56,243 of the 58,566 vehicles
-- created 2026-09-24..10-01 (45,612 bringatrailer.com, 9,963 craigslist.org, 147 classiccars.com, 104 carsandbids.com,
-- 84 mecum.com) and on 175,253 public rows overall. The live pull's schedule sync reads this column, so 10 of the
-- 1,227 live BaT lots were unscheduled on 10-01.
--
-- WHAT THIS DOES: declares the column (the database describes itself), and defines a batched, scheduled writer that
-- derives the key from the listing_url host for rows where it is NULL, newest first, 2,000 rows a run, as a paused
-- cron. It is an UPDATE of a derived key on the trunk entity, not of testimony; the owner decides whether that is a
-- sanctioned write. Nothing runs until the cron is enabled:
--   select cron.alter_job(jobid, active := true) from cron.job where jobname = 'vehicles-platform-source-backfill';
-- Verify after an hour:
--   select count(*) filter (where platform_source is null) from vehicles where created_at > '2026-09-24';  -- toward 0
--   select * from v_job_health where jobname = 'vehicles-platform-source-backfill';

SET statement_timeout = '60s';
SET lock_timeout = '10s';

COMMENT ON COLUMN public.vehicles.platform_source IS
  'Platform key: source_registry.slug of the platform the listing_url belongs to (bringatrailer, craigslist, cars-and-bids, mecum, classiccars, barrett-jackson, pcarmarket, facebook_marketplace, ...). Dimension value, not an event. Stamped by the writers at insert since 2026-10-01 (C7); NULL means unknown; rows before that are filled from the listing_url host by backfill_vehicle_platform_source().';

CREATE OR REPLACE FUNCTION public.backfill_vehicle_platform_source(p_batch integer DEFAULT 2000, p_since timestamptz DEFAULT '2026-09-24')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_n integer;
  v_by jsonb;
BEGIN
  WITH map(host, slug) AS (VALUES
    ('bringatrailer.com', 'bringatrailer'), ('craigslist.org', 'craigslist'), ('carsandbids.com', 'cars-and-bids'),
    ('mecum.com', 'mecum'), ('classiccars.com', 'classiccars'), ('barrett-jackson.com', 'barrett-jackson'),
    ('pcarmarket.com', 'pcarmarket'), ('hagerty.com', 'hagerty-marketplace'), ('facebook.com', 'facebook_marketplace'),
    ('ebay.com', 'ebay-motors'), ('bonhams.com', 'bonhams'), ('goodingco.com', 'gooding'),
    ('broadarrowauctions.com', 'broadarrow'), ('classic.com', 'classic-com'), ('classicdriver.com', 'classic-driver')),
  pick AS (
    SELECT v.id, m.slug
    FROM vehicles v
    JOIN map m ON regexp_replace(v.listing_url, '^https?://(www\.)?([^/]+).*$', '\2') ~ ('(^|\.)' || replace(m.host, '.', '\.') || '$')
    WHERE v.platform_source IS NULL
      AND v.created_at >= p_since
      AND v.listing_url IS NOT NULL
    ORDER BY v.created_at DESC
    LIMIT greatest(p_batch, 0)
  ),
  upd AS (
    UPDATE vehicles v SET platform_source = pick.slug
    FROM pick WHERE v.id = pick.id
    RETURNING pick.slug
  )
  SELECT count(*), coalesce(jsonb_object_agg(slug, n), '{}'::jsonb) INTO v_n, v_by
  FROM (SELECT slug, count(*) AS n FROM upd GROUP BY slug) s;
  RETURN jsonb_build_object('updated', v_n, 'by_platform', v_by, 'since', p_since);
END;
$fn$;
COMMENT ON FUNCTION public.backfill_vehicle_platform_source(integer, timestamptz) IS
  'C7 backfill: fills vehicles.platform_source (source_registry.slug) from the listing_url host where NULL, newest first, p_batch rows a call. Scheduled as vehicles-platform-source-backfill (created paused).';
REVOKE ALL ON FUNCTION public.backfill_vehicle_platform_source(integer, timestamptz) FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'vehicles-platform-source-backfill';
  IF v_id IS NULL THEN
    v_id := cron.schedule('vehicles-platform-source-backfill', '*/2 * * * *',
      $cmd$SELECT set_config('app.writer', 'vehicles-platform-source-backfill', true); SET statement_timeout = '50s'; SELECT public.backfill_vehicle_platform_source(2000);$cmd$);
    PERFORM cron.alter_job(job_id := v_id, active := false);
  END IF;
END
$do$;
