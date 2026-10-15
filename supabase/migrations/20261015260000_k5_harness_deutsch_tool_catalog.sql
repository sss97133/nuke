-- RSI pass 41 on the harness model: the Deutsch solid-contact crimp tool and the 16-18 AWG size-20 socket join the parts
-- master, so the wire ends that name them can be keyed. Case ledger 13.12.3.
--
-- Live as anon at 20:55Z, 475 of 991 K5 wire ends are keyed to a crimp tool. Not one of the 58 Deutsch DT, DTP and
-- DTM ends is: their contacts (0460-202-16141, 0460-204-12141, 0462-201-20141, 0462-005-20141) mapped to no tool in
-- catalog/tools.yaml, although the DT and DTP families' crimp step already names the HDT-48-00. Nor are the 48 ends on
-- M81824/1 in-line splices, whose tool (the 3137CT) mapped only the D-609 numbers. The same PR maps both, each cited to
-- its vendor page (tools.yaml), and the loader now re-writes an end whose parts changed (it wrote an end once).
-- The 3137CT is in catalog_parts; the HDT-48-00 and the 0462-005-20141 socket are not, so key_harness_wire_ends
-- (pass 6) cannot key them. This pass adds those two rows with their sources, no price, stock or maker claim (the pass 6
-- rule), and runs the key fold.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.key_harness_wire_ends(uuid)') IS NULL THEN RAISE EXCEPTION 'RSI pass 6 (20261014163000) has not run'; END IF;
END $guard$;

INSERT INTO public.catalog_parts (part_number, name, description, category, subcategory, manufacturer, in_stock, supplier_url, application_data)
SELECT c.part_number, c.name, 'From the K5 build catalog (' || (c.app->>'source_file') || '); sources in application_data.',
       'wiring', c.subcategory, NULL, NULL, c.supplier_url, c.app
FROM (VALUES
  ('HDT-48-00', 'Deutsch HDT-48-00 solid-barrel crimp tool, size 20/16/12 solid contacts', 'tool',
   'https://www.prowireusa.com/deutsch-hdt-48-00-solid-barrel-crimp-tool.html',
   '{"supplier": "prowire", "source_file": "docs/wiring/calc-data/catalog/tools.yaml", "tool_code": "HDT-48-00", "sources": ["web_snapshots/www.prowireusa.com__deutsch-hdt-48-00-solid-barrel-crimp-tool.md (fetched 2026-10-15): ''the ideal option when crimping any of the Deutsch size 20, 16, 12 solid contacts''; related items 0460-202-16141, 0460-204-12141, 0462-201-20141, 0462-005-20141"], "loaded_by": "rsi pass 41", "for": ["SSC-N", "0460-202-16141", "0460-204-12141", "0462-201-20141", "0462-005-20141"]}'::jsonb),
  ('0462-005-20141', 'DEUTSCH size-20 solid socket, nickel, 16-18 AWG', 'contact',
   'https://www.prowireusa.com/p-701-deutsch-0462-005-20141-contact-18-16-ga.html',
   '{"supplier": "prowire", "source_file": "docs/wiring/calc-data/catalog/parts.yaml", "sources": ["DEUTSCH Contacts Catalog p.125 (PDF p.7) ''Solid Contacts - Common Contact System'' (parts.yaml)", "web_snapshots/www.prowireusa.com__deutsch-hdt-48-00-solid-barrel-crimp-tool.md related item ''SOC, SOLID, SIZE 20, 16-18 AWG, NI'' 0462-005-20141 (fetched 2026-10-15)"], "loaded_by": "rsi pass 41", "range_awg": [18, 16]}'::jsonb)
) AS c(part_number, name, subcategory, supplier_url, app)
WHERE NOT EXISTS (SELECT 1 FROM public.catalog_parts p WHERE p.part_number = c.part_number);

DO $check$
DECLARE keys int;
BEGIN
  keys := public.key_harness_wire_ends('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE NOTICE 'RSI pass 41 on the K5: % keys set', keys;
END $check$;

COMMIT;
