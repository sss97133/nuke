-- feat(vehicles): platform-native listing key (additive, 1/3: column, key function, backfill log).
--
-- WHY. Each Hagerty listing is imported twice by extract-hagerty-listing, which inserts a vehicle without looking one
-- up; the URL it stores is lowercased by vehicles_canonicalize_discovery_url, so the stored URL cannot identify the
-- listing. A listing's identity is the platform's own id, so vehicles gets one column holding it.
--
-- source_listing_key = '<platform>:<native id>', id case preserved (Hagerty: 'hagerty:2qNtqutlbqCk0DwL0ePQNb').
-- NULL for every row until a run fills it. Nothing reads it yet except the extractor lookup added with this change.
-- The platform prefix scopes uniqueness per platform; the unique index is migration 3/3 (built CONCURRENTLY).
--
-- This file: ADD COLUMN (nullable, no default: catalog-only), a NOT VALID format CHECK (enforced on new writes, not
-- scanned against old rows), public.hagerty_listing_key(text) (SQL mirror of _shared/listingKey.ts hagertyListingKey),
-- and public.source_listing_key_backfill_log (one row per vehicle per backfill run: what was set or skipped and why).
-- Revert: supabase/rollbacks/20261108130000_vehicles_source_listing_key_down.sql
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '55s';

-- ACCESS EXCLUSIVE on vehicles queues every other query behind it while it waits for open writers, so take it with
-- short lock_timeout attempts (1 s each, up to 25) instead of one long wait. Both statements are catalog-only.
DO $ddl$
DECLARE
  stmts text[] := ARRAY[
    'ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS source_listing_key text',
    'ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_source_listing_key_format CHECK (source_listing_key IS NULL OR source_listing_key ~ ''^[a-z][a-z0-9_]*:[^[:space:]]+$'') NOT VALID'
  ];
  s text;
  done boolean;
BEGIN
  FOREACH s IN ARRAY stmts LOOP
    IF s LIKE '%ADD CONSTRAINT%' AND EXISTS (SELECT FROM pg_constraint WHERE conrelid = 'public.vehicles'::regclass AND conname = 'vehicles_source_listing_key_format') THEN
      CONTINUE;
    END IF;
    done := false;
    FOR i IN 1..25 LOOP
      BEGIN
        PERFORM set_config('lock_timeout', '1s', true);
        EXECUTE s;
        done := true;
        EXIT;
      EXCEPTION WHEN lock_not_available THEN
        PERFORM pg_sleep(0.5 + random());
      END;
    END LOOP;
    IF NOT done THEN RAISE EXCEPTION 'could not lock public.vehicles after 25 attempts: %', s; END IF;
  END LOOP;
END
$ddl$;

COMMENT ON COLUMN public.vehicles.source_listing_key IS
'Platform-native identity of the listing this vehicle came from: ''<platform>:<native id>'', id case preserved (hagerty:2qNtqutlbqCk0DwL0ePQNb). NULL = not keyed. Unique per live vehicle (idx_vehicles_source_listing_key_unique). A URL is not the identity: vehicles_canonicalize_discovery_url lowercases it. Filled for Hagerty by run hagerty_listing_key_v1_20261102 and by extract-hagerty-listing; other platforms not yet.';

CREATE OR REPLACE FUNCTION public.hagerty_listing_key(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  -- 'hagerty:<id>' from a Hagerty Marketplace auction URL; the id is the last path segment, case preserved
  -- (UUID ids are lowercased); NULL when the URL is not a listing URL or the id is not 20-24 alphanumerics / a UUID.
  SELECT CASE
           WHEN s.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'hagerty:' || lower(s.id)
           WHEN s.id ~ '^[A-Za-z0-9]{20,24}$' THEN 'hagerty:' || s.id
         END
    FROM (SELECT (regexp_match(btrim(p_url),
            '^https?://(?:www\.)?hagerty\.com/marketplace/(?:auction|listing)/(?:[^/?#]+/)*([^/?#]+)/?(?:[?#].*)?$', 'i'))[1] AS id) s;
$fn$;

COMMENT ON FUNCTION public.hagerty_listing_key(text) IS
'hagerty:<id> for a Hagerty Marketplace auction URL (id case preserved, UUID lowercased), else NULL. SQL mirror of supabase/functions/_shared/listingKey.ts hagertyListingKey.';

CREATE TABLE IF NOT EXISTS public.source_listing_key_backfill_log (
  run_id      text        NOT NULL,
  vehicle_id  uuid        NOT NULL,
  platform    text        NOT NULL,
  key         text,
  action      text        NOT NULL CHECK (action IN ('set', 'skipped_case_lost', 'skipped_duplicate', 'skipped_no_id')),
  duplicate_of uuid,
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  PRIMARY KEY (run_id, vehicle_id)
);
ALTER TABLE public.source_listing_key_backfill_log ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.source_listing_key_backfill_log IS
'One row per vehicle per source_listing_key backfill run (grain: run x vehicle). action=set wrote key; skipped_case_lost = the only URL available is lowercased so the native id''s case is unknown; skipped_duplicate = another live vehicle already holds the key (duplicate_of); skipped_no_id = no parseable id. reverted_at is set by the revert script. RLS on, no policy: service_role only.';

COMMIT;
