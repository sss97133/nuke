-- 20260623013601_auction_comments_rubric_v2_rescore_56d3ba9a.sql
-- RUBRIC v2 re-score of the 30 scored, non-bid auction_comments on the cohort
-- vehicle 56d3ba9a-ebd0-4961-a430-4770ab1d510c (a 1977-era Chevrolet K5 Blazer
-- "beauty curtains" BaT listing; cohort subject 1977 Chevrolet K5 Blazer
-- 6fd682a8-72a8-49eb-a7b2-def080953835; reference K5 e08bf694-970f-4cbe-8a74-8715158a0f2e).
--
-- Sibling of 20260622220000_auction_comments_rubric_v2_rescore.sql (which re-scored the
-- Blazer Chalet e412ba6d). Same rubric, different vehicle / different comment ids.
--
-- WHY v2: rubric v1 left the two axes collinear (r=0.656). v1 moved community_stance_score
-- on ANY negative condition observation or info question even when the comment never engaged
-- the seller's truthfulness. v2 DECOUPLES them:
--   AXIS 1 condition_polarity  — about the CAR (unchanged 5-bucket calibration).
--   AXIS 2 community_stance_score — about the SELLER'S HONESTY. Moves ONLY when the comment
--          ENGAGES the seller's truthfulness/claims: +1 corroborates a seller claim w/ evidence,
--          +0.5 mildly supports, 0 neutral/observation/off-topic/defect-with-no-seller-engagement,
--          -0.5 a pointed question probing a stated claim, -1 directly rebuts a stated claim w/ evidence.
--
-- FACTS SACRED: scores assigned from the literal captured comment text only; no fabrication.
-- Testimony-safe: this re-scores DERIVED analytic columns (community_stance_score,
-- condition_polarity, extracted_claims, rubric_version, stance_model, stance_scored_at) on
-- auction_comments — NOT an edit to captured testimony fields (comment_text, author, posted_at,
-- bid_amount, comment_type all untouched). rubric_version=2 makes the re-score auditable; the
-- prior v1 scores are recoverable from git history.
-- Idempotent: each UPDATE is keyed by comment id and is safe to re-run.
--
-- v2 forced community_stance_score -> 0 on exactly ONE defect comment that was non-zero in v1
-- (8af0df1d: "I see the rust spots now" — a neutral defect acknowledgment with no accusation,
-- v1 -0.5 -> v2 0). Marked inline [STANCE->0 vs v1]. Two info-question comments that v1 had
-- wrongly penalized as stance -0.5 (3a433216, 5ab80e35) are also corrected to 0 here.

BEGIN;

-- 34afc769 — "BaT would auction off just the curtains" — joke, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '34afc769-1287-4223-84d2-fe401d64c712';

-- 3a433216 — "Can you tell me if the AC works and blows cold?" neutral feature question,
-- not probing a stated claim. v1 stance -0.5 -> v2 0.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '3a433216-b808-4320-b746-0c6fe165f5b9';

-- 426697fc — explains Carfax only applies to 1981+ 17-char VINs. Factual clarification, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '426697fc-fc30-439d-b5bc-2b2be6b7811c';

-- 4a5e3a47 — "beauty curtains... sun fade... coffee and ashtray scent" — humor, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '4a5e3a47-98c4-4ada-a7dd-ea3e580b2a05';

-- 4cc079b7 — SELLER points to a minor flaw in photos 22 & 34. Transparent self-disclosure. cond -0.5, stance +0.5.
UPDATE public.auction_comments SET
  condition_polarity = -0.5,
  community_stance_score = 0.5,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Seller acknowledges a minor flaw visible in listing photos 22 and 34","locations":["photo 22","photo 34"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '4cc079b7-983e-4080-b25e-7f47267944e4';

-- 510e5fcd — "Any Carfax info... or true mileage?" pointed question probing the mileage/odometer claim. stance -0.5.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = -0.5,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '510e5fcd-c70d-4621-89b4-9176af9f6a27';

-- 5390afca — SELLER: Ziebart-treated when new + 16yrs follow-ups, all panels original incl floor pans,
-- only cosmetic paintwork wheel-wells/rocker, zero body filler, true survivor. Corroborates w/ detail. cond +1, stance +1.
UPDATE public.auction_comments SET
  condition_polarity = 1.0,
  community_stance_score = 1.0,
  extracted_claims = '[{"kind":"condition","polarity":1,"assertion":"Ziebart-treated when new with 16 years of follow-ups; all panels original including floor pans; only cosmetic paintwork between wheel wells and rocker; zero body filler; true survivor","locations":["undercarriage","floor pans","rockers","wheel wells"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '5390afca-acda-4c69-a39b-bf48cd3c7922';

