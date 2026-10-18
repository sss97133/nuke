-- Sale price history: clock the sale point at the sale, not at the row write.
-- log_vehicle_price_history() wrote every price_type with as_of = coalesce(updated_at, now()), so a sale point
-- landed by an import or a correction carried the import day (lane S butterfly 2026-10-06: 24 of 2,175 sale
-- points on the sale day, 196 on the write day). One line changes, in the sale branch only:
--   as_of = coalesce(sale_date at 00:00 UTC, updated_at, now())
-- The other four branches (msrp, purchase, current, asking) are observations at write time and stay as they are.
-- New rows only; existing vehicle_price_history rows are untouched (no row replay). The trigger, its UPDATE OF
-- list and permissions are unchanged. Body taken from prod (pg_get_functiondef, fingerprint guarded below).
-- Contract: supabase/sql/test_vehicle_price_history_sale_clock.sql (PostgreSQL 17, CI job metric-fold-health-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
DO $guard$
DECLARE m text := md5(pg_get_functiondef('public.log_vehicle_price_history()'::regprocedure));
BEGIN
  -- prod body as read 2026-10-06; refuse to replace a body that drifted since
  IF m <> '62f60351bf7f300db9ffc5ba4c70b084' THEN -- gitleaks:allow (function-definition fingerprint, not a secret)
    RAISE EXCEPTION 'log_vehicle_price_history drifted from the reviewed body (md5 %); review before replacement', m;
  END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.log_vehicle_price_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  effective_actor uuid := coalesce(auth.uid(), new.user_id, new.owner_id, new.uploaded_by);
  prev_value numeric;
  is_out boolean;
  reason text;
  ratio_threshold numeric := 20; -- 20x jump/drop = likely bad injection
begin
  -- MSRP
  if new.msrp is distinct from old.msrp and new.msrp is not null then
    prev_value := null; is_out := false; reason := null;
    select vph.value into prev_value
      from public.vehicle_price_history vph
      where vph.vehicle_id = new.id and vph.price_type = 'msrp'
      order by vph.as_of desc
      limit 1;
    if prev_value is not null and prev_value > 0 then
      if (new.msrp::numeric > prev_value * ratio_threshold) or (new.msrp::numeric < prev_value / ratio_threshold) then
        is_out := true;
        reason := 'ratio_vs_previous';
      end if;
    end if;
    insert into public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by, is_outlier, outlier_reason)
    values (new.id, 'msrp', new.msrp, 'db_trigger', coalesce(new.updated_at, now()), effective_actor, is_out, reason);
  end if;

  -- Purchase
  if new.purchase_price is distinct from old.purchase_price and new.purchase_price is not null then
    prev_value := null; is_out := false; reason := null;
    select vph.value into prev_value
      from public.vehicle_price_history vph
      where vph.vehicle_id = new.id and vph.price_type = 'purchase'
      order by vph.as_of desc
      limit 1;
    if prev_value is not null and prev_value > 0 then
      if (new.purchase_price::numeric > prev_value * ratio_threshold) or (new.purchase_price::numeric < prev_value / ratio_threshold) then
        is_out := true;
        reason := 'ratio_vs_previous';
      end if;
    end if;
    insert into public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by, is_outlier, outlier_reason)
    values (new.id, 'purchase', new.purchase_price, 'db_trigger', coalesce(new.updated_at, now()), effective_actor, is_out, reason);
  end if;

  -- Current (internal signal)
  if new.current_value is distinct from old.current_value and new.current_value is not null then
    prev_value := null; is_out := false; reason := null;
    select vph.value into prev_value
      from public.vehicle_price_history vph
      where vph.vehicle_id = new.id and vph.price_type = 'current'
      order by vph.as_of desc
      limit 1;
    if prev_value is not null and prev_value > 0 then
      if (new.current_value::numeric > prev_value * ratio_threshold) or (new.current_value::numeric < prev_value / ratio_threshold) then
        is_out := true;
        reason := 'ratio_vs_previous';
      end if;
    end if;
    insert into public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by, is_outlier, outlier_reason)
    values (new.id, 'current', new.current_value, 'db_trigger', coalesce(new.updated_at, now()), effective_actor, is_out, reason);
  end if;

  -- Asking
  if new.asking_price is distinct from old.asking_price and new.asking_price is not null then
    prev_value := null; is_out := false; reason := null;
    select vph.value into prev_value
      from public.vehicle_price_history vph
      where vph.vehicle_id = new.id and vph.price_type = 'asking'
      order by vph.as_of desc
      limit 1;
    if prev_value is not null and prev_value > 0 then
      if (new.asking_price::numeric > prev_value * ratio_threshold) or (new.asking_price::numeric < prev_value / ratio_threshold) then
        is_out := true;
        reason := 'ratio_vs_previous';
      end if;
    end if;
    insert into public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by, is_outlier, outlier_reason)
    values (new.id, 'asking', new.asking_price, 'db_trigger', coalesce(new.updated_at, now()), effective_actor, is_out, reason);
  end if;

  -- Sale
  if new.sale_price is distinct from old.sale_price and new.sale_price is not null then
    prev_value := null; is_out := false; reason := null;
    select vph.value into prev_value
      from public.vehicle_price_history vph
      where vph.vehicle_id = new.id and vph.price_type = 'sale'
      order by vph.as_of desc
      limit 1;
    if prev_value is not null and prev_value > 0 then
      if (new.sale_price::numeric > prev_value * ratio_threshold) or (new.sale_price::numeric < prev_value / ratio_threshold) then
        is_out := true;
        reason := 'ratio_vs_previous';
      end if;
    end if;
    insert into public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by, is_outlier, outlier_reason)
    values (new.id, 'sale', new.sale_price, 'db_trigger', coalesce(new.sale_date::timestamp at time zone 'UTC', new.updated_at, now()), effective_actor, is_out, reason);
  end if;

  return new;
end;
$function$;
DO $check$
BEGIN
  IF position('coalesce(new.sale_date::timestamp at time zone ''UTC'', new.updated_at, now())' IN
       pg_get_functiondef('public.log_vehicle_price_history()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'sale clock line missing after replacement';
  END IF;
END $check$;
COMMIT;
