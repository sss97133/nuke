-- RSI pass 2 on the K5 harness model: a cited cavity library and wire ends keyed to it. Case ledger 13.12.2; schema
-- proposal d3c978f1 (approved for build 2026-10-14).
--
-- The SH scoreboard after pass 1 (v_harness_coverage, read-only 2026-10-14): 0 of 884 K5 wire ends on live segments
-- keyed to a cavity, the largest key gap. The cavity library could not be matched: connector_cavity_layouts (394 rows,
-- 46 models) carries no provenance; its two D38999 61-way models name cavities R1P1..R4P8 on evenly spaced rings,
-- where MIL-STD-1560 arrangement 25-61 names them A-Z, a-z, AA-PP on five rings of 23 / 19 / 12 / 6 / 1; its Superseal
-- 34 and 26 models name rows A-D, where the housings number cavities 1-34 and 1-26 (MoTeC pin A13 is cavity 13 of
-- connector A). The K5's wire ends already say which cavity they occupy (cavity text on 853 of the 884), so the gap was
-- the library, not the evidence.
--
-- This pass:
--   1. connector_cavity_layouts gets source and method; null means not cited. The 394 existing rows stay as they are,
--      uncited, and stack need 'connector_cavity_layouts.source' counts them.
--   2. Three cited models:
--      MIL-DTL-38999 III 25-61: the 61 designators of MILNEC TX Series insert arrangements p.B-20 (25-61 = 61 x #20,
--        shell 25) and p.B-22 (front face of the pin insert), as transcribed with coordinates on 2026-06-10 in
--        scripts/generate_connector_build_sheets.py (CAV_XY). Ring and position come from those coordinates: radii from
--        PP cluster into 1 / 6 / 12 / 19 / 23, contiguous in designator order (A-Z outer, a-u, v-GG, HH-NN, PP centre).
--        Contact #20, 7.5 A, 20-24 AWG per CONNECTOR_DATA_REPORT.md section 1.3 (docs/wiring/reference/connectors, kept
--        out of git by the *_REPORT.md ignore rule; restated as source [3] of the build-sheet script; the wire range also in
--        docs/wiring/calc-data/catalog/families.yaml d38999_20). No mm offsets: the
--        transcription is in drawing pixels and the drawing's scale is not cited. No housing part: the receptacle
--        D38999/24WJ61SN and plug D38999/26WJ61PN are not in catalog_parts.
--      TE Superseal 1.0 34-way key 1 and 26-way key 1: cavities 1-34 and 1-26, housing parts MoTeC 65044 (TE
--        4-1437290-0) and 65045 (TE 3-1437290-7) from catalog_parts. Numbering only: row and column are not cited (the
--        TE drawing is not in the repo; the build-sheet script's 9/8/8/9 row rule says to verify the moulded numbers).
--   3. K5 wire ends keyed: bulkhead halves (FIREWALL-CABIN, FIREWALL-ENGINE, family d38999_20) by exact designator, case
--      kept ('j' and 'J' are different cavities); M130, PDM30 and PDM15 connectors A and B (family ssc) by number when the
--      cavity's letter is the plug's letter and the number is in range. Measured before: 116 + 179 = 295 keyable, 0
--      malformed. The Superseal ends and their plugs also get the housing part.
-- Keys are resolutions of what the rows already say; no testimony value changes.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_proposals WHERE id = 'd3c978f1-aa13-4d27-81c5-ba2decbdf496' AND status = 'approved') THEN
    RAISE EXCEPTION 'schema proposal d3c978f1 is not approved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stacks WHERE stack_id = 'SH' AND version = 1) THEN
    RAISE EXCEPTION 'RSI pass 1 (20261014113000) has not run';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'connector_cavity_layouts' AND column_name = 'source') THEN
    RAISE EXCEPTION 'connector_cavity_layouts.source already exists';
  END IF;
  IF (SELECT count(*) FROM public.catalog_parts WHERE (id, part_number) IN (('d501615e-7546-4806-a272-c4f24b36feb5', '65044'), ('3c2f8db8-8802-4d34-8474-a1054a9beb1c', '65045'))) <> 2 THEN
    RAISE EXCEPTION 'the Superseal housing parts 65044 / 65045 are not where this pass expects them';
  END IF;
END $guard$;

