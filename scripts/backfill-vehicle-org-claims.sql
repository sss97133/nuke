SET statement_timeout = 0;
DO $$
DECLARE
  r record;
  last_id uuid := NULL;
  tot int := 0;
  batch int := 0;
BEGIN
  LOOP
    SELECT * INTO r FROM backfill_vehicle_org_claims_from_bat_listings(5000, last_id);
    batch := batch + 1;
    tot := tot + COALESCE(r.inserted_seller, 0) + COALESCE(r.inserted_platform, 0);
    last_id := r.last_id;
    IF batch % 10 = 0 THEN
      RAISE NOTICE 'Batch % inserted_seller=% inserted_platform=% last_id=%', batch, r.inserted_seller, r.inserted_platform, last_id;
    END IF;
    EXIT WHEN last_id IS NULL;
  END LOOP;
  RAISE NOTICE 'Done. Batches=%, total rows=%', batch, tot;
END $$;
SELECT refresh_org_total_vehicles();
