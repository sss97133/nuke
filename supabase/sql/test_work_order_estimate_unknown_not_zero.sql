-- Disposable PG17 only. Proves 20261019170000_work_order_estimate_unknown_not_zero.sql: with no priced basis the
-- estimate and actual stay NULL (unknown) instead of 0; stated components still compute; a stated total is kept;
-- historical zeros are not rewritten. Starts from the live trigger body and shows the invented zero first.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.work_orders') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
CREATE TABLE public.work_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text,
  estimated_labor_cost numeric, estimated_parts_cost numeric, estimated_total numeric,
  actual_labor_cost numeric, actual_parts_cost numeric, actual_total numeric, updated_at timestamptz);
CREATE FUNCTION public.calculate_work_order_estimate() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  NEW.estimated_total := COALESCE(NEW.estimated_labor_cost, 0) + COALESCE(NEW.estimated_parts_cost, 0);
  NEW.actual_total := COALESCE(NEW.actual_labor_cost, 0) + COALESCE(NEW.actual_parts_cost, 0);
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_calculate_work_order_estimate BEFORE INSERT OR UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.calculate_work_order_estimate();
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;

INSERT INTO work_orders(id, title) VALUES ('10000000-0000-0000-0000-000000000001', 'historical, no basis');
SELECT t_assert((SELECT estimated_total = 0 AND actual_total = 0 FROM work_orders WHERE title = 'historical, no basis'), 'before: an unpriced insert asserts a $0 estimate and actual');

\ir ../migrations/20261019170000_work_order_estimate_unknown_not_zero.sql

INSERT INTO work_orders(title) VALUES ('unpriced');
SELECT t_assert((SELECT estimated_total IS NULL AND actual_total IS NULL AND updated_at IS NOT NULL FROM work_orders WHERE title = 'unpriced'),
  'unpriced insert: estimate and actual unknown (NULL), clock still set');
INSERT INTO work_orders(title, estimated_labor_cost, estimated_parts_cost, actual_parts_cost) VALUES ('priced', 300, 120.5, 80);
SELECT t_assert((SELECT estimated_total = 420.5 AND actual_total = 80 FROM work_orders WHERE title = 'priced'), 'stated components still compute');
INSERT INTO work_orders(title, estimated_labor_cost) VALUES ('labor only', 0);
SELECT t_assert((SELECT estimated_total = 0 FROM work_orders WHERE title = 'labor only'), 'a stated zero component is a real zero');
INSERT INTO work_orders(title, estimated_total) VALUES ('stated total', 999);
SELECT t_assert((SELECT estimated_total = 999 AND actual_total IS NULL FROM work_orders WHERE title = 'stated total'), 'a directly stated total is kept, not overwritten');
UPDATE work_orders SET title = 'historical, touched' WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT t_assert((SELECT estimated_total = 0 AND actual_total = 0 FROM work_orders WHERE id = '10000000-0000-0000-0000-000000000001'),
  'historical zero is not rewritten by an unrelated update');
UPDATE work_orders SET estimated_parts_cost = 50 WHERE title = 'unpriced';
SELECT t_assert((SELECT estimated_total = 50 FROM work_orders WHERE title = 'unpriced'), 'a later stated component computes the total');
SELECT t_assert((SELECT trg.tgenabled = 'O' FROM pg_trigger trg WHERE trg.tgname = 'trg_calculate_work_order_estimate'), 'trigger still enabled');