-- 5ab80e35 — "Have you removed the top? please share pictures" info request, not probing a claim.
-- v1 stance -0.5 -> v2 0.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '5ab80e35-d803-418d-95d9-26c8fb98ef02';

-- 5d7b3f4c — "that interior is greasy. Love it." Neutral condition observation, affectionate, no seller-claim engagement. cond -0.5, stance 0 (already 0 in v1).
UPDATE public.auction_comments SET
  condition_polarity = -0.5,
  community_stance_score = 0.0,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Interior is greasy","locations":["interior"],"challenges_claim":null,"corroborates_or_challenges":"neutral"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '5d7b3f4c-ea7c-4e79-b442-c5ccd58225b5';

-- 5e71ef3b — "thank you for the information regarding lack of rust and body originality" mildly supports seller. cond +0.5, stance +0.5.
UPDATE public.auction_comments SET
  condition_polarity = 0.5,
  community_stance_score = 0.5,
  extracted_claims = '[{"kind":"condition","polarity":0.5,"assertion":"Commenter accepts seller information on lack of rust and body originality","locations":["body"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '5e71ef3b-3e0f-4294-99fb-89e06fdffcd7';

-- 63dd18fb — "would like to know if rust repair done... checked floors under carpet... PA worst for salt...
-- these blazers dont last long in PA" pointed question probing the rust-free/solid-body claim. cond -0.5, stance -0.5.
UPDATE public.auction_comments SET
  condition_polarity = -0.5,
  community_stance_score = -0.5,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Asks whether rust repair has been done and whether floors under the carpet were checked; notes PA road salt destroys these Blazers","locations":["floors","underbody"],"challenges_claim":"rust-free / solid body","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '63dd18fb-fabd-4e74-a4a2-34181457d603';

-- 6800771f — SELLER: top never removed, original owner kept it 40+ years, no-reserve. Mild positive provenance. cond +0.5, stance +0.5.
UPDATE public.auction_comments SET
  condition_polarity = 0.5,
  community_stance_score = 0.5,
  extracted_claims = '[{"kind":"provenance","polarity":0.5,"assertion":"Top never removed; original owner kept it on for 40+ years of ownership; no-reserve auction","locations":["top"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '6800771f-807c-48fe-9203-9dd5ab06c5c4';

-- 6a4229b8 — "Cool Blazer! What area of Pittsburgh?" off-topic location, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '6a4229b8-d8dd-405d-b2d6-2d599a6cb95c';

-- 6d4d6bf6 — SELLER: "Yes the AC works and is ice cold!" positive claim answering a buyer question. cond +0.5, stance +0.5.
UPDATE public.auction_comments SET
  condition_polarity = 0.5,
  community_stance_score = 0.5,
  extracted_claims = '[{"kind":"condition","polarity":0.5,"assertion":"AC works and is ice cold","locations":["AC"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '6d4d6bf6-bae2-45e9-9f83-d20bdf11e94a';

-- 7a7bbfe6 — "Please post photos of the door frame rust" pointed question probing the rust-free claim. cond -0.5, stance -0.5.
UPDATE public.auction_comments SET
  condition_polarity = -0.5,
  community_stance_score = -0.5,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Requests photos of door frame rust","locations":["door frame"],"challenges_claim":"rust-free / solid body","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '7a7bbfe6-2b57-4645-87ac-8ddada765c1b';

-- 7b5464dc — SELLER: clean PA title (actual miles, not exempt) + signed odometer disclosure from original owner;
-- corroborates the mileage/title claim WITH documentary evidence. cond +0.5, stance +1.
UPDATE public.auction_comments SET
  condition_polarity = 0.5,
  community_stance_score = 1.0,
  extracted_claims = '[{"kind":"provenance","polarity":0.5,"assertion":"Clean PA title states actual miles (not exempt), with a signed odometer disclosure from the original owner; Carfax does not apply to pre-17-digit VINs","locations":["title","odometer disclosure"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '7b5464dc-fc37-4863-8213-440f0b520b9e';

