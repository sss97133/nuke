-- Fast quality score backfill function
-- Uses inline scoring formula (identical to compute_vehicle_quality_score)
-- but without per-row function call overhead, enabling 50K+ rows/batch
--
-- The scoring formula:
--   year valid (1885-2028): 20pts, make present: 20pts, model present: 20pts (5pts if >80 chars),
--   VIN present: 10pts (2pts if wrong length for 1981+), description >30 chars: 10pts,
--   mileage present: 5pts, listing_url present: 5pts, sale_price >= 100: 10pts
--   Total max: 100

CREATE OR REPLACE FUNCTION fast_backfill_quality_scores(batch_limit INT DEFAULT 50000)
RETURNS INT
LANGUAGE plpgsql
SET statement_timeout = '120s'
AS $$
DECLARE
  affected INT;
BEGIN
  UPDATE vehicles v SET data_quality_score = LEAST(100, GREATEST(0,
    ROUND((
      CASE WHEN v.year IS NOT NULL AND v.year >= 1885 AND v.year <= 2028 THEN 0.20 ELSE 0 END +
      CASE WHEN v.make IS NOT NULL AND trim(v.make) <> '' AND length(trim(v.make)) <= 50 THEN 0.20 ELSE 0 END +
      CASE WHEN v.model IS NOT NULL AND trim(v.model) <> '' THEN
        CASE WHEN length(trim(v.model)) <= 80 THEN 0.20 ELSE 0.05 END
      ELSE 0 END +
      CASE WHEN v.vin IS NOT NULL AND trim(v.vin) <> '' THEN
        CASE WHEN v.year IS NULL OR v.year < 1981 THEN 0.10
             WHEN length(trim(v.vin)) = 17 THEN 0.10
             ELSE 0.02 END
      ELSE 0 END +
      CASE WHEN v.description IS NOT NULL AND length(trim(v.description)) > 30 THEN 0.10 ELSE 0 END +
      CASE WHEN v.mileage IS NOT NULL AND v.mileage >= 0 AND v.mileage < 2000000 THEN 0.05 ELSE 0 END +
      CASE WHEN v.listing_url IS NOT NULL AND trim(v.listing_url) <> '' THEN 0.05 ELSE 0 END +
      CASE WHEN v.sale_price IS NOT NULL AND v.sale_price >= 100 THEN 0.10 ELSE 0 END
    ) * 100)::INTEGER
  ))
  WHERE v.id IN (
    SELECT id FROM vehicles
    WHERE data_quality_score IS NULL OR data_quality_score = 0
    LIMIT batch_limit
  );
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

COMMENT ON FUNCTION fast_backfill_quality_scores IS
'Inline quality score computation for bulk backfill. No per-row function calls.
Formula matches compute_vehicle_quality_score(vehicles) exactly.
Use: SELECT fast_backfill_quality_scores(50000); -- processes 50K rows per call';
