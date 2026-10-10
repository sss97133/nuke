-- Describe wire_termination_specs: the 40 columns with no COMMENT ON COLUMN (4 of 44 described before, v_schema_atlas
-- on prod, 2026-10-10 08:30Z) and a corrected table comment. Comments only; no wiring data or design call changes.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-10 08:32-08:40Z UTC):
--   Columns, defaults, constraints, indexes, triggers and policies from information_schema, pg_constraint, pg_indexes,
--   pg_trigger and pg_policy; fill and categorical counts on the whole table (4,149 rows). Writers from code at
--   origin/main 483775947: supabase/migrations/20260927030100_wiring_map_typed_rows.sql (adds circuit_id, endpoint_id,
--   wire_code, cavity, the DNA columns and supersession; the CREATE TABLE is in no migration file: drift),
--   20260927040100_wiring_map_supersession_keys.sql (wire_number nullable), the wire-end section of
--   docs/wiring/calc-data/load_map_rows.py (REST with the service key; inserts with --with-ends, retires changed or
--   dropped ends by setting is_superseded), and scripts/populate-termination-specs.mjs (the April 2026 backfill,
--   upsert on vehicle_id + wire_number + endpoint_side). pipeline_registry names load_map_rows.py as owner
--   (20261007003007_declare_table_owners_2.sql). Readers: nuke_frontend/src/components/wiring/map/useWiringMap.ts and
--   the map components beside it (read only).
-- Rows by generation (2026-10-10 08:32Z):
--   loader rows (circuit_id set): 4,073, created 2026-09-27 .. 2026-09-29, all method 'registry loader', trust T3;
--   891 live, 3,182 superseded (marked by later loader runs, superseded_by never set).
--   April rows (circuit_id NULL): 76, created 2026-04-12 on a different vehicle id than the loader's (the one
--   hard-coded in populate-termination-specs.mjs; the loader uses its own constant K5). Whether the two ids are one
--   physical vehicle is not established here. These 76 rows carry 76 distinct wire_number values (one end per wire,
--   22 source / 54 device) and the opposite contact genders and other pin counts than the script on main writes, so
--   they came from another version of that writer (Unknown which).
-- LIMITS:
--   Part numbers are design choices from the K5 registry and catalog files (trust T3), not observed installed parts.
--   None of the seven *_catalog_id keys is filled on any row. Inventory columns (in_stock, qty_on_hand) are defaults
--   on every row: no writer sets them.
-- CHANGED EXISTING COMMENTS:
--   Table comment: it said "Each wire has 2 rows (source + device side)"; the loader writes one row per wire end
--   (1 to 6 live ends per wire: 245 wires with 2, 50 with 3, 56 with 4, 2 with 6, 15 with 1), and the April rows hold
--   one end per wire_number. The four existing column comments are kept.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.wire_termination_specs IS
'Wiring design records, one row per wire end: the wire (circuit_id to vehicle_custom_circuits), the node it lands on (endpoint_id to harness_endpoints), the cavity, and the terminal, seal and tool part numbers chosen for it. 4,149 rows (2026-10-10): 4,073 from the wiring map loader docs/wiring/calc-data/load_map_rows.py (2026-09-27 .. 09-29; 891 live, 3,182 superseded) and 76 earlier rows from the April 2026 backfill scripts/populate-termination-specs.mjs (keyed by wire_number + endpoint_side, no circuit). A wire has as many rows as it has ends in the registry (1 to 6 live). Design records at trust T3, not observations of installed parts; corrections supersede (is_superseded), never edit in place. RLS: read policy true, write policy service_role only; the wiring map (useWiringMap.ts) reads live loader rows. Clocks: observed_at is the loader run time, created_at the insert time; there is no event time.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.wire_termination_specs.id IS
'Surrogate key of the row. Unit: none (uuid). Source: gen_random_uuid() default. Referenced only by this table''s own superseded_by (2026-10-10). Grain: one wire end (one design generation). Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.vehicle_id IS
'The vehicle the wiring design is for. Unit: none (uuid, foreign key to vehicles, ON DELETE CASCADE). Source: a constant in each writer; 2 distinct values on prod (2026-10-10): the loader''s K5 constant on all 4,073 loader rows and the id hard-coded in populate-termination-specs.mjs on the 76 April rows. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.circuit_id IS
'The wire this end belongs to. Unit: none (uuid, foreign key to vehicle_custom_circuits, ON DELETE SET NULL). Source: load_map_rows.py, the live v5 registry wire with the same code. Filled on all 4,073 loader rows, NULL on the 76 April rows. With endpoint_id it is the live key: unique index wire_termination_specs_end_live on (circuit_id, endpoint_id) where not superseded. No live end points at a superseded wire (0 rows, 2026-10-10). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.endpoint_id IS
'The map node (plug, device, splice or stud) this end lands on. Unit: none (uuid, foreign key to harness_endpoints, ON DELETE SET NULL). Source: load_map_rows.py, the node whose code is the registry termination''s endpoint. Filled and resolving on all 4,073 loader rows; NULL on the April rows. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.wire_code IS
'The wire''s code in the K5 registry as text (for example a number with a suffix such as g or r, or a named signal), which wire_number (an integer) cannot hold. Unit: text. Source: load_map_rows.py, str(termination.wire); filled on the 4,073 loader rows. Text copy of the circuit''s code, kept with the end; the key is circuit_id. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.cavity IS
'The cavity (pin position) of the connector at the node where this end is inserted. Unit: text, the connector''s own cavity label. Source: load_map_rows.py, termination.cavity from the registry. Filled on 853 of the 891 live loader rows; NULL where the registry termination has no cavity (2026-10-10). Grain: one wire end. Clock: n/a.';

