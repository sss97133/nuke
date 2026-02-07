#!/bin/bash
# Quick progress check for all analysis pipelines
cd /Users/skylar/nuke
eval "$(dotenvx run -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' 2>/dev/null)"

echo "=== NUKE ANALYTICS PROGRESS ==="
echo "$(date)"
echo ""

PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "
SELECT
  'Comment Discoveries' as pipeline, count(*)::text as count,
  round(count(*)::numeric / 128000 * 100, 1)::text || '%' as pct
FROM comment_discoveries
UNION ALL
SELECT 'Vehicle Sentiment', count(*)::text,
  round(count(*)::numeric / 128000 * 100, 1)::text || '%'
FROM vehicle_sentiment
UNION ALL
SELECT 'Condition Assessments', count(*)::text,
  round(count(*)::numeric / 130000 * 100, 1)::text || '%'
FROM vehicle_condition_assessments
UNION ALL
SELECT 'Component Conditions', count(*)::text, ''
FROM component_conditions
UNION ALL
SELECT 'Paint Assessments', count(*)::text, ''
FROM paint_quality_assessments
UNION ALL
SELECT 'Market Trends', count(*)::text, ''
FROM market_trends
UNION ALL
SELECT 'Vehicles Normalized (model)', count(*)::text,
  round(count(*)::numeric / 293000 * 100, 1)::text || '%'
FROM vehicles WHERE normalized_model IS NOT NULL AND deleted_at IS NULL
UNION ALL
SELECT 'Quality Scores', count(*)::text, ''
FROM vehicle_quality_scores;
" 2>/dev/null

echo ""
echo "--- Sentiment Breakdown ---"
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "
SELECT overall_sentiment, count(*)
FROM vehicle_sentiment
GROUP BY overall_sentiment
ORDER BY count(*) DESC
LIMIT 10;
" 2>/dev/null

echo ""
echo "--- Top Makes by Sentiment (from market_trends) ---"
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "
SELECT make, analysis_count, avg_sentiment_score, demand_high_pct::text || '%' as high_demand
FROM market_trends
WHERE model IS NULL AND period_start >= '2026-02-01'
ORDER BY analysis_count DESC
LIMIT 15;
" 2>/dev/null
