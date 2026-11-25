-- Revert 20261124207000_receipt_reread_worklist: drop the work list and the writer; lines the fold took from a reread go
-- with the source row (receipt_items.line_source references it). Stored rereads stay on raw_extraction (testimony).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP FUNCTION IF EXISTS public.receipt_record_reread(uuid, jsonb, text, text);
DROP VIEW IF EXISTS public.receipt_reread_worklist;
DELETE FROM public.receipt_items WHERE line_source = 'raw_extraction.reread.line_items';
UPDATE public.receipt_itemisation_outcomes SET source_key = NULL WHERE source_key = 'raw_extraction.reread.line_items';
DELETE FROM public.receipt_line_sources WHERE source_key = 'raw_extraction.reread.line_items';
COMMIT;