-- 8af0df1d — "Thank you. I see the rust spots now." Neutral defect acknowledgment AFTER the seller disclosed
-- them; no accusation, no rebuttal. [STANCE->0 vs v1 (-0.5)]. cond -0.5, stance 0.
UPDATE public.auction_comments SET
  condition_polarity = -0.5,
  community_stance_score = 0.0,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Confirms rust spots are visible after seller pointed them out","locations":[],"challenges_claim":null,"corroborates_or_challenges":"neutral"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '8af0df1d-a2ed-4c77-9d3e-6ebbd4d2cf8a';

-- 98de8e08 — "leave the truck, take the curtains" joke summary, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '98de8e08-1789-428b-ac63-cf4466f5061a';

-- 9ba85f33 — "lamb chops and nut huggin jeans" banter, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '9ba85f33-3b43-456f-81fb-df0758e9e3ce';

-- affc1e1b — "window treatments capture the 70's vibe... Nice Blazer. GLWTA." nostalgia/enthusiasm, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'affc1e1b-f70c-4c66-9185-499a484c52c6';

-- b1d34596 — SELLER: located in Blawnox; "runs and drives great!" positive condition claim. cond +0.5, stance +0.5.
UPDATE public.auction_comments SET
  condition_polarity = 0.5,
  community_stance_score = 0.5,
  extracted_claims = '[{"kind":"condition","polarity":0.5,"assertion":"Runs and drives great; located in Blawnox","locations":["drivetrain"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'b1d34596-3852-4008-92cc-f5c21d2b8570';

-- b4eaffb6 — "Thank you for the interior video. Looks nice and much different than the listing pictures."
-- Mildly engages the listing's photo accuracy (video differs from photos). cond 0, stance -0.5.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = -0.5,
  extracted_claims = '[{"kind":"representation","polarity":0,"assertion":"Interior video looks nice and much different than the listing pictures","locations":["interior"],"challenges_claim":"listing photos accurately represent the vehicle","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'b4eaffb6-d68e-4169-855f-f5451abdca39';

-- bbb67569 — "I always like to see the ZY5 exterior decor option, those hood stripes look great." enthusiast praise, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'bbb67569-839a-4bf7-b1cc-b3774cfd2119';

-- bcd07077 — SELLER: all photos 100% original/unedited, camera exaggerates orange, video is a truer color rep.
-- Defends/corroborates the listing's photo-accuracy. cond 0, stance +0.5.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.5,
  extracted_claims = '[{"kind":"representation","polarity":0,"assertion":"All listing photos are 100 percent original and unedited; camera exaggerates orange, interior video is a better color representation","locations":["interior"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'bcd07077-8613-474f-a0d5-0ecda9778636';

-- bd37e450 — "Oh, behave!! - Austin powers" joke, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'bd37e450-eaab-433f-a64d-d3ecbb9c3610';

-- bd38fe63 — "is the carpet orange?... Is this how it shows in person?" pointed question probing the listing's
-- color representation. cond 0, stance -0.5.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = -0.5,
  extracted_claims = '[{"kind":"representation","polarity":0,"assertion":"Questions whether the carpet/interior is truly orange as the photos show or shows differently in person","locations":["interior","carpet"],"challenges_claim":"listing photos accurately represent interior color","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'bd38fe63-b55b-4e53-9c8f-017195d1df67';

-- be9ef281 — "curtains alone worth 10 grand... my dad had a suburban..." nostalgia, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'be9ef281-9873-4bf8-ba99-2995a75ba4fd';

-- d6c9ce35 — "have the rocker panels been replaced and repainted?... other rust repairs?... checked front floors
-- for rust under carpet?" pointed questions probing the rust-free/all-original-panels claim. cond -0.5, stance -0.5.
UPDATE public.auction_comments SET
  condition_polarity = -0.5,
  community_stance_score = -0.5,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Asks whether rocker panels were replaced and repainted, whether other rust repairs were made, and whether front floors were checked for rust under the carpet","locations":["rockers","floors","underbody"],"challenges_claim":"rust-free / solid body / all-original panels","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'd6c9ce35-7438-4e7f-8900-6655b7d28caa';

-- ea7cf7ea — "Those curtains are worth 13 grand" joke/enthusiasm, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'ea7cf7ea-ca9d-499d-8ce1-45ec88179b7e';

-- eaf13b3d — "Quick story... four wheelin and got caught... Good luck with sale!" anecdote, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'eaf13b3d-847f-4f12-920c-3e521976af39';

COMMIT;
