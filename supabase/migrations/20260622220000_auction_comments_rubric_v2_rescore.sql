-- 20260622220000_auction_comments_rubric_v2_rescore.sql
-- RUBRIC v2 re-score of the 28 scored, non-bid auction_comments on the Blazer Chalet
-- vehicle e412ba6d-2bc8-430d-a35c-72bedd04fd8e (cohort subject 1977 Chevrolet K5 Blazer
-- 6fd682a8-72a8-49eb-a7b2-def080953835; reference K5 e08bf694-970f-4cbe-8a74-8715158a0f2e).
--
-- WHY v2: rubric v1 left the two axes collinear (r=0.656). v1 moved community_stance_score
-- on ANY negative condition observation (e.g. "undercarriage hosed in black paint",
-- "can you get close-ups of the rockers?") even when the comment never engaged the seller's
-- truthfulness. v2 DECOUPLES them:
--   AXIS 1 condition_polarity  — about the CAR (unchanged 5-bucket calibration).
--   AXIS 2 community_stance_score — about the SELLER'S HONESTY. Moves ONLY when the comment
--          ENGAGES the seller's truthfulness/claims: +1 corroborates a seller claim w/ evidence,
--          +0.5 mildly supports, 0 neutral/observation/off-topic/defect-with-no-seller-engagement,
--          -0.5 a pointed question probing a stated claim, -1 directly rebuts a stated claim w/ evidence.
--
-- FACTS SACRED: scores assigned from the literal captured comment text only; no fabrication.
-- Testimony-safe: this is a re-score of derived analytic columns (community_stance_score,
-- condition_polarity, extracted_claims, rubric_version, stance_model, stance_scored_at) on
-- auction_comments — NOT an edit to captured testimony fields (comment_text, author, posted_at,
-- bid_amount, comment_type all untouched). rubric_version=2 makes the re-score auditable; the
-- prior v1 scores are recoverable from git history of the v1 migration + this delta.
-- Idempotent: each UPDATE is keyed by comment id and is safe to re-run.
--
-- The 3 stance-forced-to-0 rows (defect or sub-topic but NO seller-claim engagement) vs v1
-- are called out inline with [STANCE→0 vs v1]: 1ea5c6a7 (generic rocker/quarter close-up request),
-- 7a577186 (undercarriage-paint observation, no claim engaged), aaea0386 ("no camper pics?").
-- Verified post-apply: 28 rows rubric_version=2, axis correlation 0.656(v1)→0.577(v2), 0 lock waiters.

BEGIN;

-- 003ba952 — defends seller against RussellC, mild support of seller's framing. cond 0.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.5,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '003ba952-3e10-4f98-a3b6-046b81333eb1';

-- 04505b2e — "Those seats!! Perfect." pure enthusiasm, no seller-claim engagement.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '04505b2e-7e46-41c7-9999-1c06a2744b2e';

-- 04b60499 — points another user to interior photo numbers. logistics, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '04b60499-7cb6-4fa9-887b-c4f578d58da2';

-- 0c033a8d — SELLER asserts "no rust or bubbles of any kind"; corroborates own rust-free claim. cond +0.5, stance +0.5.
UPDATE public.auction_comments SET
  condition_polarity = 0.5,
  community_stance_score = 0.5,
  extracted_claims = '[{"kind":"condition","polarity":0.5,"assertion":"No rust or bubbles of any kind anywhere on the Blazer","locations":["entire vehicle"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '0c033a8d-9263-4606-8f8f-940e66c8fa19';

-- 1ea5c6a7 — generic "can you get close-ups of quarters/rockers?" No reference to any seller claim. [STANCE→0 vs v1 (-0.5)].
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '1ea5c6a7-4b6a-4d10-8766-54e716d9ce13';

-- 31f94d58 — chatty aside about camping/bidding history. off-topic, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '31f94d58-73a4-4568-8e4b-4d80218f3e15';

-- 450fb140 — "Send me a message and let me know what it'll take." negotiation logistics, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '450fb140-9a91-4e1e-b039-6b11cba4353b';

-- 5151ce87 — SELLER: photo-upload error, will add to gallery. logistics, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '5151ce87-a450-4066-b794-35a34e8de77d';

-- 52463f39 — SELLER: re "rust" comments, areas of concern are photographed + 4K video. cond -0.5 (concedes rust areas exist), stance +0.5 (transparently corroborates by pointing to evidence).
UPDATE public.auction_comments SET
  condition_polarity = -0.5,
  community_stance_score = 0.5,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Areas of concern (rust) are clearly photographed toward the end of the photo gallery; a 4K walkaround/driving video is also provided","locations":["areas of concern"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '52463f39-dd6f-4eec-8026-338b7314364f';

