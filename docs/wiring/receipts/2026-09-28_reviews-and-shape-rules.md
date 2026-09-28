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

## Review 1 (continued) — findings A8 to C24, received 2026-09-28 19:11Z
| # | finding | disposition |
|---|---|---|
| A8 | lengths print old zone estimates (48 engine wires at 4.6 ft; coil triggers 2.5 ft vs 4.5 ft computed in `output/K5_PROTOTYPE_CUT_PLAN.md`); one length per firewall circuit that is two wires; the 20 % allowance (state row 33) not shown | registry: two conductors per crossing circuit, computed maximum per leg with basis and allowance, printed "prototype at this length" |
| A9 | 16 coil grounds + M130 A10/A11 to an unnamed head ring, no stud/count/location, no OPEN stamp | stamp OPEN now; name the ground point and lugs (state row 56 banks) |
| A10 | CAN drawn as "22 YEL + GRN", no twist, terminators, stub limits; GG and j far apart on the 61-pin; LTCD stub LENGTH OPEN; #62 note stale | design: CAN topology drawing, twist rate, 100 R positions, adjacent cavities (PDM manual p.49) |
| A11 | speed sensor: one wire, no supply/return, and it crosses the engine-only 61-pin (state row 50 forbids) | design: SEN-01-5 wire count from Dakota; move to the body crossing |
| B12 | 61-pin page had no contacts/tools/backshell/boot/spare plugs | **done 2026-09-28 evening** (parts strip, page 1-5); spare-cavity plugs MS27488-20-2 still to add |
| B13 | no strip length, crimp tool/setting, pull test on any plug figure though `DOSSIERS.md` holds them | generator: print tool + setting + pull test per plug from the terminations' tool steps |
| B14 | shields: no drain drawn, no solder sleeve, "ground at the ECU end only" unprinted, M27500 part unresolved (ML type not Tefzel — owner's call), conductor colours not given | design + generator |
| B15 | splices not drawn or placed (A02 ×5, B15 ×5, B16 ×12 through three cascaded D-609-05) | registry: splice objects (harness review A2) |
| B16 | ECU power (A26 from PDM30 OUT24), A10/A11 grounds, fuel pump #66, G1–G3, Ethernet B23–B26, ISO_KILL B14: on no sheet | generator: a power-and-ground sheet for the engine section |
| B17 | no label text; 16 white 22 AWG coil/injector wires indistinguishable | generator: provisional label text = circuit id, until Dave's names |
| B18 | location page lacks PDM15, LTCD, fuel pressure, Dakota senders, 61-pin, ground bank, head ring, alternator, fan; components are placeholders | twin: add the missing K5H_* objects; vendor CAD |
| B19 | RING-SMALL has no PN/stud/gauge and its count drifts (19/20/21); ground-bank capacity "—"; coil cylinder→output order unexplained | catalog: ring terminal PNs by stud and gauge; print the M1 ignition-output setup |
| C20 | "measured" = twin polylines, not tape on the truck (canon ch.18 §4) | **fix**: call them "twin" lengths; measured only for tape |
| C21 | firewall faces mislabelled | **done** (see above) |
| C22 | two-colour stripes read as the "not settled" dashes; labels struck through by runs on 1-10/1-12/1-13; truncated text; pin boxes carry the first wire's name; duplicate page numbers on parts overflow sheets; kits print ×0 | generator: stripe = solid band not dash; run–label collision lint; pin function from the designation file; unique numbering for overflow sheets |
| C23 | codes on pages (APS_T2_GND, COIL1_SGND, INJ PWR SPL, HEAD RING); 0 V returns in three colours; drains reuse return colours | naming table + a colour rule per function in the registry |
| C24 | engine section carries batteries, isolator, DC-DC, headlights, horn, wipers; 4 AWG single amp feed; "Specifications" is a dashboard; pedal drawn with 6 cavities vs 9-cavity plug with 6 wired; stale registry notes | section plan per harness (harness review A3); pedal plug drawn to its 9 cavities |

**Verdict as delivered:** build today only the coolant temp and oil pressure plugs (page 1-2), the injector plug once its
crimper is named, and the 61-pin cavity map for prototype pinning. Do not cut sheets 1-8 to 1-11 to their lengths; sheets
1-12 to 1-14 are not buildable; pages 1-4, 1-6, 1-7 are reference only. Not verifiable from the repo: GM end views for
crank, cam, MAP and the 12699160 throttle body; the SEN-01-5 wire count.

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
