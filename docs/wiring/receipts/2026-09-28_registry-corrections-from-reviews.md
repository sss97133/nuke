# Receipt: registry design corrections from the two reviews (A1–A4, A7, A9–A11, B19, C20, C23, C24)

- **Date:** 2026-09-28 (night)
- **Change type:** registry design (`reconcile_v5.py`, `kits_v5.py`, `catalog/endpoints.yaml`, `catalog/parts.yaml`) and
  regenerated build outputs (`k5_registry.json`, `WIRE_CHECKS.json`, `OPTIONS.md`, `DOSSIERS.md`, `BOOK_PLUGS.md`).
  Not committed, not pushed, nothing loaded to the database. Page generators (`diagram_v5.py`, `manual_v5.py`,
  `power_v5.py`) were not edited or re-run.
- **Follows:** `receipts/2026-09-28_reviews-and-shape-rules.md` (the findings, the builder review and the harness-engineering review).
- **Run order:** `python3 reconcile_v5.py` → `python3 check_plug_ends.py --wires` → `python3 check_plug_ends.py` → `python3 options_v5.py`.

## Measured

Verdict per wire = WRONG if any rule FAILs, INCOMPLETE if any rule is OPEN, else RIGHT. This is the map's rule
(`WiringMap.tsx` `verdictOf`), counted over the v5 active plus implied wires.

| Set | Wires | Right | Wrong | Incomplete |
|---|---|---|---|---|
| Whole truck, committed `WIRE_CHECKS.json` (before) | 328 | 318 | 0 | 10 |
| Whole truck, after | 344 | 334 | 0 | 10 |
| Engine-start set, before | 170 | 167 | 0 | 3 |
| Engine-start set, after | 174 | 171 | 0 | 3 |
| Whole truck, after the power-spine batch | 344 | 335 | 0 | 9 |
| Engine-start set, after the power-spine batch | 174 | 172 | 0 | 2 |
| Whole truck, after the check follow-up | 344 | 331 | 0 | 13 |
| Engine-start set, after the check follow-up | 174 | 168 | 0 | 6 |

- **What changed in the counts:** the 16 added wires are the PDM pigtails, and all 16 are RIGHT. No existing wire
  changed verdict. The same 10 are incomplete as before: 7 PCS TCM-2650 wires, FUEL_SND_GND, COIL_GND and PDM_BPOS.
- **Plug-end rules R1–R7:** 822 wire ends, 0 failing (798 before).
- **61-pin:** 57/61 used (58 before). Spares are c, d, t, u (c, t, u before).
- **Body bulkheads:** A 12/12, B 12/12, P 1/4, unchanged.
- **BOM changes:**

| Part | Before | After |
|---|---|---|
| M81824/1-3 | — | 8 |
| D-609-05 | 36 | 30 |
| CAN-TERM-100R | 1 | 2 |
| M39029/56-351 and /58-363 | 58 each | 57 each |
| MS27488-20-2 | 6 | 8 |
| 18 AWG red | 27.7 ft | 33.0 ft |
| 22 AWG red | 255.8 ft | 250.5 ft |

- **Check coverage lost:** R11 ("what switches it") ran on 64 wires before and 56 after. The 8 heavy load wires now
  start at their splice, not at a PDM output, so R11 and R9's output-rating check no longer see them. Their `control`
  text is unchanged. `check_plug_ends.py` needs to read `SPL-<box>-OUTn` as that output. It is not in this change's file list.

## Changes, each with its source

**A1 — 20 A outputs feeding a wire heavier than 16 AWG**
- **Loads fixed (8):**
  - PDM15 OUT1: #21 fan, 12 AWG.
  - PDM15 OUT4: START_TRIG, 12 AWG.
  - PDM30 OUT1: TG_FEED, 14 AWG.
  - PDM30 OUT2: BLOWER_HI, 12 AWG.
  - PDM30 OUT3: #34, 14 AWG.
  - PDM30 OUT4: #35, 14 AWG.
  - PDM30 OUT6: #51, 12 AWG.
  - PDM30 OUT8: #72, 14 AWG.
- **The design:**
  - Each output lands two 16 AWG M22759/32 pigtails, one per paired pin, the same length. They are registry wires
    `<load>_PT1` and `_PT2`, built by `add_pigtails()`.
  - The pigtails meet the load wire in a splice endpoint `SPL-<box>-OUTn`: family miniseal, kit M81824/1-3 ×1.
  - The load wire's start becomes `SPL-<box>-OUTn (<box>:OUTn pigtails Ax + Ay)`. The old start is kept in `conflicts`.
  - The load wire keeps its gauge. The joins are also listed in `reg.splices` as `type: in-line` with both sides.
