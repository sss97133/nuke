-- Trigger to append vehicle_price_history on vehicles updates
-- Adds rows when price fields change to a numeric value

create or replace function public.log_vehicle_price_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- MSRP
  if (new.msrp is distinct from old.msrp) and new.msrp is not null then
    insert into public.vehicle_price_history(vehicle_id, price_type, value, source, as_of)
    values (new.id, 'msrp', new.msrp, 'db_trigger', now());
  end if;

  -- Purchase
  if (new.purchase_price is distinct from old.purchase_price) and new.purchase_price is not null then
    insert into public.vehicle_price_history(vehicle_id, price_type, value, source, as_of)
    values (new.id, 'purchase', new.purchase_price, 'db_trigger', now());
  end if;

  -- Current
  if (new.current_value is distinct from old.current_value) and new.current_value is not null then
    insert into public.vehicle_price_history(vehicle_id, price_type, value, source, as_of)
    values (new.id, 'current', new.current_value, 'db_trigger', now());
  end if;

  -- Asking
  if (new.asking_price is distinct from old.asking_price) and new.asking_price is not null then
    insert into public.vehicle_price_history(vehicle_id, price_type, value, source, as_of)
    values (new.id, 'asking', new.asking_price, 'db_trigger', now());
  end if;

  -- Sale
  if (new.sale_price is distinct from old.sale_price) and new.sale_price is not null then
    insert into public.vehicle_price_history(vehicle_id, price_type, value, source, as_of)
    values (new.id, 'sale', new.sale_price, 'db_trigger', now());
  end if;

  return new;
end;
$$;

-- Create trigger on vehicles table
DROP TRIGGER IF EXISTS trg_log_vehicle_price_history ON public.vehicles;
create trigger trg_log_vehicle_price_history
after update of msrp, purchase_price, current_value, asking_price, sale_price on public.vehicles
for each row
execute function public.log_vehicle_price_history();
