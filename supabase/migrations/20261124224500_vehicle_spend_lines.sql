-- vehicle_spend_lines: documented spend is a fold into rows, one writer, each row keyed to the paper (and the paper's
-- line) it came from. get_vehicle_total_invested_unmasked reads the rows instead of summing receipts at read time.
--
-- WHY. Measured 2026-11-25 (scripts/data/q.sh; live linked = a non-retired 'linked' receipt_vehicle_links row, not
-- superseded, no duplicate_of): 201 live linked receipts on 26 cars; 159 counted (amount_check verified/plausible,
-- total > 0, not an excluded or quoted kind). The reader summed receipts.total at read time with no row per dollar,
-- so no witness could be cited for any part of the number, and it kept only totals > 0: the 4 negative-total papers
-- (refunds, returns) on 3 cars never netted. The fallback branch (receipts by vehicle_id/scope with no live link)
-- holds 0 counted papers; 0 receipts are live linked to more than one car.
-- Successor of the money part of #3694 (closed unlanded): no amounts in code or docs, no MCP read, no change to
-- field_evidence or vehicle_field_provenance, and #3694's uncited work_record money is left out (a statement is not
-- paper).
--
-- WHAT.
--   vehicle_spend_bases (rule rows): why a row counts. receipt_line = one priced line of a paper whose lines reconcile
--     to its total (amount_check verified with basis items_plus_tax); receipt_remainder = what such a paper's lines
--     do not carry (tax, shipping, fees); receipt_total = the whole total of a counted paper whose lines do not
--     reconcile or that has none.
--   vehicle_spend_lines (grain: one counted dollar source on one car): vehicle_id, receipt_id, receipt_item_id (set
--     only for receipt_line), basis, amount (signed: a credit is negative), run_id, folded_at. Per counted paper it
--     holds exactly {receipt_total} or {receipt_line rows + at most one receipt_remainder}, so its rows sum to the
--     paper's total.
--   vehicle_spend_lines_due (view): the rows the fold should hold now, from the same candidate set and filters the
--     reader used (links, then the vehicle_id/scope fallback), negatives included.
--   vehicle_spend_fold(p_run): the only writer. Per car, when the due rows differ from the held rows (md5 of the row
--     set) the car's rows are replaced, so a retired link, a duplicate, a supersede, a kind or amount-check change or
--     a new line all refold with no trigger on receipts. Cron vehicle-spend-fold every 10 minutes. Gauge: folded_at
--     (rows per 24 h, newest) and cron.job_run_details.
--   get_vehicle_total_invested_unmasked: breakdown.receipts = sum of the car's rows (net), breakdown.receipts_credits
--     = sum of its negative rows; components_count.receipts = papers, receipts_itemised = papers priced by line.
--     parts, labor and timeline costs are unchanged; total_invested is still the largest of the three.
--   The masked wrapper get_vehicle_total_invested (20261124211500) is unchanged: untied callers get presence and
--   counts, never an amount. The table and view are service_role only (RLS on, no anon/authenticated grant).
--
-- Expected on apply (2026-11-25): breakdown.receipts unchanged on 23 of 26 cars, lower on the 3 cars that carry a
-- negative-total paper. The backfill below asserts both, per car and per paper, and prints counts only.
-- Contract: supabase/sql/test_vehicle_spend_lines.sql (PG17).
-- Revert: supabase/sql/revert_20261124224500_vehicle_spend_lines.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.vehicle_spend_bases (
  basis text PRIMARY KEY,
  per text NOT NULL CHECK (per IN ('receipt_item', 'receipt')),
  description text NOT NULL
);
INSERT INTO public.vehicle_spend_bases (basis, per, description) VALUES
  ('receipt_line', 'receipt_item', 'one priced line of a paper whose lines reconcile to its total (amount_check verified, basis items_plus_tax)'),
  ('receipt_remainder', 'receipt', 'the part of a reconciled paper''s total its lines do not carry: tax, shipping, fees'),
  ('receipt_total', 'receipt', 'the whole total of a counted paper whose lines do not reconcile or that has none')
