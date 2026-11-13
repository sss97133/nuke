-- Fix: move expired-item marking BEFORE the activity guard.
--
-- Root cause: the claim function exits early when >8 active backends,
-- skipping both seeding AND expired-item marking. Expired items should
-- always be marked regardless of activity level - they represent stuck
-- work that needs recovery, not new load.
--
-- Change: mark expired items first, then check activity guard for seeding/claiming.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '1s';

CREATE OR REPLACE FUNCTION public.claim_retained_listing_properties(p_worker text, p_limit integer DEFAULT 20)
RETURNS TABLE(source_observation_id uuid, property_id uuid, mode text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET lock_timeout TO '500ms'
SET statement_timeout TO '10s'
AS $function$
BEGIN
  IF p_worker IS NULL OR btrim(p_worker) = '' OR length(p_worker) > 80
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Invalid bounded listing property worker';
  END IF;

  -- Paused installation is also a claim barrier for an already-running older worker.
  IF NOT EXISTS(SELECT FROM cron.job WHERE jobname = 'project-retained-listing-properties' AND active) THEN
    RETURN;
  END IF;

  -- ALWAYS mark expired items, regardless of activity level.
  -- These are stuck work items that need recovery, not new load.
  WITH expired AS(
    SELECT q.source_observation_id, q.property_id
    FROM public.retained_listing_property_work q
    WHERE q.status = 'claimed' AND q.locked_at < now() - interval '10 minutes'
    ORDER BY q.locked_at LIMIT 60
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.retained_listing_property_work q
  SET status = CASE WHEN q.attempts >= 3 THEN 'failed' ELSE 'pending' END,
      locked_by = NULL,
      locked_at = NULL,
      next_attempt_at = now() + interval '15 minutes',
      last_error = 'lease_expired'
  FROM expired e
  WHERE q.source_observation_id = e.source_observation_id AND q.property_id = e.property_id;

  -- Activity guard: skip seeding and claiming during high load.
  -- This prevents overwhelming the database but doesn't block recovery.
  IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()) OR
     (SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND backend_type = 'client backend' AND pid <> pg_backend_pid()) > 8 THEN
    RETURN;
  END IF;

  PERFORM set_config('app.writer', 'ingest-observation:retained-listing', true);
  PERFORM public.seed_retained_listing_properties();

  RETURN QUERY WITH picked AS(
    SELECT q.source_observation_id, q.property_id
    FROM public.retained_listing_property_work q
    WHERE q.status IN('pending', 'skipped') AND q.next_attempt_at <= now() AND q.attempts < 3
    ORDER BY q.next_attempt_at, q.source_observation_id, q.property_id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.retained_listing_property_work q
  SET status = 'claimed',
      locked_by = p_worker,
      locked_at = now(),
      attempts = q.attempts + 1
  FROM picked p
  WHERE q.source_observation_id = p.source_observation_id AND q.property_id = p.property_id
  RETURNING q.source_observation_id, q.property_id, CASE q.property_id
    WHEN '514cacd3-82b4-4330-b3df-e292612ee718'::uuid THEN 'retained_listing_interior_color_v1'
    WHEN 'efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid THEN 'retained_listing_exterior_color_v1'
    WHEN 'c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid THEN 'retained_listing_engine_configuration_v1'
    WHEN '66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid THEN 'retained_listing_engine_displacement_l_v1'
    WHEN '235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid THEN 'retained_listing_transmission_type_v1'
    WHEN '32b51f19-e5cf-4f67-81d9-96c2d30885a1'::uuid THEN 'retained_listing_drivetrain_layout_v1'
    WHEN 'abdd7a7a-02c1-4b09-afc6-1a288207dd2d'::uuid THEN 'retained_listing_mileage_miles_v1'
    WHEN 'ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid THEN 'retained_listing_year_v1'
    WHEN '8d274b73-a8a6-43bf-9036-5864d0152725'::uuid THEN 'retained_listing_make_v1'
    WHEN 'a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid THEN 'retained_listing_model_v1'
    WHEN '9fc93dd3-3639-439a-8eed-3e9a0f846334'::uuid THEN 'retained_listing_vin_v1'
  END;
END $function$;

COMMIT;
