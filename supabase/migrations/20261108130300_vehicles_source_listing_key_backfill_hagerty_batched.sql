-- feat(vehicles): source_listing_key backfill for Hagerty (additive, 2/3, batched: replaces 20261108130100). Run id: hagerty_listing_key_v1_20261102.
--
-- Fills vehicles.source_listing_key = 'hagerty:<id>' for live discovery_source='hagerty' rows (about 920). The id is read
-- from origin_metadata->>'discovery_url' (kept as the importer saw it) first, then discovery_url, and only when it still
-- has Hagerty's casing (an uppercase letter, or a UUID). A lowercased URL cannot give the id back, so those rows are
-- left NULL and logged (skipped_case_lost); the extractor keys them the next time the listing is imported.
-- When several live vehicles resolve to the same key (the known duplicate Hagerty listings) the earliest-created row
-- gets the key and the others are logged skipped_duplicate with duplicate_of. Nothing is merged or deleted.
-- Only source_listing_key is written. The ordinary vehicles UPDATE triggers still fire (updated_at is stamped to the run time on the ~910 rows, vehicle_status_metadata.last_activity_at likewise); no other column changes (tested: only updated_at differs). Idempotent: rows already keyed are not touched and log rows are not repeated.
-- Revert: scripts/vehicles/revert_hagerty_listing_key_v1_20261102.sql
-- Why batched: the first version ran as one transaction and hit its 50 s statement_timeout on prod (deploy run 41551368140):
-- the ~35 UPDATE triggers on vehicles make a 909-row UPDATE take over a minute, and that rolled the whole backfill back.
-- Now autocommit: build the plan in a session temp table, log it, then update 50 rows per statement (20 statements, enough
-- for 1000). Every statement is idempotent and re-runnable; the closing check fails the deploy if any logged "set" row is
-- not keyed.
SET lock_timeout = '8s';
SET statement_timeout = '55s';

CREATE TEMP TABLE _hlk AS
WITH src AS (
  SELECT v.id, v.created_at,
         public.hagerty_listing_key(v.origin_metadata ->> 'discovery_url') AS k_om,
         public.hagerty_listing_key(v.discovery_url) AS k_du
    FROM public.vehicles v
   WHERE v.discovery_source = 'hagerty' AND v.deleted_at IS NULL AND v.source_listing_key IS NULL
), pick AS (
  SELECT id, created_at,
         CASE WHEN k_om IS NOT NULL AND (k_om ~ '[A-Z]' OR k_om ~ '-') THEN k_om
              WHEN k_du IS NOT NULL AND (k_du ~ '[A-Z]' OR k_du ~ '-') THEN k_du END AS key,
         CASE WHEN k_om IS NOT NULL AND (k_om ~ '[A-Z]' OR k_om ~ '-') THEN 'origin_metadata.discovery_url'
              WHEN k_du IS NOT NULL AND (k_du ~ '[A-Z]' OR k_du ~ '-') THEN 'discovery_url' END AS source,
         (k_om IS NOT NULL OR k_du IS NOT NULL) AS had_id
    FROM src
), held AS (
  -- keys already held by a live Hagerty vehicle (empty on the first run; keeps a re-run from duplicating one)
  SELECT source_listing_key AS key FROM public.vehicles
   WHERE discovery_source = 'hagerty' AND deleted_at IS NULL AND source_listing_key IS NOT NULL
), ranked AS (
  SELECT p.*, row_number() OVER (PARTITION BY key ORDER BY created_at, id) AS rn,
         first_value(id) OVER (PARTITION BY key ORDER BY created_at, id) AS first_id
    FROM pick p
)
SELECT r.id AS vehicle_id, r.key, r.source,
       CASE WHEN r.key IS NULL AND r.had_id THEN 'skipped_case_lost'
            WHEN r.key IS NULL THEN 'skipped_no_id'
            WHEN r.rn > 1 THEN 'skipped_duplicate'
            WHEN r.key IN (SELECT key FROM held) THEN 'skipped_duplicate'
            ELSE 'set' END AS action,
       CASE WHEN r.rn > 1 THEN r.first_id END AS duplicate_of
  FROM ranked r;

INSERT INTO public.source_listing_key_backfill_log (run_id, vehicle_id, platform, key, action, duplicate_of, source)
SELECT 'hagerty_listing_key_v1_20261102', vehicle_id, 'hagerty', key, action, duplicate_of, source FROM _hlk
ON CONFLICT (run_id, vehicle_id) DO NOTHING;

UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
UPDATE public.vehicles v
   SET source_listing_key = b.key
  FROM (SELECT l.vehicle_id, l.key
          FROM public.source_listing_key_backfill_log l
         WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
           AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key IS NOT DISTINCT FROM l.key)
         ORDER BY l.vehicle_id
         LIMIT 50) b
 WHERE v.id = b.vehicle_id AND v.source_listing_key IS NULL;
DO $check$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.source_listing_key_backfill_log l
   WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.action = 'set' AND l.reverted_at IS NULL
     AND NOT EXISTS (SELECT FROM public.vehicles x WHERE x.id = l.vehicle_id AND x.source_listing_key = l.key);
  IF n > 0 THEN
    RAISE EXCEPTION 'hagerty_listing_key_v1_20261102: % logged rows are not keyed yet; re-run this file', n;
  END IF;
END
$check$;
DROP TABLE IF EXISTS pg_temp._hlk;
RESET statement_timeout;
RESET lock_timeout;
