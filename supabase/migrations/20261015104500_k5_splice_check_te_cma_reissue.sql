-- Re-issue of 20261015103000_k5_splice_check_te_cma.sql, which failed on apply 2026-10-15 04:06Z and rolled back with
-- nothing written: its stack_needs row named a three-part column object (catalog_parts.application_data.range_cma) and
-- stack_needs_object_form allows table.column only. The object is now catalog_parts.application_data; the contract's
-- fixture now carries that constraint.
--
-- RSI pass 20 on the harness model: the splice fill check reads the splice maker's own figures. Case ledger 13.12.3.
--
-- RSI pass 16's check (v_harness_splice_check) sized each splice side by the AWG formula's circular mils against the
-- ProWire 3137CT cavity colours (catalog_parts range_awg: D-609-04 20-16 AWG, D-609-05 16-12 AWG). The maker states
-- the ranges in circular mils area (CMA) and its own CMA per gauge, and they differ:
--   - TE/Raychem specification control drawing D-609-03/-04/-05 "Crimp splicer, stub", issue 1, 31 Jan 2001:
--     D-609-03 300-1510, D-609-04 779-2680, D-609-05 1900-6755 CMA, footnote "Not all wire combinations falling
--     within the usable CMA range can be accommodated within the splicer barrel."
--     (TE product details for 680106-000 (D-609-05), https://www.te.com/en/product-680106-000.html, p.2; local copy
--     reference_documents/component_drawings/te_raychem_D-609-03-04-05_stub_splice_scd.pdf)
--   - TE/Raychem SCD D-436-60/-61 "Stub splice sealing system multi-wire", issue 1, 5 Dec 2000, same barrels as
--     D-609-04/-05: CMA per gauge 16 = 2426, 18 = 1900, 20 = 1216, 22 = 754, 24 = 475, 26 = 304, and wires per splice
--     by gauge (blue: 20 -> 2, 22 -> 2-3, 24 -> 2-5, 26 -> 3-8; yellow: 16 -> 2, 18 -> 2-3, 20 -> 2-5, 22 -> 3-8,
--     24 -> 4-10, 26 -> 9-10). (local copy reference_documents/component_drawings/te_raychem_D-436-60-61_multiwire_stub_splice_scd.pdf)
-- The AWG formula gives 22 AWG 642 CM; TE counts 754. Read-only on the K5 (2026-10-15): eight 22 AWG wires and a 20 AWG
-- lead (M130-B B16, group 1) are 6,156 CM by the formula, inside 16-12 AWG, and 7,248 CMA by TE, over D-609-05's 6,755.
--
-- This pass:
--   1. catalog_parts D-609-03/-04/-05 gain range_cma, cma_by_awg and wires_per_splice_by_awg (for -04/-05) with their
--      drawing citations.
--   2. v_harness_splice_check sizes a side by its part's cma_by_awg where the part carries one (formula otherwise) and
--      checks it against range_cma where present (range_awg otherwise); a new last column, area_basis, says which.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regclass('public.v_harness_splice_check') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 16 (20261015090000) has not run';
  END IF;
  IF (SELECT count(*) FROM public.catalog_parts WHERE part_number IN ('D-609-03', 'D-609-04', 'D-609-05')) <> 3 THEN
    RAISE EXCEPTION 'expected one catalog row each for D-609-03, -04 and -05';
  END IF;
END $guard$;

-- 1. The maker's figures on the three stub splices.
UPDATE public.catalog_parts p
SET application_data = coalesce(p.application_data, '{}'::jsonb) || jsonb_build_object(
      'range_cma', x.range_cma,
      'cma_by_awg', '{"16": 2426, "18": 1900, "20": 1216, "22": 754, "24": 475, "26": 304}'::jsonb,
      'wires_per_splice_by_awg', x.counts,
      'cma_sources', jsonb_build_array(
        'TE/Raychem SCD D-609-03/-04/-05 Crimp splicer, stub, issue 1, 31 Jan 2001 (TE product details for 680106-000 (D-609-05), https://www.te.com/en/product-680106-000.html, p.2): CMA range; "Not all wire combinations falling within the usable CMA range can be accommodated within the splicer barrel."',
        'TE/Raychem SCD D-436-60/-61 Stub splice sealing system multi-wire, issue 1, 5 Dec 2000 (same barrels as D-609-04/-05): CMA per gauge and wires per splice by gauge'))
FROM (VALUES
  ('D-609-03', '[300, 1510]'::jsonb, NULL::jsonb),
  ('D-609-04', '[779, 2680]'::jsonb, '{"20": [2, 2], "22": [2, 3], "24": [2, 5], "26": [3, 8]}'::jsonb),
  ('D-609-05', '[1900, 6755]'::jsonb, '{"16": [2, 2], "18": [2, 3], "20": [2, 5], "22": [3, 8], "24": [4, 10], "26": [9, 10]}'::jsonb)) x(part_number, range_cma, counts)
WHERE p.part_number = x.part_number;

-- 2. The check on those figures.
CREATE OR REPLACE VIEW public.v_harness_splice_check AS
WITH m AS (
  SELECT h.vehicle_id, h.id AS splice_id, h.splice_code, h.placement, h.part_number, h.part_id, h.endpoint_id, h.cavity,
         coalesce(mm.side, 0) AS side, mm.ordinal, mm.member_label,
         coalesce(c.wire_gauge_awg::numeric, substring(mm.member_label FROM '^([0-9]+) AWG')::numeric) AS awg,
         p.application_data->'cma_by_awg' AS cma_table
  FROM public.harness_splices h
  JOIN public.vehicles v ON v.id = h.vehicle_id AND v.is_public IS TRUE
  JOIN public.harness_splice_members mm ON mm.splice_id = h.id
  LEFT JOIN public.vehicle_custom_circuits c ON c.id = mm.circuit_id
  LEFT JOIN public.catalog_parts p ON p.id = h.part_id
  WHERE NOT h.is_superseded),