-- ── Connector and terminal ──────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.wire_termination_specs.connector_housing_pn IS
'Part number of the connector housing the end plugs into. Unit: text part number. Source: April rows only, from the termination rule table in populate-termination-specs.mjs (housing pattern with the pin count substituted); filled on 66 of the 76 April rows and on none of the loader rows, which take the housing from the node (harness_endpoints) instead (2026-10-10). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.connector_housing_catalog_id IS
'Intended key of the housing in catalog_parts (foreign key). NULL on all 4,149 rows (2026-10-10): no writer resolves part numbers to the catalog. Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.connector_pin_count IS
'Number of cavities in the connector housing. Unit: count. April rows only: 61 on the 22 source-side rows (the 61-pin D38999 bulkhead) and 2 on the 54 device-side rows; NULL on all loader rows (2026-10-10). The script on main writes 12 for the source side, so these values came from another version of it. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.terminal_contact_pn IS
'Part number of the crimp contact (pin or socket) or terminal on this end. Unit: text part number. Source: load_map_rows.py, the first code of the registry termination''s part field (codes joined by " + "); April rows from the rule table. Filled on 4,139 of 4,149 rows (2026-10-10). A design choice, not an observed installed part. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.terminal_contact_catalog_id IS
'Intended key of the contact in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.contact_gender IS
'Contact gender: male (pin) or female (socket) (CHECK). April rows only: male on the 22 source rows, female on the 54 device rows; NULL on all loader rows (2026-10-10). The script on main writes the opposite (source female, device male). Unit: text class. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.pin_seal_pn IS
'Part number of the single-wire seal fitted with the contact. Unit: text part number. Source: load_map_rows.py, the second code of the registry part field when present; April rows from the rule table. Filled on 444 rows overall, 87 of 891 live loader rows (2026-10-10). NULL means no seal was named, not that none is needed. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.pin_seal_catalog_id IS
'Intended key of the seal in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.wedge_lock_pn IS
'Part number of the connector''s wedge lock (secondary lock). Unit: text part number. April rows only, from the rule table for Deutsch families: filled on 13 rows (2026-10-10); the loader does not set it. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.wedge_lock_catalog_id IS
'Intended key of the wedge lock in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.crimp_tool_pn IS
'Part number (or catalog key) of the crimp tool for this contact. Unit: text. Source: load_map_rows.py, looked up from docs/wiring/calc-data/catalog/tools.yaml by the contact part number (the tool whose "for" list names it); April rows from the rule table. Filled on 1,935 rows overall, 419 of 891 live loader rows (2026-10-10); NULL where tools.yaml names no tool for the contact. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.crimp_tool_catalog_id IS
'Intended key of the crimp tool in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';

-- ── Finish, label and protection (April rows only) ──────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.wire_termination_specs.heat_shrink_pn IS
'Part number of the heat-shrink sleeve at this end. NULL on all 4,149 rows (2026-10-10) although the April script computes one; the April rows hold only heat_shrink_size. Unit: text part number. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.heat_shrink_size IS
'Heat-shrink size for the wire gauge, as text in inches (for example 3/16"). Unit: text (inches). Source: the gauge-to-size table in populate-termination-specs.mjs; filled on the 76 April rows (5 distinct sizes), NULL on loader rows (2026-10-10). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.heat_shrink_catalog_id IS
'Intended key of the heat-shrink part in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.label_text IS
'Text to print on the wire label at this end. Source: populate-termination-specs.mjs, "W<wire number> <device name, 12 characters> <gauge>ga <color>"; filled on the 76 April rows, NULL on loader rows (2026-10-10). Unit: text. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.label_pn IS
'Part number of the label stock. NULL on all rows (2026-10-10): no writer sets it. Unit: text part number. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.label_catalog_id IS
'Intended key of the label stock in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.boot_pn IS
'Part number of the rubber boot over the connector back. NULL on all rows (2026-10-10): the loader does not set it, and no April row carries one although the boot table in populate-termination-specs.mjs on main would give the 2-pin Deutsch rows one (another version of that writer, as above). Unit: text part number. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.boot_catalog_id IS
'Intended key of the boot in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.loom_type IS
'Protective covering at the end: convoluted_loom (44 rows), heat_shrink (24) or split_loom (8), no CHECK. April rows only; NULL on loader rows (2026-10-10). The writer of these values is not the script on main, which does not set loom_type (Unknown). Unit: text class. Grain: one wire end. Clock: n/a.';