-- 1. Schema.
ALTER TABLE public.connector_cavity_layouts ADD COLUMN source text, ADD COLUMN method text;
COMMENT ON TABLE public.connector_cavity_layouts IS 'Grain: one cavity of one connector insert or housing model. The dimension wire ends key to (wire_termination_specs.cavity_layout_id). Rows with a null source are uncited (seed rows from before 2026-10); cited models since RSI pass 2 (20261014123000).';
COMMENT ON COLUMN public.connector_cavity_layouts.connector_model IS 'The insert arrangement or housing model, named by its standard or maker (MIL-DTL-38999 III 25-61, TE Superseal 1.0 34-way key 1).';
COMMENT ON COLUMN public.connector_cavity_layouts.cavity_id IS 'The cavity designator as moulded or as the standard names it; case-sensitive (D38999 j and J are different cavities).';
COMMENT ON COLUMN public.connector_cavity_layouts.row_index IS 'Row of a gridded housing, when the source gives it.';
COMMENT ON COLUMN public.connector_cavity_layouts.col_index IS 'Column of a gridded housing, when the source gives it.';
COMMENT ON COLUMN public.connector_cavity_layouts.ring_index IS 'Ring of a circular insert; 0 is the centre cavity on cited models.';
COMMENT ON COLUMN public.connector_cavity_layouts.position_index IS 'Order within the ring (circular) or within the housing (sequential numbering).';
COMMENT ON COLUMN public.connector_cavity_layouts.x_offset_mm IS 'Cavity centre from the insert centre, mm, when the source gives a scale.';
COMMENT ON COLUMN public.connector_cavity_layouts.y_offset_mm IS 'Cavity centre from the insert centre, mm, when the source gives a scale.';
COMMENT ON COLUMN public.connector_cavity_layouts.contact_size IS 'Contact size the cavity takes (#20, #16).';
COMMENT ON COLUMN public.connector_cavity_layouts.max_current_amps IS 'Rated current of the contact in this cavity, A.';
COMMENT ON COLUMN public.connector_cavity_layouts.wire_gauge_range IS 'Wire sizes the contact accepts.';
COMMENT ON COLUMN public.connector_cavity_layouts.source IS 'The document this row was transcribed from. Null: not cited.';
COMMENT ON COLUMN public.connector_cavity_layouts.method IS 'How the row was made from its source: transcribed, derived from transcribed values, or numbering only.';

-- 2. Three cited models.
INSERT INTO public.connector_cavity_layouts (connector_model, cavity_id, ring_index, position_index, contact_size, max_current_amps, wire_gauge_range, source, method)
SELECT 'MIL-DTL-38999 III 25-61', c, ring, pos, '#20', 7.5, '20-24 AWG',
  'MILNEC TX Series MIL-DTL-38999 Series III insert arrangements, p.B-20 (25-61: 61 x #20, shell 25) and p.B-22 (front face of pin insert); designators and coordinates transcribed 2026-06-10 in scripts/generate_connector_build_sheets.py (CAV_XY); contact #20, 7.5 A, 20-24 AWG from CONNECTOR_DATA_REPORT.md section 1.3 (local, gitignored; restated as source [3] of that script) and docs/wiring/calc-data/catalog/families.yaml (d38999_20 wire_range_awg 24-20)',
  'designators transcribed; ring and position derived from the transcribed coordinates (radius from PP); no mm offsets (drawing scale not cited)'
FROM (VALUES
  ('A', 4, 1), ('B', 4, 2), ('C', 4, 3), ('D', 4, 4), ('E', 4, 5), ('F', 4, 6), ('G', 4, 7), ('H', 4, 8),
  ('J', 4, 9), ('K', 4, 10), ('L', 4, 11), ('M', 4, 12), ('N', 4, 13), ('P', 4, 14), ('R', 4, 15), ('S', 4, 16),
  ('T', 4, 17), ('U', 4, 18), ('V', 4, 19), ('W', 4, 20), ('X', 4, 21), ('Y', 4, 22), ('Z', 4, 23), ('a', 3, 1),
  ('b', 3, 2), ('c', 3, 3), ('d', 3, 4), ('e', 3, 5), ('f', 3, 6), ('g', 3, 7), ('h', 3, 8), ('i', 3, 9),
  ('j', 3, 10), ('k', 3, 11), ('m', 3, 12), ('n', 3, 13), ('p', 3, 14), ('q', 3, 15), ('r', 3, 16), ('s', 3, 17),
  ('t', 3, 18), ('u', 3, 19), ('v', 2, 1), ('w', 2, 2), ('x', 2, 3), ('y', 2, 4), ('z', 2, 5), ('AA', 2, 6),
  ('BB', 2, 7), ('CC', 2, 8), ('DD', 2, 9), ('EE', 2, 10), ('FF', 2, 11), ('GG', 2, 12), ('HH', 1, 1), ('JJ', 1, 2),
  ('KK', 1, 3), ('LL', 1, 4), ('MM', 1, 5), ('NN', 1, 6), ('PP', 0, 1)) v(c, ring, pos);

