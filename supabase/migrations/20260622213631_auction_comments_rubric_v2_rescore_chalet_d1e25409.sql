-- 20260622213631_auction_comments_rubric_v2_rescore_chalet_d1e25409.sql
-- RUBRIC v2 re-score of the scored, non-bid auction_comments on the Blazer Chalet
-- vehicle d1e25409-40d8-442f-9fbc-d0a3507d2c22 (a 1977 Chevrolet K5 Blazer Chalet
-- BaT listing by garagekeptmotors; cohort subject 1977 Chevrolet K5 Blazer
-- 6fd682a8-72a8-49eb-a7b2-def080953835; reference K5 e08bf694-970f-4cbe-8a74-8715158a0f2e).
--
-- WHY v2: rubric v1 left the two axes collinear (r=0.656). v1 moved
-- community_stance_score on ANY negative condition observation even when the comment
-- never engaged the seller's truthfulness (e.g. a neutral "why is the steering wheel
-- 90 degrees off?" or a scholarly seat-correctness note). v2 DECOUPLES them:
--   AXIS 1 condition_polarity  — about the CAR (unchanged 5-bucket calibration; carried
--          forward from v1, which used identical AXIS 1 wording).
--   AXIS 2 community_stance_score — about the SELLER'S HONESTY. Moves ONLY when the comment
--          ENGAGES the seller's truthfulness/claims: +1 corroborates a seller claim w/ evidence,
--          +0.5 mildly supports, 0 neutral/observation/off-topic/defect-with-no-seller-engagement,
--          -0.5 a pointed question probing a stated claim, -1 directly rebuts a stated claim w/ evidence.
--
-- FACTS SACRED: scores assigned from the literal captured comment text only; no fabrication.
-- Testimony-safe: this re-scores derived analytic columns (community_stance_score,
-- condition_polarity, extracted_claims, rubric_version, stance_model, stance_scored_at) on
-- auction_comments — NOT an edit to captured testimony fields (comment_text, author, posted_at,
-- bid_amount, comment_type are untouched). rubric_version=2 makes the re-score auditable; prior
-- v1 scores are recoverable from git history. Idempotent: each UPDATE is keyed by comment id and
-- is safe to re-run; the trailing sweep only advances rows still at rubric_version < 2.
--
-- The 8 stance-forced-to-0 rows (a defect/sub-topic observation with NO seller-claim engagement)
-- vs v1 are called out inline with [STANCE->0 vs v1]. One positive force-to-0 (pure car praise,
-- not honesty engagement) is marked [STANCE->0 vs v1 (praise)].

BEGIN;

-- ============================================================================
-- AXIS 2 kept at -1: direct rebuttals of a stated seller honesty claim, w/ evidence
-- ============================================================================

-- 5f7ce0bb — rust photos of the prior chalet were NOT among the March 150 photos.
UPDATE public.auction_comments SET
  community_stance_score = -1.0, condition_polarity = -0.5,
  extracted_claims = '[{"kind":"history","polarity":-0.5,"assertion":"Rust photos of the prior chalet the seller sold were not among the 150 photos of the March auction","locations":[],"challenges_claim":"we did not hide anything / 150 photos top to bottom","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '5f7ce0bb-d6b0-42a4-9b55-4e78822364f2';

-- 95616176 — rebuts seat-originality, asks seller/Derrow family to prove as-delivered config.
UPDATE public.auction_comments SET
  community_stance_score = -1.0, condition_polarity = -0.5,
  extracted_claims = '[{"kind":"originality","polarity":-0.5,"assertion":"1977 Chalets came with low-back orange plaid cab seats; this one has incorrect 76 vinyl seats unless original-delivery photos prove otherwise; asks Derrow family / seller to substantiate as-delivered config","locations":["cab seats"],"challenges_claim":"all original / seats as represented","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '95616176-af10-4872-b5d8-914e562e0f71';

-- ca4aba6e — received photos of hidden rust on seller's other auction; doubts this one too.
UPDATE public.auction_comments SET
  community_stance_score = -1.0, condition_polarity = -1.0,
  extracted_claims = '[{"kind":"history","polarity":-1,"assertion":"Received photos of rusty spots from the winner of the seller other auction showing something was hidden; questions whether equally expensive defects are hidden here","locations":["floor","frame"],"challenges_claim":"nothing to hide","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'ca4aba6e-3421-489b-8d10-4527b746bf16';

-- ============================================================================
-- AXIS 2 kept at -0.5: pointed questions probing a stated seller claim
-- ============================================================================

