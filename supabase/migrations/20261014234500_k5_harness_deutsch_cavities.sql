-- RSI pass 9 on the K5 harness model: Deutsch DT and DTP cavities, and the K5 wire ends on them keyed. Case ledger
-- 13.12.2 / 13.12.3.
--
-- After pass 2 (cited D38999 25-61 and Superseal models), 295 of 884 K5 wire ends on live segments were keyed to a
-- cavity. 49 more sit in Deutsch DT / DTP housings whose plugs name their housing part numbers (harness_endpoints.
-- part_number: DT04-08PA / DT06-08SA on the door pass-throughs, DT04-12PA-L012 and DT04-12PB-L012 on the retired body
-- bulkheads, DTP04-4P on the door power pass-throughs, DT06-2S / DT04-2P on the fuel level sender, DTP06-2S / DTP04-2P on
-- the fuel pump), and whose cavities the build rows number 1-N. Measured read-only 2026-10-14. The WIDEBAND plug names no
-- part number and stays unkeyed.
--
-- Sources: each housing's vendor page as stored (reference_documents/web_snapshots, local) states its cavity count in
-- its product heading ("DT04-08PA - DEUTSCH DT 8 Way Gray Receptacle Connector, A Key", and likewise DT 12 A and B key,
-- DT 6, DT 2, DTP 4, DTP 2). Numbering only: Deutsch numbers the cavities on the housing face and the build rows use the
-- same numbers; positions are not transcribed from a drawing. No housing part per model: a layout serves both halves.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'connector_cavity_layouts' AND column_name = 'source') THEN
    RAISE EXCEPTION 'RSI pass 2 (20261014123000) has not run';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connector_cavity_layouts WHERE connector_model LIKE 'Deutsch DT%') THEN
    RAISE EXCEPTION 'Deutsch models already present';
  END IF;
END $guard$;

CREATE TEMP TABLE dt9 (series text, ways int, model text, src text) ON COMMIT DROP;
INSERT INTO dt9 VALUES
  ('DT', 2, 'Deutsch DT 2-way', 'customconnectorkits.com DT04-2P / DT06-2S product pages ("DEUTSCH DT 2 Way"), stored 2026-09-28: https://www.customconnectorkits.com/products/dt04-2p, https://www.customconnectorkits.com/products/dt06-2s'),
  ('DT', 6, 'Deutsch DT 6-way', 'customconnectorkits.com DT04-6P-L012 product page ("DEUTSCH DT 6 Way"), stored 2026-09-28: https://www.customconnectorkits.com/products/dt04-6p-l012'),
  ('DT', 8, 'Deutsch DT 8-way', 'customconnectorkits.com DT04-08PA product page ("DEUTSCH DT 8 Way ... A Key"), stored 2026-09-28: https://www.customconnectorkits.com/products/dt04-08pa'),
  ('DT', 12, 'Deutsch DT 12-way', 'customconnectorkits.com DT04-12PA-L012, DT06-12SA, DT04-12PB-L012, DT06-12SB product pages ("DEUTSCH DT 12 Way", A and B key), stored 2026-09-28: https://www.customconnectorkits.com/dt04-12pa-l012, https://www.customconnectorkits.com/dt04-12pb-l012'),
  ('DTP', 2, 'Deutsch DTP 2-way', 'customconnectorkits.com DTP04-2P / DTP06-2S product pages ("DEUTSCH DTP 2 Way"), stored 2026-09-28: https://www.customconnectorkits.com/products/dtp04-2p, https://www.customconnectorkits.com/products/dtp06-2s'),
  ('DTP', 4, 'Deutsch DTP 4-way', 'customconnectorkits.com DTP04-4P and DTP04-4P-L012 product pages ("DEUTSCH DTP 4 Way"), stored 2026-09-28: https://www.customconnectorkits.com/products/dtp04-4p, https://www.customconnectorkits.com/dtp04-4p-l012');

INSERT INTO public.connector_cavity_layouts (connector_model, cavity_id, position_index, source, method)
SELECT d.model, n::text, n, d.src, 'numbering only: cavity count from the vendor page; cavities 1-N as Deutsch numbers them on the housing face and the build rows name them; positions not transcribed'
FROM dt9 d CROSS JOIN LATERAL generate_series(1, d.ways) n;

-- K5 wire ends on a Deutsch plug: the plug's first DT/DTP housing number gives series and ways; the cavity text's
-- leading number, when in range, gives the cavity.
CREATE TEMP TABLE dt9_ends ON COMMIT DROP AS
SELECT t.id AS termination_id, x.series, x.ways, substring(t.cavity FROM '^\s*([0-9]+)')::int AS num
FROM public.wire_termination_specs t
JOIN public.harness_endpoints e ON e.id = t.endpoint_id
CROSS JOIN LATERAL (
  SELECT m[1] AS series, m[2]::int AS ways
  FROM regexp_matches(upper(coalesce(e.part_number, '')), '\m(DTP|DT)0[46]-0?([0-9]+)', 'g') AS m
  LIMIT 1) x
WHERE t.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT coalesce(t.is_superseded, false)
  AND t.connector_family IN ('dt', 'dtp', 'dtm');

UPDATE public.wire_termination_specs t SET cavity_layout_id = l.id
FROM dt9_ends k JOIN dt9 d ON d.series = k.series AND d.ways = k.ways
JOIN public.connector_cavity_layouts l ON l.connector_model = d.model AND l.cavity_id = k.num::text
WHERE t.id = k.termination_id AND t.cavity_layout_id IS NULL AND k.num BETWEEN 1 AND k.ways;

DO $check$
DECLARE keyed int; candidates int; out_of_range int; total int; cav int;
BEGIN
  SELECT count(*) FILTER (WHERE t.cavity_layout_id IS NOT NULL), count(*), count(*) FILTER (WHERE k.num IS NULL OR k.num NOT BETWEEN 1 AND k.ways)
    INTO keyed, candidates, out_of_range
  FROM dt9_ends k JOIN public.wire_termination_specs t ON t.id = k.termination_id;
  SELECT numerator, denominator INTO cav, total FROM public.v_harness_coverage
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND measure = 'wire ends keyed to a cavity';
  RAISE NOTICE 'RSI pass 9: % of % Deutsch wire ends keyed (% without a cavity number in range); K5 wire ends keyed to a cavity % of %',
    keyed, candidates, out_of_range, cav, total;
END $check$;

COMMIT;
