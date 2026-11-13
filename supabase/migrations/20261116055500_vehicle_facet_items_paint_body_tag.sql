-- Header facet items: a `paint` token, and the body-tag lines that reached no item.
--
-- WHY. The keyed body-tag readings (schema_proposals set drivetrain-bodytag-keys-v3-20261111) include the paint code,
-- the option-code line and line 5 of the tag. vehicle_facet_items had no item for them, so they reached no screen. The
-- header's exterior-color row needs the same items: what the car is recorded as today and what its tag says it was
-- painted.
--
-- WHAT. Anchor patches of the deployed body (marker facet_paint_body_tag_v1):
--   - token `paint`:
--       paint.current.recorded  vehicles.color (the record), field_evidence `color`, observation key `exterior_color`;
--                               the same shape as year.recorded.
--       paint.as_built.code     body_tag_paint_code as read on the tag, "lower/upper" (a third code when the tag has one),
--                               with {lower, upper, top} kept on the source as `decoded`. No color name: the code is
--                               named only by a cited paint-code table row, which does not exist yet.
--   - body_style.option_codes   body_tag_option_codes: the codes in tag order, or "none" when the reading found none.
--   - body_style.tag_line5      body_tag_line5 as read; its meaning is not stated until a cited decode exists.
-- Every other item is unchanged: a property value is still the stated text except for these two structured keys.
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
  IF position('facet_paint_body_tag_v1' in d) = 0 THEN
    -- The record's color.
    d := pg_temp.patch_once(d,
      E'         v.rear_axle_type, v.tire_spec_rear, v.bore_mm, v.stroke_mm, v.city, v.state,\n',
      E'         v.rear_axle_type, v.tire_spec_rear, v.bore_mm, v.stroke_mm, v.city, v.state, v.color,\n',
      'vehicle_facet_items v color');
    -- The item definitions.
    d := pg_temp.patch_once(d,
      E'  (''body_style'', 5, ''body_style.build_date'', ''as_built'', NULL, ''photo of the body (cowl) tag showing the build date code''),\n',
      E'  (''body_style'', 5, ''body_style.build_date'', ''as_built'', NULL, ''photo of the body (cowl) tag showing the build date code''),\n'
      || E'  (''body_style'', 6, ''body_style.option_codes'', ''as_built'', NULL, ''photo of the body (cowl) tag option line; the SPID label or build sheet for the full option list''),\n'
      || E'  (''body_style'', 7, ''body_style.tag_line5'', ''as_built'', NULL, ''photo of line 5 of the body (cowl) tag, decoded under a cited body-tag table''),\n',
      'vehicle_facet_items body tag defs');
    d := pg_temp.patch_once(d,
      E'  (''trim'', 3, ''trim.as_built.interior'', ''as_built'', NULL, ''photo of the body (cowl) tag trim code, decoded under a cited trim-code table''),\n',
      E'  (''trim'', 3, ''trim.as_built.interior'', ''as_built'', NULL, ''photo of the body (cowl) tag trim code, decoded under a cited trim-code table''),\n'
      || E'  -- facet_paint_body_tag_v1: the paint token.\n'
      || E'  (''paint'', 0, ''paint.current.recorded'', ''current'', NULL, ''a dated source for the color: listing, photos or the vehicle record''),\n'
      || E'  (''paint'', 1, ''paint.as_built.code'', ''as_built'', NULL, ''photo of the body (cowl) tag paint line, named under a cited paint-code table''),\n',
      'vehicle_facet_items paint defs');
    -- A property's value as stated; the two structured body-tag keys are written out as read.
    d := pg_temp.patch_once(d,
      $a$coalesce(p.property_key, o.structured_data->>'property_key') AS pk,$a$,
      $a$coalesce(p.property_key, o.structured_data->>'property_key') AS pk,
         CASE coalesce(p.property_key, o.structured_data->>'property_key')
           WHEN 'body_tag_paint_code' THEN CASE WHEN jsonb_typeof(o.structured_data->'body_tag_paint_code') = 'object'
             THEN nullif(concat_ws('/', o.structured_data->'body_tag_paint_code'->>'lower',
                    o.structured_data->'body_tag_paint_code'->>'upper', o.structured_data->'body_tag_paint_code'->>'top'), '')
             ELSE o.structured_data->>'body_tag_paint_code' END
           WHEN 'body_tag_option_codes' THEN CASE WHEN jsonb_typeof(o.structured_data->'body_tag_option_codes') = 'array'
             THEN coalesce((SELECT string_agg(c, ' ' ORDER BY n)
                            FROM jsonb_array_elements_text(o.structured_data->'body_tag_option_codes') WITH ORDINALITY e(c, n)
                            WHERE nullif(btrim(c), '') IS NOT NULL), 'none')
             ELSE o.structured_data->>'body_tag_option_codes' END
           ELSE o.structured_data->>coalesce(p.property_key, o.structured_data->>'property_key') END AS pv,$a$,
      'vehicle_facet_items property value');
    d := pg_temp.patch_once(d, 'o.sd->>o.pk, m.nk,', 'o.pv, m.nk,', 'vehicle_facet_items property value read');
    d := pg_temp.patch_once(d, $a$'witness', o.witness, 'value', o.sd->>o.pk,$a$, $a$'witness', o.witness, 'value', o.pv,$a$,
      'vehicle_facet_items property source value');
    d := pg_temp.patch_once(d, $a$AND nullif(btrim(o.sd->>o.pk), '') IS NOT NULL$a$, $a$AND nullif(btrim(o.pv), '') IS NOT NULL$a$,
      'vehicle_facet_items property value present');
    d := pg_temp.patch_once(d,
      E'''limitation'', o.limitation),\n         NULL::jsonb\n  FROM obs_w o CROSS JOIN v',
      E'''limitation'', o.limitation)\n'
      || E'           || CASE WHEN jsonb_typeof(o.sd->o.pk) = ''object'' THEN jsonb_build_object(''decoded'', o.sd->o.pk) ELSE ''{}''::jsonb END,\n'
      || E'         NULL::jsonb\n  FROM obs_w o CROSS JOIN v',
      'vehicle_facet_items property decoded');
    -- Keys onto items.
    d := pg_temp.patch_once(d,
      E'    (''body_tag_trim_code'', ''trim.as_built.interior'', ''text'', NULL),\n',
      E'    (''body_tag_trim_code'', ''trim.as_built.interior'', ''text'', NULL),\n'
      || E'    (''body_tag_paint_code'', ''paint.as_built.code'', ''text'', NULL),\n'
      || E'    (''body_tag_option_codes'', ''body_style.option_codes'', ''text'', NULL),\n'
      || E'    (''body_tag_line5'', ''body_style.tag_line5'', ''text'', NULL),\n'
      || E'    (''exterior_color'', ''paint.current.recorded'', ''text'', NULL),\n',
      'vehicle_facet_items paint and body tag keys');
    d := pg_temp.patch_once(d,
      E'    (''trim'', ''trim.recorded'', NULL, ''text''),\n',
      E'    (''trim'', ''trim.recorded'', NULL, ''text''),\n    (''color'', ''paint.current.recorded'', NULL, ''text''),\n',
      'vehicle_facet_items field_evidence color');
    d := pg_temp.patch_once(d,
      E'    (''trim.recorded'', v.trim, ''text'', ''trim''),\n',
      E'    (''trim.recorded'', v.trim, ''text'', ''trim''),\n    (''paint.current.recorded'', v.color, ''text'', ''color''),\n',
      'vehicle_facet_items record color');
    EXECUTE d;
  END IF;
END
$migration$;

COMMIT;
