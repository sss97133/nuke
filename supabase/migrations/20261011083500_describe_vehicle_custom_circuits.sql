-- Describe vehicle_custom_circuits: the 38 columns without a comment (4 of 42 had one: build_state, derivation_version,
-- planned_length_ft and checks) and a corrected derivation_version comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Ranked by (n_cols - n_cols_described) * ln(greatest(est_rows,0) + 1) over
-- v_schema_atlas at 2026-10-11 08:30Z: score 296.3, est_rows 2,432; 2,469 rows by exact count at 08:32Z.
--
-- METHOD (read 2026-10-11 08:31-08:36Z UTC, read-only):
--   Columns, types, defaults, NOT NULL, existing comments and pg_stats (null_frac, n_distinct, most common values) from
--   pg_attribute, pg_attrdef, pg_description and pg_stats; constraints from pg_constraint; indexes from pg_indexes;
--   policies from pg_policy; column and table privileges for anon and authenticated (has_column_privilege,
--   has_table_privilege); exact fills of every column grouped by derivation_version, method, design_status,
--   is_superseded and created month over all 2,469 rows.
--   Writers and readers from code at origin/main 3d9c76346: supabase/migrations/20260322200000_wiring_layer_overlay.sql
--   (creates the table), 20260927030100_wiring_map_typed_rows.sql (endpoint keys, cavities, DNA columns, supersession),
--   20260927040100_wiring_map_supersession_keys.sql (live-row unique index), 20260927200000_wiring_rule_checks.sql
--   (checks columns); docs/archive/database/migrations/2026-06-10_wiring_substrate_v2_step1.sql (build_state,
--   derivation_version, planned_length_ft) and 2026-06-11_custom_circuits_build_state_client_write.sql (the browser's
--   build_state grant); the loader docs/wiring/calc-data/load_map_rows.py; scripts/wiring_v2_ingest.py; readers
--   nuke_frontend/src/components/wiring/map/useWiringMap.ts, connector-inspector/useBuildState.ts,
--   pages/ShareWiring.tsx, pages/vehicle-profile/WiringWidgetLink.tsx. No edge function in supabase/functions names it.
-- LIMITS:
--   The 12 rows created 2026-04-13 (derivation_version null) and the 162 'v4-frontend-registry' rows of 2026-06 have no
--   writer in the repo: scripts/wiring_v2_ingest.py writes derivation_version 'v4.1' and no row carries that value. The
--   loader's per-run clock (observed_at) is the run time, not a design or build date. Counts below are as of 08:32Z and
--   go stale as the loader supersedes rows.
-- CHANGED EXISTING COMMENT:
--   derivation_version said "e.g. v4.1 = K5_cut_list_v4_1.txt one-time ingest"; no row holds 'v4.1'. It now lists the
--   four values present and their writers.

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

comment on column public.vehicle_custom_circuits.id is
  'Row key (uuid, gen_random_uuid()). One row is one version of one wire: a superseding row gets a new id and the old row '
  'keeps its id with is_superseded = true. Referenced by vehicle_custom_circuits.superseded_by, '
  'wire_termination_specs.circuit_id and vehicle_circuit_measurements.custom_circuit_id.';

comment on column public.vehicle_custom_circuits.overlay_id is
  'The wiring overlay (one vehicle''s wiring) this wire belongs to: FK fk_custom_circuits_overlay to '
  'vehicle_wiring_overlays(id) ON DELETE CASCADE; the vehicle is vehicle_wiring_overlays.vehicle_id. NOT NULL. One distinct '
  'value over all 2,469 rows on 2026-10-11. Part of the live-row key (overlay_id, circuit_code) where is_superseded = false '
  '(unique index vehicle_custom_circuits_overlay_code_live).';

comment on column public.vehicle_custom_circuits.circuit_code is
  'The wire''s identifier inside its overlay (text, NOT NULL). Source by derivation_version: the registry wire id '
  '(k5_registry_v5; numbers with letter suffixes such as 30a, 99G, and names such as WIPER_T3), the candidate id '
  '(april_2026_candidate, such as BC-W001), the v4 cut-list wire id (v4-frontend-registry, numbers and names such as '
  'INJ_PWR), or a descriptive code such as PDM15-GND or TRAILER-TAIL (the 12 underived rows). '
  'Unique among live rows of an overlay only; the same code recurs across superseded versions. The loader keys live rows by '
  '(circuit_code, derivation_version).';

