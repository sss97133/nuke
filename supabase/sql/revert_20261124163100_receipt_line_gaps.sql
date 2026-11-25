-- Revert 20261124163100_receipt_line_gaps.
DROP VIEW IF EXISTS public.receipt_line_gap_counts;
DROP VIEW IF EXISTS public.receipt_line_gap_terms;
DROP VIEW IF EXISTS public.receipt_line_gaps;
ALTER TABLE public.receipt_line_systems DROP COLUMN IF EXISTS expects_operation;
