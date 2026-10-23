-- Evidence layer: v3 speech-act patterns (data only). v2 scored 0.924 assertion precision on its dev set
-- but 0.753 on a blind held-out set (run ...e003); v3 adds general rules, validated on a fresh blind set (run ...e004).
UPDATE public.evidence_speech_act_patterns SET active = false WHERE version = 'v2' AND act = 'denial';
INSERT INTO public.evidence_speech_act_patterns (act, priority, roles, pattern, note, version, active) VALUES
 ('denial', 90, NULL, '\y(no(?! reserve)|not|never|none|nothing|without|free of|nor|zero|isn.?t|wasn.?t|doesn.?t|didn.?t|hasn.?t|haven.?t|don.?t|dont|aren.?t|weren.?t|can.?t|couldn.?t|lack of)\y(\W+[\w''’]+){0,4}\W+{claim}', 'v3: negation (incl. apostrophe-less, excl. "no reserve") within 4 words before the claim term', 'v3', true),
 ('denial', 91, NULL, '{claim}[\s-]*(free|wise,? (again )?there is none|is none|none)\y', 'v3: post-claim negation ("rust free", "rust wise there is none")', 'v3', true),
 ('generic', 18, NULL, '\y(i.ll|i will|we will|will be|let me|i asked|asked for|concerned|potentially|cracks me up|i know of one|i know this|negotiating|note the|quote from|this becomes|referenced|here is)\y', 'v3: intent/future/request/meta statements are not assertions', 'v3', true);
UPDATE public.evidence_speech_act_patterns
   SET pattern = replace(pattern, '|\ymy \S*\d|', '|\ymy (\S+ ){0,3}''?’?\d{2,4}\y|'), note = note || ' [v3: my <model> <year>]'
 WHERE act = 'off_subject' AND version = 'v2' AND strpos(pattern, '|\ymy \S*\d|') > 0;

-- Per-role validation results (blind hand-labeled sets). Downstream features only use roles whose
-- assertion precision on a blind set is >= 0.9 (data, not code: re-validate and update rows to change).
CREATE TABLE IF NOT EXISTS public.evidence_speech_act_validation (
  id serial PRIMARY KEY, pattern_version text NOT NULL, author_role text NOT NULL, eval_run_id uuid NOT NULL,
  blind boolean NOT NULL, n_labeled int NOT NULL, assertion_tp int NOT NULL, assertion_predicted int NOT NULL,
  denial_tp int NOT NULL, denial_predicted int NOT NULL, validated_at timestamptz NOT NULL DEFAULT now(), note text);
ALTER TABLE public.evidence_speech_act_validation ENABLE ROW LEVEL SECURITY;
INSERT INTO public.evidence_speech_act_validation (pattern_version, author_role, eval_run_id, blind, n_labeled, assertion_tp, assertion_predicted, denial_tp, denial_predicted, note) VALUES
 ('v3','listing_description','7e1d0c24-2026-4a10-9e00-00000000e004',true,39,33,33,0,0,'blind set e004 (274 claims, 25 vehicles)'),
 ('v3','seller_comment','7e1d0c24-2026-4a10-9e00-00000000e004',true,87,43,53,11,16,'blind set e004'),
 ('v3','commenter','7e1d0c24-2026-4a10-9e00-00000000e004',true,148,9,14,2,3,'blind set e004');
CREATE OR REPLACE VIEW public.evidence_roles_validated WITH (security_invoker = true) AS
  SELECT DISTINCT ON (author_role) author_role, pattern_version, assertion_tp::numeric/nullif(assertion_predicted,0) AS assertion_precision,
         (assertion_tp::numeric/nullif(assertion_predicted,0)) >= 0.9 AS passes
  FROM public.evidence_speech_act_validation WHERE blind ORDER BY author_role, validated_at DESC, id DESC;