mc AS (
  SELECT m.*,
         CASE WHEN m.awg IS NULL THEN NULL
              WHEN m.cma_table ? (m.awg::int)::text THEN (m.cma_table->>((m.awg::int)::text))::numeric
              ELSE power(5 * power(92::numeric, (36 - m.awg) / 39), 2) END AS cma,
         m.awg IS NOT NULL AND m.cma_table IS NOT NULL AND NOT (m.cma_table ? (m.awg::int)::text) AS formula_fallback
  FROM m),
sides AS (
  SELECT vehicle_id, splice_id, splice_code, placement, part_number, part_id, endpoint_id, cavity, side,
         count(*) AS conductors, count(*) FILTER (WHERE awg IS NULL) AS gauges_unknown,
         string_agg(member_label || CASE WHEN awg IS NOT NULL AND member_label !~ '^[0-9]+ AWG' THEN ' (' || awg || ' AWG)' ELSE '' END, ', '
                    ORDER BY ordinal) AS conductors_named,
         round(sum(cma)) AS circular_mils,
         bool_or(cma_table IS NOT NULL) AS maker_table, bool_or(formula_fallback) AS any_fallback
  FROM mc GROUP BY vehicle_id, splice_id, splice_code, placement, part_number, part_id, endpoint_id, cavity, side),
rng AS (
  SELECT p.id,
         CASE WHEN jsonb_typeof(p.application_data->'range_cma') = 'array' THEN (p.application_data->'range_cma'->>0)::numeric
              ELSE round(power(5 * power(92::numeric, (36 - greatest((p.application_data->'range_awg'->>0)::numeric, (p.application_data->'range_awg'->>1)::numeric)) / 39), 2)) END AS min_cm,
         CASE WHEN jsonb_typeof(p.application_data->'range_cma') = 'array' THEN (p.application_data->'range_cma'->>1)::numeric
              ELSE round(power(5 * power(92::numeric, (36 - least((p.application_data->'range_awg'->>0)::numeric, (p.application_data->'range_awg'->>1)::numeric)) / 39), 2)) END AS max_cm,
         jsonb_typeof(p.application_data->'range_cma') = 'array' AS maker_range
  FROM public.catalog_parts p
  WHERE jsonb_typeof(p.application_data->'range_cma') = 'array'
     OR (jsonb_typeof(p.application_data->'range_awg') = 'array' AND jsonb_array_length(p.application_data->'range_awg') = 2)),
pin_lead AS (
  SELECT DISTINCT h.endpoint_id, h.cavity
  FROM public.harness_splices h JOIN public.harness_splice_members mm ON mm.splice_id = h.id
  WHERE NOT h.is_superseded AND h.placement = 'at_pin' AND mm.circuit_id IS NULL AND mm.member_label ~* '\mpin lead\M')
SELECT s.vehicle_id, s.splice_id, s.splice_code, s.placement, s.part_number, s.side, s.conductors, s.conductors_named, s.gauges_unknown,
       s.circular_mils, r.min_cm AS part_min_circular_mils, r.max_cm AS part_max_circular_mils,
       CASE WHEN r.id IS NULL THEN 'part range unknown'
            WHEN s.circular_mils > r.max_cm * 1.005 THEN 'over the crimp range'
            WHEN s.gauges_unknown > 0 THEN 'gauge unknown'
            WHEN s.placement = 'at_pin' AND pl.endpoint_id IS NULL THEN 'lead into the pin not named'
            WHEN s.circular_mils < r.min_cm * 0.995 THEN 'under the crimp range'
            ELSE 'fits' END AS status,
       CASE WHEN r.id IS NULL THEN NULL
            WHEN r.maker_range AND s.maker_table AND NOT s.any_fallback THEN 'maker: CMA range and CMA per gauge (TE/Raychem SCD)'
            WHEN r.maker_range AND s.maker_table THEN 'maker: CMA range and CMA per gauge; AWG formula for a gauge the maker''s table lacks'
            WHEN r.maker_range THEN 'maker CMA range; AWG formula for the conductors'
            ELSE 'AWG formula against the crimp tool''s AWG cavity range' END AS area_basis
FROM sides s
LEFT JOIN rng r ON r.id = s.part_id
LEFT JOIN pin_lead pl ON pl.endpoint_id = s.endpoint_id AND pl.cavity = s.cavity;
COMMENT ON VIEW public.v_harness_splice_check IS 'Per side of each live splice of a public vehicle (side 0: every conductor enters one end): its conductors with their gauge, their combined area and the splice part''s crimp range. Area and range come from the maker''s figures where the part carries them (catalog_parts cma_by_awg and range_cma: TE/Raychem SCDs D-609 and D-436 for the MiniSeal stub splices), else from the AWG formula against the crimp tool''s AWG cavity range; area_basis says which. status: fits; over or under the crimp range; gauge unknown; part range unknown; or, for a splice beside a pin, lead into the pin not named. Over is reported even when a gauge is unknown. RSI passes 16 and 20, case ledger 13.12.3.';
REVOKE ALL ON public.v_harness_splice_check FROM anon, authenticated;
GRANT SELECT ON public.v_harness_splice_check TO anon, authenticated;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'key', 'column', 'catalog_parts.application_data', NULL, 'range_cma and cma_by_awg: the splice maker''s CMA range and CMA per gauge on each stub splice');

COMMIT;
