---
id: 2026-10-15_k5-splice-check-te-cma
change_type: data_model
scope: catalog_parts D-609-03/-04/-05 (maker's CMA range, CMA per gauge, wires per splice); v_harness_splice_check on those figures with an area_basis column
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261015103000_k5_splice_check_te_cma.sql
contract: supabase/sql/test_k5_splice_check_te_cma.sql (db-contracts)
---

# RSI pass 20: the splice fill check reads the splice maker's figures

**Gap.** RSI pass 16's fill check sized each splice side with the AWG formula's circular mils. It compared that against
the ProWire 3137CT crimp tool's cavity colours: D-609-04 for 20–16 AWG, D-609-05 for 16–12 AWG. The maker, TE/Raychem,
states its own ranges in circular mils area (CMA) and its own CMA per gauge, and they differ. The formula gives 22 AWG
as 642 CM; TE counts 754. Live on the K5 after pass 16, all 33 checkable splice sides "fit" on the formula.

**Evidence** (read on the drawings themselves; the PDFs are in the local library `reference_documents/component_drawings/`):
- TE/Raychem specification control drawing D-609-03/-04/-05, "Crimp splicer, stub", issue 1, 31 Jan 2001, gives these
  CMA ranges:
  - D-609-03: 300–1510;
  - D-609-04: 779–2680;
  - D-609-05: 1900–6755.

  Its footnote: "Not all wire combinations falling within the usable CMA range can be accommodated within the splicer
  barrel." (TE product details for 680106-000 (D-609-05), https://www.te.com/en/product-680106-000.html, p.2)
- TE/Raychem SCD D-436-60/-61, "Stub splice sealing system multi-wire", issue 1, 5 Dec 2000, uses the same barrels as
  D-609-04/-05.
  - CMA per gauge: 16 = 2426, 18 = 1900, 20 = 1216, 22 = 754, 24 = 475, 26 = 304.
  - Wires per splice, by gauge: blue 20 → 2 and 22 → 2–3; yellow 20 → 2–5 and 22 → 3–8.

**Change:**
- The three D-609 catalog rows gain `range_cma`, `cma_by_awg` and `wires_per_splice_by_awg` (the last for -04 and -05),
  with their citations.
- `v_harness_splice_check` sizes a side from the part's `cma_by_awg` where the part has one, falling back to the
  formula for a gauge the maker's table lacks. It checks against `range_cma` where the part has one, else
  `range_awg`. A new last column, `area_basis`, says which basis was used.

**Expected after deploy (no loader run needed):** some K5 splice sides that fit on the formula are over on TE's
figures. Measured read-only:
- M130-B B16 group 1 (eight 22 AWG wires and a 20 AWG lead): 6,156 CM on the formula, 7,248 CMA on TE's, against
  D-609-05's 6,755.
- PDM30-A A24 (six 22 AWG and two 20 AWG wires): 6,956 CMA on TE's, over 6,755 before any lead is counted.

**Unknowns:** none for this change. TE gives no mixed-gauge wire-count table; the count limits are stored, not checked.
