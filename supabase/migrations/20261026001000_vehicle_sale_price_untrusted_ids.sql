-- Internal helper: set-based equivalent of vehicle_sale_price_untrusted() (verified 2258=2258, 0 diff, 2026-10-24).
CREATE OR REPLACE VIEW public.vehicle_sale_price_untrusted_ids AS
WITH cand AS MATERIALIZED (
  SELECT DISTINCT pv.vehicle_id FROM public.vehicle_events pv WHERE pv.price_verification IS NOT NULL
)
SELECT v.id AS vehicle_id
FROM cand c
JOIN public.vehicles v ON v.id = c.vehicle_id
JOIN public.vehicle_events ev ON ev.vehicle_id = c.vehicle_id
WHERE v.sale_price IS NOT NULL
GROUP BY v.id, v.sale_price
HAVING (coalesce(bool_or(ev.price_verification IN ('unverified','contradicted') AND ev.final_price = v.sale_price), false)
        AND NOT coalesce(bool_or(ev.final_price = v.sale_price AND (ev.price_verification IS NULL OR ev.price_verification = 'verified') AND ev.sale_truth_role IS DISTINCT FROM 'duplicate'), false))
    OR (coalesce(bool_or(ev.price_verification = 'verified' AND ev.final_price <> v.sale_price), false)
        AND NOT coalesce(bool_or(ev.price_verification = 'verified' AND ev.final_price = v.sale_price), false));
COMMENT ON VIEW public.vehicle_sale_price_untrusted_ids IS 'Set-based equivalent of vehicle_sale_price_untrusted(id, sale_price) for bulk/matview readers (no per-row lookups).';
REVOKE ALL ON public.vehicle_sale_price_untrusted_ids FROM anon, authenticated;
GRANT SELECT ON public.vehicle_sale_price_untrusted_ids TO service_role;
