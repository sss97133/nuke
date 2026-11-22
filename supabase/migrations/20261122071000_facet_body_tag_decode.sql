-- facet_body_tag_decode_v1: the body tag's paint and trim codes read through the cited code tables already loaded.
--
-- WHY. vehicle_decode_rules holds cited body_tag_paint_code and body_tag_trim_code rows (seeded by 20261116033000),
-- and a paint row points at its paint_codes row by id. vehicle_facet_items showed paint.as_built.code as a bare code
-- ("75/75") and kept saying it needed "a cited paint-code table naming the tag's paint code"; the trim item said the
-- same of a trim-code table. Both tables were on file. The page asked for what the database already had.
--
-- WHAT CHANGES. In the `item` CTE, for paint.as_built.code and trim.as_built.interior only, when the item has a
-- value (not missing, not a conflict) and a current rule row matches the vehicle's make, year and the code (the
-- first token of a two-tone "lower/upper" paint value):
--   * `rule` carries the row: key, rule_id, code, decoded (paint: the paint_codes name; trim: the rule's value),
--     citation_url, citation_title, citation_locator. When the upper and lower paint codes differ, both are decoded.
--   * `needed` becomes "a second independent read of the body tag" (the table is no longer what is missing).
-- Status and value are unchanged: a single photo reading is still a reading. No row is written.
--
-- REVERT. Redefine vehicle_facet_items without the text between the markers facet_body_tag_decode_v1 and
-- facet_body_tag_decode_v1_end (two places). Nothing else is created.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  a1 text := E'    ''sources'', coalesce(sources, ''[]''::jsonb), ''rule'', coalesce(rule, av_rule), ''equation'', NULL,\n    ''needed'', CASE WHEN status <> ''established'' THEN needed END)\n';
  r1 text := E'    ''sources'', coalesce(sources, ''[]''::jsonb), ''rule'', coalesce(rule, av_rule, tag_rule /* facet_body_tag_decode_v1 */), ''equation'', NULL,\n    ''needed'', CASE WHEN status <> ''established'' THEN CASE WHEN tag_rule IS NOT NULL THEN ''a second independent read of the body tag'' ELSE needed END END)\n';
  a2 text := E'  FROM (SELECT base.*, (status = ''established'' AND NOT coalesce(strong, false) AND nraw > 1\n          AND lead_nk IN (''transmission_type'', ''layout'', ''configuration'', ''year'')) AS shared_class FROM base) b\n),';
  r2 text := $r2$  FROM (SELECT base.*, (status = 'established' AND NOT coalesce(strong, false) AND nraw > 1
          AND lead_nk IN ('transmission_type', 'layout', 'configuration', 'year')) AS shared_class FROM base) b
  -- facet_body_tag_decode_v1: the cited code-table row for the body tag's paint or trim code.
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object('key', min(r.rule_key), 'applies_to', b.key,
             'rule_ids', jsonb_agg(r.id ORDER BY c.ord, r.id),
             'decoded', jsonb_agg(jsonb_strip_nulls(jsonb_build_object('code', r.code,
                 'name', CASE WHEN r.rule_key = 'body_tag_paint_code'
                   THEN coalesce((SELECT pc.name FROM public.paint_codes pc
                                  WHERE pc.id::text = r.value#>>'{ref,id}'), r.value->>'name') END,
                 'value', CASE WHEN r.rule_key = 'body_tag_trim_code' THEN r.value END)) ORDER BY c.ord, r.id),
             'citation_url', min(r.citation_url), 'citation_title', min(r.citation_title),
             'citation_locator', min(r.citation_locator)) AS tag_rule
    FROM v
    CROSS JOIN LATERAL (SELECT DISTINCT ON (t.code) t.code, t.ord
                        FROM unnest(string_to_array(b.lead_val, '/')) WITH ORDINALITY t(code, ord)
                        WHERE nullif(btrim(t.code), '') IS NOT NULL ORDER BY t.code, t.ord) c
    JOIN public.vehicle_decode_rules r ON r.superseded_at IS NULL
     AND r.rule_key = CASE b.key WHEN 'paint.as_built.code' THEN 'body_tag_paint_code' ELSE 'body_tag_trim_code' END
     AND r.code = btrim(c.code) AND lower(r.make) = lower(v.make)
     AND v.year BETWEEN coalesce(r.year_min, v.year) AND coalesce(r.year_max, v.year)
    WHERE b.status NOT IN ('missing', 'conflict')
    HAVING count(*) > 0
  ) tr ON b.key IN ('paint.as_built.code', 'trim.as_built.interior')
  -- facet_body_tag_decode_v1_end
),$r2$;
  n1 integer; n2 integer;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('facet_body_tag_decode_v1' IN d) > 0 THEN RETURN; END IF;
  n1 := (length(d) - length(replace(d, a1, ''))) / length(a1);
  n2 := (length(d) - length(replace(d, a2, ''))) / length(a2);
  IF n1 <> 1 OR n2 <> 1 THEN RAISE EXCEPTION 'facet body tag decode anchors drifted: % and % matches', n1, n2; END IF;
  d := replace(replace(d, a1, r1), a2, r2);
  EXECUTE d;
END $patch$;
