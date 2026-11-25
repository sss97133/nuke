-- facet_witness_independence_v1: one photo is one witness; an unregistered reader is one family; a conflict has no
-- headline value; a reading says what would establish it; no photo text in an item.
--
-- WHY (board, 2026-11-24, skeptic attacks on 20261124193000 and S1; lead ruling "vendor lineage").
--  1. Two readers of one photo share its blur and glare: they agree, they do not independently witness. 20261124193000
--     counted image + reader lineage as independent; independence is now the photo (or the paper, or the source) alone.
--     The rows stay distinct (both readers' sources are listed), only the count of independent witnesses changes.
--  2. A reading whose model has no model_registry row (or no model at all, as in legacy field_evidence readings) belongs
--     to one family, 'unregistered'. Before, every unregistered model string and every legacy extractor name was a family
--     of its own, so two of them could establish an item.
--  3. A conflict item headed by its first row in rank order showed an outnumbered legacy reading as the item's value
--     (28 of 36 conflicts on 8 bench cars, skeptic S1). A conflict now has value and normalized NULL; its sides carry
--     their independent witness count and are ordered by witness class (decode > receipt > registered photo reading >
--     claim > unregistered reading > the vehicle record) then by that count. The vehicle record never adds to a count.
--  4. A 'reading' item names what would establish it, and every item with readings carries agreement {readings, photos,
--     families}: e.g. two readers of one vendor on one photo show as 2 readings, 1 photo, 1 family.
--  5. The axle branch put words read from a photo into an item's source value. A source now carries the unit type only.
-- reader_lineage(model) returns NULL for a model with no registered platform/BYOK provider (it returned the model
-- string, which made each unknown model its own family).
--
-- Grain, keys, clocks unchanged; reader only, nothing is written; recomputes on every call.
-- REVERT: re-run 20261124193000's reader_lineage definition and redefine vehicle_facet_items with the replacements below
-- reversed. Contract: supabase/sql/test_vehicle_facet_reader_lineage.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.reader_lineage(p_agent_model text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT lower(m.provider)
    FROM public.model_registry m
   WHERE m.slug = btrim(p_agent_model)
     AND m.caller_kind IN ('platform', 'user_byok')
     AND nullif(btrim(m.provider), '') IS NOT NULL AND lower(m.provider) <> 'unknown'
   LIMIT 1
$$;
COMMENT ON FUNCTION public.reader_lineage(text) IS
  'The reader family (model_registry.provider, lowercased) of a platform or BYOK model; NULL when the model is not registered. The fact reader counts every unregistered reader as one family, ''unregistered''. facet_witness_independence_v1.';

DO $patch$
DECLARE
  d text;
  n integer;
  r record;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('facet_witness_independence_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('facet_reader_lineage_v2' IN d) = 0 THEN RAISE EXCEPTION 'apply 20261124193200 first'; END IF;
  FOR r IN SELECT * FROM (VALUES
    (1, E'  SELECT o.*, coalesce(lin.l, o.method) AS lineage, lin.l IS NOT NULL AS lineage_known,',
        E'  SELECT o.*, /* facet_witness_independence_v1 */ coalesce(lin.l, \'unregistered\') AS lineage, lin.l IS NOT NULL AS lineage_known,'),
    (2, E'WHEN \'reading\' THEN \'reader:\' || coalesce(f.extractor, f.source_type)',
        E'WHEN \'reading\' THEN \'reader:unregistered\''),
    (3, E'\'img:\' || a.image_id ELSE \'obs:\' || a.item_id END, \'reader:\' || a.method,',
        E'\'img:\' || a.image_id ELSE \'obs:\' || a.item_id END, \'reader:unregistered\','),
    (4, E'           \'value\', CASE a.origin WHEN \'photo_text\' THEN \'text read in a photo of the differential: "\' || a.printed || \'"\'\n                                  ELSE \'a reader named the unit: "\' || a.printed || \'"\' END,',
        E'           \'value\', a.axle_type,'),
    (5, E'\'decoded\', jsonb_build_object(\'type\', a.axle_type, \'printed\', a.printed)),',
        E'\'decoded\', jsonb_build_object(\'type\', a.axle_type)),'),
    (6, E'  SELECT td.*, CASE cls WHEN \'decode\' THEN 0 WHEN \'receipt\' THEN 1 WHEN \'reading\' THEN 2 WHEN \'claim\' THEN 3 ELSE 4 END AS crank',
        E'  SELECT td.*, CASE WHEN cls = \'decode\' THEN 0 WHEN cls = \'receipt\' THEN 1\n                    WHEN cls = \'reading\' AND family <> \'reader:unregistered\' THEN 2 WHEN cls = \'claim\' THEN 3\n                    WHEN cls = \'reading\' THEN 4 ELSE 5 END AS crank'),
    (7, E'  SELECT key, norm, min(crank) AS best,',
        E'  SELECT key, norm, min(crank) AS best,\n         count(DISTINCT split_part(indep, \'|reader:\', 1)) FILTER (WHERE cls <> \'record\') AS n,'),
    (8, E'         count(DISTINCT r.indep) FILTER (WHERE r.cls <> \'record\') AS nind,',
        E'         count(DISTINCT split_part(r.indep, \'|reader:\', 1)) FILTER (WHERE r.cls <> \'record\') AS nind,\n         count(*) FILTER (WHERE r.cls = \'reading\') AS nread,\n         count(DISTINCT split_part(r.indep, \'|reader:\', 1)) FILTER (WHERE r.cls = \'reading\') AS nimg,\n         count(DISTINCT r.family) FILTER (WHERE r.cls = \'reading\') AS nfam_read,'),
    (9, E'         a.lead_val, a.lead_norm, a.lead_nk, a.rule, a.sources, a.strong, a.nraw,',
        E'         a.lead_val, a.lead_norm, a.lead_nk, a.rule, a.sources, a.strong, a.nraw, a.nread, a.nimg, a.nfam_read,'),
    (10, E'\'sources\', s.sources) ORDER BY s.best, s.norm)',
         E'\'sources\', s.sources, \'witnesses\', s.n) ORDER BY s.best, s.n DESC, s.norm)'),
    (11, E'    \'value\', CASE WHEN lead_nk IN (\'displacement\', \'number\') OR shared_class THEN lead_norm ELSE lead_val END,',
         E'    \'value\', CASE WHEN status = \'conflict\' THEN NULL WHEN lead_nk IN (\'displacement\', \'number\') OR shared_class THEN lead_norm ELSE lead_val END,'),
    (12, E'    \'stated\', CASE WHEN lead_nk IN (\'displacement\', \'number\') OR shared_class THEN lead_val END,',
         E'    \'stated\', CASE WHEN status <> \'conflict\' AND (lead_nk IN (\'displacement\', \'number\') OR shared_class) THEN lead_val END,'),
    (13, E'    \'normalized\', lead_norm, \'unit\', unit, \'status\', status,',
         E'    \'normalized\', CASE WHEN status <> \'conflict\' THEN lead_norm END, \'unit\', unit, \'status\', status,\n    \'agreement\', CASE WHEN nread > 0 THEN jsonb_build_object(\'readings\', nread, \'photos\', nimg, \'families\', nfam_read) END,'),
    (14, E'THEN \'a second independent read of the body tag\' ELSE needed END END)',
         E'THEN \'a second independent read of the body tag\'\n      WHEN status = \'reading\' THEN \'another photo of it read by a second reader family, or paper (a receipt or document) stating it\'\n      ELSE needed END END)'),
    -- the same wording where the body-tag decode patch (20261122071000) is not in the chain
    (15, E'    \'needed\', CASE WHEN status <> \'established\' THEN needed END)',
         E'    \'needed\', CASE WHEN status = \'reading\' THEN \'another photo of it read by a second reader family, or paper (a receipt or document) stating it\'\n      WHEN status <> \'established\' THEN needed END)'),
    -- each reader model of a photo stays its own row (so two readers of one family both show), while independence
    -- counts the photo alone (split_part on '|reader:', anchors 7 and 8). Registry-keyed and claim-role branches.
    (16, E'\'img:\' || o.image_id || CASE WHEN o.lineage_known THEN \'|reader:\' || o.lineage ELSE \'\' END',
         E'\'img:\' || o.image_id || \'|reader:\' || o.lineage || \'|model:\' || coalesce(o.agent_model, o.method)')
  ) x(ord, old, new) ORDER BY ord LOOP
    -- the axle branch (20261120090000) is not in every contract chain; where it is, it is patched
    IF r.ord IN (3, 4, 5) AND position('FROM axle_ev a' IN d) = 0 THEN CONTINUE; END IF;
    -- exactly one of 14 / 15 applies
    IF r.ord = 14 AND position(r.old IN d) = 0 THEN CONTINUE; END IF;
    IF r.ord = 15 AND position('second reader family' IN d) > 0 THEN CONTINUE; END IF;
    n := (length(d) - length(replace(d, r.old, ''))) / length(r.old);
    IF n <> (CASE WHEN r.ord = 16 THEN 2 ELSE 1 END) THEN RAISE EXCEPTION 'facet witness independence anchor % drifted: % matches', r.ord, n; END IF;
    d := replace(d, r.old, r.new);
  END LOOP;
  EXECUTE d;
END $patch$;
