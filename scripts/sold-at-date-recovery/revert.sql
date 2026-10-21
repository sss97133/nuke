-- One-statement revert for sold_at date recovery (marker sold_at_date_recovery_v1).
-- Clears recovered clocks on vehicle_events and supersedes the recovery observations.
-- Safe to re-run. Does not delete testimony.

BEGIN;
SET LOCAL statement_timeout = '15min';
SET LOCAL lock_timeout = '30s';

-- 1) Clear sold_at only where this recovery wrote it.
UPDATE public.vehicle_events e
SET sold_at = NULL,
    metadata = e.metadata - 'sold_at_date_recovery',
    updated_at = transaction_timestamp()
WHERE e.metadata -> 'sold_at_date_recovery' ->> 'marker' = 'sold_at_date_recovery_v1';

-- 2) Supersede recovery observations (keep the rows).
UPDATE public.vehicle_observations o
SET is_superseded = true,
    superseded_at = coalesce(o.superseded_at, transaction_timestamp())
WHERE o.extraction_method = 'sold_at_date_recovery_v1'
  AND coalesce(o.is_superseded, false) IS FALSE;

COMMIT;
