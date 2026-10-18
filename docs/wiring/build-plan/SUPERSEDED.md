# SUPERSEDED — harvested into the K5 registry (2026-09-26)

This April 17, 2026 whole-vehicle plan (332 wires, 6 sub-harnesses) is kept as **evidence**, not as a live layout.

- Its circuits were harvested into `docs/wiring/calc-data/k5_registry.json` by `docs/wiring/calc-data/reconcile_v5.py`:
  - 89 of them paired with cut-list v4.2 wires, where they supply the far ends and terminals
  - 243 became `candidate` rows, reviewed chapter by chapter
- Regenerate `docs/wiring/calc-data/RECONCILE_REPORT.md` (gitignored by the repo's *_REPORT.md rule) with `python3 docs/wiring/calc-data/reconcile_v5.py`; it lists pairs, conflicts and superseded assumptions:
  - TXL/GXL insulation
  - the fuse block / rear junction box
  - the April bulkhead scheme
  - EV6 injectors
  - the Aeromotive pump
  - the Holley T43
  - the neutral-safety switch
- Do not edit these files. Changes go into the registry, and every output derives from it.
