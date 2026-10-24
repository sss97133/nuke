-- shadow_sale_prices: add first-class vehicle_events branch (Collecting Cars) + source_tbl column (appended).
-- Guard: abort if the view has columns we don't know about (another workstream), so nothing is dropped.
do $g$ begin
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='shadow_sale_prices') <> 13 then
    raise exception 'shadow_sale_prices has unexpected columns; merge manually';
  end if;
end $g$;
insert into shadow_view_defs_backup (view_name, def, saved_at) values ('shadow_sale_prices', pg_get_viewdef('public.shadow_sale_prices'::regclass), now());
create or replace view public.shadow_sale_prices as
 SELECT ae.id AS auction_event_id, ae.vehicle_id, ae.source AS platform, ae.auction_end_date AS sold_at,
    COALESCE(ae.currency_code, 'USD'::text) AS currency_code, (ae.price_basis)::text AS price_basis_reported, 'hammer'::text AS price_basis,
    ae.hammer_price, ae.gross_price, ae.net_to_owner, ae.fx_to_usd,
    CASE WHEN COALESCE(ae.currency_code, 'USD'::text) = 'USD'::text THEN ae.hammer_price ELSE round(ae.hammer_price * ae.fx_to_usd, 2) END AS hammer_price_usd,
    ae.fx_to_usd_source, 'auction_events'::text AS source_tbl
   FROM auction_events ae
  WHERE ae.outcome = 'sold'::text AND ae.hammer_price >= 1000::numeric AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of'::text)
 UNION ALL
 SELECT ve.id, ve.vehicle_id, 'collecting-cars'::text, ve.sold_at,
    ve.currency_code, (ve.price_basis)::text, 'hammer'::text,
    ve.hammer_price, ve.gross_price, ve.net_to_owner, ve.fx_to_usd,
    CASE WHEN ve.currency_code = 'USD'::text THEN ve.hammer_price ELSE round(ve.hammer_price * ve.fx_to_usd, 2) END,
    ve.fx_to_usd_source, 'vehicle_events'::text
   FROM vehicle_events ve
  WHERE ve.source_platform = 'collecting_cars' AND ve.event_status = 'sold' AND ve.hammer_price >= 1000::numeric
    AND ve.currency_code IS NOT NULL AND ve.sale_truth_role IS DISTINCT FROM 'duplicate'
    AND NOT EXISTS (SELECT 1 FROM auction_events a WHERE a.vehicle_id = ve.vehicle_id AND a.source IN ('collecting-cars','collecting_cars') AND a.outcome = 'sold');
-- Revert: drop view public.shadow_sale_prices; then re-create from the newest shadow_view_defs_backup row saved before this change
-- (select def from shadow_view_defs_backup where view_name='shadow_sale_prices' order by saved_at desc limit 1 offset 0 -- the row inserted above).
