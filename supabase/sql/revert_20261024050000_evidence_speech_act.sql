-- Revert step 2 (restores step-1 behaviour; mined rows keep their quotes)
ALTER TABLE public.evidence_claims DROP COLUMN IF EXISTS speech_act_pattern_id, DROP COLUMN IF EXISTS polarity, DROP COLUMN IF EXISTS speech_act;
ALTER TABLE public.evidence_claim_patterns DROP COLUMN IF EXISTS polarity_if_asserted;
DROP FUNCTION IF EXISTS public.classify_speech_act(text);
DROP TABLE IF EXISTS public.evidence_speech_act_patterns;
-- then re-apply mine_bat_text_claims from 20261024040000_evidence_trust_registry_and_bat_text_claims.sql
