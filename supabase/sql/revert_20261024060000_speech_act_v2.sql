-- Revert step 3: drop v2 patterns/functions, re-activate v1, re-apply miner from 20261024050000
DROP FUNCTION IF EXISTS public.reclassify_evidence_claims(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.classify_speech_act(text, text, text);
DELETE FROM public.evidence_speech_act_patterns WHERE version = 'v2';
UPDATE public.evidence_speech_act_patterns SET active = true WHERE version = 'v1';
ALTER TABLE public.evidence_speech_act_patterns DROP COLUMN IF EXISTS roles, DROP COLUMN IF EXISTS version;
-- then re-run 20261024050000 mine_bat_text_claims definition
