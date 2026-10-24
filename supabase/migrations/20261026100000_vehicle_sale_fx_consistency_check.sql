-- Sale fx consistency: a non-USD sale with a rate must carry
--   sale_price_usd = round(sale_price * sale_price_fx_rate, 2)   (to the cent, the rounding vehicle_sale_price_fx_usd uses)
--   sale_price_fx_date within the 7 days up to sale_date        (the window the fx helpers search)
-- Before: 27 vehicles had drifted (amount or sale date changed without the rate following); run fx_fix_v1_20261024
-- re-derived the 18 with an amount at the recorded provider's rate.
-- NOT VALID: enforced on every insert/update from now on; existing rows are not re-checked, because 9 GBP vehicles hold
-- sale_price_usd with no native sale_price and wait on a human decision. VALIDATE once they are resolved.
-- Rollback: supabase/rollbacks/20261026100000_vehicle_sale_fx_consistency_check_down.sql
set lock_timeout = '5s';
alter table public.vehicles drop constraint if exists vehicles_sale_price_fx_consistent;
alter table public.vehicles add constraint vehicles_sale_price_fx_consistent check (
  sale_price_currency is null or upper(sale_price_currency) = 'USD' or sale_price_fx_rate is null
  or (sale_price is not null and sale_date is not null
      and sale_price_usd = round(sale_price::numeric * sale_price_fx_rate, 2)
      and sale_price_fx_date between sale_date - 7 and sale_date)
) not valid;
comment on constraint vehicles_sale_price_fx_consistent on public.vehicles is
  'Non-USD sale: sale_price_usd = round(sale_price * sale_price_fx_rate, 2) and sale_price_fx_date in [sale_date - 7, sale_date]. NOT VALID until the 9 GBP rows with no native amount are resolved.';
