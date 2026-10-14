-- 20261015011500_resolve_platform_slug_lowercase_first.sql
--
-- resolve_platform_slug(raw) is the platform resolver behind vehicles.canonical_platform (trigger
-- trg_resolve_canonical_columns). When source_alias_mapping has no row for the raw value, its fallback strips every
-- character outside [a-z0-9-] BEFORE it lowercases, so each capital letter is deleted: "Affordable Classics" becomes
-- "ffordable-lassics". It also turns surrounding spaces into hyphens before trimming, so a padded value keeps a
-- leading hyphen.
--
-- EVIDENCE (read-only, prod, 2026-10-14 23:35Z):
--   Live definition (pg_get_functiondef): LANGUAGE sql STABLE PARALLEL SAFE;
--     COALESCE((SELECT canonical_slug FROM source_alias_mapping WHERE raw_value = raw),
--              LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(raw, '[_\s]+', '-', 'g'), '[^a-z0-9-]', '', 'g'))))
--     Its CREATE is in no migration (applied directly; this file commits it).
--   Distinct canonical_platform values on vehicles with status in the idx_vehicles_canonical_platform_v2 set: 80,
--     of which 4 are visibly mangled: ffordable-lassics 2 rows, orldwide-intage-utos 3, he-hop-lubs 1,
--     -ourt-iling-robate-o--19--80-eb-28-2020 1 (7 rows). Every future raw value with a capital and no alias row
--     is mangled the same way.
--
-- WHAT: the same function, same signature, language, volatility and parallel safety; the alias lookup is unchanged
-- (now schema-qualified); the fallback lowercases first, then collapses whitespace/underscores to one hyphen, strips
-- the rest, and trims hyphens from both ends. Stored canonical_platform values are not rewritten here: the trigger
-- recomputes a row on its next write. Assertions below check the fallback on values with no alias row.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.resolve_platform_slug(raw text)
 RETURNS text
 LANGUAGE sql
 STABLE PARALLEL SAFE
AS $function$
  SELECT COALESCE(
    (SELECT canonical_slug FROM public.source_alias_mapping WHERE raw_value = raw),
    -- Fallback: lowercase first, then whitespace/underscores to hyphens, drop the rest, trim edge hyphens.
    BTRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(BTRIM(raw)), '[_\s]+', '-', 'g'), '[^a-z0-9-]', '', 'g'), '-')
  );
$function$;

DO $$
BEGIN
  IF public.resolve_platform_slug('Night Run Fallback Motors') IS DISTINCT FROM 'night-run-fallback-motors' THEN
    RAISE EXCEPTION 'resolve_platform_slug fallback still drops capitals: %',
      public.resolve_platform_slug('Night Run Fallback Motors');
  END IF;
  IF public.resolve_platform_slug('  Night_Run  Fallback ') IS DISTINCT FROM 'night-run-fallback' THEN
    RAISE EXCEPTION 'resolve_platform_slug fallback keeps edge hyphens: %',
      public.resolve_platform_slug('  Night_Run  Fallback ');
  END IF;
  IF public.resolve_platform_slug('bringatrailer') IS DISTINCT FROM 'bat' THEN
    RAISE EXCEPTION 'resolve_platform_slug alias lookup changed: bringatrailer -> %',
      public.resolve_platform_slug('bringatrailer');
  END IF;
  IF public.resolve_platform_slug(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'resolve_platform_slug(NULL) should stay NULL';
  END IF;
END $$;

COMMENT ON FUNCTION public.resolve_platform_slug(text) IS
'Platform slug for a raw source value, used by trg_resolve_canonical_columns to set vehicles.canonical_platform. Returns source_alias_mapping.canonical_slug for an exact raw_value match; otherwise a normalised slug (lowercase, whitespace and underscores to one hyphen, other characters dropped, edge hyphens trimmed). NULL in, NULL out. Lowercase-first since 20261015011500; before it, the fallback deleted capital letters.';

COMMIT;