-- 1c103da1 — probes "solid / all original" framing: rust under floor panels, restoration extent.
UPDATE public.auction_comments SET
  community_stance_score = -0.5, condition_polarity = -0.5,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Asks about condition under the floor panels/carpet (driver and passenger), problematic rust spots beyond superficial, and whether/when/to-what-extent it was restored","locations":["floor panels","carpet"],"challenges_claim":"solid / all original","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '1c103da1-37ae-440b-af20-802126c6fb7d';

-- faf29b48 — probes the restoration-disclosure gap (asks Derrow family what year restoration was).
UPDATE public.auction_comments SET
  community_stance_score = -0.5, condition_polarity = 0.5,
  extracted_claims = '[{"kind":"history","polarity":0.5,"assertion":"Chalet #1221 built 9/76; the recent repaint of camper stripes corrected a prior repaint over original factory vinyl stripes; asks a Derrow family member what year the overall restoration was done (not stated in description)","locations":["camper stripes","paint"],"challenges_claim":"restoration extent disclosed","corroborates_or_challenges":"challenges"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'faf29b48-b860-4cf4-9024-1638d74f5bb7';

-- ============================================================================
-- AXIS 2 FORCED TO 0 vs v1: defect/sub-topic observation, NO seller-claim engagement
-- ============================================================================

-- 0436e5d0 [STANCE->0 vs v1] — expert seat-correctness note, no honesty engagement. cond -0.5.
UPDATE public.auction_comments SET
  community_stance_score = 0.0, condition_polarity = -0.5,
  extracted_claims = '[{"kind":"originality","polarity":-0.5,"assertion":"Has incorrect 76 model-year vinyl seats; 77 Chalets came with orange plaid cloth seats; a cloth reupholstery on the dinette seats would hurt factory-original collector value","locations":["cab seats","dinette seats"],"challenges_claim":null,"corroborates_or_challenges":"neutral"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '0436e5d0-67b7-4fe3-81c7-8a90476905c6';

-- 3d850b38 [STANCE->0 vs v1] — mild "thought 77 had high-back buckets" observation. cond 0.
UPDATE public.auction_comments SET
  community_stance_score = 0.0, condition_polarity = 0.0,
  extracted_claims = '[{"kind":"originality","polarity":0,"assertion":"Thought that 1977 had the high-back bucket seats","locations":["cab seats"],"challenges_claim":null,"corroborates_or_challenges":"neutral"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '3d850b38-0e80-465d-99c8-6408b5e6cbdb';

-- 45aa55d6 [STANCE->0 vs v1] — RPO-tag / window-sticker scholarship, no honesty engagement. cond 0.
UPDATE public.auction_comments SET
  community_stance_score = 0.0, condition_polarity = 0.0,
  extracted_claims = '[{"kind":"originality","polarity":0,"assertion":"RPO tags for 77 Chalets typically list cab seats as 164H/164W KUU2 BUCKSKIN CUSTOM; window sticker spell-outs differ from RPO tags; welcomes correction","locations":["cab seats"],"challenges_claim":null,"corroborates_or_challenges":"neutral"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '45aa55d6-88e4-46d5-94b7-cbd820c2185d';

-- 7ac880c4 [STANCE->0 vs v1] — neutral steering-wheel oddity observation. cond -0.5.
UPDATE public.auction_comments SET
  community_stance_score = 0.0, condition_polarity = -0.5,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Steering wheel appears 90 degrees off in the driving video; guesses it was centered that way to see the speedometer","locations":["steering wheel"],"challenges_claim":null,"corroborates_or_challenges":"neutral"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '7ac880c4-fd3f-454c-b9cf-0c9f2908a004';

-- 7dc957d3 [STANCE->0 vs v1] — neutral condition questions (crooked wheel, smells), no stated claim. cond -0.5.
UPDATE public.auction_comments SET
  community_stance_score = 0.0, condition_polarity = -0.5,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Asks why the steering wheel is 90 degrees crooked and whether there are cigarette, mold, or moisture smells inside","locations":["steering wheel","interior"],"challenges_claim":null,"corroborates_or_challenges":"neutral"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '7dc957d3-7910-4fb5-8836-e8a461d21fb3';

-- bcb40447 [STANCE->0 vs v1] — neutral question about the 90-degree wheel oddity. cond -0.5.
UPDATE public.auction_comments SET
  community_stance_score = 0.0, condition_polarity = -0.5,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Asks what the 90-degree out-of-position steering wheel is attributed to","locations":["steering wheel"],"challenges_claim":null,"corroborates_or_challenges":"neutral"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'bcb40447-2eec-4888-8e89-b45bd469b0b0';

