-- Revert 20261124163200_receipt_line_rule_promote.
DROP FUNCTION IF EXISTS public.receipt_line_rule_propose(text, text, int, text, text, text, text, uuid[], text, text, text, int, int, text, text);
DROP FUNCTION IF EXISTS public.receipt_line_rule_promote(text);
