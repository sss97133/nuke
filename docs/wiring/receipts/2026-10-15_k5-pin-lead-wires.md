---
id: 2026-10-15_k5-pin-lead-wires
change_type: substrate_correction
scope: docs/wiring/calc-data/kits_v5.py (each ECU/PDM pin splice becomes a node SPL-<plug>-<cavity>, its wires end there, and the lead into the contact is a wire row LEAD-<plug>-<cavity>); reconcile_v5.py (pin text follows a wire through its pin splice); load_map_rows.py (the node sits at its plug; a wire that ends at a pin splice starts there); k5_registry.json, WIRE_CHECKS.json and OPTIONS.md regenerated
amends: 2026-10-15_k5-pin-leads-te-sizing
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 26: the lead into a spliced pin is a wire, and the splice is a node

**Gap.** Pass 21 named a 20 AWG lead in every ECU/PDM pin splice, but only as words inside the splice row ("20 AWG
pin lead"). A lead in words has no wire row, so it has:
- no cut length and no BOM feet;
- no wire end in the contact;
- no key in `harness_splice_members`.

Live as anon on 2026-10-15 06:20Z, splice members keyed to a wire read 147 of 178. The wires that share the pin were
also modelled as ending in the pin's contact. TE gives one conductor per Superseal cavity, so physically they end in
the splice.

**Pattern followed, not minted:** the PDM 20 A pigtails (reconcile_v5.add_pigtails) and PCS_IGN_PT already work this
way:
- the splice is its own endpoint (SPL-PDM15-OUT8);
- the load wire ends there;
- each conductor into a contact is an implied wire row in M22759/32.

**Change (generator and loader):**
- Each pin splice becomes a node, `SPL-<plug>-<cavity>` (family miniseal, a stub splice). The pin's wires end there
  (cavity "splice n"), and `LEAD-<plug>-<cavity>` runs from the pin's SSC-N contact to the node.
- Where a pin overfills one D-609-05 (M130-B B16, PDM30-A A24, PDM30-B B8):
  - the groups are nodes `-G1`, `-G2`;
  - their group leads `LEAD-...-G<n>` run to the join node, and the pin lead runs from the join.
- **Lead length (the system's call):** 4 in, and splices on one plug alternate 4 and 6 in.
  - No document in hand sets a splice's distance from a Superseal housing; searched 2026-10-15, AS50881 text is not
    public.
  - 4 in clears the housing and the splice's heat-shrink with room to crimp.
  - NASA-STD-8739.4 says splice locations are staggered to keep the harness profile down.
  - Group leads are 4 in.
- **Lead colour:** the circuit's colour where 20 AWG M22759/32 in that colour is already on the BOM; otherwise the
  stocked gray, with the cavity marker naming the circuit. A new spool for under a foot of lead is waste. Leads whose
  wires have no colour yet stay uncoloured until `colours()` assigns one, as the pigtails do.
- The wire records' pin text is unchanged: a member still names the pin it reaches. `pins_from_terminations` follows
  a wire through its pin splice to that pin.
- **Loader:**
  - a pin-splice node takes its plug's position ("beside <plug> pin <cavity>");
  - a wire that ends at a pin splice starts there;
  - April concept matching counts the node as its plug.

- **Build book:** `kits_v5.pin_splices_at_pins` folds each node back onto its pin for the pages
  (`diagram_v5.load`, `manual_v5.load`), so the diagrams still draw a pin splice beside its pin.
  - Drawn as their own boxes, the 25 nodes overflowed four sheets' margins.
  - `diagram_v5.py --check` prints the same summary as main and exits 0.
  - `manual_v5.py --pages-only` reports the same single rule break as main. The manual keeps the leads in its wire
    list, because the spec page counts them.

**Result (regenerated; a second rebuild is byte-identical):**
- Implied wires go from 245 to 270: 19 pin leads and 6 group leads. Endpoints go from 178 to 203. Wire ends go from
  943 to 993.
- Splices stay at 54. The 25 ECU/PDM pin splices now sit at their nodes, and every member is a wire code. The 12
  device-terminal splices (pass 18) are unchanged.
- Wire checks: the 25 leads pass R8 (ends). The 5 M130 leads take the same R9 OPEN as the wires they replace in the
  contact ("not in the stored pin table"). No new FAIL.
- BOM, 20 AWG M22759/32: gray 45.2 → 48.2 ft, red 123.4 → 128.5 ft, green 0.4 ft, yellow 0.6 ft. Green and yellow
  were already needed by wires without a length. Four white leads have no stock key yet, like the pigtails, until
  `colours()` runs after the BOM.
- **Loader plan against live rows:** 25 new nodes, 25 new wires, and 68 wires re-pointed from the pin to their splice
  (`from_cavity` B16 → "splice n"). No wire record's text changes.

**Measure note:** "spliced pins whose lead into the pin the design names" counts splices drawn at a pin. After this
pass that population is the 12 device-terminal splices, and none has a lead yet. The 19 ECU/PDM pins left the
population because their leads are now wires. A measure for pin-splice nodes needs the pin relationship in
`harness_splices`, which is owed.

**Unknowns:**
- The Superseal seal range on thin-wall wire, unchanged from pass 21. Needs: TE's or MoTeC's answer; the draft is
  ~/nuke-logs/k5-rsi-20261014/vendor_questions_DRAFT.md.
- Each lead's final cut, which is checked at the formboard against the 4/6 in design length.
