-- Stand-in with the column names the price-basis workstream is adding (hammer_price, gross_price, net_to_owner,
-- price_basis). When those columns land, re-point this view at them; shadow functions read only this view.
-- hammer = reported / shadow_price_basis_factors.hammer_divisor; gross = hammer + buyer premium (platform_fee_schedules,
-- pct with min/cap, schedule in effect on the sale date); net_to_owner = hammer (seller commission not subtracted yet: NULL-safe placeholder).
CREATE OR REPLACE VIEW public.shadow_sale_prices WITH (security_invoker = true) AS
SELECT ae.id AS auction_event_id, ae.vehicle_id, ae.source AS platform, ae.auction_end_date AS sold_at,
       coalesce(ae.currency_code, 'USD') AS currency_code,
       f.reported_basis AS price_basis_reported, 'hammer'::text AS price_basis,
       round(ae.winning_bid / f.hammer_divisor, 2) AS hammer_price,
       CASE WHEN f.reported_basis = 'hammer_plus_premium' THEN ae.winning_bid
            ELSE round(ae.winning_bid / f.hammer_divisor + coalesce(least(greatest(ae.winning_bid * fs.buyer_premium_pct / 100,
                   coalesce(fs.buyer_premium_min, 0)), coalesce(fs.buyer_premium_cap, 'infinity')), 0), 2) END AS gross_price,
       round(ae.winning_bid / f.hammer_divisor, 2) AS net_to_owner
FROM public.auction_events ae
JOIN public.shadow_price_basis_factors f ON f.platform = ae.source
LEFT JOIN LATERAL (SELECT s.* FROM public.platform_fee_schedules s
   WHERE s.platform_key = replace(replace(ae.source, '_', ''), '-', '')
     AND (s.effective_from IS NULL OR s.effective_from <= ae.auction_end_date::date)
     AND (s.effective_to IS NULL OR s.effective_to > ae.auction_end_date::date)
   ORDER BY s.effective_from DESC NULLS LAST LIMIT 1) fs ON true
WHERE ae.outcome = 'sold' AND ae.winning_bid >= 1000
  AND NOT (coalesce(ae.raw_data, '{}'::jsonb) ? 'duplicate_of');
