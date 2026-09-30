---
id: 2026-09-29_substrate-correction-ibooster-gen1
change_type: substrate_correction
scope: docs/wiring/K5_WIRING_STATE.md §1 (brake booster row)
found_by: parts-artist-2 (pieces lane), 2026-09-29
---

# The K5's iBooster is a Gen 1, not a Gen 2

State §1 listed the brake booster as "Bosch iBooster Gen 2 (Tesla salvage + Tulay connector)". The evidence says Gen 1:

- **The order record**, `vehicle_observations` a7276b88 (provenance, 2023-11-09): "Bosch iBooster Gen 1, Tesla
  Model S part 1037123-00-B".
- **The part label** in the owner's photo 40e5e5f9 reads 1037123-00-B.
- **openinverter** (`reference_documents/web_snapshots/openinverter.org__Bosch_iBooster.md`) lists 1037123-00-A/B
  as the Model S/X Gen 1.
- **The registry pin table** `calc-data/catalog/pin_tables/IBOOSTER.yaml` was already Gen 1: the fastandquiet Gen-1
  pinout and the Tulay Gen-1 harness.

Only the §1 row's text changes. The decision it records is still locked: an iBooster, powered by the PDM, as the
brake booster. No wire or pin changes. The row now also says what the pin table says: the Tulay harness is planned,
not bought.

## Unknowns

None.