comment on column public.vehicle_custom_circuits.circuit_name is
  'Human label of the wire (text, NOT NULL). load_map_rows.py writes the registry''s build-sheet name for k5_registry_v5 '
  'rows and the candidate label for april_2026_candidate rows, cut to 200 characters. Display text, not a key.';

comment on column public.vehicle_custom_circuits.system_category is
  'Subsystem the wire serves (text, NOT NULL, no CHECK; 31 distinct values in pg_stats). Two vocabularies are mixed: the '
  'registry subsystem in upper case for k5_registry_v5 rows (CORE_ENGINE, LIGHTING_EXTERIOR, AUDIO; UNASSIGNED when the '
  'registry has none), the candidate sub in kebab case for april_2026_candidate rows (dash-cabin, body-convenience), and '
  'POWER-DISTRIBUTION, CAN-BUS, TRAILER on the 12 underived rows. harness_section is the normalized grouping.';

comment on column public.vehicle_custom_circuits.wire_color is
  'Insulation colour as the source wrote it (text, no vocabulary): lower-case names with stripes (red, white/violet), GM '
  'abbreviations (BLK, BRN/WHT) and ''cable'' for multi-conductor cable. 142 distinct values; null on 22.5% (pg_stats '
  'null_frac 0.225). From the registry wire colour (k5_registry_v5) or the April plan colour (april_2026_candidate).';

comment on column public.vehicle_custom_circuits.wire_gauge_awg is
  'Conductor size in American Wire Gauge (integer; a smaller number is a thicker conductor; values 0 to 24 present). From '
  'the registry awg when it is an integer, or the April plan awg when it is all digits; otherwise null (1.7% null).';

comment on column public.vehicle_custom_circuits.wire_type is
  'Wire or cable specification as text (30 distinct): military specifications (M22759/32, M22759/16, M27500 2C), SAE '
  'automotive insulation (TXL, GXL) and descriptions (RCA pair, Cat5 pair, kit harness). From the registry spec '
  '(k5_registry_v5) or the April plan insulation (april_2026_candidate). is_shielded is derived from it.';

comment on column public.vehicle_custom_circuits.is_shielded is
  'True when the wire is shielded cable (boolean, default false). Derived, not observed: load_map_rows.py sets it on '
  'k5_registry_v5 rows when wire_type contains ''M27500''; scripts/wiring_v2_ingest.py when the spec contains ''SHIELDED''. '
  'Null on all 360 april_2026_candidate rows: the loader''s bulk insert sends null for keys a row lacks, overriding the '
  'default. Null is unknown, not unshielded.';

comment on column public.vehicle_custom_circuits.from_component is
  'Start end of the wire as text (NOT NULL): the registry''s from string (forms such as PDM30:OUT19 or M130:B16), the April '
  'device name, or ''(not recorded)'' when the source names none; cut to 200 characters. The keyed form of the same end is '
  'from_endpoint_id + from_cavity.';

comment on column public.vehicle_custom_circuits.from_connector is
  'Start-end connector name (text). Unused: null on all 2,469 rows on 2026-10-11 and set by no writer in the repo. '
  'The start plug is now from_endpoint_id and its cavity from_cavity.';

comment on column public.vehicle_custom_circuits.from_pin is
  'Start-end pin as text. Filled on 358 of 360 april_2026_candidate rows (the candidate''s from pin, up to 120 characters) '
  'and 102 of 162 v4-frontend-registry rows; null on every k5_registry_v5 row, which carries from_cavity instead.';

comment on column public.vehicle_custom_circuits.from_location_zone is
  'Body zone of the start end (text, no CHECK). Filled on the 12 underived rows of 2026-04-13 only (rear, dash); null '
  'elsewhere. Zones of plugs are harness_endpoints.location_zone.';

