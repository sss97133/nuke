-- 20260623020000_auction_comments_rubric_v2_rescore_k5.sql
-- RUBRIC v2 re-score of the K5 Blazer auction-comment intelligence for the
-- cohort subject listing (vehicle 2713522d-2541-44b8-b9b6-32255783df85,
-- a 1977 Chevrolet K5 Blazer BaT listing).
--
-- WHY v2: v1 had its two axes collinear (condition_polarity vs
-- community_stance_score at r=0.656) — condition leaked into stance. v2
-- DECOUPLES them:
--   AXIS 1 condition_polarity  — about the CAR (unchanged from v1 intent).
--   AXIS 2 community_stance_score — about the SELLER'S HONESTY. It moves ONLY
--          when the comment ENGAGES the seller's truthfulness / a stated claim.
--          A defect noted NEUTRALLY (no accusation, no reference to a seller
--          claim) is stance 0 even when condition is negative.
--
-- The decoupling forces two v1 non-zero stances to 0 (no seller-claim
-- engagement):
--   * 7dd11606 "Is the tach running or malfunctioning?" — neutral functionality
--     question, seller made no tach claim → stance -0.5 (v1) → 0 (v2).  [defect-flavored]
--   * 12488dde "You never see these preserved in this condition..." — condition
--     enthusiasm, engages no specific seller claim → stance +0.5 (v1) → 0 (v2).
-- And it upgrades one seller rebuttal that v1 left at 0:
--   * 7a3dcc15 seller substantiates the original-seat claim against a doubter
--     → stance 0 (v1) → +0.5 (v2).
--
-- FACTS SACRED: only real captured comment rows are touched; no fabrication.
-- Testimony-safe: this is a re-score of derived intelligence columns
-- (community_stance_score / condition_polarity / extracted_claims / scoring
-- metadata) on auction_comments, NOT an overwrite of the captured comment_text
-- or author or any source field. extracted_claims is preserved as authored in
-- v1 (rubric v2 leaves the claim structure unchanged); only the scalar axes and
-- the rubric_version / stance_model / stance_scored_at provenance advance.
-- Idempotent: each UPDATE is keyed by comment id and is safe to re-run; it only
-- advances rows still at rubric_version < 2.

-- AXIS 2 = community_stance_score (seller honesty), AXIS 1 = condition_polarity (car).
-- Each row carries stance_model='rubric-v2 BYOK', rubric_version=2, stance_scored_at=now().

-- 00ac903a  seat puckered, asks owner to explain — pointed Q probing the
--           original/excellent-interior claim.            stance -0.5 / cond -0.5
UPDATE public.auction_comments SET community_stance_score=-0.5, condition_polarity=-0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='00ac903a-d247-496e-8a5e-f172e3a67fa2' AND coalesce(rubric_version,0) < 2;

-- 0f815453  full VIN decode confirms 1977/K5/350 — corroborates with evidence.
--           stance +1 / cond +0.5
UPDATE public.auction_comments SET community_stance_score=1.0, condition_polarity=0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='0f815453-6b5b-4332-8879-170860d30000' AND coalesce(rubric_version,0) < 2;

-- 0fde1abb  wheel-choice compliment — enthusiasm, no claim engaged. stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='0fde1abb-1bba-4b21-861d-d17d84ff9e50' AND coalesce(rubric_version,0) < 2;

-- 12488dde  "never see these preserved like this" — condition enthusiasm, no
--           seller claim engaged. FORCED TO 0 (v1 +0.5). stance 0 / cond +0.5
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='12488dde-1481-4de3-b5c5-7654c55870ab' AND coalesce(rubric_version,0) < 2;

-- 19f7db5f  seller self-enthusiasm (huge Blazer guy / lowest mileage) — own
--           claim, not engaging another's. stance 0 / cond +0.5
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='19f7db5f-1a73-421a-917b-46dca95d0b7e' AND coalesce(rubric_version,0) < 2;

-- 1d0e2edc  "23000 Dollars???" — price reaction. stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='1d0e2edc-7a07-4079-ae4e-80a20d10e000' AND coalesce(rubric_version,0) < 2;

