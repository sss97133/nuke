-- receipt_relations: one paper's edge to another paper of the same purchase, or to the purchase it returns, kept as keyed
-- rows from rule rows. The spend fold stops counting a purchase twice.
--
-- WHY. A purchase often leaves several papers: an order confirmation, an invoice and a payment receipt. Each landed as
-- its own receipt and each was counted. Measured 2026-11-25 on live counted receipts (not duplicate, not superseded,
-- amount_check verified/plausible, one owner):
--   1 pair with the same vendor key and the same total within 3 days whose item text overlaps (on the Blazer);
--   1 pair with the same vendor, printed invoice number and paper date whose lines add up, together, to the total
--     printed on one of them to the cent (also on the Blazer): two pages of one invoice, the second page's own total
--     counted on top of the grand total;
--   0 refunds matched to a purchase by exact amount; returns are matched by vendor, a 90-day window and item text.
-- Only same-bytes and same-file duplicates (20261124204000, 20261124206000) were caught before this.
--
-- WHAT.
--   receipt_relation_rules (rule rows): relation (same_purchase | returns | shares_invoice_number), establishes (whether
--     the edge acts on a reader), params (the window in days). Two rules establish same_purchase: same total + shared
--     item word (same_vendor_total_items), and pages of one invoice (same_vendor_invoice_pages).
--   receipt_relations (grain: one edge between two receipts by one rule): receipt_id, related_receipt_id (both FK
--     receipts), rule_key FK, basis_ref (day_gap, shared_words: counts only), run_id, created_at, retired_at. At most one
--     live edge per (receipt_id, related_receipt_id, rule_key).
--     same_purchase: receipt_id = the copy, related = the paper kept (same total: amount_check verified first, then more
--       lines, then the earlier created_at, then id; invoice pages: the page carrying the grand total is kept). returns: receipt_id = the return paper, related = its one best purchase (most shared
--       item words, then the nearest date); no edge when two candidates tie.
--   receipt_relations_fold(p_run): the only writer. It computes the due edges from the rule rows, retires live edges that
--     are no longer due and inserts new ones. Cron receipt-relations-fold at :27 hourly, after the itemise fold (:17)
--     has written the lines it reads. Gauge: created_at / retired_at per 24 h, plus cron.job_run_details.
--   vehicle_spend_lines_due: a receipt that is the copy in a live, established same_purchase edge is not counted on a
--     car where the kept paper itself counts (so a purchase never counts zero times), and vehicle_spend_fold refolds
--     that car on its next run. A return paper already nets by sign; its edge is what ta-labor
--     reads as "cancelled by return".
-- Expected on apply (measured read-only 2026-11-25): 2 same_purchase edges (one per rule, both on the Blazer),
-- 1 shares_invoice_number edge, 2 returns edges (a core return to its core charge, a spark plug and mount return to its
-- order). After the next spend fold: vehicle_spend_lines 340 -> 338, breakdown.receipts lower on exactly 1 car.
-- Contract: supabase/sql/test_receipt_relations.sql (PG17). Revert: supabase/sql/revert_20261125013000_receipt_relations.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.receipt_relation_rules (
  rule_key text PRIMARY KEY,
  relation text NOT NULL CHECK (relation IN ('same_purchase', 'returns', 'shares_invoice_number')),
  establishes boolean NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL
);
INSERT INTO public.receipt_relation_rules (rule_key, relation, establishes, params, description) VALUES
  ('same_vendor_total_items', 'same_purchase', true, '{"days": 3}',
   'same owner and vendor key, the same total within the window, and at least one shared item word: one purchase on two papers'),
  ('same_vendor_invoice_pages', 'same_purchase', true, '{"days": 0}',
   'same owner, vendor key, printed invoice number and paper date, different totals, and the two papers'' lines add up to the total printed on one of them: pages of one invoice; the page with the grand total is kept'),
  ('same_vendor_invoice_number', 'shares_invoice_number', false, '{}',
   'same owner, vendor key and printed invoice number; on its own not proof of one purchase (items can differ), so it acts on no reader'),
  ('return_same_vendor_items', 'returns', true, '{"days": 90}',
   'a negative-total paper and the one earlier positive paper of the same owner and vendor within the window that shares the most item words')
ON CONFLICT (rule_key) DO UPDATE SET relation = EXCLUDED.relation, establishes = EXCLUDED.establishes, params = EXCLUDED.params,
  description = EXCLUDED.description;