-- ── Inventory (never filled) ────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.wire_termination_specs.in_stock IS
'Whether the parts for this end are on hand. Default false; false on all 4,149 rows (2026-10-10): no writer sets it, so it is not an inventory reading. Unit: boolean. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.qty_on_hand IS
'Quantity of the parts on hand. Default 0; 0 on all rows (2026-10-10): no writer sets it. Unit: count. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.qty_needed IS
'Quantity of the termination parts needed for this end. Default 1; both writers write 1, and it is 1 on all rows (2026-10-10). Unit: count. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.notes IS
'Free-text note on the end. Loader rows: "doubled over at the terminal (MoTeC C125 p.21)" when the registry marks the wire doubled (79 rows). April rows: a description of the wire or device on all 76 rows, from a writer not in the repo (populate-termination-specs.mjs on main sets no notes; Unknown) (2026-10-10). Unit: text. Grain: one wire end. Clock: n/a.';

-- ── Provenance (DNA columns, loader rows only) ──────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.wire_termination_specs.source IS
'Where the end''s facts come from: "k5_registry v5 @ <git short sha>" (the registry file at the commit the loader ran from; 15 distinct commits), or "k5-wiring:<node code>:#<wire> end" when the node has a dossier in the registry (the loader says the registry''s facts are checked in vehicle_observations under k5-wiring:* sources). Filled on all 4,073 loader rows, NULL on April rows (2026-10-10). Unit: text. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.method IS
'How the row was produced: "registry loader" on all 4,073 loader rows; NULL on the April rows (2026-10-10). Unit: text. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.observed_at IS
'The loader run time (datetime.now in UTC at script start, NOW in load_map_rows.py), not when anything was seen on the vehicle; within 10 minutes of created_at on every loader row; range 2026-09-27 13:50Z .. 2026-09-29 01:40Z; NULL on April rows (2026-10-10). Unit: timestamptz. Grain: one wire end. Clock: ingest time (the writer''s run), despite the name.';
COMMENT ON COLUMN public.wire_termination_specs.trust IS
'Trust tier (CHECK T1, T2, T3): T1 owner or operator confirmed, T2 attributed or relayed, T3 scraped or inferred (vocabulary in 20260927030100_wiring_map_typed_rows.sql). T3 on all 4,073 loader rows, as design records; NULL on April rows (2026-10-10). Unit: text class. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.confidence_score IS
'Confidence in the row, 0 .. 1 (CHECK). NULL on all rows (2026-10-10): no writer sets it. Unit: probability-like score, uncalibrated. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.is_superseded IS
'True when a later loader run replaced or dropped this end (its wire changed or retired, or the registry no longer has the end); the row is kept. Not null, default false. True on 3,182 of the 4,073 loader rows, false on the 891 live loader rows and the 76 April rows (2026-10-10). Readers take is_superseded = false. Unit: boolean. Grain: one wire end. Clock: n/a; the change time is updated_at.';
COMMENT ON COLUMN public.wire_termination_specs.superseded_by IS
'Intended pointer to the replacing row (foreign key to this table). NULL on all rows, including the 3,182 superseded ones (2026-10-10): the loader marks is_superseded without linking the successor; the successor is the live row with the same (circuit, endpoint) keys or none. Unit: none (uuid). Grain: one wire end. Clock: n/a.';

-- ── Clocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.wire_termination_specs.created_at IS
'When the row was inserted, default now(): 2026-04-12 for the April rows, 2026-09-27 .. 2026-09-29 01:40Z for loader rows (2026-10-10). Unit: timestamptz. Grain: one wire end. Clock: ingest time.';
COMMENT ON COLUMN public.wire_termination_specs.updated_at IS
'Last change to the row, maintained by trigger set_wire_termination_specs_updated_at (digital_twin_set_updated_at). Later than created_at on 3,182 rows, the same count as the superseded rows, so for those it is about when the row was superseded; newest 2026-09-30 17:49Z (2026-10-10). Unit: timestamptz. Grain: one wire end. Clock: ingest time (last write).';

DO $$
DECLARE
  v_missing int;
BEGIN
  SELECT count(*) INTO v_missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.wire_termination_specs'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF v_missing > 0 THEN
    RAISE NOTICE 'wire_termination_specs: % columns still have no comment (a column was added after 2026-10-10)', v_missing;
  END IF;
END $$;

COMMIT;
