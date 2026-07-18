-- 20260622213630_auction_comments_rubric_v2_rescore_k5_c0e3ce7b.sql
-- Applied to prod 2026-06-22 (data re-score, no schema change — columns already exist from
-- 20260622030000_auction_comments_intelligence.sql).
--
-- WHAT: Re-score the comment-intelligence axes for the 1977 K5 Blazer auction
--       (vehicle_id c0e3ce7b-2c2b-460d-85fb-abeeee328148) under RUBRIC v2.
--
-- WHY v2: rubric v1 left the two axes COLLINEAR (r=0.656) — condition defects leaked into
--   community stance. v2 DECOUPLES them:
--     condition_polarity     (AXIS 1) — about the CAR. Unchanged definition.
--     community_stance_score (AXIS 2) — about the SELLER's HONESTY. Moves ONLY when the
--       comment ENGAGES the seller's truthfulness/claims. A defect noted NEUTRALLY (no
--       accusation, no reference to a seller claim) = stance 0 even if condition is negative.
--
-- These are ANALYSIS columns (derived scores + extracted_claims), NOT testimony fields.
--   comment_text / author / source / posted_at are untouched. Re-scoring derived columns in
--   place is the designed, auditable path (rubric_version + stance_scored_at record it).
--   The trust-invariant supersede-never-delete rule governs testimony VALUES, not the
--   recomputation of a versioned derived score — and nothing here deletes or rewrites any
--   observed datum.
--
-- IDEMPOTENT: each UPDATE is keyed by stable comment id and is a no-op once the row already
--   carries the v2 values (guarded with `rubric_version IS DISTINCT FROM 2`). Re-running
--   sets the same buckets again only if a row regressed to v1. stance_scored_at is left as the
--   first-applied value on no-op re-runs (the WHERE guard skips already-v2 rows).
--
-- v1 -> v2 stance deltas (the decoupling in action):
--   5775b8b0  bed-lip trim looks off ...... cond -0.5  stance -0.5 -> 0  (defect, NO seller-claim engaged)
--   cc47880f  leaking t-case/oil pan/dif .. cond -0.5  stance -0.5 -> 0  (defect, NO seller-claim engaged)
--   fd90a55f  "which t-case? NP203?" ....... cond  0    stance -0.5 -> 0  (neutral spec Q, no claim engaged)
--   c2a61391  seller: carpet source ........ cond +0.5  stance +0.5 -> 0  (seller's own answer, not community corroboration)
--   ea5e32c0  seller: original 203 ......... cond +0.5  stance +0.5 -> 0  (seller's own answer, not community corroboration)
--   e3950807  "video says no AC but pics" .. cond  0    stance -0.5 -> -0.5 (KEPT: pointed Q probing a STATED seller claim)
--   (all other 14 rows were stance 0 / condition 0 under both rubrics.)

BEGIN;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='18564e6a-1e19-4963-bd0a-87385137755d' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='2391fb6e-0ba6-4c4f-a69b-8435ab3d117a' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='2b80c466-9c83-44d9-b32b-93a8caf5248a' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='2edde80a-4369-4404-bd1b-4c97d2c1f03d' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='43e4907a-4f5a-438f-b405-5979ab37ea3e' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='4e55f5ec-13ac-4cff-8f1b-9882c9b9f2c9' AND rubric_version IS DISTINCT FROM 2;

-- AXIS1 -0.5 (notable fit issue) ; AXIS2 0 (DEFECT noted neutrally, no seller claim engaged). v1 stance -0.5.
UPDATE public.auction_comments SET
  condition_polarity=-0.5, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[{"kind":"condition","polarity":-0.5,"assertion":"Bed-lip trim appears misshapen/ill-fitting, possibly reinstalled over new carpet","locations":["bed lip trim"],"corroborates_or_challenges":"neutral","challenges_claim":null,"comment_id":"5775b8b0-99f5-4e5c-b566-7adf85008b2a"}]'::jsonb
WHERE id='5775b8b0-99f5-4e5c-b566-7adf85008b2a' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[{"kind":"spec","polarity":0,"assertion":"80 inches (6ft 8in) from ground to top of roof rack; takes regular unleaded","locations":["roof rack","fuel system"],"corroborates_or_challenges":"neutral","challenges_claim":null,"comment_id":"642ee942-e891-4237-8575-bd6a8dbc8992"}]'::jsonb
WHERE id='642ee942-e891-4237-8575-bd6a8dbc8992' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='86f3e6a4-2dae-4c81-8bed-effca60530cf' AND rubric_version IS DISTINCT FROM 2;

-- AXIS1 +0.5 (credible positive provenance about the car) ; AXIS2 0 (seller's OWN answer, not community corroboration). v1 stance +0.5.
UPDATE public.auction_comments SET
  condition_polarity=0.5, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[{"kind":"provenance","polarity":0.5,"assertion":"Carpet and floor mats sourced from OC Auto Carpet; colors are exact matches to original","locations":["interior carpet","floor mats"],"corroborates_or_challenges":"neutral","challenges_claim":null,"comment_id":"c2a61391-b53e-4f02-a0b6-5981d8bf66e9"}]'::jsonb
WHERE id='c2a61391-b53e-4f02-a0b6-5981d8bf66e9' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='c69ddca0-46e2-47dd-b3d8-5ff2c4c9d0b4' AND rubric_version IS DISTINCT FROM 2;

-- AXIS1 -0.5 (notable leak issue) ; AXIS2 0 (DEFECT noted neutrally, no seller claim engaged). v1 stance -0.5.
UPDATE public.auction_comments SET
  condition_polarity=-0.5, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[{"kind":"condition","polarity":-0.5,"assertion":"Appears to have significant fluid leaking from transfer case, oil pan, and front differential","locations":["transfer case","oil pan","front differential"],"corroborates_or_challenges":"neutral","challenges_claim":null,"comment_id":"cc47880f-ac55-4a26-8924-68cf8fb3c4eb"}]'::jsonb
WHERE id='cc47880f-ac55-4a26-8924-68cf8fb3c4eb' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='d91e0d69-a516-4bfd-9280-5e4083a2ceef' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='dd05af3f-e061-4774-aedd-081671bd33a6' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='e24b5ce4-3472-4424-a80c-912e8083505d' AND rubric_version IS DISTINCT FROM 2;

-- AXIS1 0 (spec/feature discrepancy, no condition flaw) ; AXIS2 -0.5 (POINTED Q probing the seller's stated "no AC" claim). KEPT from v1.
UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=-0.5, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[{"kind":"spec","polarity":0,"assertion":"Possible discrepancy: video says no AC but photos show heater/cooler controls","locations":["dashboard","HVAC controls"],"corroborates_or_challenges":"challenges","challenges_claim":"video says no AC","comment_id":"e3950807-397d-469f-814b-5d950dd66d36"}]'::jsonb
WHERE id='e3950807-397d-469f-814b-5d950dd66d36' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[{"kind":"spec","polarity":0,"assertion":"Not optioned with AC but has working heat","locations":["HVAC"],"corroborates_or_challenges":"neutral","challenges_claim":null,"comment_id":"e6ace08a-3728-4d31-a938-e9bda1afd530"}]'::jsonb
WHERE id='e6ace08a-3728-4d31-a938-e9bda1afd530' AND rubric_version IS DISTINCT FROM 2;

-- AXIS1 +0.5 (credible positive originality about the car) ; AXIS2 0 (seller's OWN answer, not community corroboration). v1 stance +0.5.
UPDATE public.auction_comments SET
  condition_polarity=0.5, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[{"kind":"provenance","polarity":0.5,"assertion":"Original NP203 transfer case confirmed by seller","locations":["transfer case"],"corroborates_or_challenges":"neutral","challenges_claim":null,"comment_id":"ea5e32c0-7433-4e76-9df8-cbd5b19aded3"}]'::jsonb
WHERE id='ea5e32c0-7433-4e76-9df8-cbd5b19aded3' AND rubric_version IS DISTINCT FROM 2;

UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='eae57ae6-8c65-47a0-a373-55c458887ad8' AND rubric_version IS DISTINCT FROM 2;

-- AXIS1 0 ; AXIS2 0 (NEUTRAL spec question, NO seller claim referenced — v1 wrongly scored -0.5). v1 stance -0.5.
UPDATE public.auction_comments SET
  condition_polarity=0, community_stance_score=0, rubric_version=2,
  stance_model='rubric-v2 BYOK', stance_scored_at=now(),
  extracted_claims='[]'::jsonb
WHERE id='fd90a55f-b65d-4665-a081-157e9a723256' AND rubric_version IS DISTINCT FROM 2;

COMMIT;