ALTER TABLE public.receipt_relation_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receipt_relation_rules_read ON public.receipt_relation_rules;
CREATE POLICY receipt_relation_rules_read ON public.receipt_relation_rules FOR SELECT USING (true);
REVOKE ALL ON public.receipt_relation_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipt_relation_rules TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.receipt_relations (
  id bigserial PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  related_receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  rule_key text NOT NULL REFERENCES public.receipt_relation_rules(rule_key),
  basis_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CHECK (receipt_id <> related_receipt_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS receipt_relations_live_key ON public.receipt_relations (receipt_id, related_receipt_id, rule_key) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS receipt_relations_related_idx ON public.receipt_relations (related_receipt_id) WHERE retired_at IS NULL;
ALTER TABLE public.receipt_relations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_relations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipt_relations TO service_role;
GRANT USAGE ON SEQUENCE public.receipt_relations_id_seq TO service_role;
COMMENT ON TABLE public.receipt_relations IS
  'receipt_relations_v1: receipt -> receipt edges by rule row (receipt_relation_rules). Written only by receipt_relations_fold; retired, never deleted.';

CREATE OR REPLACE FUNCTION public.receipt_relations_due()
RETURNS TABLE (receipt_id uuid, related_receipt_id uuid, rule_key text, basis_ref jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $due$
  WITH live AS (
    SELECT r.id, r.user_id, public.supply_vendor_key(r.vendor_name) AS vk, round(coalesce(r.total_amount, r.total), 2) AS amt,
           coalesce(r.receipt_date, r.transaction_date, r.purchase_date)::date AS d, nullif(btrim(r.invoice_number), '') AS inv,
           (r.amount_check = 'verified') AS verified, r.created_at,
           (SELECT count(*) FROM public.receipt_items i WHERE i.receipt_id = r.id) AS n_lines,
           (SELECT round(sum(i.total_price), 2) FROM public.receipt_items i WHERE i.receipt_id = r.id) AS line_sum
      FROM public.receipts r
     WHERE r.duplicate_of IS NULL AND coalesce(r.is_superseded, false) = false
       AND r.amount_check IN ('verified', 'plausible')
       AND length(coalesce(public.supply_vendor_key(r.vendor_name), '')) >= 3
  ),
  words AS (
    SELECT DISTINCT i.receipt_id, w
      FROM public.receipt_items i
     CROSS JOIN LATERAL regexp_split_to_table(lower(coalesce(i.description, '')), '[^a-z]+') AS w
     WHERE length(w) >= 4 AND i.receipt_id IN (SELECT id FROM live)
  ),
  pairs AS (
    SELECT a.*, b.id AS b_id, b.amt AS b_amt, b.d AS b_d, b.inv AS b_inv, b.verified AS b_verified, b.n_lines AS b_n_lines,
           b.created_at AS b_created_at, b.line_sum AS b_line_sum,
           (SELECT count(*) FROM words x JOIN words y ON y.w = x.w WHERE x.receipt_id = a.id AND y.receipt_id = b.id) AS shared
      FROM live a JOIN live b ON b.user_id = a.user_id AND b.vk = a.vk AND b.id <> a.id
  ),
  rules AS (SELECT rule_key, relation, coalesce((params ->> 'days')::int, 0) AS days FROM public.receipt_relation_rules),
  invoice_pages AS (
    -- a = the continuation page: its total is not the invoice's; b's total = both papers' lines together
    SELECT p.id AS receipt_id, p.b_id AS related_receipt_id, ru.rule_key,
           jsonb_build_object('day_gap', abs(p.d - p.b_d), 'shared_words', p.shared, 'pages_add_up', true) AS basis_ref
      FROM pairs p JOIN rules ru ON ru.rule_key = 'same_vendor_invoice_pages'
     WHERE p.inv IS NOT NULL AND p.inv = p.b_inv AND p.d IS NOT NULL AND p.b_d IS NOT NULL AND abs(p.d - p.b_d) <= ru.days
       AND p.amt > 0 AND p.b_amt > 0 AND p.amt <> p.b_amt AND p.line_sum > 0 AND p.b_line_sum > 0
       AND p.line_sum + p.b_line_sum = p.b_amt
  ),
  same_purchase AS (
    -- a = the copy: the pair's lower-ranked paper
    SELECT p.id AS receipt_id, p.b_id AS related_receipt_id, ru.rule_key,
           jsonb_build_object('day_gap', abs(p.d - p.b_d), 'shared_words', p.shared) AS basis_ref
      FROM pairs p JOIN rules ru ON ru.rule_key = 'same_vendor_total_items'
     WHERE p.amt > 0 AND p.amt = p.b_amt AND p.d IS NOT NULL AND p.b_d IS NOT NULL AND abs(p.d - p.b_d) <= ru.days AND p.shared > 0
       AND (p.b_verified, p.b_n_lines, -extract(epoch FROM p.b_created_at), p.b_id::text)
         > (p.verified, p.n_lines, -extract(epoch FROM p.created_at), p.id::text)
  ),
  shares_invoice AS (
    SELECT p.id, p.b_id, ru.rule_key, jsonb_build_object('day_gap', abs(p.d - p.b_d), 'shared_words', p.shared)
      FROM pairs p JOIN rules ru ON ru.relation = 'shares_invoice_number'
     WHERE p.inv IS NOT NULL AND p.inv = p.b_inv AND p.id::text < p.b_id::text
  ),
  return_candidates AS (
    SELECT p.id, p.b_id, ru.rule_key, p.shared, p.d - p.b_d AS gap,
           rank() OVER (PARTITION BY p.id ORDER BY p.shared DESC, p.d - p.b_d) AS rk,
           count(*) OVER (PARTITION BY p.id, p.shared, p.d - p.b_d) AS ties
      FROM pairs p JOIN rules ru ON ru.relation = 'returns'
     WHERE p.amt < 0 AND p.b_amt > 0 AND p.d IS NOT NULL AND p.b_d IS NOT NULL AND p.d >= p.b_d AND p.d - p.b_d <= ru.days AND p.shared > 0
  )
  SELECT * FROM same_purchase
  UNION ALL SELECT * FROM invoice_pages
  UNION ALL SELECT * FROM shares_invoice
  UNION ALL SELECT id, b_id, rule_key, jsonb_build_object('day_gap', gap, 'shared_words', shared) FROM return_candidates WHERE rk = 1 AND ties = 1
$due$;
REVOKE ALL ON FUNCTION public.receipt_relations_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_relations_due() TO service_role;

CREATE OR REPLACE FUNCTION public.receipt_relations_fold(p_run text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fold$
DECLARE
  v_run text := coalesce(p_run, 'receipt-relations-fold:' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'));
  v_retired int; v_added int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('receipt_relations_fold')) THEN
    RETURN jsonb_build_object('run', v_run, 'skipped', 'another fold holds the lock');
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _receipt_relations_due (receipt_id uuid, related_receipt_id uuid, rule_key text, basis_ref jsonb) ON COMMIT DROP;
  TRUNCATE _receipt_relations_due;
  INSERT INTO _receipt_relations_due SELECT * FROM public.receipt_relations_due();
  UPDATE public.receipt_relations rr SET retired_at = now()
   WHERE rr.retired_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM _receipt_relations_due d
                      WHERE d.receipt_id = rr.receipt_id AND d.related_receipt_id = rr.related_receipt_id AND d.rule_key = rr.rule_key);
  GET DIAGNOSTICS v_retired = ROW_COUNT;
  INSERT INTO public.receipt_relations (receipt_id, related_receipt_id, rule_key, basis_ref, run_id)
  SELECT d.receipt_id, d.related_receipt_id, d.rule_key, d.basis_ref, v_run FROM _receipt_relations_due d
   WHERE NOT EXISTS (SELECT 1 FROM public.receipt_relations rr WHERE rr.retired_at IS NULL
                       AND rr.receipt_id = d.receipt_id AND rr.related_receipt_id = d.related_receipt_id AND rr.rule_key = d.rule_key);
  GET DIAGNOSTICS v_added = ROW_COUNT;
  RETURN jsonb_build_object('run', v_run, 'added', v_added, 'retired', v_retired,
    'live', (SELECT jsonb_object_agg(rule_key, n) FROM (SELECT rule_key, count(*) n FROM public.receipt_relations WHERE retired_at IS NULL GROUP BY 1) x));
END
$fold$;
REVOKE ALL ON FUNCTION public.receipt_relations_fold(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_relations_fold(text) TO service_role;

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
eligible AS (
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
-- receipt_relations_v1: a copy of a purchase is not counted on a car where the paper it repeats is counted
counted AS (
  SELECT e.* FROM eligible e
   WHERE NOT EXISTS (SELECT 1 FROM public.receipt_relations rr JOIN public.receipt_relation_rules rl ON rl.rule_key = rr.rule_key
                      JOIN eligible k ON k.vehicle_id = e.vehicle_id AND k.receipt_id = rr.related_receipt_id
                      WHERE rr.receipt_id = e.receipt_id AND rr.retired_at IS NULL AND rl.relation = 'same_purchase' AND rl.establishes)
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

DO $$ BEGIN RAISE NOTICE 'receipt_relations_fold first run: %', public.receipt_relations_fold('receipt-relations-fold:migration-20261125013000'); END $$;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'receipt-relations-fold';
    PERFORM cron.schedule('receipt-relations-fold', '27 * * * *',
      $c$SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.receipt_relations_fold(NULL)$c$);
  END IF;
END $$;

COMMIT;
