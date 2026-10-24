-- v7: add fx_to_usd / hammer_price_usd (sale-date rate from derive_price_components_v3) to shadow_sale_prices. Additive columns only.
begin;
insert into public.shadow_view_defs_backup (view_name, def, saved_at) values ('shadow_sale_prices', pg_get_viewdef('public.shadow_sale_prices'::regclass), now());
create or replace view public.shadow_sale_prices with (security_invoker = true) as
 SELECT id AS auction_event_id, vehicle_id, source AS platform, auction_end_date AS sold_at,
    COALESCE(currency_code, 'USD'::text) AS currency_code, (price_basis)::text AS price_basis_reported,
    'hammer'::text AS price_basis, hammer_price, gross_price, net_to_owner,
    fx_to_usd, CASE WHEN COALESCE(currency_code, 'USD') = 'USD' THEN hammer_price ELSE round(hammer_price * fx_to_usd, 2) END AS hammer_price_usd, fx_to_usd_source
   FROM auction_events ae
  WHERE outcome = 'sold' AND hammer_price >= 1000 AND NOT (COALESCE(raw_data, '{}'::jsonb) ? 'duplicate_of');
select currency_code, count(*), count(hammer_price_usd) usd from public.shadow_sale_prices group by 1;
commit;
-- REVERT: begin; drop view public.shadow_sale_prices; execute the def from (select def from public.shadow_view_defs_backup where view_name='shadow_sale_prices' order by saved_at desc limit 1) as: create view public.shadow_sale_prices with (security_invoker=true) as <def>; commit;