-- 75f08bcd — "Do those bench seats fold down to make a bed?" feature question, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '75f08bcd-8ae4-461a-a798-6dd9b12f11d5';

-- 7a577186 — undercarriage thoroughly painted black; "makes me walk." A NEUTRAL condition observation
-- + general caution; does NOT reference or rebut a specific seller claim. cond -0.5, [STANCE→0 vs v1 (-0.5)].
UPDATE public.auction_comments SET
  condition_polarity = -0.5,
  community_stance_score = 0.0,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"The underside is thoroughly coated/hosed in black paint, which conceals condition and is not confidence-inspiring; warrants closer inspection","locations":["undercarriage","underside"],"challenges_claim":null,"corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '7a577186-fa83-46a3-ba7b-5267f8682398';

-- 84b6b25b — "Does it have any rust, bubbles, or rotted areas...? Looks good in your pictures."
-- A pointed question probing the implied rust-free condition the seller is presenting. stance -0.5.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = -0.5,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '84b6b25b-f5a7-4e2d-a79d-266130c15b88';

-- 9017ed5d — "Great seller... bought multiple vehicles from him, never disappointed." vouches for seller honesty WITH personal track-record evidence. cond 0, stance +1.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 1.0,
  extracted_claims = '[{"kind":"provenance","polarity":0.5,"assertion":"Has bought multiple vehicles from this seller and was never disappointed; vouches for the seller as great to deal with","locations":[],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '9017ed5d-b8c9-44d7-88f0-c8c19054c00e';

-- a78b2b4c — "Are you a dealer or private seller just reselling and what is the history?"
-- A pointed question probing the seller's stated identity/provenance. stance -0.5.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = -0.5,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'a78b2b4c-1e0b-44e6-bc03-0331644b44d9';

-- a8a3ae91 — directly rebuts seller's rust-free claim WITH evidence ("clearly see fiberglass/filler...
-- prove me wrong... left floor pan... rear main seal leak"). cond -1, stance -1.
UPDATE public.auction_comments SET
  condition_polarity = -1.0,
  community_stance_score = -1.0,
  extracted_claims = '[{"kind":"condition","polarity":-1,"assertion":"Left inner quarter panel behind the tire shows fiberglass/filler (concealed rust repair)","locations":["left inner quarter panel"],"challenges_claim":"It does not have rust / rust-free","corroborates_or_challenges":"challenges"},{"kind":"condition","polarity":-0.5,"assertion":"The Blazer had a pretty good rear main seal leak when inspected in person","locations":["rear main seal"],"challenges_claim":null,"corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'a8a3ae91-0a90-4be5-a9a8-0aa54131ea18';

-- aaea0386 — "No pictures inside the camper?" generic photo-gap question, no seller-claim engagement. [STANCE→0 vs v1 (-0.5)].
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'aaea0386-4a09-4b04-a3dd-b22e805a5ff3';

-- ccc56bd9 — SELLER: provenance narrative (WA -> OH, time to part ways). factual, neutral. no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'ccc56bd9-c55e-4a75-9c2a-051835ac4179';

-- d0b67b2e — "Wow, this rig is NICE!!! Should bring a good price." enthusiasm, no seller-claim engagement.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'd0b67b2e-2c23-466f-b5d2-3b4a84613b37';