DROP FUNCTION IF EXISTS public.mine_bat_text_claims(uuid[], uuid);
CREATE OR REPLACE FUNCTION public.mine_bat_text_claims(p_vehicle_ids uuid[], p_run_id uuid, p_include_comments boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
SET statement_timeout = '120s'
AS $fn$
DECLARE n int := 0; m int;
BEGIN
  IF array_length(p_vehicle_ids, 1) > 500 THEN
    RAISE EXCEPTION 'mine_bat_text_claims: max 500 vehicles per call';
  END IF;

  IF p_include_comments THEN
  INSERT INTO public.evidence_claims (run_id, vehicle_id, source_slug, author_role, author_key, claim_kind, field_hint,
         quote, source_comment_id, source_url, observed_at, pattern_id, trust_id, speech_act, polarity, speech_act_pattern_id)
  SELECT p_run_id, ac.vehicle_id, 'bat', role.r, coalesce(ac.author_username, ac.id::text), p.claim_kind, p.field_hint,
         left(s.q, 400), ac.id, ac.source_url, ac.posted_at, p.id, t.id, sa.act,
         CASE sa.act WHEN 'assertion' THEN p.polarity_if_asserted WHEN 'denial' THEN -p.polarity_if_asserted ELSE 0 END,
         sa.pattern_id
  FROM public.auction_comments ac
  CROSS JOIN LATERAL (SELECT CASE WHEN ac.is_seller THEN 'seller_comment' ELSE 'commenter' END r) role
  CROSS JOIN LATERAL (SELECT btrim(x[1]) q FROM regexp_matches(ac.comment_text, '[^.!?\n]+[.!?]*', 'g') x) s
  CROSS JOIN public.evidence_claim_patterns p
  JOIN public.evidence_trust_registry t ON t.source_slug='bat' AND t.author_role=role.r AND t.claim_kind=p.claim_kind
  CROSS JOIN LATERAL public.classify_speech_act(s.q) sa
  WHERE ac.vehicle_id = ANY(p_vehicle_ids)
    AND EXISTS (SELECT 1 FROM public.vehicles vv WHERE vv.id = ac.vehicle_id)  -- some comments point at merged/deleted vehicles
    AND coalesce(ac.platform,'bat') = 'bat'
    AND ac.bid_amount IS NULL
    AND p.active
    AND length(s.q) >= 20
    AND s.q ~* p.pattern
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
  END IF;

  INSERT INTO public.evidence_claims (run_id, vehicle_id, source_slug, author_role, author_key, claim_kind, field_hint,
         quote, source_url, observed_at, pattern_id, trust_id, speech_act, polarity, speech_act_pattern_id)
  SELECT p_run_id, v.id, 'bat', 'listing_description', 'listing', p.claim_kind, p.field_hint,
         left(s.q, 400), bl.bat_listing_url, coalesce(bl.auction_end_date, bl.sale_date)::timestamptz, p.id, t.id, sa.act,
         CASE sa.act WHEN 'assertion' THEN p.polarity_if_asserted WHEN 'denial' THEN -p.polarity_if_asserted ELSE 0 END,
         sa.pattern_id
  FROM public.vehicles v
  JOIN LATERAL (SELECT * FROM public.bat_listings b WHERE b.vehicle_id = v.id ORDER BY b.auction_end_date DESC NULLS LAST LIMIT 1) bl ON true
  CROSS JOIN LATERAL (SELECT btrim(x[1]) q FROM regexp_matches(v.description, '[^.!?\n]+[.!?]*', 'g') x) s
  CROSS JOIN public.evidence_claim_patterns p
  JOIN public.evidence_trust_registry t ON t.source_slug='bat' AND t.author_role='listing_description' AND t.claim_kind=p.claim_kind
  CROSS JOIN LATERAL public.classify_speech_act(s.q) sa
  WHERE v.id = ANY(p_vehicle_ids)
    AND p.active
    AND length(s.q) >= 20
    AND s.q ~* p.pattern
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
  PERFORM public.reclassify_evidence_claims(p_run_id, p_vehicle_ids);  -- v2 role/claim-scoped labels
  RETURN n;
END;
$fn$;