- **Sources:**
  - MoTeC PDM user manual p.43 (PDM15) and p.44 (PDM30): "20 A Output n (with Axx)".
  - p.48: "20# to 16#" for 20 A outputs, and 16# = 15 A at 80 °C.
  - Superseal SSC-N contact range 24–16 AWG.
  - State 0h(1).
- **Deviation from the brief: in-line, not a D-609-05 stub.** A stub puts all three wires in one end. That is
  2 × 2,580 + 6,530 = 11,690 CM for a 12 AWG load, or 9,270 CM for a 14 AWG load. Both are past the 16–12 AWG
  cavity, whose ceiling is 6,530 CM. This is the repo's own splice-sizing rule (`kits_v5.splice_for`; ProWire
  3137CT cavities 26-20 / 20-16 / 16-12). In-line, the pigtail side is 5,160 CM (12 AWG equivalent) and the load side
  is 12 or 14 AWG, so both sides fit the yellow cavity. ProWire's MiniSeal page names D-609 as the stub part and
  "M81824/1 series" as the butt part, with a sealing sleeve. M81824/1-3 was added to `parts.yaml`.
- **Range conflict, not settled:** the 3137CT page gives the yellow cavity as 16–12 AWG. ProWire's MiniSeal category
  page gives the yellow band as "12-10AWG". Bench-check a 14 AWG load in the yellow splice.
