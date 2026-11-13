-- Header facet items: two wording repairs the live page showed (logged out, 1973 Firebird, 2026-11-12).
--
-- WHY. (1) Keyed body-tag readings carry the limitation "... its meaning comes from vehicle_decode_rules.", so a table
-- name printed on the page. The stored testimony stays as written; the reader words the table name. (2) The paint code,
-- interior trim code and tag line 5 asked first for a tag photo even when the tag photos are already their witnesses;
-- what establishes them is the cited decode table. The need now names the table first and the photo only if none is
-- on record.
--
-- WHAT. Anchor patches of the deployed body (marker facet_item_wording_v1). Values, statuses, sources and every other
-- item are unchanged.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION pg_temp.patch_once(p_text text, p_anchor text, p_replacement text, p_what text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE n integer := (length(p_text) - length(replace(p_text, p_anchor, ''))) / greatest(length(p_anchor), 1);
BEGIN
  IF n <> 1 THEN RAISE EXCEPTION '% anchor drifted (found % times): %', p_what, n, p_anchor; END IF;
  RETURN replace(p_text, p_anchor, p_replacement);
END $f$;

DO $migration$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('facet_item_wording_v1' in d) = 0 THEN
    d := pg_temp.patch_once(d,
      $a$nullif(concat_ws('; ', nullif(btrim(o.sd->>'limitation'), ''),$a$,
      $a$nullif(concat_ws('; ', nullif(btrim(replace(o.sd->>'limitation', 'vehicle_decode_rules', 'the decode rules')), ''),$a$,
      'vehicle_facet_items limitation wording');
    d := pg_temp.patch_once(d,
      E'  (''body_style'', 7, ''body_style.tag_line5'', ''as_built'', NULL, ''photo of line 5 of the body (cowl) tag, decoded under a cited body-tag table''),\n',
      E'  -- facet_item_wording_v1: a tag item needs its cited decode table; a tag photo only when none is on record.\n'
      || E'  (''body_style'', 7, ''body_style.tag_line5'', ''as_built'', NULL, ''a cited body-tag table decoding line 5 (and a photo of line 5 of the body (cowl) tag, if none is on record)''),\n',
      'vehicle_facet_items line 5 need');
    d := pg_temp.patch_once(d,
      E'  (''trim'', 3, ''trim.as_built.interior'', ''as_built'', NULL, ''photo of the body (cowl) tag trim code, decoded under a cited trim-code table''),\n',
      E'  (''trim'', 3, ''trim.as_built.interior'', ''as_built'', NULL, ''a cited trim-code table decoding the tag''''s trim code (and a photo of the body (cowl) tag trim code, if none is on record)''),\n',
      'vehicle_facet_items trim need');
    d := pg_temp.patch_once(d,
      E'  (''paint'', 1, ''paint.as_built.code'', ''as_built'', NULL, ''photo of the body (cowl) tag paint line, named under a cited paint-code table''),\n',
      E'  (''paint'', 1, ''paint.as_built.code'', ''as_built'', NULL, ''a cited paint-code table naming the tag''''s paint code (and a photo of the body (cowl) tag paint line, if none is on record)''),\n',
      'vehicle_facet_items paint need');
    EXECUTE d;
  END IF;
END
$migration$;

COMMIT;
