-- Evidence layer step 2: speech act (assertion/question/denial/hedge/generic) + polarity, as DATA patterns.
-- Additive columns + one new table; miner replaced (same signature). Revert: supabase/sql/revert_20261024050000_evidence_speech_act.sql
CREATE TABLE IF NOT EXISTS public.evidence_speech_act_patterns (
  id        serial PRIMARY KEY,
  act       text NOT NULL CHECK (act IN ('question','hedge','generic','denial')),
  priority  int  NOT NULL,          -- lower = checked first; no match => 'assertion'
  pattern   text NOT NULL,          -- case-insensitive POSIX regex on the sentence
  note      text,
  active    boolean NOT NULL DEFAULT true,
  UNIQUE (act, pattern)
);
ALTER TABLE public.evidence_speech_act_patterns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.evidence_claim_patterns ADD COLUMN IF NOT EXISTS polarity_if_asserted smallint NOT NULL DEFAULT 1;
UPDATE public.evidence_claim_patterns SET polarity_if_asserted = -1 WHERE field_hint = 'condition_issue';

ALTER TABLE public.evidence_claims ADD COLUMN IF NOT EXISTS speech_act text;
ALTER TABLE public.evidence_claims ADD COLUMN IF NOT EXISTS polarity smallint;        -- +1 supports value, -1 detracts, 0 not evidence
ALTER TABLE public.evidence_claims ADD COLUMN IF NOT EXISTS speech_act_pattern_id int REFERENCES public.evidence_speech_act_patterns(id);

INSERT INTO public.evidence_speech_act_patterns (act, priority, pattern, note) VALUES
 ('question', 10, '\?\s*\S{0,3}\s*$', 'ends with question mark'),
 ('question', 11, '^\s*(@\S+\s+)*(seller\s*[-,:]*\s*)?(has|have|had|is|are|was|were|does|did|do|can|could|would|will|any|anyone|how|what|why|when|where|which|who)\M', 'interrogative opener'),
 ('question', 12, '\m(wondering|curious) (if|whether|about)\M|\m(i|we) wonder\M|\mplease (share|post|provide|email)\M|\m(can|could) you\M', 'indirect question / request'),
 ('generic',  20, '\m(these cars|these trucks|on these|common (issue|problem|failure)|usually|typically|generally|known (for|to)|tend to|prevailing)\M', 'statement about the model, not this vehicle'),
 ('hedge',    30, '\m(not sure|unclear|i think|i believe|i guess|probably|maybe|perhaps|might|may have|appears? to|seems?|presumably|looks like|looks the part|said to|reportedly|unknown)\M', 'uncertain or attributed'),
 ('denial',   40, '\m(no|not|never|none|nothing|without|free of|nor|zero|isn''t|wasn''t|doesn''t|didn''t|hasn''t|haven''t|don''t|aren''t|weren''t|can''t|couldn''t)\M', 'negation')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.classify_speech_act(p_sentence text)
RETURNS TABLE (act text, pattern_id int)
LANGUAGE sql STABLE AS $f$
  SELECT coalesce(m.act, 'assertion'), m.id
  FROM (SELECT 1) one
  LEFT JOIN LATERAL (
    SELECT sp.act, sp.id FROM public.evidence_speech_act_patterns sp
    WHERE sp.active AND p_sentence ~* sp.pattern
    ORDER BY sp.priority, sp.id LIMIT 1) m ON true;
$f$;

CREATE OR REPLACE FUNCTION public.mine_bat_text_claims(p_vehicle_ids uuid[], p_run_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET statement_timeout = '120s'
AS $fn$
DECLARE n int := 0; m int;
BEGIN
  IF array_length(p_vehicle_ids, 1) > 500 THEN
    RAISE EXCEPTION 'mine_bat_text_claims: max 500 vehicles per call';
  END IF;

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
    AND coalesce(ac.platform,'bat') = 'bat'
    AND ac.bid_amount IS NULL
    AND p.active
    AND length(s.q) >= 20
    AND s.q ~* p.pattern
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;

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
  RETURN n;
END;
$fn$;