-- ef07c251 [STANCE->0 vs v1] — promo-film seat scholarship, muddies the discussion, no honesty engagement. cond 0.
UPDATE public.auction_comments SET
  community_stance_score = 0.0, condition_polarity = 0.0,
  extracted_claims = '[{"kind":"originality","polarity":0,"assertion":"A 77 GM promo film shows a 77 rig with 76-style plaid dinette seats and 76 woodgrain panels; assumes a pre-production prototype; muddies the seats discussion","locations":["dinette seats","camper interior"],"challenges_claim":null,"corroborates_or_challenges":"neutral"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'ef07c251-a33f-4d50-a4b4-3fba7d36f599';

-- f2e49eb6 [STANCE->0 vs v1] — bushing defect noted neutrally, no accusation/no stated-claim rebuttal. cond -0.5.
UPDATE public.auction_comments SET
  community_stance_score = 0.0, condition_polarity = -0.5,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Front right spring bushing nut and bolt (photo 149) should be tightened before someone drives it home; some other areas of concern; otherwise nice rig","locations":["front right spring bushing","suspension"],"challenges_claim":null,"corroborates_or_challenges":"neutral"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'f2e49eb6-e494-483b-b9ad-67270385cdb4';

-- f622e664 [STANCE->0 vs v1 (praise)] — "nicest Chalet I've ever seen" = car praise, not honesty engagement. cond +0.5.
UPDATE public.auction_comments SET
  community_stance_score = 0.0, condition_polarity = 0.5,
  extracted_claims = '[{"kind":"condition","polarity":0.5,"assertion":"Hands down the nicest Chalet the commenter has ever seen","locations":[],"challenges_claim":null,"corroborates_or_challenges":"neutral"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'f622e664-fd68-4db5-bbc4-168a16f1220d';

-- ============================================================================
-- AXIS 2 kept at +0.5: mild support / seller engaging on a claim
-- ============================================================================

-- 06e24c33 — seller defends own honesty (150 photos, nothing to hide).
UPDATE public.auction_comments SET
  community_stance_score = 0.5, condition_polarity = 0.0,
  extracted_claims = '[{"kind":"history","polarity":0,"assertion":"Seller states the prior listing had over 150 photos top to bottom and nothing was hidden; nothing to hide on this one either","locations":[],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '06e24c33-4a43-4447-bdf0-c0b33cb430a0';

-- 3fdd3408 — relays/supports the seller's PO-preference explanation for the wheel.
UPDATE public.auction_comments SET
  community_stance_score = 0.5, condition_polarity = 0.0,
  extracted_claims = '[{"kind":"condition","polarity":0,"assertion":"Seller previously said the previous owner set the steering wheel that way as a personal preference","locations":["steering wheel"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '3fdd3408-39a8-423e-918a-d566def2b34b';

-- 9882e501 — provenance corroboration: sat in THIS rig as a kid at the Ohio dealer.
UPDATE public.auction_comments SET
  community_stance_score = 0.5, condition_polarity = 0.0,
  extracted_claims = '[{"kind":"history","polarity":0.5,"assertion":"Commenter sat in this exact rig as a child at the Defiance, Ohio dealership when it arrived new","locations":[],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '9882e501-0b70-4d69-a06b-3b6586750bd3';

-- a5877e4d — seller responsive: posting photo, can ship, bushing now tightened.
UPDATE public.auction_comments SET
  community_stance_score = 0.5, condition_polarity = 0.0,
  extracted_claims = '[{"kind":"condition","polarity":0,"assertion":"Seller is posting a photo, can help with shipping, and states the item (spring bushing) is now tightened","locations":["front right spring bushing"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'a5877e4d-3b11-41f9-89c2-df671f7bc4ac';

-- a7b8f40c — supports the seller's feature set (benches fold to bed + cot, like a Westfalia).
UPDATE public.auction_comments SET
  community_stance_score = 0.5, condition_polarity = 0.0,
  extracted_claims = '[{"kind":"feature","polarity":0,"assertion":"The benches fold down to a bed and a cot folds out up top, similar to a VW Westfalia setup","locations":["camper interior"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'a7b8f40c-44eb-443c-8bc7-7bf1639d1f95';

