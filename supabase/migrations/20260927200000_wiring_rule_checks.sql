-- Wiring map: each wire and each plug carries its rule-check results.
--
-- WHY: owner, 2026-09-27: "need to ensure all our wires are right ... so much missing end points". The registry now
-- runs rule checks on every wire and device (docs/wiring/calc-data/check_plug_ends.py --wires):
--   R8  both ends named with pins           R9  the pin fits the job (M130 pin table, PDM ratings)
--   R10 the circuit is complete for its signal type
--   R11 every PDM load has a recorded command path
--   R12 firewall crossings go through a 61-pin cavity or the grommet
--   R13 nothing contradicts a locked decision  R14 the wire record and the plug write-up agree
-- The map shows each wire as right or not, with the failing checks in plain words, and rolls the counts up per
-- section. Plan: ~/.claude/plans/vivid-hugging-globe.md ("Where it shows").
--
-- SCHEMA_LAW: derived results, not facts — recomputed on every registry load and stamped with the rule version, so
-- they are replaced in place (not superseded). Two nullable columns per table; both tables are small and read only by
-- the wiring page. No new table.

set lock_timeout = '10s';

alter table public.vehicle_custom_circuits
  add column if not exists checks jsonb,
  add column if not exists checks_version text,
  add column if not exists checked_at timestamptz;

alter table public.harness_endpoints
  add column if not exists checks jsonb,
  add column if not exists checks_version text,
  add column if not exists checked_at timestamptz;

comment on column public.vehicle_custom_circuits.checks is
  'Rule-check results for this wire, derived by docs/wiring/calc-data/check_plug_ends.py --wires: '
  '{"R8 ends": ["PASS"|"FAIL"|"OPEN", "why"], ...}. Recomputed on every load; checks_version names the rule set.';
comment on column public.harness_endpoints.checks is
  'Rule-check results for this plug or device (R10 circuit complete, R11 command path, R13 locked decisions), derived '
  'by check_plug_ends.py --wires. Recomputed on every load.';
