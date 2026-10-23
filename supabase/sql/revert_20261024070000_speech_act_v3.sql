DELETE FROM public.evidence_speech_act_patterns WHERE version = 'v3';
UPDATE public.evidence_speech_act_patterns SET active = true WHERE version = 'v2' AND act = 'denial';
UPDATE public.evidence_speech_act_patterns
   SET pattern = replace(pattern, '|\ymy (\S+ ){0,3}''?’?\d{2,4}\y|', '|\ymy \S*\d|'), note = replace(note, ' [v3: my <model> <year>]', '')
 WHERE act = 'off_subject' AND version = 'v2' AND strpos(note, '[v3:') > 0;
-- then: SELECT public.reclassify_evidence_claims(<run_id>) for affected runs
DROP VIEW IF EXISTS public.evidence_roles_validated;
DROP TABLE IF EXISTS public.evidence_speech_act_validation;
-- restore the 2-arg miner: re-run the mine_bat_text_claims block of 20261024060000_evidence_speech_act_v2.sql after:
DROP FUNCTION IF EXISTS public.mine_bat_text_claims(uuid[], uuid, boolean);