-- 2abf1755  amazing-survivor enthusiasm. stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='2abf1755-d9f2-4efc-8562-4be830432ba5' AND coalesce(rubric_version,0) < 2;

-- 3153cdd6  seller opening statement (self-claims). stance 0 / cond +0.5
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='3153cdd6-47d4-4d84-9a01-b81787bd9380' AND coalesce(rubric_version,0) < 2;

-- 3656cca2  owned an identical '77, yellow trim one-year-only — corroborates the
--           year claim with first-hand evidence. stance +1 / cond 0
UPDATE public.auction_comments SET community_stance_score=1.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='3656cca2-b42d-477a-b54e-667b5c89734f' AND coalesce(rubric_version,0) < 2;

-- 3e511870  1977 not 1976, 6th VIN digit=7 + yellow moldings — corroborates with
--           evidence. stance +1 / cond +0.5
UPDATE public.auction_comments SET community_stance_score=1.0, condition_polarity=0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='3e511870-be54-4e76-acbd-7c35741719df' AND coalesce(rubric_version,0) < 2;

-- 49d5e097  Exterior Decor Package per SPID sticker + GM doc link — corroborates
--           with evidence. stance +1 / cond +1
UPDATE public.auction_comments SET community_stance_score=1.0, condition_polarity=1.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='49d5e097-218d-49d4-8205-afb7dfe33740' AND coalesce(rubric_version,0) < 2;

-- 4c17ae81  manual + air cleaner dated 1977 corroborate the year (notes NP-203 as
--           a minor downside). stance +1 / cond +0.5
UPDATE public.auction_comments SET community_stance_score=1.0, condition_polarity=0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='4c17ae81-be34-404c-9197-c3cb8f3d2b70' AND coalesce(rubric_version,0) < 2;

-- 4c9e9e9b  "model year updated to 1977!" — mildly supports (confirms the
--           correction landed). stance +0.5 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.5, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='4c9e9e9b-0e4e-44ca-bb1d-374307abd304' AND coalesce(rubric_version,0) < 2;

-- 62ebf24a  "best survivor on earth / fall guy" enthusiasm. stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='62ebf24a-9644-424d-8b43-68ffe4495388' AND coalesce(rubric_version,0) < 2;

-- 7424bd4f  "never seen one with the hood painted white" — pointed doubt re the
--           factory Decor-Package claim. stance -0.5 / cond 0
UPDATE public.auction_comments SET community_stance_score=-0.5, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='7424bd4f-7be8-4b78-bd77-fc8955b9d89b' AND coalesce(rubric_version,0) < 2;

-- 74a77557  "Good luck mike" — off-topic. stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='74a77557-bd81-4382-9152-98191d0edc0f' AND coalesce(rubric_version,0) < 2;

-- 74ae7899  description says powered rear glass; photo shows manual crank handle —
--           directly rebuts a stated claim with evidence. stance -1 / cond -0.5
UPDATE public.auction_comments SET community_stance_score=-1.0, condition_polarity=-0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='74ae7899-1c39-44ae-b519-d951b4dc93e7' AND coalesce(rubric_version,0) < 2;

-- 77981dee  "Can you document the 13k miles?" — pointed Q probing the stated
--           mileage claim. stance -0.5 / cond 0
UPDATE public.auction_comments SET community_stance_score=-0.5, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='77981dee-49a9-4661-8034-ac075b1c4240' AND coalesce(rubric_version,0) < 2;

-- 7a3dcc15  seller substantiates the original-seat claim against @lambchop's doubt
--           — mildly supports own honesty. UPGRADE (v1 0). stance +0.5 / cond +0.5
UPDATE public.auction_comments SET community_stance_score=0.5, condition_polarity=0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='7a3dcc15-15cb-4861-aaed-04edabbd2fc2' AND coalesce(rubric_version,0) < 2;

-- 7dd11606  "Is the truck running in the tach pics or is it malfunctioning?" —
--           neutral functionality question; seller made no tach claim to probe.
--           FORCED TO 0 (v1 -0.5, defect-flavored). stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='7dd11606-1522-4ac2-b7bd-53fd19e56754' AND coalesce(rubric_version,0) < 2;

