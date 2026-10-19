---
id: 2026-10-15_k5-registry-rebuilds-from-main
change_type: substrate_correction
scope: docs/wiring/calc-data/reconcile_v5.py inputs; calc-data/cut_list_v42.py; calc-data/inputs/ (three copied inputs); .gitignore exception; k5_registry.json, OPTIONS.md regenerated
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 17: the K5 registry rebuilds from main

**Gap.** `k5_registry.json` is the design's record; every harness model pass loads from it. Its generator could not
run from a clean checkout. `reconcile_v5.py` read four files that were not on main:
- `output/lego-book/build_ch1.py` (commit 47a11163b, a side branch);
- `output/lego-book/ch1_wire_index.csv` and `build-plan/MASTER_CUT_LIST.csv`, which `.gitignore` drops as `*.csv`;
- `/Users/skylar/k5-harness-pull/devices.json`, outside the repo.

So any design change (a splice lead, a moved output) could only be hand-patched into the JSON. #1238 did exactly that
for four Dakota wire lengths and left the BOM, readiness and wire-stock lines stale.

**Change:**
- `calc-data/cut_list_v42.py` holds the only parts of `build_ch1.py` the registry reads: the cut-list v4.2 parser,
  the M130 pin table and the rail pins, copied verbatim. `build_ch1.py` also renders pages, runs wireviz and reads twin
  lengths at import; the registry needs none of that.
- `calc-data/inputs/` holds copies of the other three inputs, made 2026-10-15. All three were read in full before
  copying: device names, pins, gauges, colours and currents, with no contact details, prices or invoices. A
  `.gitignore` exception keeps the two CSVs tracked.
- Row citations keep their original paths (`build-plan/MASTER_CUT_LIST.csv:<line>`). The line numbers hold in the
  copies, and the registry text does not churn.

**Proof.** In a clean worktree of origin/main, the documented run order was `reconcile_v5.py`, then
`check_plug_ends.py --wires`, then `options_v5.py`. It reproduces main's registry section for section, with one
exception: the four Dakota wires #1238 patched by hand (39, 71, 119, 120). For those, the generator applies its own L18
decision. `length_kind` becomes `twin` (it was `estimate`), and each wire's conflicts list records the decision. The
following sections then agree with the wires they summarise:
- readiness: 4 lengths move from estimated to twin;
- BOM wire feet;
- wire stock and cart lines: up to 5.0 ft more of one stock.

Every other section is identical: endpoints, terminations, splices, dossiers, PDM settings, implied wires and options.

**Database effect:** none. The loader compares `WIRE_KEYS` (`load_map_rows.py`), and its notes column is built from a
wire's notes and control only. Neither `length_kind` nor the conflicts list reaches a database row.

**Unknowns:** none for this change.
