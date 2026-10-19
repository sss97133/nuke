---
id: 2026-10-14_k5-harness-rsi-pass2
change_type: data_model
scope: connector_cavity_layouts.source/method; three cited cavity models; K5 wire-end cavity and housing keys; K5 Superseal plug housing keys; stack SH need on cavity citations
proposal: schema_proposals d3c978f1 (approved for build 2026-10-14 under owner direction)
case: docs/ledger/theory/data-machine-cases.md 13.12.2
migration: supabase/migrations/20261014123000_k5_harness_rsi_pass2_cavities.sql
contract: supabase/sql/test_k5_harness_rsi_pass2.sql (PG17, CI job k5-harness-rsi-pass2-contract)
---

# RSI pass 2 on the K5 harness model: the cavity library

After pass 1, the SH scoreboard's largest key gap was **cavity keys: 0 of 884** K5 wire ends on live segments. The wire
ends already say which cavity they occupy; 853 of the 884 carry cavity text. The library could not be matched.

**Measured on the live rows before the pass, read-only, 2026-10-14:**
- `connector_cavity_layouts` held 394 rows in 46 models. None carried a source.
- Its two D38999 61-way models name cavities R1P1 to R4P8 on evenly spaced rings. MIL-STD-1560 arrangement 25-61 names
  them A-Z, a-z and AA-PP on five rings.
- Its Superseal 34 and 26 models name rows A-D. The housings number cavities 1-34 and 1-26: MoTeC pin A13 is cavity 13
  of connector A.
- 295 K5 wire ends could be keyed by rule, with 0 malformed:
  - 116 bulkhead-half ends whose designator is in the 25-61 set.
  - 179 Superseal ends whose letter matches the plug and whose number is in range.

**Sources, in the repo:**
- **Designators and coordinates.** MILNEC TX Series D38999 III insert arrangements, p.B-20 and p.B-22, transcribed in
  `scripts/generate_connector_build_sheets.py` (`CAV_XY`, 2026-06-10). The radii from PP cluster 1 / 6 / 12 / 19 / 23
  and run contiguous in designator order. That is the 25-61 ring structure, which checks the transcription.
- **Contact #20: 7.5 A, 20-24 AWG.** From `CONNECTOR_DATA_REPORT.md` §1.3, which is local and gitignored. The script
  restates it as source [3], and `catalog/families.yaml` `d38999_20` gives the same wire range.
- **Superseal housings.** `catalog_parts` 65044 (TE 4-1437290-0) and 65045 (TE 3-1437290-7), both keying 1. The
  `M800-KIT-N` kit on every K5 Superseal plug is "34 /26 WAY, KEY 1".

**After this pass:**
- Three cited models, 121 rows: the bulkhead insert and the two Superseal housings.
- 295 K5 wire ends keyed to a cavity; 179 keyed to a housing part.
- Six plugs keyed to a housing: M130, PDM30 and PDM15, connectors A and B.
- The 394 uncited rows stay as they were. The new stack need `connector_cavity_layouts.source` counts them.

**Not claimed:**
- No mm offsets: the transcription is in drawing pixels and the scale is not cited.
- No Superseal row or column positions: the TE drawing is not in the repo.
- No housing part for the bulkhead: D38999/24WJ61SN and /26WJ61PN are not in `catalog_parts`.

**Still missing, as SH names them:**
- Cavities on the other 589 ends (GM blade, DT, ring and lug, kit terminals). Each needs its own cited layout.
- Topology and routing.
- Load models on nets.
- The factory baseline and residual.
- Measured lengths.

**Unknowns:** none for this pass.
