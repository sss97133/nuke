-- ============================================
-- AGGREGATE AUTHOR PERSONAS
-- Rolls up comment_persona_signals into author_personas
-- ============================================

CREATE OR REPLACE FUNCTION aggregate_author_personas()
RETURNS void AS $$
  INSERT INTO author_personas (
    username, platform,
    primary_persona, avg_tone_helpful, avg_tone_technical,
    avg_tone_friendly, avg_tone_confident, avg_tone_snarky,
    expertise_level, total_comments,
    comments_with_questions, comments_with_answers,
    comments_with_advice, comments_supportive, comments_critical,
    avg_comment_length, first_seen, last_seen, updated_at
  )
  SELECT
    author_username, platform,
    -- primary_persona: pick from intent + expertise combo
    CASE
      WHEN AVG(tone_technical) > 0.6 AND mode() WITHIN GROUP (ORDER BY expertise_level) IN ('expert','professional')
        THEN 'helpful_expert'
      WHEN mode() WITHIN GROUP (ORDER BY intent) = 'buying' AND bool_or(is_serious_buyer)
        THEN 'serious_buyer'
      WHEN mode() WITHIN GROUP (ORDER BY intent) = 'critiquing' OR AVG(tone_snarky) > 0.5
        THEN 'critic'
      WHEN mode() WITHIN GROUP (ORDER BY intent) IN ('selling','advising')
        THEN 'dealer'
      ELSE 'casual_enthusiast'
    END,
    AVG(tone_helpful), AVG(tone_technical),
    AVG(tone_friendly), AVG(tone_confident), AVG(tone_snarky),
    mode() WITHIN GROUP (ORDER BY expertise_level),
    COUNT(*),
    COUNT(*) FILTER (WHERE asks_questions), COUNT(*) FILTER (WHERE answers_questions),
    COUNT(*) FILTER (WHERE gives_advice), COUNT(*) FILTER (WHERE supports_others),
    COUNT(*) FILTER (WHERE critiques_others),
    AVG(comment_length)::INT,
    MIN(extracted_at), MAX(extracted_at), now()
  FROM comment_persona_signals
  GROUP BY author_username, platform
  ON CONFLICT (username, platform) DO UPDATE SET
    primary_persona = EXCLUDED.primary_persona,
    avg_tone_helpful = EXCLUDED.avg_tone_helpful,
    avg_tone_technical = EXCLUDED.avg_tone_technical,
    avg_tone_friendly = EXCLUDED.avg_tone_friendly,
    avg_tone_confident = EXCLUDED.avg_tone_confident,
    avg_tone_snarky = EXCLUDED.avg_tone_snarky,
    expertise_level = EXCLUDED.expertise_level,
    total_comments = EXCLUDED.total_comments,
    comments_with_questions = EXCLUDED.comments_with_questions,
    comments_with_answers = EXCLUDED.comments_with_answers,
    comments_with_advice = EXCLUDED.comments_with_advice,
    comments_supportive = EXCLUDED.comments_supportive,
    comments_critical = EXCLUDED.comments_critical,
    avg_comment_length = EXCLUDED.avg_comment_length,
    last_seen = EXCLUDED.last_seen,
    updated_at = now();
$$ LANGUAGE sql;

-- Run it once to populate from existing 951 signals
SELECT aggregate_author_personas();