comment on column public.vehicle_custom_circuits.to_component is
  'Far end of the wire as text (NOT NULL): the registry''s to string or device, the April device name, or ''(not recorded)'' '
  'when the source names none; may be a long description such as a ground bank. The keyed form is to_endpoint_id + to_cavity.';

comment on column public.vehicle_custom_circuits.to_connector is
  'Far-end connector name (text). Unused: null on all 2,469 rows on 2026-10-11 and set by no writer in the repo. '
  'The far plug is now to_endpoint_id and its cavity to_cavity.';

comment on column public.vehicle_custom_circuits.to_pin is
  'Far-end pin as text. Filled on all 360 april_2026_candidate rows (the candidate''s to pin, up to 120 characters) and on '
  'no other row; k5_registry_v5 rows carry to_cavity instead.';

comment on column public.vehicle_custom_circuits.to_location_zone is
  'Body zone of the far end (text, no CHECK). Filled on the 12 underived rows of 2026-04-13 only (rear); null elsewhere.';

comment on column public.vehicle_custom_circuits.fuse_type is
  'Fuse or protection device type for the wire (text). Unused: null on all 2,469 rows on 2026-10-11 and set by no writer '
  'in the repo.';

comment on column public.vehicle_custom_circuits.fuse_rating_amps is
  'Fuse rating in amperes (numeric). Unused: null on all 2,469 rows on 2026-10-11 and set by no writer in the repo.';

comment on column public.vehicle_custom_circuits.measured_length_ft is
  'Wire length in feet reserved for a tape measurement (the June 2026 substrate receipt; estimates go in planned_length_ft). '
  'Filled on 12 rows only: the underived rows of 2026-04-13, round values 1.5 to 14.0 ft with no linked measurement record '
  'and no writer in the repo; whether they were measured is Unknown. No loader writes it.';

comment on column public.vehicle_custom_circuits.routing_description is
  'Route of the wire as text through named landmarks (for example R4 cross-frame junction to R6 tailgate centre). Filled on '
  'the 12 underived rows of 2026-04-13 only; no writer in the repo sets it.';

comment on column public.vehicle_custom_circuits.notes is
  'Free text about the wire. k5_registry_v5 rows: the registry note and ''switched by: <control>'' joined by ''; '', cut to '
  '1,000 characters; april_2026_candidate rows: the candidate note; v4-frontend-registry rows: an ingest note naming '
  'k5LandmarkPaths.ts WIRE_REGISTRY and the signal type. 46.7% null (pg_stats). Not a key and not parsed by readers.';

comment on column public.vehicle_custom_circuits.created_at is
  'Ingest clock: when this row was inserted (timestamptz, default now()). Rows span 2026-04-13 to 2026-09-30. Each '
  'superseding version gets its own created_at; no trigger maintains it. Not a design, cut or build date.';

comment on column public.vehicle_custom_circuits.derivation_version is
  'Which loader generation produced the row (text). Values on 2026-10-11: k5_registry_v5 (docs/wiring/calc-data/'
  'load_map_rows.py, 1,935 rows, 390 live), april_2026_candidate (the same loader''s candidate pass, 360 rows, 138 live), '
  'v4-frontend-registry (162 rows of 2026-06, all superseded; the notes name k5LandmarkPaths.ts WIRE_REGISTRY; writer not '
  'in the repo) and null (12 rows of 2026-04-13, all superseded, writer not in the repo). scripts/wiring_v2_ingest.py '
  'would write ''v4.1''; no row holds it. The loader keys live rows by (circuit_code, derivation_version).';

comment on column public.vehicle_custom_circuits.from_endpoint_id is
  'The plug or device at the start end: FK to harness_endpoints(id) ON DELETE SET NULL. Set by load_map_rows.py from the '
  'registry termination or the start code; candidate rows are relinked to the live endpoint when theirs is superseded. Null on 12.1% '
  '(pg_stats), including every v4-frontend-registry and underived row.';

comment on column public.vehicle_custom_circuits.to_endpoint_id is
  'The plug or device at the far end: FK to harness_endpoints(id) ON DELETE SET NULL. Set by load_map_rows.py from the far '
  'termination, else the destination code when it differs from the start. Null on 20.6% (pg_stats).';