-- bc033317 — cites photo #162 (option 64W XUU2 BUCKSKIN CUST VINYL BUCKET) supporting seat config. cond +0.5.
UPDATE public.auction_comments SET
  community_stance_score = 0.5, condition_polarity = 0.5,
  extracted_claims = '[{"kind":"originality","polarity":0.5,"assertion":"Picture #162 shows option 64W XUU2 BUCKSKIN CUST VINYL BUCKET","locations":["cab seats","window sticker"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'bc033317-85bd-4234-bf75-80b500207751';

-- cbb7cfdc — benign explanation supporting seller (alignment shop didn't straighten the wheel).
UPDATE public.auction_comments SET
  community_stance_score = 0.5, condition_polarity = 0.0,
  extracted_claims = '[{"kind":"condition","polarity":0,"assertion":"Assumes they had it aligned and the alignment shop did not straighten the steering wheel","locations":["steering wheel"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'cbb7cfdc-4c02-4b43-b49e-b3244afd4fbd';

-- f8cc55a9 — seller answering a buyer question (mild support).
UPDATE public.auction_comments SET
  community_stance_score = 0.5, condition_polarity = 0.0,
  extracted_claims = '[{"kind":"feature","polarity":0,"assertion":"Seller confirms yes it does (in answer to a buyer question)","locations":[],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'f8cc55a9-b1a1-4edf-bf17-62480dfcfa92';

-- ============================================================================
-- AXIS 2 kept at +1: corroborates a seller claim WITH evidence
-- ============================================================================

-- 18b5c500 — seller substantiates condition: more solid, floors clean, "rust" was paint flaking, recently repainted else original.
UPDATE public.auction_comments SET
  community_stance_score = 1.0, condition_polarity = 0.5,
  extracted_claims = '[{"kind":"condition","polarity":0.5,"assertion":"This one is more solid than the previous; nothing to report on the floor panels; the rust the prior winner spoke of was paint flaking off, expected on a vehicle this old; recently repainted, otherwise all original","locations":["floor panels","paint"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '18b5c500-ae68-4765-ab40-597db9bde7e7';

-- 9a5ef636 — seller substantiates: no smells, non-smoker, climate-controlled, wheel = PO preference.
UPDATE public.auction_comments SET
  community_stance_score = 1.0, condition_polarity = 0.5,
  extracted_claims = '[{"kind":"condition","polarity":0.5,"assertion":"No odd smells inside; non-smoker; always stored in a climate-controlled garage; clean and dry; off-center steering wheel was the previous owner preference","locations":["interior","steering wheel"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = '9a5ef636-222b-43d4-87ef-d92dc1b2467b';

-- cccafed2 — firsthand corroboration of seat-correctness (father was Chevy district sales manager).
UPDATE public.auction_comments SET
  community_stance_score = 1.0, condition_polarity = 0.5,
  extracted_claims = '[{"kind":"originality","polarity":0.5,"assertion":"The seats are correct; commenter father was Chevrolet district sales manager in Boise when these were new; plaid cloth was reserved for optional high-back buckets available later in the year; low-back was the standard seat","locations":["cab seats"],"challenges_claim":null,"corroborates_or_challenges":"corroborates"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'cccafed2-ad11-400e-9bf5-9179d14ab30a';

-- ============================================================================
-- AXIS 2 stays 0, but carries a defect observation with no seller engagement:
-- preserve condition, attach claim.
-- ============================================================================

-- c8ee0633 — ashtray-door paint chips, asks what causes it. Neutral curiosity. stance 0 (unchanged). cond -0.5.
UPDATE public.auction_comments SET
  community_stance_score = 0.0, condition_polarity = -0.5,
  extracted_claims = '[{"kind":"condition","polarity":-0.5,"assertion":"Notes chips and scratches on the dashboard ashtray door paint and asks what causes the damage","locations":["dashboard ashtray door"],"challenges_claim":null,"corroborates_or_challenges":"neutral"}]'::jsonb,
  rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE id = 'c8ee0633-720c-4ac4-9f3c-e1a966c10f91';

-- ============================================================================
-- Sweep: remaining scored comments (neutral / enthusiasm / off-topic / bidding-strategy)
-- keep their v1 stance + condition; advance rubric provenance to v2 so the whole set is consistent.
-- ============================================================================
UPDATE public.auction_comments
SET rubric_version = 2, stance_model = 'rubric-v2 BYOK', stance_scored_at = now()
WHERE vehicle_id = 'd1e25409-40d8-442f-9fbc-d0a3507d2c22'
  AND comment_text IS NOT NULL
  AND sentiment_score IS NOT NULL
  AND comment_type <> 'bid'
  AND bid_amount IS NULL
  AND rubric_version < 2;

COMMIT;
