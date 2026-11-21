-- Receipt line kind: a part sold with "free shipping" is a part, not a charge.
--
-- Why: the proof vehicle's build record counted 62 receipts where the page lists 65. One of the three missing documents is a
-- real part whose printed words end "(Condition New, free standard shipping)". The charge rule matched the word "shipping",
-- so the line, and with it the whole document, dropped out of every reader that skips charges.
--
-- What this changes (revert: re-apply the definition in 20261111210500_receipt_work_reconciliation.sql):
--   receipt_line_kind(...)  a seller's "free shipping / free delivery / free returns" remark is set aside before the charge
--                           words are tested. A line that is only that remark, or that names a real shipping, freight, tax
--                           or return charge, is still a charge. Nothing else about the rule changes.
-- Rows affected on 2026-11-20 (read-only count): 1 receipt line in the whole table carries such a remark.
-- Contract: supabase/sql/test_receipt_work_reconciliation.sql.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.receipt_line_kind(p_description text, p_part_number text, p_total numeric, p_hours numeric,
                                                    p_line_date date, p_performer text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN d ~* '\m(shipping|freight|handling|delivery|sales tax|tax|discount|coupon|core charge|core exchange|core return|return|deposit|payment|surcharge|fee|subtotal|total)\M'
         OR coalesce(p_part_number, '') ~* '^\{?(shipping|freight|tax|handling)\}?$' THEN 'charge'
    WHEN d ~* 'back[- ]?order' OR d ~* 'qty shipped 0' THEN 'backordered'
    WHEN d ~* 'kit component' THEN 'kit_component'
    WHEN p_hours IS NOT NULL OR nullif(btrim(coalesce(p_performer, '')), '') IS NOT NULL
         OR (p_part_number IS NULL AND p_total IS NULL AND p_line_date IS NOT NULL) THEN 'labor'
    WHEN p_part_number IS NULL AND p_total IS NULL THEN 'note'
    ELSE 'part'
  END
  -- the remark is set aside only when other words remain; a line that is nothing but the remark stays a charge
  FROM (SELECT CASE WHEN btrim(stripped, ' ,;()-') = '' THEN raw ELSE stripped END AS d
          FROM (SELECT coalesce(p_description, '') AS raw,
                       regexp_replace(coalesce(p_description, ''),
                                      '\mfree +((standard|ground|economy|expedited) +)?(shipping|delivery|returns?)\M', '', 'gi') AS stripped) r) s
$$;
COMMENT ON FUNCTION public.receipt_line_kind(text, text, numeric, numeric, date, text) IS
  'What a receipt line is: charge (shipping, tax, fees), backordered (nothing shipped), kit_component (priced on its kit line), labor (hours, a performer, or a dated unpriced work note), note (unpriced, no part number), else part. First match wins. A seller''s "free shipping" remark on a part line is not a charge.';