- **Marked OPEN, not redesigned** (the builder's call):
  - #66 fuel pump: 14 AWG on the single 8 A pin A4. MoTeC recommends 24#–20# on 8 A outputs (p.48).
  - One conductor on a paired pin: #93 (22 AWG, A9+A17), #54 (16 AWG, B5+B11), INJ_PWR (16 AWG, A3+A12),
    COIL_PWR (16 AWG, A5+A14). One wire can't fill both cavities of a paired output.
  - These are on the PDM30-A and PDM15-A open lists. `kits_v5` now words the single-pin case correctly.

**A2 — throttle body 12699160**
- The TB endpoint's first open item is now "pin order: cite a GM end view of 12699160 before terminating", citing
  state row 29 and 0s.
- Wires 4a, 4b, 4c, 4e and 4f drop the stale 12605109 terminal name `GM_DBW_6PIN_F`. They now read "WCTHB50 kit
  terminal (TE AMP)" (endpoints.yaml TB; ICT WCTHB50 page).

**A3 — one home for pins**
- `pins_from_terminations()` runs after `kits_v5.attach`. It rewrites a record's pin text from its termination row
  wherever the two disagree, and logs the old text in `conflicts`. No cavity moved.
- **32 far-end pins were rewritten:**
  - Crank #99 → 1. Cam #101 → 3, 101g → 2, 101r → 1.
  - MAP 108g → 1, 108r → 3.
  - IAT, coolant temp and oil temp: signal → 2, 0 V → 1.
  - Coil triggers #5, #7–12 and #24 → c (Dave's a/b/c/d).
  - Injector drivers #13–20 → 1.
  - Dakota #116 → TACH, #119 → LEFT (+), #120 → RIGHT (+).
  - #126 → button harness.
- **65 PDM starts** now carry their pins, e.g. COIL_PWR `PDM15:OUT3 (A5 + A14)`, #64 `PDM15:OUT12 (A8)`.

**A4 — LTCD feed, verified in the manual**
- **What the manual says:**
  - LTCD user manual p.31: "110 mA typical current plus the sensor heater current", heater "typically 0.5 A - 1 A
    (up to 2 A on startup)".
  - p.37: "Each sensor can draw over 3 Amps when cold".
  - The earlier receipt could not match that text. It is verified now.
- **The calculation:**
  - Cold draw: 2 × over 3 A + 0.11 A = over 6.1 A.
  - PDM manual p.48 table: 22# = 6 A at 80 °C and 5 A at 100 °C, so 22 AWG is under the cold draw.
  - 20# = 8 A / 6 A. 18# = 11 A / 9 A.
  - OUT12 is an 8 A output (p.43), so the wire is sized to the output. 18 AWG carries 8 A even at 100 °C, the PDM15's
    recommended ceiling.
  - Feed drop at 6.1 A over 4.6 ft (1.40 m × 0.018 Ω/m): 0.15 V, 1.3 %.
- **Change:** #64 goes 22 → 18 AWG M22759/32, and LTCD_GND goes 20 → 18 AWG.
- **Trade-off, recorded:** 18 AWG is past MoTeC's 24#–20# recommendation for 8 A outputs, but inside the contact.
  20 AWG would meet the recommendation and the 80 °C rating, but not the 100 °C rating.
- **Open on the WIDEBAND endpoint:** confirm the #68054 DTM contacts take 18 AWG, and set OUT12's limit to 8 A.

**A7 — 5 V/0 V letter pairing**
- No wire changed. M130-A and M130-B each carry one open item: "5 V/0 V pairing: techspec A02↔B15/A09↔B16 vs Dave's
  sheet A2/B16 — Dave to rule".
- **Sources:**
  - M1 hardware techspec pp.16–17, verified in the PDF text: A02 SEN_5V0_A, A09 SEN_5V0_B, B15 SEN_0V_A,
    B16 SEN_0V_B.
  - Canon chapters/17, "SEN_0V letter-pairing rule", items 8–9.

**A9 — head ring grounds**
- COIL-GROUND-RINGS carries the open item "ground point, stud size, lug count: name it (state row 56 banks)".
- The M130 grounds ECU_GND1 and ECU_GND2 (A10/A11) now end on that endpoint. Their record device was the unnamed
  `COIL_GND_STAR_ECM_HEAD`; the old value is in `conflicts`. Source: chapters/17 §17.4.6.
- HEAD RING stays open.

**A10 — CAN bus as data**
- **Topology** (`topology` on CAN-BUS, copied into the registry by `ENDPOINT_EXTRA`):
  - Node order: M130 B17/B18 → PDM30 B26/B25 → 61-pin GG/j → PDM15 B26/B25 → LTCD pins 3/2.
  - UTC stub: within 500 mm of one end.
  - 100R 0.25 W at each end. At least one twist per 50 mm. Stubs 500 mm max. Bus 16 m max.
  - Verified in the PDM manual on p.49 ("UTC Wiring for PC Connection", "CAN Bus Wiring Requirements") and p.50
    (drawing, "Short CAN Bus"). The LTCD manual p.37 repeats the rules.
- **Kit:** CAN-TERM-100R goes 1 → 2. The stale one-resistor short-bus note is replaced on CAN-BUS, #62 and the part.
- **Open items:**
  - GG and j are not adjacent. Choose an adjacent pair from spares c, d, t, u, or accept.
  - The UTC splice point.
  - The PDM stubs.
  - The LTCD lead length.

**A11 — speed sender off the engine-only 61-pin**
- **Wire count, verified:** the Dakota VHX manual 650314:P p.8 states the SEN-01-5 is a 3-wire sensor. Red goes to
  SPD + ("should not be hooked up to anything else"), white to SPD SND, black to SPD −.
- The existing VSS_PWR, VSS_GND and VSS_DAK are those three wires, so no companion wires were added.
- The Summit page the brief named (`web_snapshots/www.summitracing.com__dak-sen-01-5.md`) is not on file.
  SEN015 now cites the manual.
- **Changes:**
  - VSS-SENDER gets a pin map: red, black, white. #100 and VSS_DAK share the white lead, so the endpoint is marked
    `splice_point`.
  - Open: "crossing: bulkhead C, cavity OPEN".
  - Open: the M130 tap on the white lead, or feed the M130 from the VHX SPD OUT (p.8).
  - #100 leaves cavity d. `kits_v5.CHASSIS_OFF` releases it after the nearest-cavity pass. A first try that dropped
    it before the pass moved #114 from A to d, and was reverted. No other wire's cavity changed.
  - The stale VSS endpoint ("speed source decision") is retired as superseded by VSS-SENDER (state 0v).
- **Gap:** R12 doesn't check this crossing, because it only judges cab↔engine-bay pairs and the sender sits on the
  chassis ("rear"). #100 therefore reads RIGHT with its crossing cavity OPEN.

**B19 — ring terminals**
- RING-SMALL stays OPEN, with the text "ring terminal PN by stud (M5/M6/M8/3/8 in) and gauge".
- `parts.yaml` has none.
- A read-only query of `catalog_parts` (supplier_url prowireusa.com) found no ring terminals.
- The studs themselves are open: the starter S stud and the head ring.

**C20 — length basis**
- No basis string said "measured". The 5 lengths the options report calls "measured" are twin paths: #6, #59, #63,
  PDM_BPOS and G1.
- Their basis now starts `twin:` and says "not taped on the truck".
- Every wire gets `length_kind`: tape, twin or estimate.
- **Still wrong:** `options_v5.py` line 67 classifies `twin` as measured, so OPTIONS.md and the Specifications page
  still print "measured 5". That file is outside this change.

**C23 — Dave's words** (`kits_v5.SPECIAL_NAME`)
- APS_T2_GND "pedal track 2 0 V". COIL1_SGND "coil 1 signal ground".
- INJ_PWR "injector +12 V feed". COIL_PWR "coil +12 V feed".
- DAK_OILP_GND "Dakota oil sender 0 V", plus DAK_OILP_5V, DAK_CTS_RET, LTCD_GND and VSS_*.
- END_WORD now says "injector +12 V splice" and "coil +12 V splice". `manual_v5.SHORT_END` no longer shortens these
  to INJ/COIL PWR SPL, so the manual prints the full words. Its overprint lint has not been run on that.

**C24 — pedal plug**
- APS gets `cavities: 9`, with the 6 wired B–G.
- `empty` holds 3 placeholder names, with the open item "cavity letters: read the WPAPP30 plug". No saved source
  names the 3 unused cavities, and the ICT page does not say whether the pigtail has 9 leads or 6.
- The page generators don't read `empty` or `cavities` yet, so the unused 3 do not print.

## Toolchain notes
- `reconcile_v5.py` and `kits_v5.py` hard-coded `REPO = /Users/skylar/nuke`. From a worktree they read and wrote the
  main checkout. Both now resolve the checkout from their own path.
- Gitignored inputs were copied into this worktree, not committed:
  - `output/lego-book/ch1_wire_index.csv`
  - `build-plan/MASTER_CUT_LIST.csv`
  - `docs/library/_extracted/component_drawings__motec_m130_datasheet/page-0004/0005.txt`
- Without the M130 pages, R9 reports 69 false OPENs.
- `check_plug_ends.py --wires` exits 1 on the 11 device R13 failures. Those failures were already there before this change.

## Not verified / open follow-ups
- Pages not re-run: the diagram and manual render the new pigtail wires, the `SPL-*` starts and the pin suffixes
  unseen. `power_v5.py`'s `OUT(\d+)` pattern does find the output inside `SPL-PDM15-OUT1`.
- The GM end views for 12699160 and for crank, cam and MAP are not on file.
- Kits' `pdm_pairs` still counts a D-609-05 for #93 and #54, the single wires on paired outputs above.

## Second batch — power-spine contradictions (from the DC primary build, `power_v5.py` read-only)

**Measured after this batch**
- Whole truck: 344 wires, 335 right, 0 wrong, 9 incomplete. PDM_BPOS is RIGHT now that its distribution-stud end has
  a termination row.
- Wire ends: 831, up from 822, with 0 failing.
- PDM30 8 A outputs: 22/22 in the options ledger, up from 21/22.

**Changes, each with its source**
1. **PDM15 feed lug.** DL214 is a 2 AWG lug and did not match the 6 AWG cable. The cable is now 4 AWG (item 2), so the
   lugs are LUG-4AWG-M6 at the PDM15 stud and LUG-4AWG-M8 at the MEGA holder. Both are OPEN: no 4 AWG 1/4 in or 5/16 in
   lug is in `parts.yaml`, the carts, or ProWire's `catalog_parts` (read-only query).
2. **PDM15 feed fuse.** The record said "MEGA 80 A"; it is now MEGA 100 A on 4 AWG.
   - "MEGA 80 A" does not exist: MEGA is made 100–500 A (chapters/17 §17.2 item 9).
   - The PDM15's total continuous output is 80 A (PDM manual p.35). Times 1.25 gives 100 A, the chapters/17 §17.5 item 5
     method that put a MEGA 125 A on the PDM30's 100 A.
   - The cable has to carry the fuse. PDM manual p.48 rates 6# at 90 A (80 °C) and 75 A (100 °C), which is under 100 A.
     4# is rated 120 A / 100 A.
   - p.48 also recommends 4# to 2# for battery positive.
   - This supersedes chapters/17 §17.8 item 4's 6 AWG for this feed. The canon text is not edited here.
   - MEGA-100A is added to `parts.yaml` as OPEN: the Littelfuse part number is not on file.
3. **PDM30 feed note.** The row stays 2 AWG, per the 2026-09-26 decision. The note's "0 AWG = 150 A" is rewritten as
   2 AWG /16 = 150 A at 80 °C and 120 A at 100 °C (p.48), on the MEGA 125 A.
   - p.4 is cited correctly now: "6# or 4#" is the PDM16/32 Autosport pin; the PDM15/30 "use a 6 mm eyelet to suit the
     wire size".
   - "Fused … rating TBD" now reads "MEGA 125 A at the distribution bus".
   - The old sentences are logged in `conflicts` through the new `notes_sub` decision key.
4. **Amplifier fuse, #32.** The ACC-BATT note now says MIDI 60 A, matching #32. Source: the Crutchfield snapshot of the
   JL VX700/5i, "a 60-amp fuse recommended" and "An external 60-amp AFS, AGU, or MAXI fuse (not included) must be
   installed". #32 lands 410LTP on the MIDI M5 stud (ACC-BATT kit). MIDI-60A is OPEN: its part number is not on file.
5. **Isolator part.** The `parts.yaml` entry ISOLATOR (Moroso 74102, 1/2 in studs) is renamed MOROSO-74102 and retired;
   LUG-2AWG-1/2 is retired with it. BLUESEA-7700 is added: studs 3/8 in-16, 140 in-lb, from its instructions
   990180170-006 p.1–2 and the bluesea.com snapshot. Source: state row 57.
6. **Termination rows.** `kits_v5.ecu_pins` now also terminates a far end named as one ECU/PDM pin.
   - ISO_KILL lands at M130-B B14 and is now in M130-B's wire list.
   - ECU_PWR lands at PDM30-B B6.
   - CAN_FW_H/L land at PDM15-B B26/B25; this gap was found by the same scan.
   - Distribution-stud ends were added on PS-STUDS: PDM_BPOS 2516LTP, PDM15_BPOS LUG-4AWG-M8, #52 810TP,
     #3 AMP-KIT-RING (open), and PCS_BATT RING-SMALL (open).
   - START_TRIG at the PDM15, and PDM30 OUT1–4, 6 and 8 plus PDM15 OUT1, already end on their pins through the batch-1
     pigtails.
7. **PDM30 8 A capacity.** ECU_PWR's pin text now names `PDM30:OUT24`, so the row, the PDM30-B endpoint (B6) and the
   options ledger agree at 22/22 used.
8. **Fuse-holder studs.**
   - Holders now carry `stud`: MEGA 02980900TXN is M8, MIDI 0498900.TXN is M5.
   - The only source is the 2026-09-25 cart receipt ("to the MIDI M5 studs", "to the MEGA M8 studs"). The Littelfuse
     datasheets are not on file.
   - Fused ends now land on the holder stud: #59 at the MEGA 2516LTP (was 238LTP), PDM_BPOS 2516LTP, DCDC_IN 810TP
     (was 838TP), #52 810TP.
   - PS-STUDS carries the rule as an open item, plus PCS_BATT's 5 A holder (OPEN: MIDI starts at 30 A).
9. **ECU grounds.** ECU_GND1/2 notes no longer say "To battery-negative star". They now say: in the loom to the engine
   head ring with the coil grounds, never through chassis or body.
   - Sources: chapters/17 §17.4 item 6 and state row 56.
   - The ring, stud and bank stay OPEN on COIL-GROUND-RINGS (A9).
   - The head is the engine, not the body, so both rules hold. The builder should confirm the ground star beside the
     batteries is not wanted instead. That was the old note's reading, and it also fits row 56 ("engine-bay returns").
10. **Fuel pump protection, #66.** The row gets a `protection` field: the PDM15 OUT10 maximum-current setting, 8 A.
    - PDM manual p.23: "to protect the wire and the PDM output". p.25: a device drawing 5 A or less takes an 8 A wire and
      an 8 A setting.
    - chapters/17 §17.8 item 6: "PDM-switched loads carry none (the PDM is the fuse)".
    - The canon's §17.5 "Fuel pump MIDI 30–40A" row sized the old relay-fed Aeromotive and does not apply. Canon is not
      edited here.

**BOM after this batch** (vs batch 1): 2516LTP 4, 810TP 2, 838TP 4, 410LTP 1, LUG-4AWG-M6 1, LUG-4AWG-M8 1,
AMP-KIT-RING 1, RING-SMALL 6.

**Left open / not in my files**
- #62 is a CAN pair recorded as one wire. Its M130 B18 and PDM30 B26/B25 ends still have no termination rows.
- PCS_NS/PCS_REV name PDM30 inputs as a channel string. Their PDM30 ends are not terminated, and the PCS end is unnamed.
- #32's ACC-BATT termination row still reads "open (connector not picked)". Only the endpoint kit carries 410LTP.
- The canon text in chapters/17 §17.5 and §17.8 item 4 still says 6 AWG for the PDM feed and MIDI 30–40 A for the pump.
  That is for whoever owns canon.

## Follow-up — `check_plug_ends.py` reads the splice starts and the chassis crossing

**Change 1: splice starts count as their PDM output.** A wire whose start is `SPL-<box>-OUTn` is now treated as driven
by that PDM output for R9 (the output-rating part) and R11 ("what switches it").
- R11 covers 64 PDM-driven wires again, as in the committed run (it had dropped to 56).
- R9 passes 102 again, as in the committed run (it had dropped to 99).

**Change 2: R12 sees the body crossing.** A cab-to-chassis wire now reads OPEN "crosses cab -> chassis through the body
crossing: bulkhead C, cavity OPEN" when either end, or its notes, records "crossing: bulkhead C". Before this, R12 did
not judge cab-to-chassis wires at all.
- The rule hits #100 and the three Dakota sender wires VSS_PWR, VSS_GND and VSS_DAK. They run the same cab-to-NP205
  path, and the VSS-SENDER endpoint carries the open item.
- These four are now INCOMPLETE. That is why the counts moved from 335 right / 9 incomplete to 331 right / 13
  incomplete (engine-start set: 172/2 to 168/6).
- No WRONG appeared.
- Bulkhead C being designed closes all four.

**Where the build reads and writes.** The worktree does not write into `/Users/skylar/nuke`.
- The main checkout's `k5_registry.json`, `WIRE_CHECKS.json` and `KITS_REPORT.md` are still dated 2026-09-27 21:34,
  before this session.
- `reconcile_v5.py` and `kits_v5.py` now resolve `REPO` from their own path.
- `check_plug_ends.py` and `options_v5.py` already did.
- Three gitignored build inputs were copied from the main checkout into the same paths in this worktree (read from
  main, written to the worktree only, never committed):
  - `docs/wiring/output/lego-book/ch1_wire_index.csv`
  - `docs/wiring/build-plan/MASTER_CUT_LIST.csv`
  - `docs/library/_extracted/component_drawings__motec_m130_datasheet/page-0004.txt` and `page-0005.txt`
- Source PDFs were read in place from `/Users/skylar/nuke/reference_documents/component_drawings/` and extracted to the
  session scratchpad: the PDM, LTCD, M1 techspec and Dakota VHX manuals.
- `reconcile_v5.py` still reads `/Users/skylar/k5-harness-pull/devices.json`, read-only, outside both checkouts.

## Round 5: tilt ignition switch; wiper and washer deep dive (2026-09-28)
- **IGN-SWITCH** is OER 1990096, the 9-blade switch for the tilt column. The OER 1990084 non-tilt alternative is retired. Source: owner, 2026-09-28, "the column is TILT".
- **Wiper motor, from the 1977 LTSM Sec. 8.**
  - p.802: a compound-wound motor with a park switch and an internal circuit breaker on the brush plate.
  - p.803: the ignition feed lands on center terminal 2. The grounding-type dash switch grounds 1 and 3 for LO and 1 only for HI; HI runs through the 20 ohm resistor. After OFF, the park switch runs the motor in LO off the feed until the cam opens it.
  - p.810: 20+ A is the stall current.
  - p.812: the bench trouble chart gives 3.5–5.0 A as the normal draw.
  - p.804: pulse wipers used the same motor with an external control unit.
- **The PDM feed is right.** The switch still selects speed and park still runs from the feed.
  - OUT12 limit is 7 A. The load is 5.0 A from p.812, so 1.25 × 5.0 = 6.25 A. The ceiling is 0.85 × 11 A = 9 A for 18 AWG (PDM manual p.48).
  - A stall at 20+ A trips the filtered over-current (PDM manual p.23–24). The motor's own breaker backs it up.
  - The on-truck draw is OPEN: clamp-meter it at mock-up.
  - WIPER_T1 carries the armature current and stays 16 AWG, at or above the 18 AWG feed. WIPER_T3 carries shunt current only and stays 18 AWG. OUT12 protects both.
- **New wire WIPER_SW_GND** (16 AWG, switch mount to GND-BANK-CAB). The motor current returns through the grounding-type switch (p.803). Grounds run in the loom (state row 56).
- **Washer.**
  - The factory '77 pump is driven by the wiper motor and triggered by a ratchet solenoid that the switch grounds (Fig. 8-16; p.814). It is left unwired, and the lock-out tang keeps it idle (p.814).
  - The 1985–87 jar pump is a 2-wire electric pump: white is the feed, pink the switched ground (1987 LDT manual 8A-34).
  - Picked: the Hella 8TW 004 223-031 pump in the 8TW 003 248-001 1.5 l tank, mating connector 8JD 008 151-021. Pin 1 is +, pin 2 is − (Hella product information, snapshot saved).
  - The USA1 20151 pump is retired: its listing publishes no plug and no current.
  - OPEN: the pump current, since Hella publishes none (bench it), and the tank's fit on the inner fender.
- **Intermittent wipers are not added.** Pulsing the feed would stop the blades mid-sweep. A PDM delay would need the park switch on a PDM input.

## Round 6: parts rows and kits for body bulkheads A, B, P (2026-09-28)
- **A:** DT04-12PA-L012 receptacle (gray, A key) with W12P, DT06-12SA plug with W12S, and a DT12-L012-GKT gasket. **B:** DT04-12PB-L012 (black, B key) with W12P, DT06-12SB with W12S, and a DT12-L012-GKT gasket. Both are full at 12 of 12, so neither takes a cavity plug. Sources: the customconnectorkits pages for each part, snapshots saved.
- **P:** DTP04-4P-L012 with WP-4P, DTP06-4S with WP-4S, a DTP4P-L012-GKT gasket, and six 114017 sealing plugs, three per half for cavities 2 to 4. The 114017 comes from the Deutsch catalog's size 16-12 sealing plug row (web_snapshots/www.farnell.com__628276.md).
- **Mating-half contacts:** A, B, P and C gained a `wires` list, so kits_v5 counts the other half's contact. Before this, C also left its sockets out.
- **BOM contact totals:** size 16 has 42 pins and 42 sockets. Size 12 has 11 pins and 11 sockets.
- **OPEN:** the DTP4P-L012-GKT page was not saved, because customconnectorkits returned 429 and I stopped fetching from that host.
- **OPEN:** C's 0413-204-2005 plugs conflict with the Deutsch table, which lists that part for size 20 contacts.

## Round 7: the 6L90 case connector and the PCS kit harness (2026-09-28)
- **TRANS-CASE (new endpoint, chassis):** the Kostal 16-cavity case connector, GM 15131300 / 19303772. Its full cavity map comes from the EFI Connection pigtail page (snapshot), with each cavity marked as fed through the kit, inside the kit, available, or OPEN. We do not cut or terminate this plug.
- **PCS-HARNESS-4610 (new endpoint, kit_terminal):** the Zero Gravity "TCM4610 Harness only" (snapshot). It sits between PCS-TCM and the case.
  - The seven vehicle-side PCS wires now end at its leads. The lead labels are OPEN until the harness drawing.
  - The GMLAN pair and case cavities 9 and 12 are recorded as inside the kit.
  - PCS-TCM keeps no wires of ours.
- **New wire TRANS_BATT:** 18 AWG from the distribution stud to case cavities 1 and 4, on a 7.5 A inline fuse. Holley 558-499 p.3 asks for "a constant battery source capable of supplying 5 amps", and 1.25 × 5 A = 6.25 A. 18 AWG carries 9 A at 100 °C (MoTeC PDM manual p.48). It is separate from PCS_BATT, the PCS's own 5 A supply under the 07-12 ruling.
- **New wires TRANS_GND and PCS_GND:** each 18 AWG to the engine ground star. TRANS_GND serves case cavities 2 and 5. ZGP p.2 lists "12V Battery, Ignition and Grounds", and grounds run in the loom per state row 56.
- **New wire TRANS_BRK:** 22 AWG from case cavity 6 to the brake lamp feed tap at the CHMSL, the same source as PCS_BRK.
- **Case cavities not wired:** tap up/down (7) is OPEN until shifter buttons are picked. Park/neutral (3) and output speed (16) are recorded as available outputs. The Dakota SPD/GEAR substitution stays OPEN.
- **#58 retirement reason:** now cites the 07-12 ruling and state §3 0a. OUT23 is free of it and carries MIRROR_PWR. **#125:** the GMLAN pair lives inside the kit.
- **New option candidate PCS-CAN.** It is not wired, because it would break the locked two-node private bus. It is an owner decision.

## Round 8: cavity plugs by contact size; door pass-through kits; iBooster candidates (2026-09-28)
- **Cavity plugs:** the Deutsch catalog sealing-plug table (web_snapshots/www.farnell.com__628276.md) gives 114017 for size 16-12 and 0413-204-2005 for size 20.
  - Bulkhead C and both DT 8-way door pass-throughs take 114017, one per spare cavity in each half. The dt family default is now 114017, and the C OPEN is closed.
  - 0413-204-2005 now appears only on the size-20 DTM port, IBST-DIAG. Its parts row is renamed as the size-20 plug.
- **Door pass-through kits:** they were empty, so their housings never reached the parts list. The DT 8-way kit is DT04-08PA, DT06-08SA, W8P, W8S and four 114017. The DTP 4-way kit is DTP04-4P, DTP06-4S, WP-4P and WP-4S. These parts rows already existed.
  - Parts list now: 114017 × 18 (C 4, doors 8, P 6), DT04-08PA × 2, DTP04-4P × 2.
- **Candidate IBST-CAN, iBooster step 2 (read-only):** IBST_CAN_H/L is a 22 AWG M22759/16 twisted pair from booster pins 16 and 25 to IBST-DIAG.
  - Sources: fastandquiet Gen 2 pinout; CANW, one twist per 50 mm (PDM manual p.50); coloured yellow/green like the trunk.
  - IBST-DIAG is a DTM 4-way: MoTeC #68054 on the harness half, capped by #68055 (LTC manual p.32). It carries two 120 Ω terminators, because the booster has no termination and runs at 500 kbps (evcreate). The bus is never joined to the M1 trunk.
  - OPEN: pins 16 and 25 are blind-plugged and not in the Tulay harness. The Bosch terminal 1928498705 is on file (openinverter). The terminator part and the #68054/#68055 kit contents are also OPEN.
- **Candidate BFL, brake-fluid level:** BFL_SIG and BFL_0V are 20 AWG from the reservoir sensor to the engine PDM15 (DIG1 A27, 0V B22).
  - PDM30 DIG8 is free but sits in the cab. That crossing failed R12, because bulkheads A and B are full and C is the floor exit.
  - OPEN: the sensor connector, the sensor type and polarity, and the lamp output.

## Round 9: iBooster is Gen 1; the PCS mounts in the cab (2026-09-28)
- **IBOOSTER is the Gen 1 Tesla Model S/X unit, 1037123-00-B.**
  - Sources: the owner's Gmail, Calimotive order #1011, confirmed 2023-11-09 ("we will ship out a revision B") and delivered 2023-11-13; and the label in K5 photo 40e5e5f9.
  - The harness is Tulay's Gen-1 universal harness. It is NOT on order, so its purchase is OPEN.
  - Pins follow the fastandquiet Gen-1 pinout: 1 always hot 40 A, 9 ground, 17 always hot 5 A, 20 ignition 5 A.
  - The pedal-sensor mapping is 1→2, 2→22, 3→8, 4→23, inside the Gen-1 harness.
- **New wire IBOOST_PERM:** 16 AWG to pin 17, the Tulay 1.50 mm² red lead, on a 5 A inline fuse at the distribution stud.
  - #52 and IBOOST_PERM both record the isolator choice: A is the Odyssey + post; B is the distribution stud, as designed and the default. It is an owner/Dave call.
  - IBST-CAN now cites the Gen-1 pinout, where vehicle CAN is on pins 16/25.
- **The PCS goes in the cab.** The ZGP TCM-2650 setup guide rev2 has no mounting location and no sealing rating in any of its 23 pages. Under the lead's rule, PCS-TCM and its kit leads are in the cab, under the dash beside the PDM30.
  - PCS_BATT (5 A) and TRANS_BATT (7.5 A) now come from the PDM30 battery stud, on 9904 rings. That stud is always hot, fed from the distribution stud by PDM_BPOS. This avoids a firewall crossing, because bulkheads A and B are full.
  - PCS_GND and TRANS_GND now go to the cab ground bank.
  - PCS_IGN moved from PDM15 OUT13 to PDM30 OUT21. From the engine PDM it would cross the firewall with no path, which failed R12.
  - OUT21 was the only base-free 8 A output, but the PL candidate held it. PL now needs another output, which is recorded on OUT21.
  - OPEN: the kit harness's path from the cab to the case connector.
- **The PDM30 battery stud joins the colour rule's power sources,** so PCS_BATT is red.

## Round 10: lead round 5 (fourth reads) (2026-09-28)
1. **Small inline fuses.** One holder family, Blue Sea 5065 waterproof in-line ATO/ATC: 12 AWG pigtails, 30 A max (snapshot). The fuses are Blue Sea 5237/5239/5240/5241 (ATO/ATC fuses snapshot).
   - The protection record now carries value, source, holder and fuse part, and the BOM counts them: 6 holders; 5 A fuse × 4; 7.5 A × 1; 10 A × 1.
   - **DAK_CONST is 5 A, not 3 A.** Dakota VHX manual 650314:P p.6 asks for "a fused 5 - 20 amp circuit", and the old 3 A had no source.
   - **PCS_BATT stays 5 A, provisional.** That figure is Holley's transmission figure. The PCS's own draw is OPEN: the ZGP guide rev2, the PSI TCM-2650 page and the ZGP harness page give none.
   - **New rule R15 protected.** A feed landing on a battery stud with no protection record FAILS, and so does an inline fuse with no holder or fuse part. Result: 17 wires pass, 0 fail.
   - **Stud rings sit on the holder's 12 AWG pigtail.** 9916 at the PDM30 M6 stud; 9918 at the 3/8 in distribution stud. R1 reads the pigtail gauge there.
2. **PCS_IGN has its own output, PDM15 OUT13.**
   - PCS_IGN_PT is 20 AWG, the pin range for 8 A outputs (PDM manual p.9). It runs to SPL-PDM15-OUT13, a 20 + 14 AWG stub splice in the 16-12 band.
   - PCS_IGN continues at 14 AWG through body bulkhead P cavity 2. P had 3 spare size-12 cavities for 14-12 AWG; it now has 2.
   - OUT21 is back to PL.
3. **Case cavities 12 and 9** are marked OPEN until the TCM-4610 drawing: does the kit feed them from the PCS ignition lead? The PDM15 OUT13 load note carries the same question.
4. **TRANS_GND goes to the engine ground star** (Holley p.3), from a new endpoint for the kit's case-side ground lead on the chassis. It runs along the kit's route, which is OPEN until mock-up.
5. **PCS_NS and PCS_REV** now have "switched output" labels and are white signal stock.
6. **PCS_BRK and TRANS_BRK** now tap SPL-PDM30-OUT5, the brake lamp output (#93, DIG14), in the cab. They no longer run to the CHMSL at the back of the truck. They are white and carry R11 control from #93.
7. **BLOWER-RES cavities** are now BAT, M1, M2 and BLO. The factory circuits 51, 63, 72 and 101 move to factory_circuit, and the device text says they are circuit numbers.
8. **IBOOSTER pin rows** each name the fastandquiet Gen-1 pinout and Tulay Gen-1 snapshot filenames.
9. **IBOOST_PERM's stud ring** is 9918, not RING-SMALL.