comment on column public.vehicle_custom_circuits.from_cavity is
  'Cavity (pin position) in the start plug, as the registry termination names it (text: A24, B16, ''splice 3'', GND). '
  'k5_registry_v5 rows only; 372 of 390 live k5_registry_v5 rows carry it. Pairs with from_endpoint_id.';

comment on column public.vehicle_custom_circuits.to_cavity is
  'Cavity in the far plug, as the registry termination names it (text: 1, 2, ring, ''ring 3'', ''splice 1''). '
  'k5_registry_v5 rows only; 361 of 390 live k5_registry_v5 rows carry it. Pairs with to_endpoint_id.';

comment on column public.vehicle_custom_circuits.design_status is
  'Whether the wire is decided or only on the list (text, NOT NULL, default ''concept''; CHECK concept, decided). '
  'load_map_rows.py writes decided on k5_registry_v5 rows and concept on april_2026_candidate rows; older rows hold the '
  'default.';

comment on column public.vehicle_custom_circuits.harness_section is
  'Harness section the wire belongs to (text; CHECK engine, power_spine, comms, dash_cabin, body_convenience, '
  'lighting_front, lighting_rear, powertrain_chassis). Mapped by load_map_rows.py from the registry subsystem '
  '(SUB2SECTION; exterior lighting split front and rear by label) or the April sub (APRIL2SECTION). 9% null (pg_stats).';

comment on column public.vehicle_custom_circuits.source is
  'Where the row''s content came from (text, NOT NULL in practice: 0% null). ''k5_registry v5 @ <git sha>'' names the '
  'registry commit the loader read; ''April 2026 whole-truck plan (candidate, unreviewed)'' the candidate list. On '
  'superseded rows the loader rewrites it to say why the row left (for example ''retired in k5_registry v5 @ <sha>''). '
  '86 distinct values.';

comment on column public.vehicle_custom_circuits.method is
  'How the row was produced (text): ''registry loader'' or ''registry loader (candidate)'' (load_map_rows.py). Null on the '
  'v4-frontend-registry and underived rows.';

comment on column public.vehicle_custom_circuits.observed_at is
  'Loader run clock: the UTC time load_map_rows.py started the run that wrote the row (one value per run; 25 distinct). '
  'Not when the wire was designed, cut or measured. Null on rows the loader did not write.';

comment on column public.vehicle_custom_circuits.trust is
  'Trust tier (text; CHECK T1 owner or operator confirmed, T2 attributed or relayed, T3 scraped or inferred). Every '
  'loader row is T3: these are design records, and T1/T2 facts arrive through vehicle_observations. Null on rows the '
  'loader did not write.';

comment on column public.vehicle_custom_circuits.confidence_score is
  'Confidence from 0 to 1 (numeric; CHECK between 0 and 1). Unused: null on all 2,469 rows on 2026-10-11 and set by no '
  'writer in the repo.';

comment on column public.vehicle_custom_circuits.is_superseded is
  'True when a newer row replaces this one or the wire left the design (boolean, NOT NULL, default false). Rows are '
  'superseded, never deleted. 1,941 of 2,469 rows superseded and 528 live on 2026-10-11. Readers filter '
  'is_superseded = false for the current wire list.';

comment on column public.vehicle_custom_circuits.superseded_by is
  'The row that replaced this one: FK to vehicle_custom_circuits(id). Set by load_map_rows.py when a changed wire is '
  'reinserted or an April candidate is carried by a v5 wire; null on live rows and on superseded rows that left the '
  'design with no successor (source says why).';

comment on column public.vehicle_custom_circuits.checks_version is
  'Which rule set produced checks (text, for example ''check_plug_ends R8-R14 @ <git sha>''). Written with checks and '
  'checked_at by load_map_rows.py; null where checks is null (57.3%).';

comment on column public.vehicle_custom_circuits.checked_at is
  'Rule-check clock: the loader run time at which checks was computed (timestamptz). Null where checks is null.';

commit;
