---
id: 2026-10-15_k5-pin-leads-te-sizing
change_type: substrate_correction
scope: docs/wiring/calc-data/kits_v5.py (splice sizing on TE/Raychem CMA; a named 20 AWG pin lead in every ECU/PDM pin splice; area-packed groups when a pin overfills one D-609-05); k5_registry.json and DOSSIERS.md regenerated
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 21: every spliced ECU or PDM pin gets its lead, sized on the splice maker's figures

**Gap.** Where several wires share an M130 or PDM pin, the design joins them in a MiniSeal stub splice beside the pin.
One contact goes into the Superseal cavity: TE specifies one conductor and one insulation diameter per cavity. But
the generator named the conductor from the splice into that contact only at M130-B B16 ("pin lead", no gauge). RSI
pass 16 measured 1 of 31 spliced pins with a named lead. The generator also sized splices with the AWG formula against
the 3137CT crimp tool's colour bands, which differ from the maker's own figures (RSI pass 20).

**Evidence:**
- TE/Raychem SCD D-609-03/-04/-05 (issue 1, 31 Jan 2001), stub splice ranges in CMA: 300–1510, 779–2680, 1900–6755.
- TE/Raychem SCD D-436-60/-61 (issue 1, 5 Dec 2000), same barrels, CMA per gauge: 16 = 2426, 18 = 1900, 20 = 1216,
  22 = 754, 24 = 475, 26 = 304.
- MoTeC PDM user manual, printed p.6 and p.48: "Suitable wire gauges are 24# to 20# for the 8 Amp outputs and 20# to
  16# for the 20 Amp outputs". Every spliced PDM pin here is an 8 A output, a 0 V pin or a CAN pin.
- ProWire SSC-N (the Superseal contact): 16–24 AWG.
- TE 108-78140, 114-78011 and drawing C-2-1437285-3 give one conductor per cavity. No TE or MoTeC document covers
  two wires in one contact.

**Change (generator):**
- Splices are sized on TE's CMA per gauge. 14, 12 and 10 AWG keep the AWG nominal, because TE's table lacks them.
- The smallest D-609 whose CMA range holds the total is chosen.
- Every ECU/PDM pin splice gets a "20 AWG pin lead" member, counted in its area. 20 AWG is MoTeC's heaviest for an
  8 A output, inside the SSC-N's range, and what the design's B16 group leads already were.
- A pin whose wires and lead overfill one D-609-05 has its wires packed, in order, into groups that each fit with a
  "20 AWG group lead". The group leads and the pin lead then meet in one join.

**Result (regenerated; a second rebuild is byte-identical):**
- Splices go from 49 to 53. All 21 ECU/PDM pin splices name their pin lead.
- Three pins split into groups:
  - M130-B B16, 12 wires: 7 + 5;
  - PDM30-A A24, 8 wires: 6 + 2;
  - PDM30-B B8, five 20 AWG wires: 4 + 1. Five 20 AWG wires and the lead come to 7,296 CMA against 6,755.
- The two-wire CAN, 5 V and 0 V pins move from D-609-04 to D-609-05: two 22 AWG wires and the lead are 2,724 CMA, past
  the D-609-04's 2,680.
- BOM: D-609-04 goes from 23 to 15 and D-609-05 from 34 to 46.
- The device-terminal splices (pass 18) keep their parts. They still have no lead into the terminal, because the
  factory terminals' ranges are open in the registry.

**Unknowns:**
- The Superseal seal range. TE draws 1.6–1.9 mm insulation in any cavity and 2.0–2.2 mm in end cavities, while
  MoTeC's own harness for this connector uses 22 AWG M22759/16 (1.27–1.37 mm). This is a connector-wide question, not
  specific to the leads. Needs: a written answer from TE or MoTeC; the receipt for the research is
  ~/nuke-logs/k5-rsi-20261014/pin_lead_facts.md.
- Each lead's cut length, which is set at the formboard.
