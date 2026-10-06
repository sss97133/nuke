-- Isolated PostgreSQL 17 regression: synthetic rows only, never production intake.
-- The frozen live 2026-10-06 body of log_vehicle_price_history() reproduces the installed function and its
-- fingerprint; the migration file itself is then applied and the sale clock is checked.
-- Execute in an empty dm_price_history_sale_clock_ci database with no auth schema.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() <> 'dm_price_history_sale_clock_ci'
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Refusing fixtures outside isolated DB'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';
SET TIME ZONE 'UTC';
-- auth.uid() is read by the function; outside Supabase it has no session, so the stub returns NULL.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid,
 msrp numeric, purchase_price numeric, current_value numeric, asking_price numeric, sale_price integer,
 sale_date date, updated_at timestamptz);
CREATE TABLE public.vehicle_price_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
 price_type text, value numeric, source text, as_of timestamptz, logged_by uuid, is_outlier boolean,
 outlier_reason text, created_at timestamptz DEFAULT now());
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

-- Frozen live body (pg_get_functiondef on prod, 2026-10-06)
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
    values (new.id, 'sale', new.sale_price, 'db_trigger', coalesce(new.updated_at, now()), effective_actor, is_out, reason);
  end if;

  return new;
end;
$function$;
CREATE TRIGGER trg_log_vehicle_price_history AFTER UPDATE OF msrp, purchase_price, current_value, asking_price, sale_price
 ON public.vehicles FOR EACH ROW EXECUTE FUNCTION log_vehicle_price_history();

SELECT pg_temp.ok('frozen body reproduces the prod fingerprint',
 md5(pg_get_functiondef('public.log_vehicle_price_history()'::regprocedure)) = '62f60351bf7f300db9ffc5ba4c70b084'); -- gitleaks:allow (function-definition fingerprint, not a secret)
CREATE TEMP TABLE before_def AS SELECT pg_get_functiondef('public.log_vehicle_price_history()'::regprocedure) d,
 (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='trg_log_vehicle_price_history') trg;

-- The defect on the frozen body: a sale point lands at the write time although the sale date is known.
INSERT INTO public.vehicles(id, sale_date, updated_at) VALUES
 ('00000000-0000-4000-8000-000000000001', '2024-01-25', '2026-10-06 06:00+00');
UPDATE public.vehicles SET sale_price = 1000000 WHERE id = '00000000-0000-4000-8000-000000000001';
SELECT pg_temp.ok('frozen body clocks the sale point at the write time (the defect)',
 (SELECT as_of FROM public.vehicle_price_history WHERE vehicle_id='00000000-0000-4000-8000-000000000001' AND price_type='sale')
   = '2026-10-06 06:00+00'::timestamptz);

\ir ../migrations/20261006100000_price_history_sale_clock.sql

SELECT pg_temp.ok('exactly one line of the function body changed',
 (SELECT count(*) FROM (SELECT a.n, a.l AS old_l, b.l AS new_l
    FROM unnest(string_to_array((SELECT d FROM before_def), E'\n')) WITH ORDINALITY a(l, n)
    FULL JOIN unnest(string_to_array(pg_get_functiondef('public.log_vehicle_price_history()'::regprocedure), E'\n'))
      WITH ORDINALITY b(l, n) USING (n)) x WHERE old_l IS DISTINCT FROM new_l) = 1);
SELECT pg_temp.ok('trigger definition unchanged',
 (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='trg_log_vehicle_price_history') = (SELECT trg FROM before_def));

-- 1. sale_date known: the sale point is clocked at the sale day, 00:00 UTC
INSERT INTO public.vehicles(id, sale_date, updated_at) VALUES
 ('00000000-0000-4000-8000-000000000002', '2024-01-25', '2026-10-06 06:00+00'),
 ('00000000-0000-4000-8000-000000000003', NULL,         '2026-10-06 06:00+00'),
 ('00000000-0000-4000-8000-000000000004', NULL,         NULL),
 ('00000000-0000-4000-8000-000000000005', '2025-08-15', '2026-10-06 06:00+00');
UPDATE public.vehicles SET sale_price = 2000000 WHERE id = '00000000-0000-4000-8000-000000000002';
SELECT pg_temp.ok('sale point clocked at the sale date',
 (SELECT as_of FROM public.vehicle_price_history WHERE vehicle_id='00000000-0000-4000-8000-000000000002' AND price_type='sale')
   = '2024-01-25 00:00+00'::timestamptz);
-- 2. no sale_date: falls back to updated_at, as before
UPDATE public.vehicles SET sale_price = 30000 WHERE id = '00000000-0000-4000-8000-000000000003';
SELECT pg_temp.ok('no sale date: falls back to updated_at',
 (SELECT as_of FROM public.vehicle_price_history WHERE vehicle_id='00000000-0000-4000-8000-000000000003' AND price_type='sale')
   = '2026-10-06 06:00+00'::timestamptz);
-- 3. neither: falls back to now() (one transaction, so now() is the same instant in the check)
BEGIN;
UPDATE public.vehicles SET sale_price = 40000 WHERE id = '00000000-0000-4000-8000-000000000004';
SELECT pg_temp.ok('no sale date and no updated_at: falls back to now()',
 (SELECT as_of FROM public.vehicle_price_history WHERE vehicle_id='00000000-0000-4000-8000-000000000004' AND price_type='sale')
   = now());
COMMIT;
-- 4. the other branches keep the write clock even when a sale date is present
UPDATE public.vehicles SET asking_price = 55000, msrp = 9000 WHERE id = '00000000-0000-4000-8000-000000000005';
SELECT pg_temp.ok('asking and msrp points keep the write clock',
 (SELECT bool_and(as_of = '2026-10-06 06:00+00'::timestamptz) AND count(*) = 2
    FROM public.vehicle_price_history WHERE vehicle_id='00000000-0000-4000-8000-000000000005' AND price_type IN ('asking','msrp')));
-- 5. the clock does not depend on the session time zone
SET TIME ZONE 'America/Los_Angeles';
UPDATE public.vehicles SET sale_price = 2100000 WHERE id = '00000000-0000-4000-8000-000000000005';
SET TIME ZONE 'UTC';
SELECT pg_temp.ok('sale clock is 00:00 UTC whatever the session time zone',
 (SELECT as_of FROM public.vehicle_price_history WHERE vehicle_id='00000000-0000-4000-8000-000000000005' AND price_type='sale')
   = '2025-08-15 00:00+00'::timestamptz);
-- 6. a sale_date change alone writes no price point (the trigger watches prices, not dates)
UPDATE public.vehicles SET sale_date = '2024-01-26', sale_price = sale_price WHERE id = '00000000-0000-4000-8000-000000000002';
SELECT pg_temp.ok('date-only change writes no price point',
 (SELECT count(*) FROM public.vehicle_price_history WHERE vehicle_id='00000000-0000-4000-8000-000000000002') = 1);
-- 7. the migration refuses a drifted body: re-running its guard now fails
DO $$ BEGIN
  BEGIN
    IF md5(pg_get_functiondef('public.log_vehicle_price_history()'::regprocedure)) <> '62f60351bf7f300db9ffc5ba4c70b084' THEN -- gitleaks:allow
      RAISE EXCEPTION 'drift';
    END IF;
    RAISE EXCEPTION 'Contract failed: guard would accept the replaced body';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'drift' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS migration guard refuses a second application';
END $$;
