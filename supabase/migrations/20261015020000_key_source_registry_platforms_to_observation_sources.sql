-- 20261015020000_key_source_registry_platforms_to_observation_sources.sql
--
-- Fill source_registry.observation_source_id for 21 platforms whose platform entity row already exists, so
-- vehicles.platform_source (whose comment names source_registry.slug as its key) reaches observation_sources, the
-- declared platform entity (20261007233000). The memo docs/proposals/2026-10-07-platform-entity.md §6 lists this fill
-- as "Unknown, to read"; it is now read. (Re-cut of PR #1240, whose version 20261015010000 collided with
-- 20261015010000_search_fuzzy_name_dictionary on main.)
--
-- EVIDENCE (read-only, prod, 2026-10-14 23:28-23:34Z):
--   source_registry: 97 rows; observation_source_id set on 3 (autotrader, dupontregistry, silodrome), each to the
--     same slug. The FK source_registry_observation_source_id_fkey -> observation_sources(id) exists; no unique key on
--     the column; one trigger (source_registry_updated_at).
--   Match rule: the registry slug equals an observation_sources slug (19 rows below), or source_alias_mapping already
--     maps it to one (2 rows: bringatrailer -> bat, broadarrow -> broad-arrow). observation_sources.bat is
--     "Bring a Trailer", base_url https://bringatrailer.com, and its notes name bringatrailer as a legacy alias.
--     Where observation_sources holds a separator twin (broad-arrow/broad_arrow, cars-and-bids/cars_and_bids,
--     classic-driver/classicdriver, er-classics/erclassics), the row named here is the one with the registry's exact
--     spelling or the alias table's choice; the twins themselves are left for the sibling fold the memo describes.
--   vehicles.platform_source on public rows (index-only counts, 570,508 non-null): 285,417 (50.0%) match an
--     observation_sources slug directly. Through this bridge, bringatrailer's 210,828 rows also reach the entity:
--     496,245 (87.0%). The other public values are spellings with no registry row on either side (classiccars,
--     user-submission, facebook ...; open add_source proposals from 20261007231000) or not platforms (unknown,
--     correct_vehicle_sale_provenance, pipeline ...).
--
-- WHAT: one guarded UPDATE of 21 rows (only where observation_source_id is NULL), a column comment, and an assertion
-- that every pair resolved. No vehicles row is touched. Re-applying it changes nothing.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _platform_bridge (registry_slug text PRIMARY KEY, entity_slug text NOT NULL) ON COMMIT DROP;
INSERT INTO _platform_bridge (registry_slug, entity_slug) VALUES
  ('barrett-jackson',     'barrett-jackson'),
  ('bringatrailer',       'bat'),
  ('broadarrow',          'broad-arrow'),
  ('carandclassic',       'carandclassic'),
  ('cars-and-bids',       'cars-and-bids'),
  ('classic-com',         'classic-com'),
  ('classic-driver',      'classic-driver'),
  ('collecting-cars',     'collecting-cars'),
  ('copart',              'copart'),
  ('craigslist',          'craigslist'),
  ('dupont-registry',     'dupont-registry'),
  ('dyler',               'dyler'),
  ('er-classics',         'er-classics'),
  ('hagerty-marketplace', 'hagerty-marketplace'),
  ('hemmings',            'hemmings'),
  ('manheim',             'manheim'),
  ('mecum',               'mecum'),
  ('pcarmarket',          'pcarmarket'),
  ('rennlist',            'rennlist'),
  ('rm-sothebys',         'rm-sothebys'),
  ('russo-and-steele',    'russo-and-steele');

UPDATE public.source_registry r
SET observation_source_id = o.id
FROM _platform_bridge b
JOIN public.observation_sources o ON o.slug = b.entity_slug
WHERE r.slug = b.registry_slug
  AND r.observation_source_id IS NULL;

DO $$
DECLARE
  unresolved text;
BEGIN
  SELECT string_agg(b.registry_slug || ' -> ' || b.entity_slug, ', ' ORDER BY b.registry_slug)
  INTO unresolved
  FROM _platform_bridge b
  LEFT JOIN public.source_registry r ON r.slug = b.registry_slug
  LEFT JOIN public.observation_sources o ON o.id = r.observation_source_id
  WHERE o.id IS NULL OR o.slug IS DISTINCT FROM b.entity_slug;

  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION 'source_registry platform bridge did not resolve: %', unresolved;
  END IF;
END $$;

COMMENT ON COLUMN public.source_registry.observation_source_id IS
'The platform entity row (observation_sources.id) this registry entry is. Lets a value keyed by source_registry.slug, such as vehicles.platform_source, reach the declared platform entity. Filled by migrations: 3 rows before 2026-10-14, 21 by 20261015020000 (exact slug match, or the source_alias_mapping choice for bringatrailer -> bat and broadarrow -> broad-arrow). NULL means no entity row is chosen yet, not that none exists. Grain: one registry entry. Clock: none of its own; source_registry.updated_at moves when it is set.';

COMMIT;
