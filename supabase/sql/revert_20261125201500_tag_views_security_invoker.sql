-- Revert of 20261125201500_tag_views_security_invoker.sql: the two tag views run as their owner again (no
-- security_invoker), which re-opens rows the base tables' policies withhold. Run by hand only if the migration must be
-- undone.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER VIEW public.tag_analysis_view RESET (security_invoker);
ALTER VIEW public.enhanced_tag_context RESET (security_invoker);
COMMIT;