ON CONFLICT (basis) DO UPDATE SET per = EXCLUDED.per, description = EXCLUDED.description;
ALTER TABLE public.vehicle_spend_bases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_spend_bases_read ON public.vehicle_spend_bases;
CREATE POLICY vehicle_spend_bases_read ON public.vehicle_spend_bases FOR SELECT USING (true);
REVOKE ALL ON public.vehicle_spend_bases FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_spend_bases TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.vehicle_spend_lines (
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  receipt_item_id uuid REFERENCES public.receipt_items(id) ON DELETE CASCADE,
  basis text NOT NULL REFERENCES public.vehicle_spend_bases(basis),
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  run_id text NOT NULL,
  folded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_spend_lines_key UNIQUE NULLS NOT DISTINCT (vehicle_id, receipt_id, receipt_item_id),
  CONSTRAINT vehicle_spend_lines_item_iff_line CHECK ((receipt_item_id IS NOT NULL) = (basis = 'receipt_line'))
);
CREATE INDEX IF NOT EXISTS vehicle_spend_lines_receipt_idx ON public.vehicle_spend_lines (receipt_id);
CREATE INDEX IF NOT EXISTS vehicle_spend_lines_item_idx ON public.vehicle_spend_lines (receipt_item_id) WHERE receipt_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vehicle_spend_lines_folded_idx ON public.vehicle_spend_lines (folded_at);
ALTER TABLE public.vehicle_spend_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_spend_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_spend_lines TO service_role;
COMMENT ON TABLE public.vehicle_spend_lines IS
  'vehicle_spend_lines_v1: documented spend per car, one row per counted dollar source (a reconciled line, its remainder, or a paper total). Written only by vehicle_spend_fold. Holds amounts: service_role only; readers mask (get_vehicle_total_invested).';

CREATE OR REPLACE VIEW public.vehicle_spend_lines_due WITH (security_invoker = true) AS
WITH cand AS (
  SELECT l.vehicle_id, l.receipt_id
    FROM public.receipt_vehicle_links l
   WHERE l.status = 'linked' AND l.retired_at IS NULL
  UNION
  SELECT v.id, r.id
    FROM public.receipts r
   CROSS JOIN LATERAL unnest(ARRAY[r.vehicle_id,
           CASE WHEN r.scope_type = 'vehicle' AND r.scope_id ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
                THEN r.scope_id::uuid END]) AS x(vehicle_id)
    JOIN public.vehicles v ON v.id = x.vehicle_id
   WHERE NOT EXISTS (SELECT 1 FROM public.receipt_vehicle_links l WHERE l.receipt_id = r.id AND l.retired_at IS NULL)
),
counted AS (
  SELECT c.vehicle_id, r.id AS receipt_id, round(coalesce(r.total_amount, r.total), 2) AS amt,
         (r.amount_check = 'verified' AND r.amount_check_reasons ->> 'basis' = 'items_plus_tax') AS reconciled
    FROM cand c
    JOIN public.receipts r ON r.id = c.receipt_id
   WHERE r.duplicate_of IS NULL
     AND coalesce(r.is_superseded, false) = false
     AND r.amount_check IN ('verified', 'plausible')
     AND NOT public.receipt_doc_kind_excluded(r.document_kind)
     AND NOT public.receipt_doc_kind_quoted(r.document_kind)
     AND round(coalesce(r.total_amount, r.total), 2) <> 0
),
lines AS (
  SELECT c.vehicle_id, c.receipt_id, i.id AS receipt_item_id, round(i.total_price, 2) AS amount
    FROM counted c
    JOIN public.receipt_items i ON i.receipt_id = c.receipt_id
   WHERE c.reconciled AND round(i.total_price, 2) <> 0
),
lined AS (SELECT vehicle_id, receipt_id, sum(amount) AS s FROM lines GROUP BY 1, 2)
SELECT vehicle_id, receipt_id, receipt_item_id, 'receipt_line'::text AS basis, amount FROM lines
UNION ALL
SELECT c.vehicle_id, c.receipt_id, NULL::uuid, 'receipt_remainder', c.amt - l.s
  FROM counted c JOIN lined l ON l.vehicle_id = c.vehicle_id AND l.receipt_id = c.receipt_id
 WHERE c.amt - l.s <> 0
UNION ALL
SELECT c.vehicle_id, c.receipt_id, NULL::uuid, 'receipt_total', c.amt
  FROM counted c
 WHERE NOT EXISTS (SELECT 1 FROM lined l WHERE l.vehicle_id = c.vehicle_id AND l.receipt_id = c.receipt_id);
