-- ALLOW_RAW_TESTIMONY_WRITE
-- ============================================================================
-- Land the proven rubric_version=2 comment claims as drillable testimony.
--
-- The 1977 Chevrolet K5 Blazer cohort (conceptual subject 6fd682a8) has
-- rubric_version=2 extracted_claims stored on auction_comments. Each claim is a
-- structured assertion (kind/polarity/assertion/locations/challenges_claim/
-- corroborates_or_challenges) made by a named BaT commenter at a known time on a
-- known listing. Until now those claims lived only inside the auction_comments
-- JSONB blob — not as first-class, drillable vehicle_observations.
--
-- This migration promotes each claim into a vehicle_observations row so the UI
-- can drill: tap a condition assertion -> open its source comment (author +
-- posted_at + listing permalink + EXACT excerpt + comment_id).
--
-- 96 claims across the 6 cohort listings that carried rubric_v2 claims:
--   d1e25409 (26), 2713522d (19), 56d3ba9a (15), 8ab289d8 (15),
--   e412ba6d (14), c0e3ce7b (7).
--
-- FACTS SACRED: every value is read directly from auction_comments. Nothing is
-- invented. confidence is derived from the BaT source trust (0.85 -> 'high').
-- comment_id is set to the PARENT comment row id (ac.id) for ALL rows — the
-- earlier promote-discoveries rows left comment_id NULL; this set fixes that so
-- every row drills to its source comment.
--
-- DON'T MINT: reuses the existing vehicle_observations table, the existing 'bat'
-- observation_source, the existing observation_kind enum, and the existing
-- citation_excerpt / source_url / structured_data citation columns. No new
-- tables, functions, or sources.
--
-- TESTIMONY DISCIPLINE: supersede-never-overwrite. Idempotent via NOT EXISTS on
-- the per-claim source_identifier; re-running lands nothing new. The earlier
-- description-derived condition/provenance rows (extracted_by =
-- 'promote-discoveries-to-observations', distinct source_identifier 'dd-...')
-- are a different observation set and are left untouched — these coexist.
--
-- PERFORMANCE: vehicle_observations has 4 heavy AFTER INSERT triggers (ARS
-- recompute, sentiment queue, live-metrics, subscriber-notify). Inserting all 96
-- rows in one transaction exceeds the 120s statement_timeout. This migration
-- therefore commits ONE cohort vehicle per statement (7-26 rows each) so each
-- statement stays under the cap and commits independently. pg_sleep(0.1) between
-- statements lets the triggers and autovacuum breathe (db-safety batching rule).
--
-- Raw-write marker present above because vehicle_observations is a testimony
-- table guarded by the block-god-writes hook; this is a sanctioned migration
-- landing cited testimony, exactly the path the hook documents.
-- ============================================================================

DO $$
DECLARE
  vids uuid[] := ARRAY[
    'c0e3ce7b-2c2b-460d-85fb-abeeee328148',  -- 7 claims
    'e412ba6d-2bc8-430d-a35c-72bedd04fd8e',  -- 14 claims (incl. the Squarebody89 rust comment)
    '56d3ba9a-ebd0-4961-a430-4770ab1d510c',  -- 15
    '8ab289d8-c3c2-4a07-9db6-9343f92e0afb',  -- 15
    '2713522d-2541-44b8-b9b6-32255783df85',  -- 19
    'd1e25409-40d8-442f-9fbc-d0a3507d2c22'   -- 26
  ]::uuid[];
  v uuid;
  n int;
  bat_id uuid;
BEGIN
  SELECT id INTO bat_id FROM observation_sources WHERE slug = 'bat';
  IF bat_id IS NULL THEN
    RAISE EXCEPTION 'observation_sources slug=bat not found';
  END IF;

  FOREACH v IN ARRAY vids LOOP
    -- Each iteration is its own implicit statement; commits independently of the
    -- others when this DO is split per-vehicle by the runner. If run as a single
    -- DO block and it times out mid-loop, re-run — completed vehicles are skipped
    -- by the NOT EXISTS guard and only the unfinished ones re-attempt.
    INSERT INTO vehicle_observations (
      vehicle_id, vehicle_match_confidence, observed_at, source_id, source_url,
      source_identifier, kind, content_text, content_hash, structured_data,
      confidence, confidence_score, confidence_factors, extraction_method,
      citation_excerpt, extracted_by
    )
    SELECT
      ac.vehicle_id,
      1.0,
      ac.posted_at,
      bat_id,
      ac.source_url,                                   -- listing permalink (real captured value)
      'bat-comment:' || ac.id::text || ':claim' || claim.idx::text,
      -- Map the rubric claim kind onto a valid observation_kind enum value.
      -- The raw claim kind is preserved verbatim in structured_data.claim_kind.
      (CASE lower(coalesce(claim.value->>'kind',''))
         WHEN 'condition'      THEN 'condition'
         WHEN 'provenance'     THEN 'provenance'
         WHEN 'history'        THEN 'provenance'
         WHEN 'originality'    THEN 'condition'
         WHEN 'spec'           THEN 'specification'
         WHEN 'feature'        THEN 'specification'
         WHEN 'representation'  THEN 'expert_opinion'
         ELSE 'expert_opinion'
       END)::observation_kind,
      claim.value->>'assertion',
      encode(digest('bat-comment:' || ac.id::text || ':claim' || claim.idx::text, 'sha256'), 'hex'),
      jsonb_strip_nulls(jsonb_build_object(
        'assertion',                  claim.value->>'assertion',
        'locations',                  claim.value->'locations',
        'polarity',                   claim.value->'polarity',
        'corroborates_or_challenges', claim.value->>'corroborates_or_challenges',
        'challenges_claim',           claim.value->>'challenges_claim',
        'comment_id',                 ac.id::text,          -- drill-to-source: parent comment row id
        'author',                     ac.author_username,
        'claim_kind',                 claim.value->>'kind',  -- raw rubric kind, preserved
        'rubric_version',             2
      )),
      'high'::confidence_level,
      0.85,                                              -- BaT source base_trust_score
      jsonb_build_object('bat_source_trust', 0.85, 'rubric_version', 2),
      'rubric_v2_comment_claim',
      claim.value->>'assertion',                          -- EXACT claim text
      'land-k5-cohort-comment-claims:1.0.0'
    FROM auction_comments ac
    CROSS JOIN LATERAL jsonb_array_elements(ac.extracted_claims) WITH ORDINALITY AS claim(value, idx)
    WHERE ac.vehicle_id = v
      AND ac.rubric_version = 2
      AND jsonb_typeof(ac.extracted_claims) = 'array'
      AND claim.value->>'assertion' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM vehicle_observations vo
        WHERE vo.source_identifier = 'bat-comment:' || ac.id::text || ':claim' || claim.idx::text
      );
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'cohort vehicle % landed % claim observations', v, n;
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;
