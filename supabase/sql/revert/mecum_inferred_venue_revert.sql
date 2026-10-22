update public.vehicle_events e set metadata = e.metadata - 'auction_name_inferred' - 'auction_name_inferred_run'
from public.mecum_venue_backfill_backup_20261022 b where b.id=e.id and e.metadata->>'auction_name_inferred_run'='mecum-venue-20261022';