REVOKE ALL ON public.vehicle_spend_lines_due FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_spend_lines_due TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_spend_fold(p_run text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fold$
DECLARE
  v_run text := coalesce(p_run, 'vehicle-spend-fold:' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'));
  v_ids uuid[];
  v_checked int;
  v_removed int := 0;
  v_written int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('vehicle_spend_fold')) THEN
    RETURN jsonb_build_object('run', v_run, 'skipped', 'another fold holds the lock');
  END IF;
  WITH d AS (
    SELECT vehicle_id, md5(string_agg(receipt_id::text || '|' || coalesce(receipt_item_id::text, '') || '|' || basis || '|' || amount::text,
                                      ',' ORDER BY receipt_id, receipt_item_id NULLS FIRST, basis)) AS h
      FROM public.vehicle_spend_lines_due GROUP BY vehicle_id),
  c AS (
    SELECT vehicle_id, md5(string_agg(receipt_id::text || '|' || coalesce(receipt_item_id::text, '') || '|' || basis || '|' || amount::text,
                                      ',' ORDER BY receipt_id, receipt_item_id NULLS FIRST, basis)) AS h
      FROM public.vehicle_spend_lines GROUP BY vehicle_id)
  SELECT count(*)::int, array_agg(vehicle_id) FILTER (WHERE dh IS DISTINCT FROM ch)
    INTO v_checked, v_ids
    FROM (SELECT coalesce(d.vehicle_id, c.vehicle_id) AS vehicle_id, d.h AS dh, c.h AS ch
            FROM d FULL JOIN c ON c.vehicle_id = d.vehicle_id) x;
  IF v_ids IS NOT NULL THEN
    DELETE FROM public.vehicle_spend_lines WHERE vehicle_id = ANY (v_ids);
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    INSERT INTO public.vehicle_spend_lines (vehicle_id, receipt_id, receipt_item_id, basis, amount, run_id)
    SELECT vehicle_id, receipt_id, receipt_item_id, basis, amount, v_run
      FROM public.vehicle_spend_lines_due WHERE vehicle_id = ANY (v_ids);
    GET DIAGNOSTICS v_written = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('run', v_run, 'cars_checked', v_checked, 'cars_refolded', coalesce(cardinality(v_ids), 0),
                            'rows_removed', v_removed, 'rows_written', v_written);
END
$fold$;
REVOKE ALL ON FUNCTION public.vehicle_spend_fold(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_spend_fold(text) TO service_role;
COMMENT ON FUNCTION public.vehicle_spend_fold(text) IS
  'vehicle_spend_lines_v1: the only writer of vehicle_spend_lines. Replaces a car''s rows when vehicle_spend_lines_due differs from them. Cron vehicle-spend-fold.';

-- First run, checked against the reader it replaces (skipped when this migration already ran: the reader reads rows).
DO $$
DECLARE
  v_first boolean := position('vehicle_spend_lines' IN pg_get_functiondef('public.get_vehicle_total_invested_unmasked(uuid)'::regprocedure)) = 0;
BEGIN
  DROP TABLE IF EXISTS pg_temp._spend_before;
  CREATE TEMP TABLE _spend_before (vehicle_id uuid PRIMARY KEY, receipts numeric, first boolean);
  INSERT INTO _spend_before
  SELECT v.vehicle_id, (public.get_vehicle_total_invested_unmasked(v.vehicle_id) #>> '{breakdown,receipts}')::numeric, v_first
    FROM (SELECT vehicle_id FROM public.vehicle_spend_lines_due UNION SELECT vehicle_id FROM public.vehicle_spend_lines) v;
  RAISE NOTICE 'vehicle_spend_fold first run: %', public.vehicle_spend_fold('vehicle-spend-fold:migration-20261124224500');
END $$;

CREATE OR REPLACE FUNCTION public.get_vehicle_total_invested_unmasked(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with
    vehicle_te as (select id from timeline_events where vehicle_id = p_vehicle_id),
    parts as (
      select coalesce(sum(wop.total_price), 0) as total, count(*) as cnt
      from work_order_parts wop where wop.timeline_event_id in (select id from vehicle_te)
    ),
    labor as (
      select coalesce(sum(wol.total_cost), 0) as total, count(*) as cnt
      from work_order_labor wol where wol.timeline_event_id in (select id from vehicle_te)
    ),
    te_costs as (
      select coalesce(sum(cost_amount), 0) as total from timeline_events
      where vehicle_id = p_vehicle_id and cost_amount is not null and cost_amount > 0
    ),
    -- vehicle_spend_lines_v1: the fold's rows (vehicle_spend_fold), net of credits.
    rcpts as (
      select coalesce(sum(s.amount), 0) as total,
             coalesce(sum(s.amount) filter (where s.amount < 0), 0) as credits,
             count(distinct s.receipt_id) as cnt,
             count(distinct s.receipt_id) filter (where s.basis = 'receipt_line') as itemised
      from vehicle_spend_lines s where s.vehicle_id = p_vehicle_id
    )
  select jsonb_build_object(
    'total_invested', greatest(parts.total + labor.total, te_costs.total, rcpts.total),
    'breakdown', jsonb_build_object(
      'parts', parts.total, 'labor', labor.total, 'materials', 0, 'overhead', 0, 'tools', 0,
      'financial_records_total', 0, 'timeline_costs', te_costs.total, 'receipts', rcpts.total,
      'receipts_credits', rcpts.credits),
    'components_count', jsonb_build_object(
      'parts_items', parts.cnt, 'labor_tasks', labor.cnt, 'materials_items', 0,
      'events_with_work', 0, 'receipts', rcpts.cnt, 'receipts_itemised', rcpts.itemised))
  from parts, labor, te_costs, rcpts;
$function$;
REVOKE ALL ON FUNCTION public.get_vehicle_total_invested_unmasked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vehicle_total_invested_unmasked(uuid) TO service_role;

DO $$
DECLARE v_bad int; v_cars int; v_changed int; v_rows int; v_papers int;
BEGIN
  -- Every counted paper's rows sum to its total.
  SELECT count(*) INTO v_bad
    FROM (SELECT s.receipt_id, sum(s.amount) AS s, max(round(coalesce(r.total_amount, r.total), 2)) AS amt
            FROM public.vehicle_spend_lines s JOIN public.receipts r ON r.id = s.receipt_id
           GROUP BY s.vehicle_id, s.receipt_id) x
   WHERE x.s <> x.amt;
  IF v_bad > 0 THEN RAISE EXCEPTION 'vehicle_spend_lines: % papers whose rows do not sum to their total', v_bad; END IF;
  -- Against the old reader: the same receipts figure, plus the negative-total papers it dropped. First run only.
  IF (SELECT bool_and(first) FROM _spend_before) THEN
    SELECT count(*), count(*) FILTER (WHERE b.receipts <> n.receipts),
           count(*) FILTER (WHERE abs(n.receipts - (b.receipts + coalesce(neg.s, 0))) > 0.01 * greatest(1, coalesce(n.cnt, 0)))
      INTO v_cars, v_changed, v_bad
      FROM _spend_before b
      CROSS JOIN LATERAL (SELECT (public.get_vehicle_total_invested_unmasked(b.vehicle_id) #>> '{breakdown,receipts}')::numeric AS receipts,
                                 (public.get_vehicle_total_invested_unmasked(b.vehicle_id) #>> '{components_count,receipts}')::int AS cnt) n
      LEFT JOIN LATERAL (SELECT sum(p.s) AS s
                           FROM (SELECT receipt_id, sum(amount) AS s FROM public.vehicle_spend_lines
                                  WHERE vehicle_id = b.vehicle_id GROUP BY receipt_id) p
                          WHERE p.s < 0) neg ON true;
    IF v_bad > 0 THEN RAISE EXCEPTION 'vehicle_spend_lines: % of % cars differ from the old receipts figure by more than their credits', v_bad, v_cars; END IF;
    SELECT count(*), count(DISTINCT receipt_id) INTO v_rows, v_papers FROM public.vehicle_spend_lines;
    RAISE NOTICE 'vehicle_spend_lines: % rows, % papers, % cars; breakdown.receipts changed on % cars (credits netted)', v_rows, v_papers, v_cars, v_changed;
  END IF;
  DROP TABLE pg_temp._spend_before;
END $$;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vehicle-spend-fold';
    PERFORM cron.schedule('vehicle-spend-fold', '4-59/10 * * * *',
      $c$SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.vehicle_spend_fold(NULL)$c$);
  END IF;
END $$;

COMMIT;
