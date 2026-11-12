-- eBay's aggregate read carries exact decimal/count/currency evidence even when the integer high_bid is unchanged.
-- Amend the current writer in place; preserve its closed-lot guard and all other houses' semantics.
DO $migration$
DECLARE
  body text := pg_get_functiondef('public.upsert_live_auction_vehicles(jsonb)'::regprocedure);
  needle text := '     OR (v.sale_status = ''auction_live'' AND v.sale_price IS NOT NULL)';
  replacement text := $clause$     OR (excluded.platform_source = 'ebay-motors' AND EXISTS (
       SELECT 1 FROM unnest(ARRAY['bid_count','currency','current_bid','current_bid_kind','buy_it_now','buying_options',
         'auction_observation_id','auction_snapshot_id']) AS f(key)
       WHERE v.origin_metadata->f.key IS DISTINCT FROM excluded.origin_metadata->f.key))
     OR (v.sale_status = 'auction_live' AND v.sale_price IS NOT NULL)$clause$;
  guard text := $guard$    AND (excluded.platform_source IS DISTINCT FROM 'ebay-motors' OR (
      v.platform_source = 'ebay-motors'
      AND nullif(excluded.origin_metadata->>'auction_observation_id', '') IS NOT NULL
      AND nullif(excluded.origin_metadata->>'auction_snapshot_id', '') IS NOT NULL
      AND nullif(excluded.origin_metadata->>'source_observed_at', '') IS NOT NULL
      AND (nullif(v.origin_metadata->>'source_observed_at', '') IS NULL
        OR (excluded.origin_metadata->>'source_observed_at')::timestamptz >= (v.origin_metadata->>'source_observed_at')::timestamptz)))
$guard$;
BEGIN
  IF md5(body) = '493d6cebe847a6610acffbd2ff4494e3' THEN RETURN; END IF;
  IF md5(body) <> 'a96f95c279f17395cc93e4f370e8e0ff' THEN
    RAISE EXCEPTION 'upsert_live_auction_vehicles changed; review before amending eBay predicate';
  END IF;
  body := replace(body, needle, replacement);
  body := replace(body, '    AND NOT EXISTS (SELECT 1 FROM auction_events a', guard || '    AND NOT EXISTS (SELECT 1 FROM auction_events a');
  EXECUTE body;
END
$migration$;
