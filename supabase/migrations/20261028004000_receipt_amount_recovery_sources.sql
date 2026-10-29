-- Cited observations for amounts and dates recovered from a receipt's own page
-- (OCR text, extracted text, line items). Additive only: new nullable columns.
-- Fill rules (applied by data runs, not this migration): total_amount / receipt_date
-- are written only when empty; amount_check recomputes through its existing trigger.
alter table public.receipts
  add column if not exists amount_source text,
  add column if not exists amount_source_confidence numeric(3,2)
    check (amount_source_confidence is null or amount_source_confidence between 0 and 1),
  add column if not exists amount_source_citation jsonb,
  add column if not exists amount_source_value numeric,
  add column if not exists amount_source_run_id text,
  add column if not exists receipt_date_source text,
  add column if not exists receipt_date_source_confidence numeric(3,2)
    check (receipt_date_source_confidence is null or receipt_date_source_confidence between 0 and 1),
  add column if not exists receipt_date_source_citation jsonb,
  add column if not exists receipt_date_source_value date,
  add column if not exists receipt_date_source_run_id text;

comment on column public.receipts.amount_source is 'Where a recovered amount came from, e.g. raw_extraction.ocr.full_text or line_items. Null when the amount was read at ingest.';
comment on column public.receipts.amount_source_value is 'The recovered amount as observed; total_amount is filled from it only when total_amount and total were both empty.';
comment on column public.receipts.amount_source_citation is 'Pattern, field path, line and snippet the amount was read from, the line-item cross-check, and the fill decision.';
comment on column public.receipts.receipt_date_source_value is 'The page date as observed; receipt_date is filled from it only when receipt, transaction and purchase dates were all empty.';

-- Revert:
-- alter table public.receipts drop column if exists amount_source, drop column if exists amount_source_confidence,
--   drop column if exists amount_source_citation, drop column if exists amount_source_value, drop column if exists amount_source_run_id,
--   drop column if exists receipt_date_source, drop column if exists receipt_date_source_confidence,
--   drop column if exists receipt_date_source_citation, drop column if exists receipt_date_source_value, drop column if exists receipt_date_source_run_id;
