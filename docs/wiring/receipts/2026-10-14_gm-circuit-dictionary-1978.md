---
id: 2026-10-14_gm-circuit-dictionary-1978
change_type: data_model
scope: gm_circuit_identification rows and column descriptions; v_harness_factory_residual names; v_harness_coverage dictionary measure; one SH need; read policies on connector_cavity_layouts, pdm_units, pdm_channels
case: docs/ledger/theory/data-machine-cases.md 13.12.2
migration: supabase/migrations/20261014143000_gm_circuit_dictionary_1978_chart.sql
generator: docs/wiring/calc-data/gm_circuit_tabulation_78.py --sql
contract: supabase/sql/test_gm_circuit_dictionary_1978_chart.sql (PG17, CI job gm-circuit-dictionary-1978-contract)
---

# RSI pass 4: the GM circuit dictionary from the 1978 C/K Circuit Tabulation chart

**Gap:** after pass 3, the K5 residual had 23 GM circuits the build cites with no baseline row keyed to them.
`gm_circuit_identification` held 219 circuits from the 1973 manual and lacked 4 of the 28 numbers the build cites.

**Source.** GM ST 352 78, the 1978 Light Duty Truck Wiring Diagrams for C/K
(`reference_documents/wiring_diagram_booklets/ST_352_78_CK_Wiring.pdf`). It is local and not in git, and it is found
by `scripts/library_search.py "circuit identification"`.
- The Circuit Tabulation chart on pp. 8-11 lists 275 circuits by number, colour and name.
- The chart is from 1978, one model year after the K5's 1977. GM circuit numbers are one numbering system across years.

**Method.** `gm_circuit_tabulation_78.py` parses the library's text extraction and generates the migration's rows.
- It handles two columns per page, colours that wrap ("Dark Green-" / "White", or a stripe on the next line with no
  hyphen), names that wrap, and the OCR fixes it names.
- 274 circuits read with a colour. Circuit 813's colour is unreadable ("\Pm!te"), so it is not loaded.

**Measured against the dictionary:**
- 145 numbers appear in both; colour and stripe agree on 139.
- 6 disagree: 22, 67, 225, 231, 232 and 234. Each source keeps its own reading; the conflict goes into notes and is not
  resolved.
- 129 numbers are new, including 63, 70, 72, 101 and 140, which the K5 build cites.

**Result:**
- Every GM circuit the K5 build cites now has a name and colour in the dictionary.
- The residual shows them, for example "150 BLK Ground Circuit - Direct: baseline gap".
- The baseline gaps remain gaps: the dictionary says what a circuit is, not that the 1977 truck had it.

**Read policies, measured 2026-10-14.** Row security was on with no policy at all on `connector_cavity_layouts`,
`pdm_units` and `pdm_channels`, so a logged-out reader resolved 0 of the 295 cavity keys and 0 of the 57 protection keys.
- The cavity library is reference data with no vehicle and no private data. It gets public read, like `catalog_parts`.
- PDM units and channels belong to a vehicle. They are readable when the vehicle is public or the reader owns it, the
  harness tables' rule. The contract test checks that a private vehicle's PDM stays hidden.

**Not claimed:**
- The 35 factory baseline rows without a cited GM number are not keyed by colour and name; that would be a guess.
- OCR spelling in names is kept as read.

**Unknowns:** none for this pass.
