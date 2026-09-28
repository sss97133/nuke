-- harness_endpoints.family: admit the terminal families added to the K5 catalog on 2026-09-28
-- (docs/wiring/calc-data/catalog/families.yaml; receipt docs/wiring/receipts/2026-09-28_pin-tables-for-83-plugs-and-range-failures-closed.md):
--   dt              Deutsch DT, size 16 contacts (door pass-throughs, body bulkheads A/B)
--   dtp             Deutsch DTP, size 12 contacts (door window-power pass-throughs, bulkhead P)
--   dtm             Deutsch DTM, size 20 contacts (LTC wideband plug)
--   gm_blade        GM factory Packard 56-series blades (ignition, light, dimmer, wiper, blower, column switches)
--   screw_terminal  screw / set-screw terminals (Orion charger, amplifier block, radio harness blocks)
--   contura         Blue Sea Contura switch 0.250 in tabs
-- Until now the map loader wrote these rows as 'unknown' (load_map_rows.py). Same list as before plus the six.
set statement_timeout = '30s';
set lock_timeout = '5s';

alter table public.harness_endpoints drop constraint if exists harness_endpoints_family_check;
alter table public.harness_endpoints add constraint harness_endpoints_family_check
  check (family in ('ssc','d38999_20','gt150','mp150','ev1','kit_terminal','te_amp_plug','ring_small','lug',
                    'miniseal','solder_sleeve','xlr_solder',
                    'dt','dtp','dtm','gm_blade','screw_terminal','contura',
                    'unknown'));
