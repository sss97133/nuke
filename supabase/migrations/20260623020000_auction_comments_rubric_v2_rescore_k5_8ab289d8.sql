-- 20260623020000_auction_comments_rubric_v2_rescore_k5_8ab289d8.sql
-- Applied to prod 2026-06-23 (data re-score; per-row UPDATE of community_stance_score,
-- condition_polarity, extracted_claims on 40 already-scored comments for ONE vehicle).
--
-- VEHICLE: 8ab289d8-c3c2-4a07-9db6-9343f92e0afb (a 1977 K5 Blazer BaT listing; cohort
-- subject 6fd682a8-72a8-49eb-a7b2-def080953835). This is a targeted re-score of the rows
-- previously scored under rubric_version=1, NOT a schema change. The two scoring columns
-- already exist (20260622030000_auction_comments_intelligence.sql).
--
-- WHY rubric v2: v1 had the two axes collinear (Pearson r=0.656 across this vehicle's rows)
-- because enthusiasm and seller-disclosure leaked into the stance axis. v2 DECOUPLES them.
-- After this re-score, r=0.379 on the same 40 rows.
--
-- RUBRIC v2 — discrete buckets {-1,-0.5,0,+0.5,+1} on two ORTHOGONAL axes:
--   AXIS 1 condition_polarity  (about the CAR, unchanged from v1):
--     +1 evidenced-exceptional · +0.5 credible positive · 0 neutral/enthusiasm/no claim
--     · -0.5 notable issue (repaint/repaired panel/leak/wear)
--     · -1 hard defect or misrepresentation (frame/floor rot, flood, rust-through, wrong year, odo doubt).
--   AXIS 2 community_stance_score (about the SELLER's HONESTY — the key v2 change):
--     moves ONLY when the comment ENGAGES the seller's truthfulness/claims.
--     A defect noted NEUTRALLY (no accusation, no reference to a seller claim) = stance 0
--     even if condition is negative.
--       +1 corroborates a seller claim WITH evidence · +0.5 mildly supports the seller
--       · 0 neutral / observation / off-topic / a defect with no seller-claim engagement
--       · -0.5 a pointed question probing a stated claim
--       · -1 directly rebuts a stated seller claim with evidence.
--
-- The headline v2 effect on this vehicle:
--   * 17 rows had non-zero v1 stance forced to 0 (enthusiasm/valuation/nostalgia that engaged
--     no seller claim, plus the seller's OWN disclosures which are claims being made, not the
--     community engaging the seller's honesty).
--   * Of those, the "defect-but-no-seller-engagement" subset = 2 rows: 587c889c and 6653f1dc
--     (both condition_polarity=-0.5 seller disclosures; v1 stance +0.5 -> v2 stance 0).
--   * Stance KEEPS non-zero on the 4 rows that actually engage seller honesty:
--       6ce8ef3b (-0.5, probes originality/matching-numbers/top claims),
--       e06bedae (-0.5, probes the stated rocker/lower-repair quality),
--       bf60fd55 (+0.5, corrects the BaT writeup toward the true full-time-4WD spec),
--       da6a547f (+0.5, corroborates the seller-disclosed valve-seal startup puff).
--
-- IDEMPOTENT: each UPDATE is gated on `rubric_version IS DISTINCT FROM 2`, so re-running this
-- file after it has been applied is a no-op (zero rows touched). stance_scored_at is set to
-- now() only on the rows that actually transition. Supersede-never-delete note: these columns
-- are derived re-scores (not testimony rows); the source comment prose is untouched.
--
-- FACTS SACRED: every assertion in extracted_claims is quoted/paraphrased from the comment
-- prose itself (carried verbatim from the v1 extraction where present); nothing fabricated.

BEGIN;

UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='0844ad0e-3cef-4a97-93cc-7e62a7dd4b25' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='15642841-7393-443a-9fd4-b2b7a3a472f4' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='1e2bd047-afbf-4b26-9d66-797c1af3afe1' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='33373c57-8b6e-4438-9a61-93260ce6a6cb' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='3dc0701e-c44a-4fac-bb77-118c631caca8' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='3df00b9c-8991-4060-89b8-a81bcb6e3a0c' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0.5, extracted_claims='[{"kind":"history","polarity":0.5,"assertion":"Acquired from son of original owners; sat on four flat tires for many years; recommissioned with new tires, battery, starter, fresh gas","locations":["whole vehicle","tires","battery","starter"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='47ad61ec-1608-4ff2-9a70-ba72bd245903' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='4e7cc53a-6d5b-4052-8e7e-405a09110251' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='4e8c305f-1443-4ffb-8697-cb1959af8beb' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='4e982455-e6a5-45c6-bb5b-f80f11462b68' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='5247fc8a-da2b-48a8-816a-8081db386d88' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='55f5f608-0e0a-4055-8a33-83837add258c' AND rubric_version IS DISTINCT FROM 2;
-- 587c889c: seller's OWN needs/defect disclosure. condition -0.5; stance forced 0 (defect-but-no-seller-engagement).
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=-0.5, extracted_claims='[{"kind":"condition","polarity":-0.5,"assertion":"A/C inoperative - all components present but compressor belt is off","locations":["A/C compressor"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"},{"kind":"condition","polarity":-0.5,"assertion":"Windows function but tracks need lubricating","locations":["window tracks"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"},{"kind":"condition","polarity":-0.5,"assertion":"Occasional startup puff from hardened valve seals; likely needs new belts and hoses","locations":["engine valve seals","belts","hoses"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"},{"kind":"condition","polarity":-0.5,"assertion":"Carpet torn at passenger footwell and sun-mottled; will need replacement","locations":["passenger footwell carpet"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='587c889c-26e1-48eb-89d4-a58550bacbae' AND rubric_version IS DISTINCT FROM 2;
-- 6653f1dc: seller's OWN repair/originality disclosure. condition -0.5; stance forced 0 (defect-but-no-seller-engagement).
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=-0.5, extracted_claims='[{"kind":"provenance","polarity":0.5,"assertion":"Interior, drivetrain original; paint mostly original","locations":["interior","drivetrain","paint"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"},{"kind":"condition","polarity":-0.5,"assertion":"Front of hood damaged and repaired poorly years ago; baseball-sized area of filler cracking, driver-quality until properly repaired/repainted","locations":["front of hood"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"},{"kind":"condition","polarity":-0.5,"assertion":"Removable top professionally bed-lined and front roof repainted in single-stage Frost white due to sun fading","locations":["roof","removable top"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"},{"kind":"condition","polarity":-0.5,"assertion":"Small rust spot in driver rocker repaired with a new rocker panel","locations":["driver rocker"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='6653f1dc-10a1-4732-a27f-5cbb979cecef' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='69981e98-6ae5-4682-bd52-34d25d65f690' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='6a83cd19-232e-422e-a4a6-22c15f39744f' AND rubric_version IS DISTINCT FROM 2;
-- 6ce8ef3b: community probes seller's originality/matching-numbers/top claims. stance -0.5 (kept).
UPDATE public.auction_comments SET community_stance_score=-0.5, condition_polarity=0, extracted_claims='[{"kind":"provenance","polarity":0,"assertion":"Asks whether the truck is completely original, matching numbers, and whether the top has ever been off","locations":["whole vehicle","removable top"],"challenges_claim":"completely original / matching numbers / top never off","corroborates_or_challenges":"challenges"}]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='6ce8ef3b-bda0-40ca-ac60-88f987c28f22' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='6fa2d83e-50ce-4b49-bf54-cba032478af4' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='8e8776fa-ac04-4652-adaf-79a8e9858e6c' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='96805a6e-be1c-42e6-a558-67951d570561' AND rubric_version IS DISTINCT FROM 2;
-- 98b2aca9: SELLER opening listing (survivor / 66k actual / very original). cond +0.5; stance 0 (claim made, not community-engaged).
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0.5, extracted_claims='[{"kind":"provenance","polarity":0.5,"assertion":"Survivor with 66k actual miles; very original and well-optioned; local truck known by seller since new","locations":["whole vehicle"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='98b2aca9-cacb-4e6d-92de-876d5c078871' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='9a7fdf70-dad9-4e66-b9d5-7807a9cd9d5d' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='a88fdc40-5761-4b50-89be-b3ea8ce734ff' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='af7383cd-5183-414c-b184-8f50adb1471c' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='b3c8e3fe-0de5-425b-b6c1-35791d2b0182' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='b87c5bca-2de2-4065-a511-23e340439acf' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='beab7145-5ccc-4f2c-be34-95aa223b9384' AND rubric_version IS DISTINCT FROM 2;
-- bf60fd55: community corrects the BaT writeup toward true full-time-4WD spec (supports seller). cond +0.5; stance +0.5 (kept).
UPDATE public.auction_comments SET community_stance_score=0.5, condition_polarity=0.5, extracted_claims='[{"kind":"spec","polarity":0.5,"assertion":"Full-time 4WD with locking center differential; no routing power to just the rear wheels (corrects the BaT writeup)","locations":["drivetrain"],"challenges_claim":"BaT listing copy implying selectable/rear-wheel power","corroborates_or_challenges":"corroborates"}]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='bf60fd55-447f-4729-a9d7-9e1435ada074' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='c13c0f2d-87c4-4515-9011-8aa37ab26548' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='c91fffab-d564-41ba-b2fd-388404468e56' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='ccfe814f-06d7-45ba-a7f3-97ec04fe0a3a' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='d812730c-05ad-40f5-a45d-8dfe48e2a212' AND rubric_version IS DISTINCT FROM 2;
-- d9e88a1f: valuation/bidder commentary, engages no seller claim. v1 stance -0.5 -> v2 0 (forced; non-defect).
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='d9e88a1f-5bd8-424e-a5ed-33c8dcd6892d' AND rubric_version IS DISTINCT FROM 2;
-- da6a547f: corroborates seller-disclosed valve-seal startup puff via own 78 Blazer. cond 0; stance +0.5 (new non-zero).
UPDATE public.auction_comments SET community_stance_score=0.5, condition_polarity=0, extracted_claims='[{"kind":"condition","polarity":0,"assertion":"Commenter reports the same startup behavior on their own 78 Blazer, corroborating the seller-disclosed valve-seal puff as normal/expected","locations":["engine valve seals"],"challenges_claim":"seller-disclosed startup valve-seal puff","corroborates_or_challenges":"corroborates"}]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='da6a547f-24f9-4565-b00a-7bae9a46dbcf' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='ddc3b76c-e5ac-4133-a4e2-aa2b648ed6ad' AND rubric_version IS DISTINCT FROM 2;
-- e06bedae: community probes the stated rocker/lower-repair quality (close-up + backside photos). cond -0.5; stance -0.5 (kept).
UPDATE public.auction_comments SET community_stance_score=-0.5, condition_polarity=-0.5, extracted_claims='[{"kind":"condition","polarity":-0.5,"assertion":"Requests close-up and backside photos of the repaired rocker and the lower repaired area behind the wheel to verify repair quality/extent","locations":["rocker","lower area behind wheel"],"challenges_claim":"seller-stated rocker/lower repairs done properly","corroborates_or_challenges":"challenges"}]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='e06bedae-2ce6-4397-bf36-93ead4d71834' AND rubric_version IS DISTINCT FROM 2;
-- e3da4480: "great survivor, worth more than this bid." cond +0.5; stance 0 (general praise/valuation, no specific seller-honesty engagement).
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0.5, extracted_claims='[{"kind":"condition","polarity":0.5,"assertion":"Describes the truck as a great survivor worth more than the current high bid","locations":["whole vehicle"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='e3da4480-3f98-48b3-b87a-38ef4d76886f' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='e786b6d6-6043-4b34-8130-1c4a2f3b3830' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='e8eaf045-c6df-457b-81b1-b0962018784e' AND rubric_version IS DISTINCT FROM 2;
UPDATE public.auction_comments SET community_stance_score=0, condition_polarity=0, extracted_claims='[]'::jsonb, rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now() WHERE id='ee6dfd0f-4c96-4bd6-9109-252c64cb03f1' AND rubric_version IS DISTINCT FROM 2;

COMMIT;
