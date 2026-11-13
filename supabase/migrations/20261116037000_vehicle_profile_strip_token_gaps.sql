-- vehicle_profile_read: the strip names every header token it holds no value for, so the header can show it as a gap.
--
-- WHY. Owner rule: a missing item shows as a gap with what would close it. The header showed only the tokens that had a
-- value: on 2026-11-12, of the nine header tokens (year, make, model, trim, body style, engine, transmission, drivetrain,
-- location) 20d21fb0 showed 8, bf3821e3 and a18b3763 6, c7d011b6 6. A token without a chip could not be opened, so its
-- line items (vehicle_facet_items, each missing one with the evidence it needs) were unreachable from the header.
--
-- WHAT. The strip section gains `gaps`: [{dimension, label}] for the strip tokens (body style, engine, transmission,
-- drivetrain, location) with no strip facet, and trim when the record holds no trim or series (the headline shows
-- those). Year, make and model are the headline's own. The label is the token's display name, stated here so the client
-- maps nothing. The strip is returned when it has a facet or a gap. The header renders each gap as a muted chip that opens
-- that token's items. token_gaps_v1 marks the patch; anchors refuse drift and are skipped when applied.
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
  d := pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure);
  IF position('token_gaps_v1' in d) = 0 THEN
    d := pg_temp.patch_once(d,
      E'         (SELECT claim FROM odometer) AS odometer\n),',
      E'         (SELECT claim FROM odometer) AS odometer,\n'
      || E'         -- token_gaps_v1: the strip tokens with no facet, and trim when the record names none.\n'
      || E'         (SELECT coalesce(jsonb_agg(jsonb_build_object(''dimension'', g.dim, ''label'', g.label) ORDER BY g.ord), ''[]''::jsonb)\n'
      || E'          FROM (VALUES (1, ''trim'', ''Trim''), (2, ''body_style'', ''Body style''), (3, ''engine'', ''Engine''),\n'
      || E'                       (4, ''transmission'', ''Transmission''), (5, ''drivetrain'', ''Drivetrain''),\n'
      || E'                       (6, ''location'', ''Location'')) g(ord, dim, label)\n'
      || E'          WHERE NOT EXISTS (SELECT 1 FROM claims c WHERE c.dimension = g.dim)\n'
      || E'            AND (g.dim <> ''trim'' OR NOT EXISTS (SELECT 1 FROM v\n'
      || E'                 WHERE nullif(btrim(v.trim), '''') IS NOT NULL OR nullif(btrim(v.series), '''') IS NOT NULL))) AS gaps\n),',
      'vehicle_profile_read strip gaps');
    d := pg_temp.patch_once(d,
      E'    || CASE WHEN s.shown > 0 THEN jsonb_build_array(jsonb_build_object(\n      ''kind'', ''strip'',',
      E'    || CASE WHEN s.shown > 0 OR jsonb_array_length(s.gaps) > 0 THEN jsonb_build_array(jsonb_build_object(\n      ''kind'', ''strip'',',
      'vehicle_profile_read strip condition');
    d := pg_temp.patch_once(d,
      E'      ''facets'', s.facets,\n',
      E'      ''facets'', s.facets,\n      ''gaps'', s.gaps,\n',
      'vehicle_profile_read strip gaps key');
    EXECUTE d;
  END IF;
  IF position('token_gaps_v1' in pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'vehicle_profile_read is not patched';
  END IF;
END $migration$;

DROP FUNCTION pg_temp.patch_once(text, text, text, text);
COMMIT;
