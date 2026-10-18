-- Public read of the prediction ledger: the band columns only.
--
-- 20260927230000 let anon/authenticated read model_version = 30 rows with a table-level SELECT, so every
-- column of those rows was readable (the lead's review: buy_recommendation, predicted_margin,
-- predicted_flip_margin, notes...). The homepage needs the band only. Row rule unchanged (model 30 only);
-- columns limited to what market_pulse_live() reads.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

REVOKE SELECT ON public.hammer_predictions FROM anon, authenticated;
GRANT SELECT (id, vehicle_id, model_version, predicted_at, predicted_low, predicted_hammer, predicted_high, price_tier, comp_count)
  ON public.hammer_predictions TO anon, authenticated;

RESET lock_timeout;
RESET statement_timeout;

NOTIFY pgrst, 'reload schema';

-- POST-APPLY (read-only, as anon): market_pulse_live() still returns bands; select notes from hammer_predictions -> permission denied.
