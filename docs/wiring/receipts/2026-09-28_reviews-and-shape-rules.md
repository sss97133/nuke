# Receipt: two reviews of the book (builder, harness-engineering) and the shape rules that followed

- **Date:** 2026-09-28 (evening)
- **Change type:** review findings + toolchain (`manual_v5.py`, `diagram_v5.py`) + pages; no registry design change yet
- **Follows:** `receipts/2026-09-28_figures-from-the-twin-and-overprint-lint.md`
- **Ask (owner, 2026-09-28):** "you should probably do full page pin outs in color. you should have some dave agents and
  zuken agents look at your work"; "same idea goes for all the others. need accurate shapes 100%"; "make the text curve
  around the out circle ... color either fill or stroke on the 61 pin ... add text for each pin out"; "for the 61 pin
  firewall just add, male / female"; "what are these failed half circle things".

## Shape rules now in the generator
- No plug shape is drawn unless it comes from the maker's drawing. Every plug prints as a **pin map**: cavity squares in
  moulded order, filled with the ordered wire colour (stripe as a band), captioned "housing shape not drawn". The
  vendor's product photo of the plug kit sits beside the map where one is on file (`reference_documents/product_images/`,
  gitignored; `sources.json` holds each URL; fetched 2026-09-28 one every 10 s, all 200).
- The 61-pin is the one plug with a source drawing (MILNEC insert arrangement 25-61 as transcribed in
  `scripts/generate_connector_build_sheets.py`), so it is drawn to it: page 1-5 both faces, cavities filled in the wire
  colour, socket/pin (female/male) stated; on every sheet with only that sheet's cavities lit, the cavity letter at the
  rim, runs ending short of the letter, nothing crossing the face.
- The half circles on 1-5 were a stripe band drawn as a bad arc path; it is now a rect clipped to the cavity circle.
- Page 1-5's right face is the receptacle's **rear, wire-entry** view (the cab-side builder crimps sockets here), which
  is also the harness plug's pin face; the earlier caption called it a plug on the cab side (harness review B20).
- Six full-page colour pinouts (M130 A/B, PDM30 A/B, PDM15 A/B) with the MoTeC designations from the datasheet and
  manual text (`m130_designations.txt`, `pdm30_designations.txt`, `pdm15_designations.txt`). Their cell layout is print
  order, not the housing's row layout, and the page says so: the TE drawings (4-1437290-0, 3-1437290-7) are not on file.
  TE's document server refuses scripted downloads (HTTP 403 on both the STEP and the customer drawing, 2026-09-28) and no
  Chrome was connected to fetch them through the owner's browser.

## Review 1 — builder ("Dave") review, agent `dave-review`, first seven findings received (rest requested)
Verdict as delivered: would build from none of the diagram sheets today; from the plug pages only coolant temp and oil
pressure, plus prototype pinning of the firewall connector.
| # | finding | checked against | disposition |
|---|---|---|---|
| A1 | 12 AWG feeds landed on paired Superseal pins (fan A1+A10, starter A7+A16, blower A3+A12); contacts take 16–24 AWG | state 0h(1) already found it; PDM manual p.48 | design change owed in `reconcile_v5.py`: 2 × 16 AWG per paired output, joined at the load, splice drawn |
| A2 | throttle-body pin order borrowed from other SENT bodies, not stamped OPEN | state row 29, 0s | stamp OPEN on the plug until a GM end view of 12699160 is cited |
| A3 | registry `to.pin` disagrees with the termination rows for crank, cam, MAP (and harness review A7: wire 99, 4a/4c, COIL_PWR) | registry vs page | one home for pins: derive `wire.frm/to` from the termination rows in the build |
| A4 | LTCD feed 22 AWG on PDM15 OUT12; two LSU heaters can draw > 6 A cold | LTCD manual p.37, PDM manual p.48 (cited by the reviewer; the manual text on file has no plain "3 A" line I could match, so **not yet verified**) | verify the heater current in the LTCD manual, then size the feed with the calculation on the page |
| A5 | coil and injector +12 V rail feeds (PDM15 OUT3/OUT2) not drawn on the coil/injector sheets | canon ch.16 §7.4 | draw the rail's source on the sheet (junction column) |
| A6 | 12 front-body feeds have no bulkhead cavity (A and B 12/12) | page 1-6 | bulkhead C design (finish line item 3) |
| A7 | sensor 5 V / 0 V letters cross: A02 (5 V A) returned on B16 (0 V B); techspec pairs A02↔B15, A09↔B16 | M1 techspec pins A02/A09/B15/B16 (verified in the PDF text); Dave's own M130 sheet (receipt 2026-09-26) has A2/B16 and A9/B15 | **adjudication for Dave**: canon ch.17 §17.4.8–9 says match letters; Dave's Bronco sheet does not; the registry follows Dave's sheet |

## Review 2 — harness-engineering practice (Capital / E3 / AS50881 / IPC-A-620), agent `zuken-review`, 23 findings
Headline: the registry stores one record per ECU-to-device path, not physical wires, splices, cables or harness segments;
most of what reads wrong on the pages comes from that. Kept as the data-model backlog, in its order:
1. nets vs wires (one conductor per row, each with its own length, terminals, harness); 2. splice objects with ids and
positions; 3. harness / segment / bundle objects, so length comes from the path; 4. cable objects (M27500, twisted pairs);
5. coverings and fixings; 6. terminal–seal–tool selection table keyed by AWG and insulation OD; 7. one home per fact (pins
on the termination rows); 8. one wire-numbering scheme and generated marker text; 9. option expressions on connectors,
splices and kits; 10. reference designators on every connector, splice, ground and stud; 11. revision stamps on sheets;
12. per-segment lengths (69 of 174 wires carry the same 4.6 ft estimate); 13. current and protection on wires.
Drawings: 14. shield drains drawn nowhere (99S/101S/103S/104S), CAN trunk 62 and Ethernet undrawn; 15. splices drawn as
boxes; 16. cab-side runs unlabelled; 17. no off-sheet references; 18. no title/revision block; 19. no legend page;
20. face caption (fixed above); 21. truncated text and case mismatch (a–d vs A–D on the coils); 22. links only to the map
card, not to parts. Structure: 23. missing GM page types, and which can be generated today (special tools, terminal
repair figures per family, wire spec table, power and ground distribution, section BOM, draft cut list, option codes on
runs).
Kept, per the reviewer: the options/capacity approach, cited cells with DESIGN COMPLETE / OPEN, the termination rows as
the seed for the wires table, the GM page grammar, true-colour runs, the twin location view, the link plumbing.

## Measured (2026-09-28, after)
- Manual: 21 pages, 0 overprints, links written into the PDF.
- Registry unchanged today: 328 wires, 318 right, 0 wrong, 10 incomplete. Every review finding above that changes a wire
  is a registry change with its own receipt; none has been applied yet.

## Also today
- K5 vehicle record: asking_price and sale_price 189,000 (written at vehicle creation 2025-09-20, no source) cleared
  through `correct_vehicle_sale_provenance_batch` v2.4 citing owner observation 04b9e2aa (client paid in full, not a sale,
  not listed). `vehicle_price()` now reports an estimate, not an ask.

## Open (named close paths)
- Dave's findings 8+ (requested from the reviewer).
- The design changes: A1 pigtails, A3 pin home, A4 LTCD current, A5 rail feeds on the sheets, A7 adjudication.
- TE drawings for the Superseal housings and the Deutsch bodies: owner's browser or a signed-in download.
