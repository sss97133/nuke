-- ============================================================================
-- queue_sentiment_update: a comment with no vehicle has no vehicle to re-score
-- ============================================================================
--
-- WHY (2026-09-28): the first observation demoted into the user pool through
-- demote_observation_to_user (20260928204500) aborted its whole transaction:
--   null value in column "vehicle_id" of relation "sentiment_update_queue"
-- The AFTER INSERT trigger on vehicle_observations queues a per-vehicle sentiment
-- recompute for every 'comment' row and assumed every row has a vehicle. Rows in
-- the user pool (vehicle_id NULL, subject 'user' / 'organization') are now a
-- sanctioned state, so the trigger skips them. Nothing else changes: comments on
-- a vehicle still queue exactly as before.
--
-- Live verification after CI applies:
--   select pg_get_functiondef('public.queue_sentiment_update()'::regprocedure) ~ 'vehicle_id IS NOT NULL';
--   -- true; then the 433-row demote batch runs clean and
--   -- select count(*) from sentiment_update_queue where vehicle_id is null;  -- 0

SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.queue_sentiment_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only queue text observations (comment for now) that belong to a vehicle.
  -- User-pool rows (vehicle_id NULL) have nothing to re-score.
  IF NEW.kind = 'comment' AND NEW.vehicle_id IS NOT NULL THEN
    INSERT INTO sentiment_update_queue (vehicle_id, priority)
    VALUES (
      NEW.vehicle_id,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM vehicle_live_metrics
          WHERE vehicle_id = NEW.vehicle_id AND is_active_auction = true
        ) THEN 10
        ELSE 1
      END
    )
    ON CONFLICT (vehicle_id) DO UPDATE SET
      priority = GREATEST(sentiment_update_queue.priority, EXCLUDED.priority),
      created_at = NOW(),
      processed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;
