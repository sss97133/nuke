-- firecrawl_group_score: a model family key can appear under more than one brand in mv_family_sales, so (family_key,
-- band, computed_at) was not unique and the first best_v1 run failed on it. The key now includes the brand.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
ALTER TABLE public.firecrawl_group_score DROP CONSTRAINT IF EXISTS firecrawl_group_score_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS firecrawl_group_score_key ON public.firecrawl_group_score (family_key, band, coalesce(brand, ''), computed_at);
COMMIT;