INSERT INTO public.connector_cavity_layouts (connector_model, cavity_id, position_index, housing_part_id, source, method)
SELECT m.model, n::text, n, m.part, m.src, 'numbering only; row and column not cited'
FROM (VALUES
  ('TE Superseal 1.0 34-way key 1', 34, 'd501615e-7546-4806-a272-c4f24b36feb5'::uuid,
   'MoTeC 65044 34 Pin Superseal Connector Kit (TE 4-1437290-0, keying 1), catalog_parts; cavities numbered 1-34 as the MoTeC M130 / PDM pin tables name them (A01-A34)'),
  ('TE Superseal 1.0 26-way key 1', 26, '3c2f8db8-8802-4d34-8474-a1054a9beb1c'::uuid,
   'MoTeC 65045 26 Pin Superseal Connector Kit (TE 3-1437290-7, keying 1), catalog_parts; cavities numbered 1-26 as the MoTeC M130 / PDM pin tables name them (B01-B26)')
) m(model, ways, part, src)
CROSS JOIN LATERAL generate_series(1, m.ways) n;

-- 3. K5 wire ends keyed to those cavities.
CREATE TEMP TABLE k5_cav ON COMMIT DROP AS
SELECT t.id AS termination_id, ep.id AS endpoint_id, ep.code,
  CASE WHEN ep.code IN ('FIREWALL-CABIN', 'FIREWALL-ENGINE') AND t.connector_family = 'd38999_20' THEN 'MIL-DTL-38999 III 25-61'
       WHEN ep.code ~ '^(M130|PDM30|PDM15)-A$' AND t.connector_family = 'ssc' THEN 'TE Superseal 1.0 34-way key 1'
       WHEN ep.code ~ '^(M130|PDM30|PDM15)-B$' AND t.connector_family = 'ssc' THEN 'TE Superseal 1.0 26-way key 1' END AS model,
  CASE WHEN t.connector_family = 'd38999_20' THEN t.cavity
       WHEN substring(t.cavity FROM '^([AB])0*[1-9][0-9]?$') = right(ep.code, 1)
       THEN substring(t.cavity FROM '^[AB]0*([1-9][0-9]?)$') END AS cavity_id
FROM public.wire_termination_specs t
JOIN public.harness_endpoints ep ON ep.id = t.endpoint_id
WHERE t.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT coalesce(t.is_superseded, false);
DELETE FROM k5_cav WHERE model IS NULL;

UPDATE public.wire_termination_specs t SET cavity_layout_id = l.id
FROM k5_cav k JOIN public.connector_cavity_layouts l ON l.connector_model = k.model AND l.cavity_id = k.cavity_id
WHERE t.id = k.termination_id AND t.cavity_layout_id IS NULL;

UPDATE public.wire_termination_specs t SET connector_housing_catalog_id = l.housing_part_id
FROM (SELECT DISTINCT k.termination_id, k.model FROM k5_cav k) k
JOIN (SELECT DISTINCT connector_model, housing_part_id FROM public.connector_cavity_layouts WHERE housing_part_id IS NOT NULL) l ON l.connector_model = k.model
WHERE t.id = k.termination_id AND t.connector_housing_catalog_id IS NULL;

UPDATE public.harness_endpoints ep SET catalog_part_id = l.housing_part_id
FROM (SELECT DISTINCT k.endpoint_id, k.model FROM k5_cav k) k
JOIN (SELECT DISTINCT connector_model, housing_part_id FROM public.connector_cavity_layouts WHERE housing_part_id IS NOT NULL) l ON l.connector_model = k.model
WHERE ep.id = k.endpoint_id AND ep.catalog_part_id IS NULL;

-- The scoreboard counts the library's citations.
INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'dimension', 'column', 'connector_cavity_layouts.source', 'connector_cavity_layouts.id', 'cavity layout rows with a cited source');

-- Result.
DO $check$
DECLARE keyed int; unkeyed int; housings int; plugs int; cited int; total int;
BEGIN
  SELECT count(*) FILTER (WHERE t.cavity_layout_id IS NOT NULL), count(*) FILTER (WHERE t.cavity_layout_id IS NULL AND k.cavity_id IS NOT NULL)
    INTO keyed, unkeyed
  FROM k5_cav k JOIN public.wire_termination_specs t ON t.id = k.termination_id;
  IF unkeyed > 0 THEN
    RAISE EXCEPTION '% K5 wire ends name a cavity of a cited model and were not keyed', unkeyed;
  END IF;
  SELECT count(*) INTO housings FROM k5_cav k JOIN public.wire_termination_specs t ON t.id = k.termination_id WHERE t.connector_housing_catalog_id IS NOT NULL;
  SELECT count(DISTINCT k.endpoint_id) INTO plugs FROM k5_cav k JOIN public.harness_endpoints ep ON ep.id = k.endpoint_id WHERE ep.catalog_part_id IS NOT NULL;
  SELECT count(source), count(*) INTO cited, total FROM public.connector_cavity_layouts;
  RAISE NOTICE 'RSI pass 2: % wire ends keyed to a cavity, % to a housing part, % plugs keyed to a housing, % of % cavity rows cited',
    keyed, housings, plugs, cited, total;
END $check$;

COMMIT;
