-- best_w_outcome 1 -> 2 (owner-lead decision 2026-10-15), equal to the tier weight.
-- Why: the owner's core product is knowing what is happening in the market: what sold, for how much and how fast. An ask with no
-- observable outcome is half a data point. This puts the weight where his stated goal is, rather than re-tuning his rating of
-- eBay until eBay falls. best_v1 is now (2 tier + complete + 2 outcome + unique + group) / 7 and best_v1_1 adds quality: / 8.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
UPDATE public.firecrawl_params SET value = 2, set_at = now(),
  note = 'best_v1 weight of outcome observability. 2 since 2026-10-15 (equal to tier): the owner''s core product is what sold, for how much and how fast; an ask with no observable outcome is half a data point. Was 1.'
 WHERE key = 'best_w_outcome';
COMMIT;
