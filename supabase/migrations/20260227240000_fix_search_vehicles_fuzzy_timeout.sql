-- Fix: search_vehicles_fuzzy 3s statement_timeout causes autocomplete failures at scale
-- (1) Remove SET statement_timeout = '3s' — too tight for 1.2M+ vehicle table
-- (2) Add composite GIN trigram index on (lower(make) || ' ' || lower(model))
--     so similarity searches hit index instead of full-table scan
--
-- IMPORTANT: expressions in WHERE clause must be byte-for-byte identical to the index
-- definition for Postgres to use the index. Index uses: lower(make) || ' ' || lower(model)
-- so the function WHERE clause must use the same form.
--
-- Result: Bitmap Index Scan on idx_vehicles_make_model_trgm instead of 96s parallel seq scan.

-- Step 1: Composite GIN trigram index for make+model combined search
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- Apply this migration with: supabase db push (runs outside transaction)
-- OR execute manually via psql with SET statement_timeout = '0' first.
CREATE INDEX IF NOT EXISTS idx_vehicles_make_model_trgm
  ON public.vehicles
  USING GIN ((lower(make) || ' ' || lower(model)) gin_trgm_ops)
  WHERE is_public = true
    AND year IS NOT NULL
    AND make IS NOT NULL
    AND model IS NOT NULL;

-- Step 2: Recreate search_vehicles_fuzzy without the 3s timeout
-- Key changes:
--   - Removed: SET statement_timeout TO '3s'
--   - WHERE clause uses (lower(v.make) || ' ' || lower(v.model)) % query_text
--     which exactly matches idx_vehicles_make_model_trgm (enables Bitmap Index Scan)
--   - Relevance scoring updated to include combined make+model similarity
--   - Removed coalesce() on make/model since IS NOT NULL already filters nulls
CREATE OR REPLACE FUNCTION public.search_vehicles_fuzzy(
  query_text text,
  limit_count integer DEFAULT 20
)
RETURNS TABLE(
  id uuid,
  year integer,
  make text,
  model text,
  color text,
  description text,
  created_at timestamp with time zone,
  relevance real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
-- statement_timeout intentionally removed — was '3s', too tight at 1.2M vehicles
AS $function$
BEGIN
  PERFORM set_limit(0.25);
  RETURN QUERY
  SELECT
    v.id,
    v.year,
    v.make,
    v.model,
    v.color,
    v.description,
    v.created_at,
    GREATEST(
      similarity(lower(v.make), lower(query_text)),
      similarity(lower(v.model), lower(query_text)),
      similarity(lower(v.make) || ' ' || lower(v.model), lower(query_text)),
      similarity(lower(coalesce(v.vin, '')), lower(query_text))
    )::real AS relevance
  FROM vehicles v
  WHERE v.is_public = true
    AND v.year IS NOT NULL
    AND v.make IS NOT NULL
    AND v.model IS NOT NULL
    AND (
      -- Matches idx_vehicles_make_model_trgm exactly — uses Bitmap Index Scan
      (lower(v.make) || ' ' || lower(v.model)) % lower(query_text)
      -- VIN fallback (uses vehicles_vin_trgm_idx)
      OR lower(coalesce(v.vin, '')) % lower(query_text)
    )
  ORDER BY relevance DESC, v.created_at DESC
  LIMIT limit_count;
END;
$function$;