-- 8cce53da  AM-radio banter. stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='8cce53da-baaa-4ed0-8434-d613cccb1db2' AND coalesce(rubric_version,0) < 2;

-- 8e7051fc  "certain of the model year of every car I own. How does this happen?"
--           — jab probing the wrong-year listing/claim. stance -0.5 / cond 0
UPDATE public.auction_comments SET community_stance_score=-0.5, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='8e7051fc-1eac-4cb5-ba78-b9e74020a722' AND coalesce(rubric_version,0) < 2;

-- 9649d35a  seller: "three videos added" — logistics. stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='9649d35a-85d8-4de0-a7d2-349552c9a08b' AND coalesce(rubric_version,0) < 2;

-- 9708da25  "Damn nice. Wow." — enthusiasm. stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='9708da25-2190-4972-a3f0-03676ac2e649' AND coalesce(rubric_version,0) < 2;

-- a9482bc5  owned 4 K5s, "checks every single box" — endorses the seller's
--           framing; mildly vouches. stance +0.5 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.5, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='a9482bc5-76a1-4f19-b597-95d484c69d4d' AND coalesce(rubric_version,0) < 2;

-- a9a277a5  seller documents the 13k miles via prior title + service records + GA
--           inspection — corroborates own mileage claim with evidence. stance +1 / cond +1
UPDATE public.auction_comments SET community_stance_score=1.0, condition_polarity=1.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='a9a277a5-a90a-4636-9c35-5f8104dd262c' AND coalesce(rubric_version,0) < 2;

-- ab8f4ef5  "'77 was the only year for the gold/yellow trim" — corroborates the
--           year claim with evidence. stance +1 / cond +0.5
UPDATE public.auction_comments SET community_stance_score=1.0, condition_polarity=0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='ab8f4ef5-5a1f-4db4-ae35-6cce33fb5567' AND coalesce(rubric_version,0) < 2;

-- bcf458a3  "amazing original condition... expected a Rusty Jones pamphlet" —
--           endorses the rust-free/original framing with a specific observation
--           (undercarriage pic #157). Mildly vouches. stance +0.5 / cond +0.5
UPDATE public.auction_comments SET community_stance_score=0.5, condition_polarity=0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='bcf458a3-51bc-4e7d-8c6f-ceb297f7308e' AND coalesce(rubric_version,0) < 2;

-- bfe5f793  seller explains the tach reading (truck running ~1300 rpm, tach fine)
--           — substantiates against the malfunction question. Mildly supports.
--           stance +0.5 / cond +0.5
UPDATE public.auction_comments SET community_stance_score=0.5, condition_polarity=0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='bfe5f793-eea3-44bf-ba2e-e489dc5da593' AND coalesce(rubric_version,0) < 2;

-- cef973cd  "wish they still built them like this" — enthusiasm. stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='cef973cd-f34f-4629-8e67-3f239f334206' AND coalesce(rubric_version,0) < 2;

-- db392870  "makes the premium listings look lame" — enthusiasm. stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='db392870-3d87-4730-aefb-45235d73ea2f' AND coalesce(rubric_version,0) < 2;

-- de39ae5a  "funny to read the window sticker — everything was optional" — banter.
--           stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='de39ae5a-aa7f-481e-a9a1-869d796ba4a6' AND coalesce(rubric_version,0) < 2;

-- e7f26941  "Better than anything new!" — enthusiasm. stance 0 / cond 0
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.0,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='e7f26941-e205-403e-8f3c-04fafbed03ba' AND coalesce(rubric_version,0) < 2;

-- fab748ec  seller: original wheels included, amazing condition — own enthusiasm,
--           no challenge being answered. stance 0 / cond +0.5
UPDATE public.auction_comments SET community_stance_score=0.0, condition_polarity=0.5,
  rubric_version=2, stance_model='rubric-v2 BYOK', stance_scored_at=now()
WHERE id='fab748ec-e4ae-4bc5-b0f3-a2aa0d0c1c6a' AND coalesce(rubric_version,0) < 2;