-- d3ffb106 — RussellC: challenges the "original" framing with archived eBay ad evidence ("original" 19x;
-- this #1683 is a partial restoration). cond -0.5, stance -1 (rebuts a stated claim w/ evidence).
UPDATE public.auction_comments SET
  condition_polarity = -0.5,
  community_stance_score = -1.0,
  extracted_claims = '[{"kind":"provenance","polarity":-0.5,"assertion":"This Chalet #1683 is a partial restoration, not an unmolested original, contrary to a prior eBay ad that used the word original 19 times in the description","locations":[],"challenges_claim":"original (unmolested original) Blazer Chalet","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'd3ffb106-4b16-42ff-88cb-d98ab2856284';

-- e6c7d50a — "Looks nice... how big is the area above the cab?" feature question, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'e6c7d50a-e3ef-416f-a483-5611e7ad087d';

-- ec2166b8 — SELLER reply to RussellC: explicitly states "I/BAT never claimed unmolested original",
-- knew it was a partial restoration, concedes decals replaced. Corroborates the (revised, honest) claim
-- by disclosing the restoration. cond -0.5, stance +0.5.
UPDATE public.auction_comments SET
  condition_polarity = -0.5,
  community_stance_score = 0.5,
  extracted_claims = '[{"kind":"provenance","polarity":-0.5,"assertion":"Seller knew at purchase this Chalet was a partial restoration (professionally repainted to original Cordova brown/Santa Fe tan); the decals have been replaced and do not run down to the tail lights as a correct example would","locations":["decals","paint","tail lights"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'ec2166b8-4445-41ed-a1b3-ca5989f8c78c';

-- ecc35638 — SELLER: can help set up shipping; BAT disabled the quote tool. logistics, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'ecc35638-70c5-45c8-bce5-4459fbf0fcbb';

-- ef7c8c38 — inspector: directly rebuts seller's "rust free" with location-specific evidence
-- (right rocker, both quarters, LF floor pan hole, inner quarter filler, both inner fenders). cond -1, stance -1.
UPDATE public.auction_comments SET
  condition_polarity = -1.0,
  community_stance_score = -1.0,
  extracted_claims = '[{"kind":"condition","polarity":-1,"assertion":"Right rocker panel and both quarter panels have rust bubbles","locations":["right rocker panel","both quarter panels"],"challenges_claim":"it is rust free","corroborates_or_challenges":"challenges"},{"kind":"condition","polarity":-1,"assertion":"Left front floor pan has a rust hole","locations":["left front floor pan"],"challenges_claim":"it is rust free","corroborates_or_challenges":"challenges"},{"kind":"condition","polarity":-1,"assertion":"Left inner quarter panel behind the rear tire has been stuffed with fiberglass/filler","locations":["left inner quarter panel"],"challenges_claim":"it is rust free","corroborates_or_challenges":"challenges"},{"kind":"condition","polarity":-1,"assertion":"Both front inner fenders have rust holes","locations":["both front inner fenders"],"challenges_claim":"it is rust free","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'ef7c8c38-583b-40ba-9d0e-d13d41c865ed';

-- f0c5253b — "Looks like my Big Jim action figure... Awesome!" nostalgia, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'f0c5253b-9349-4cee-9d75-fb391e0dc04c';

-- f66fc36e — RussellC: probes whether the incorrect redone decals/stripes (redone 2009-10) were
-- disclosed; cites tell-tale giveaways. Engages "original" claim with evidence. cond -0.5, stance -0.5
-- (framed as a probing question to seller, less direct rebuttal than d3ffb106).
UPDATE public.auction_comments SET
  condition_polarity = -0.5,
  community_stance_score = -0.5,
  extracted_claims = '[{"kind":"spec","polarity":-0.5,"assertion":"The camper logo letters, camper stripes and back door decal were redone in 2009-10 and are incorrect: the white background behind the forward logo letters and the incomplete diagonal stripes (which should continue to the taillights) are tell-tale giveaways","locations":["forward camper side logo letters","back door decal","diagonal camper stripes"],"challenges_claim":"original","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'f66fc36e-2e39-4199-92a9-455a58f58c55';

-- f852a221 — "Blazer Chalet, the answer to a question nobody asked... still cool!" banter, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'f852a221-9955-42f3-8121-1e49046b8a41';

-- fb511318 — SELLER: "Bidding is now open!... happy bidding." announcement, no stance.
UPDATE public.auction_comments SET
  condition_polarity = 0.0,
  community_stance_score = 0.0,
  extracted_claims = '[]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'fb511318-8064-40f6-9074-de539b5f87da';

-- ff7ce30e — RussellC: closes the loop ("no harm, no foul" since seller knew), but rebuts the PRIOR
-- sellers' "original/survivor" assertions with evidence (cab seats, camper carpet, decals not original;
-- a 100k-mile odo discrepancy on his own #1747 proven by title). Engages truthfulness w/ evidence. cond -0.5, stance -0.5.
UPDATE public.auction_comments SET
  condition_polarity = -0.5,
  community_stance_score = -0.5,
  extracted_claims = '[{"kind":"provenance","polarity":-0.5,"assertion":"The cab seats, camper carpet, and decals are not original, despite prior sellers claims of original/survivor condition, which compromises top-end factory-showroom collector value","locations":["cab seats","camper carpet","decals"],"challenges_claim":"original / survivor condition","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'ff7ce30e-7404-4c6a-8d05-8568f1a2fb70';

COMMIT;
