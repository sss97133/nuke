-- Revert for 20261024040000_evidence_trust_registry_and_bat_text_claims.sql (all objects are new; nothing else touched)
DROP FUNCTION IF EXISTS public.mine_bat_text_claims(uuid[], uuid);
DROP VIEW IF EXISTS public.evidence_claims_weighted;
DROP TABLE IF EXISTS public.evidence_claims;
DROP TABLE IF EXISTS public.evidence_claim_patterns;
DROP TABLE IF EXISTS public.evidence_trust_registry;
-- To revert only one run's rows: DELETE FROM public.evidence_claims WHERE run_id = '<run_id>';
