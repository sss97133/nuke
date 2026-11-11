\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN
    RAISE EXCEPTION 'Disposable contract database required';
  END IF;
END $$;
CREATE TABLE public.firecrawl_params(key text PRIMARY KEY,value numeric,text_value text,note text NOT NULL,set_at timestamptz NOT NULL);
INSERT INTO public.firecrawl_params VALUES
 ('monthly_credits',1000,NULL,'Original plan','2026-01-01'),
 ('period_start_day',4,NULL,'Original period','2026-01-01'),
 ('reserve_fraction',0.15,NULL,'Original reserve.','2026-01-01'),
 ('unrelated_setting',37,'unchanged','Unrelated provenance','2026-01-01');
CREATE TEMP TABLE before_rows AS TABLE public.firecrawl_params;
\ir ../migrations/20261113172000_firecrawl_reserve_release.sql
DO $$ BEGIN
  ASSERT (SELECT value=0.14 AND set_at>'2026-01-01' AND note LIKE 'Original reserve.%' AND note LIKE '%persists until revised%' FROM firecrawl_params WHERE key='reserve_fraction');
  ASSERT NOT EXISTS ((SELECT * FROM firecrawl_params WHERE key<>'reserve_fraction') EXCEPT (SELECT * FROM before_rows WHERE key<>'reserve_fraction'));
  ASSERT NOT EXISTS ((SELECT * FROM before_rows WHERE key<>'reserve_fraction') EXCEPT (SELECT * FROM firecrawl_params WHERE key<>'reserve_fraction'));
  ASSERT (SELECT 1000*(0.15-value)=10 FROM firecrawl_params WHERE key='reserve_fraction'),'ten existing credits released';
  ASSERT (SELECT 1000*(1-value)=860 AND greatest(0,1000*(1-value)-852)=8 FROM firecrawl_params WHERE key='reserve_fraction'),'ceiling860 leaves8 after852 spend, not10';
END $$;
CREATE TEMP TABLE after_rows AS TABLE public.firecrawl_params;
\ir ../migrations/20261113172000_firecrawl_reserve_release.sql
DO $$ BEGIN
  ASSERT NOT EXISTS ((TABLE firecrawl_params) EXCEPT (TABLE after_rows)) AND NOT EXISTS ((TABLE after_rows) EXCEPT (TABLE firecrawl_params)),
    'replay preserves the existing release value, note and clock';
END $$;

-- Invoke the actual migration on drift, then verify its refusal and no update.
UPDATE firecrawl_params SET value=0.15 WHERE key='reserve_fraction';
UPDATE firecrawl_params SET value=2000 WHERE key='monthly_credits';
\set ON_ERROR_STOP off
\ir ../migrations/20261113172000_firecrawl_reserve_release.sql
\set refused :ERROR
\set refusal_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT 1 / CASE WHEN :'refused'::boolean AND :'refusal_state'='P0001' THEN 1 ELSE 0 END;
DO $$ BEGIN ASSERT (SELECT value=0.15 FROM firecrawl_params WHERE key='reserve_fraction'); END $$;
UPDATE firecrawl_params SET value=1000 WHERE key='monthly_credits';
UPDATE firecrawl_params SET value=5 WHERE key='period_start_day';
\set ON_ERROR_STOP off
\ir ../migrations/20261113172000_firecrawl_reserve_release.sql
\set refused :ERROR
\set refusal_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT 1 / CASE WHEN :'refused'::boolean AND :'refusal_state'='P0001' THEN 1 ELSE 0 END;
DO $$ BEGIN ASSERT (SELECT value=0.15 FROM firecrawl_params WHERE key='reserve_fraction'); END $$;
UPDATE firecrawl_params SET value=4 WHERE key='period_start_day';
UPDATE firecrawl_params SET value=0.13 WHERE key='reserve_fraction';
\set ON_ERROR_STOP off
\ir ../migrations/20261113172000_firecrawl_reserve_release.sql
\set refused :ERROR
\set refusal_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT 1 / CASE WHEN :'refused'::boolean AND :'refusal_state'='P0001' THEN 1 ELSE 0 END;
DO $$ BEGIN ASSERT (SELECT value=0.13 FROM firecrawl_params WHERE key='reserve_fraction'); END $$;
UPDATE firecrawl_params SET value=NULL WHERE key='reserve_fraction';
\set ON_ERROR_STOP off
\ir ../migrations/20261113172000_firecrawl_reserve_release.sql
\set refused :ERROR
\set refusal_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT 1 / CASE WHEN :'refused'::boolean AND :'refusal_state'='P0001' THEN 1 ELSE 0 END;
DO $$ BEGIN ASSERT (SELECT value IS NULL FROM firecrawl_params WHERE key='reserve_fraction'); END $$;
UPDATE firecrawl_params SET value=0.15 WHERE key='reserve_fraction';
DELETE FROM firecrawl_params WHERE key='period_start_day';
\set ON_ERROR_STOP off
\ir ../migrations/20261113172000_firecrawl_reserve_release.sql
\set refused :ERROR
\set refusal_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT 1 / CASE WHEN :'refused'::boolean AND :'refusal_state'='P0001' THEN 1 ELSE 0 END;
DO $$ BEGIN
  ASSERT (SELECT value=0.15 FROM firecrawl_params WHERE key='reserve_fraction');
  ASSERT NOT EXISTS (SELECT 1 FROM firecrawl_params WHERE key='period_start_day'),'missing config is never invented';
  RAISE NOTICE 'reserve release: guarded ten-credit ceiling change, unchanged config, exact replay and five drift/missing cases pass';
END $$;
