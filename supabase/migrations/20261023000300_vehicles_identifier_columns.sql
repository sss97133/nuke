-- Vehicles columns for typed identifiers, split out after run 39842460458 timed out waiting on the vehicles lock.
-- Nullable, no default: metadata-only. Short lock_timeout with retries so it never queues behind traffic.
SET statement_timeout = '0'; -- bounded instead by lock_timeout x tries (~6 min max)
DO $alter$
DECLARE tries int := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '3s';
      ALTER TABLE public.vehicles
        ADD COLUMN IF NOT EXISTS is_replica boolean,
        ADD COLUMN IF NOT EXISTS replica_quote text,
        ADD COLUMN IF NOT EXISTS numbers_state text CHECK (numbers_state IN ('matching','non_matching','unknown')),
        ADD COLUMN IF NOT EXISTS numbers_documented_by text[],
        ADD COLUMN IF NOT EXISTS numbers_quote text,
        ADD COLUMN IF NOT EXISTS body_style_quote text;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      tries := tries + 1;
      IF tries >= 90 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END $alter$;
