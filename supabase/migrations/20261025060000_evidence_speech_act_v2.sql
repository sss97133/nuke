-- Evidence layer step 3: v2 speech-act patterns (role-scoped, claim-scoped denial), tuned on a 240-claim dev set
-- and validated on a separate held-out set. Data-only change + classifier signature extension.
-- Revert: supabase/sql/revert_20261024060000_speech_act_v2.sql
ALTER TABLE public.evidence_speech_act_patterns DROP CONSTRAINT IF EXISTS evidence_speech_act_patterns_act_check;
ALTER TABLE public.evidence_speech_act_patterns ADD CONSTRAINT evidence_speech_act_patterns_act_check
  CHECK (act IN ('question','hedge','generic','denial','off_subject','fragment'));
ALTER TABLE public.evidence_speech_act_patterns ADD COLUMN IF NOT EXISTS roles text[];   -- NULL = all author roles
ALTER TABLE public.evidence_speech_act_patterns ADD COLUMN IF NOT EXISTS version text NOT NULL DEFAULT 'v1';
UPDATE public.evidence_speech_act_patterns SET active = false WHERE version = 'v1';
INSERT INTO public.evidence_speech_act_patterns (act, priority, roles, pattern, note) VALUES
 ('question', 10, NULL, '\?\s*\S{0,3}\s*$', 'v2'),
 ('question', 11, NULL, '^\s*(@\S+\s+)*([a-z]+:\s*)?(also,?\s*)?(seller\s*[-,:]*\s*)?(is|are|was|were|does|did|do|can|could|would|will|any|anyone|how|what|why|where|which|who)\y|^\s*(@\S+\s+)*(also,?\s*)?(has|have|had) (you|it|this|the|anyone|there)\y|^\s*(@\S+\s+)*when\y(?!\s+(we|i)\y)', 'v2'),
 ('off_subject', 12, ARRAY['commenter'], '^(?!.*(\y(this|the) (car|truck|one|example|vehicle|jeep|bus|wagon|coupe|roadster|seller)\y|\yseller\y|\yphotos?\y|\ypics?\y|\ypicture\y|#\s?\d+|\ygallery\y|\ythis\y|\y(obviously|clearly)\y|\yher\y|\yit(''s|’s| has| is| was| had)\y))', 'v2'),
 ('fragment', 13, NULL, '^\W*(\S+\s+){0,4}\S+\W*$', 'v2'),
 ('generic', 14, NULL, '\y(leak[- ]down|compression test|looked for|uploaded|meant for you|personally i enjoy|odd that|rust was standard)\y', 'v2'),
 ('question', 15, NULL, '\y(wondering|curious) (if|whether|about)\y|\y(i|we) wonder\y|\yplease (share|post|provide|email)\y|\y(can|could) you\y|\yany chance\y|\ywanted to follow up\y|\yrequest\y', 'v2'),
 ('off_subject', 16, ARRAY['commenter'], '\ymy (dad|dad''s|dad’s|father|grandfather|mom|own|old|daily|first|car|truck|part|guess)\y|\yi (had|have one|owned|bought|drove|replaced|remember|was driving|was there|learned|also learned|agree|can.t wait|recently acquired)\y|\yhis own\y|\yhe did have\y|\ymy then\y|\ytwelve years ago\y|\ypsa\y|\ywould love\y|\ymy \S*\d|\ymy contemporary\y|\yyou can\y|\yi.ve long\y|\ythe (yellow|red|blue|other) car\y|\yit was a super\y|\ycontinue to be\y', 'v2'),
 ('off_subject', 17, ARRAY['seller_comment'], '\ydmv\y|\yresident\y|\ytake care of paperwork\y|\ymy guess\y|\ymy (second|first|contemporary)\y|\ybought them\y', 'v2'),
 ('generic', 18, NULL, '\y(these cars|these trucks|on these|this era|common|usually|typically|generally|often|known (for|to)|tend to|prevailing|many|so many|nobody|likelihood|likely|hopefully|if|would|should|will need|hurts the value|the real point|not that big of a deal|haystack|uncommon|curiosity)\y', 'v2'),
 ('hedge', 19, NULL, '\y(not sure|unclear|i think|i believe|i don''t believe|i guess|probably|maybe|perhaps|might|may|may have|appears?|seems?|presumably|looks like|looks the part|said to|reportedly|believed|by the looks|feels|unknown|my guess)\y', 'v2'),
 ('denial', 90, NULL, '\y(no|not|never|none|nothing|without|free of|nor|zero|isn''t|wasn''t|doesn''t|didn''t|hasn''t|haven''t|don''t|aren''t|weren''t|can''t|couldn''t|NOT)\y(\W+[\w''’]+){0,5}\W+{claim}', 'v2: negation within 5 words before the claim term')
ON CONFLICT (act, pattern) DO NOTHING;
UPDATE public.evidence_speech_act_patterns SET version = 'v2' WHERE note LIKE 'v2%';
-- the trailing-question-mark rule is shared with v1 (same text, so the insert above was skipped): keep it active in v2
UPDATE public.evidence_speech_act_patterns SET active = true, version = 'v2', priority = 9 WHERE act = 'question' AND pattern = '\?\s*\S{0,3}\s*$';

-- Denial patterns may contain {claim}, replaced by the matched claim pattern (negation must scope the claim term).
CREATE OR REPLACE FUNCTION public.classify_speech_act(p_sentence text, p_role text, p_claim_pattern text)
RETURNS TABLE (act text, pattern_id int)
LANGUAGE sql STABLE AS $f$
  SELECT coalesce(m.act, 'assertion'), m.id
  FROM (SELECT 1) one
  LEFT JOIN LATERAL (
    SELECT sp.act, sp.id FROM public.evidence_speech_act_patterns sp
    WHERE sp.active
      AND (sp.roles IS NULL OR p_role = ANY(sp.roles))
      AND p_sentence ~* replace(sp.pattern, '{claim}', p_claim_pattern)
    ORDER BY sp.priority, sp.id LIMIT 1) m ON true;
$f$;

-- Re-label existing claims in place (quotes unchanged).
CREATE OR REPLACE FUNCTION public.reclassify_evidence_claims(p_run_id uuid, p_vehicle_ids uuid[] DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SET statement_timeout = '120s' AS $fn$
DECLARE n int;
BEGIN
  UPDATE public.evidence_claims c
     SET speech_act = x.act, speech_act_pattern_id = x.pattern_id, polarity = x.pol
    FROM (SELECT c2.id, sa.act, sa.pattern_id,
                 CASE sa.act WHEN 'assertion' THEN p.polarity_if_asserted WHEN 'denial' THEN -p.polarity_if_asserted ELSE 0 END AS pol
            FROM public.evidence_claims c2
            JOIN public.evidence_claim_patterns p ON p.id = c2.pattern_id
            CROSS JOIN LATERAL public.classify_speech_act(c2.quote, c2.author_role, p.pattern) sa
           WHERE c2.run_id = p_run_id
             AND (p_vehicle_ids IS NULL OR c2.vehicle_id = ANY(p_vehicle_ids))) x
   WHERE c.id = x.id;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $fn$;

-- Miner: same body as step 2, then v2 relabel of the rows it touched.
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
    AND EXISTS (SELECT 1 FROM public.vehicles vv WHERE vv.id = ac.vehicle_id)  -- some comments point at merged/deleted vehicles
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
  PERFORM public.reclassify_evidence_claims(p_run_id, p_vehicle_ids);  -- v2 role/claim-scoped labels
  RETURN n;
END;
$fn$;
