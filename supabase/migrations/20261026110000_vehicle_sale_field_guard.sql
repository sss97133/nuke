-- Guard vehicles sale fields against no-sale lots and native-amount wipes.
-- Cause (2026-10-24 12:21 UTC, vehicle bef19c3d): extract-bonhams (bonhams-v3) re-imported the vehicle's own discovery lot
-- 18524/282 (bought in) and wrote its full record: sale_price null, sale_date 2010-08-15, sale_status available, while
-- sale_price_usd/fx stayed from the sold lot 19293/438 (GBP 7,500).
-- Rules:
--  1. An update that clears sale_price while sale_price_usd stays set on a non-USD sale is refused inside a correction
--     (nuke.bulk_sale_correction = 'on'); from any other writer the prior sale_price, sale_date and sale_status are kept.
--  2. A row that has a sale price keeps its sale_date and sale_status when the incoming update carries no sale price
--     (a no-sale lot: upcoming, bought in, withdrawn) unless it comes from a correction.
create or replace function public.vehicles_guard_sale_fields()
returns trigger language plpgsql as $$
declare v_corr boolean := coalesce(current_setting('nuke.bulk_sale_correction', true), '') = 'on';
begin
  if old.sale_price is not null and new.sale_price is null then
    if new.sale_price_usd is not null and coalesce(new.sale_price_currency, 'USD') <> 'USD' then
      if v_corr then
        raise exception 'sale correction may not null sale_price while keeping sale_price_usd (vehicle %)', new.id
          using errcode = '23514';
      end if;
    end if;
    if not v_corr then
      new.sale_price := old.sale_price;
      new.sale_date := old.sale_date;
      new.sale_status := old.sale_status;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists vehicles_guard_sale_fields_bu on public.vehicles;
create trigger vehicles_guard_sale_fields_bu
  before update of sale_price, sale_date, sale_status on public.vehicles
  for each row when (old.sale_price is not null and new.sale_price is null)
  execute function public.vehicles_guard_sale_fields();
