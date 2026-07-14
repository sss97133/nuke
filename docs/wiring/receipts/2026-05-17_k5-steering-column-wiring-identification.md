# K5 Steering Column Wiring — Connector & Pin Map Identification

**Date:** 2026-05-17
**Vehicle:** 1977 Chevrolet K5 Blazer (vehicle_id in Nuke — squarebody, 73-87 column family)
**Audience:** Dave (wiring sub) — to scope what factory column wiring he can tap rather than gut
**Scope:** Identify the physical connectors at the base of the column, name pins, cite colors, propose how the K5 cut list should expand
**Source posture:** factory 1977 service manual gives the mechanical/diagnostic context; the per-circuit color/pin map lives in the *separate* 1977 Wiring Diagram Booklet (Section 12), which we don't have on disk. Closest substrate on disk is the 1978 ST-352 CK Wiring booklet (`docs/wiring/booklets/ST_352_78_CK_Wiring/`) — same column family. Vendor-side citations (American Autowire 510706, Speedway 500684) are independent witnesses to the same pinout.

---

## 1. Physical connectors at the column base

The 1977 service manual confirms that the C/K (and K5) column has a **single "harmonica connector"** at the bottom of the jacket carrying everything the column originates — turn signals, hazard, horn, brake feed-through — plus a **second, separate ignition switch connector** that mates to the column-mounted Delco lock-cylinder ignition switch.

> "Check for secure connection at the chassis to switch connector. **This is the harmonica connector on the column** (Figure 3B-13)."
> — 1977 Light Truck Service Manual, PDF p211 (printed §3B, p3B-11). `reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf`

> "Pull the switch connector out of the bracket on the jacket and feed switch connector through column support bracket and pull switch straight up, guiding the wiring harness through the column housing and protector."
> — 1977 LTSM, PDF p238 (printed §3B, p3B-38)

> "All GM steering columns starting in 1969 had the straight 'harmonica' type connectors. … The connectors have small letters molded into them to identify each position."
> — chevroletforum.com 72 Blazer thread (community consensus on Packard Electric 56-series harmonica)

| Connector | Mfr family | Pin count | Origin device | What it carries |
|---|---|---|---|---|
| Turn-signal harmonica | Packard Electric 56-series flat-blade ("harmonica") | **11 cavities A–N (positions D–P populated, F/E often blank)** | Turn signal switch (with built-in hazard yoke) | LH/RH front turn, LH/RH rear turn, brake input, horn ground, hazard feed, switch feed |
| Ignition switch | Packard Electric **5-cavity** flat-blade (SOL/ACC/GRD/BAT/IGN) | **5 cavities** (4 populated: SOL, ACC, BAT, IGN; one GRD often unused) | Column ignition switch (key cylinder drives mechanical actuator rod to switch low on jacket) | BAT, IGN feed, ACC feed, SOL crank |
| Horn slip-ring | Brass contact ring + spring-loaded brush in column shroud | 1 conductor | Horn button on steering wheel | Ground for horn relay (low-side trigger) |

**Hazard switch is NOT a separate connector.** The 1977 manual is explicit: the hazard switch is a mechanical knob on the turn-signal switch assembly itself; its contacts are inside the switch body, and its feed/output are pins on the same harmonica.

> "Push the hazard warning knob in and unscrew the knob. … Remove the three switch mounting screws. … Pull the switch connector out of the bracket on the jacket"
> — 1977 LTSM, PDF p238

---

## 2. Pin map — Turn signal harmonica (Packard 56-series 11-way)

Citation: American Autowire 510706 (1983-87 C/K Truck Classic Update Series) instruction PDF "Table B" page 7. The 1973-87 GM column harmonica did NOT change pinout across the run; AAW's 83-87 table is the same physical mating connector as a 1977 K5 column. Independent confirmation from the 1978 ST-352 CK Wiring booklet circuit-number table (`booklets/ST_352_78_CK_Wiring/p008.png`).

| Cavity | AAW wire color | Function | GM circuit # (1978 booklet) |
|---|---|---|---|
| P | White | Brake switch input → turn signal switch (so brake lamps blink when turning) | #17 White "Directional Signal Sw. Feed from Stop Sw." |
| N | Dark Green | Right rear turn / brake out | #19 Dark Green "Stop and Directional Lamp - Rear R.H." |
| M | Yellow | Left rear turn / brake out | #18 Yellow "Stop and Directional Lamp - Rear L.H." |
| L | Purple | Turn switch feed (12V from turn flasher) | #16 Purple "Directional Signal Sw. Feed from Flasher" |
| K | Brown | Hazard feed (12V from hazard flasher) | #29 Brown "Traffic Hazard Sw. Feed from Hazard Flasher" |
| J | Dark Blue | Right front turn / park out | #15 Dark Blue "R.H. Indicator and Front Directional Lamps" |
| H | Light Blue | Left front turn / park out | #14 Light Blue "L.H. Indicator and Front Directional Lamps" |
| G | Black | Horn relay ground (low-side trigger) | #30 Black "Ground, Horn Sw. Controlled" |
| F | (blank) | — | — |
| E | (blank) | — | — |
| D | (blank) | — | — |

Source: American Autowire 510706 install PDF, page 7 "Table B" — see saved binary at `~/.claude/projects/-Users-skylar/<session>/tool-results/webfetch-1779033655859-1v59ar.pdf` p8 of PDF. AAW labels these as the wires their dash harness terminates into the 14-way Pack-Con that mates to the OEM column harmonica.

The yellow #18 / brown #18 conflict in the 1978 booklet (one cell tabulates "Brown — Stop and Directional Lamp - Rear L.H.", another shows yellow #18) is a **substrate inconsistency to flag** — the cut-list and color/function pairing should default to the AAW table (yellow=LH rear) which is consistent with every modern aftermarket harness and with the Light Blue / Dark Blue front pattern. (`booklets/ST_352_78_CK_Wiring/p008.png`)

---

## 3. Pin map — Column ignition switch (Packard 56-series 5-way)

Citation: American Autowire **500684 ignition switch** instruction sheet (Speedway Motors PN 91050423), retrieved from `https://static.speedwaymotors.com/pdf/91050423instructions.pdf` (saved as `~/.claude/projects/-Users-skylar/<session>/tool-results/webfetch-1779033705010-5ftlgo.pdf` p1). Diagram labeled "View from back of connector."

| Terminal | Wire color | Function | GM circuit # (1978 booklet) |
|---|---|---|---|
| BAT | Red | Battery feed in (always hot) | #2 Red "Feed, Battery — Unfused" |
| IGN | Pink | Ignition out — hot in RUN and CRANK | #3 Pink "Feed, Ign. Sw., 'On and Crank' Controlled — Fused" |
| ACC | Brown | Accessory out — hot in ACC and RUN, dead in CRANK | #4 Brown "Feed, Ign. Sw., 'Accy and On' Controlled, Unfused" |
| SOL | Purple | Starter solenoid trigger — momentary, hot in CRANK only, routes through neutral-safety switch on autos | #6 Purple "Starter Solenoid Feed" |
| GRD | (not used) | factory leaves this terminal blank | — |

The SMP **US-14** replacement ignition switch (the part already on the K5 BOM, `K5_bom.txt:"1x Ignition Switch [US-14] — $20"`) mates to this same 5-way connector. The SMP **TW-20** turn signal switch (also on BOM) mates to the 11-way harmonica above.

---

## 4. Reuse vs replace — Dave's decision

**Recommendation: keep the column intact, replace the two switches with new SMP TW-20 + US-14 (already on BOM), reuse the OEM column harmonica + ignition connectors on the harness side as the column-to-chassis interface, and pigtail 22 AWG Tefzel into the existing Packard 56-series cavities.**

Why:
- **The Packard 56-series harmonica accepts 18-22 AWG round-wire pins** (TXL/GXL up through the era, now superseded by Tefzel for our build). Same physical female terminal as 1973-1987 — the OEM tin-plated brass blade-receptacle (Delphi/Packard PN 12010717 family terminal, housing 1973-1987 standard 56-series). 22 AWG Tefzel fits with no adapter — it's actually a step *down* in copper area from OEM 18 AWG and crimps cleanly into the same terminal. Confirm strip length per Packard datasheet (~5 mm).
- **Reusing the column connectors saves us 11 + 5 = 16 wire ends through the bulkhead**. The alternative — running 16 wires from PDM30 + switched inputs directly up to switch contacts inside the column — adds bulk in a tight column-to-dash route and reproduces what the OEM connector already does cleanly.
- **The K5 was already using these connectors for ~50 years**; the column tube is the load-bearing fixture. Cutting and re-pinning the column harness with new terminals + same connector bodies is the lowest-risk path.

### Wire-by-wire fate vs MoTeC PDM30

| OEM circuit (cavity / color) | Repurpose? | Goes to |
|---|---|---|
| Turn harmonica P / White (brake input) | **REUSE as input** | PDM30 input (or M130 DI) for brake-light request; also feeds the turn switch for combined brake/turn lamps |
| Turn harmonica N / Dark Green (RH rear turn) | **REUSE as output** | Splice to PDM30 OUT28 feed (#82 in cut list) — wire #82 currently runs from PDM30 to Diode Dynamics 36469; instead route PDM30 → turn switch cavity J input, switch routes through harmonica N to rear; rear gets fed via this single column-routed path. Or: leave PDM30 OUT28 direct-to-rear (current plan), and abandon harmonica N at the column |
| Turn harmonica M / Yellow (LH rear) | same as N, LH side | same logic, OUT27 (#80) |
| Turn harmonica L / Purple (turn switch feed) | **REUSE as input** | PDM30 fused output → cavity L (replaces factory turn flasher; the K5 LED turn signals require electronic flashers anyway — PDM30 PWM or an LED-compatible flasher inline) |
| Turn harmonica K / Brown (hazard feed) | **REUSE as input** | Same as L but from hazard PDM channel; this is the path that bypasses the ignition switch (hazards work key-off) |
| Turn harmonica J / Dark Blue (RH front) | same as N | front-turn light fed via switch — OR abandoned if PDM does direct-drive |
| Turn harmonica H / Light Blue (LH front) | same as M | front-turn light fed via switch — OR abandoned if PDM does direct-drive |
| Turn harmonica G / Black (horn relay GND) | **REUSE as input** | Horn button on wheel closes G to ground; routes to PDM30 DI / horn-relay trigger pin (cut list #48) |
| Ignition BAT / Red | **REUSE as input** | Direct feed from main battery distribution (already #63 Battery Disconnect) into BAT terminal |
| Ignition IGN / Pink | **REUSE as PDM trigger** | This wire becomes the PDM30 wake / "key-on" digital input. PDM30 internally distributes "ignition on" to all IGN-controlled outputs. **Cut list #40 "Ignition Switch — 14 AWG ORN" is this wire** — but should be 18 AWG Tefzel, not 14 AWG (PDM input draws milliamps) |
| Ignition ACC / Brown | **REUSE as PDM input** OR abandon | If we want a distinct "ACC mode" (radio on, engine off), wire ACC to a second PDM digital input. With the PDM keypad we can synthesize this in software; ACC can be abandoned at the column |
| Ignition SOL / Purple | **REUSE as PDM trigger** | Crank request input to PDM30; PDM gates this through neutral-safety switch (cut list #56) before energizing starter solenoid. Replaces factory direct-wire-to-starter |
| Ignition GRD | leave blank | factory leaves it blank too |

### Abandon in place
- The factory wires that ran out of these connectors to: factory fuse panel, factory horn relay, factory turn flasher, factory hazard flasher, factory ignition coil resistor (#7 Brown primary resistance bypass — LS3 doesn't need it), factory key-buzzer (#240 family), factory neutral-safety jumper to starter. Cut at the connector, cap, label.

### Physical compatibility — 22 AWG Tefzel in 56-series cavities
- Cavity-side terminal: GM/Packard 56-series female blade-receptacle, accepts 14-22 AWG. M22759/32 22 AWG Tefzel has 26 strands of 36 AWG (~0.34 mm² conductor) — well within the terminal's strip-and-crimp range.
- **Buy 100 of Delphi/Packard 12089039 or 12191760 (56-series female, 18-22 AWG, tin-plated)** plus the matching seals where applicable. Crimp with a Pico 3902 or Molex 63811-1000. Add these to `K5_connector_shopping_list.txt`.

---

## 5. Cut-list expansion proposal

The current `K5_cut_list_v2.txt` collapses the column to 4 single-wire entries: #33 Turn Signal Switch (1 wire), #40 Ignition Switch (1 wire), #41 Hazard Flasher (1 wire), #48 Horn (1 wire). The substrate reality is **8 wires on the turn harmonica + 4 wires on the ignition + 1 horn slip-ring = 13 wires** at the column-base interface.

Proposed expansion (one cut-list block per connector):

```
>> STEERING COLUMN — TURN SIGNAL HARMONICA (8 wires, 21 ft total at ~3.5 ft each, post-amendment color)
#33a  Turn Sig Brake In            COLUMN:P  → PDM30/Brake In  18 AWG M22759/32  WHT          3.5ft
#33b  Turn Sig RH Rear Out         COLUMN:N  → bulkhead rear   18 AWG M22759/32  DK GRN       3.5ft
#33c  Turn Sig LH Rear Out         COLUMN:M  → bulkhead rear   18 AWG M22759/32  YEL          3.5ft
#33d  Turn Sw Feed                 COLUMN:L  → PDM30/Turn fuse 18 AWG M22759/32  PPL          3.5ft
#33e  Hazard Sw Feed               COLUMN:K  → PDM30/Haz fuse  18 AWG M22759/32  BRN          3.5ft
#33f  Turn Sig RH Front Out        COLUMN:J  → bulkhead frt    18 AWG M22759/32  DK BLU       3.5ft
#33g  Turn Sig LH Front Out        COLUMN:H  → bulkhead frt    18 AWG M22759/32  LT BLU       3.5ft
#33h  Horn Relay GND               COLUMN:G  → PDM30/Horn DI   18 AWG M22759/32  BLK          3.5ft

>> STEERING COLUMN — IGNITION SWITCH (4 wires, 14 ft)
#40a  Ign BAT In                   COLUMN:BAT → Batt Disconnect 10 AWG M22759/16 RED          3.5ft
#40b  Ign IGN Out (PDM wake)       COLUMN:IGN → PDM30 KEY-ON DI 18 AWG M22759/32 PNK          3.5ft
#40c  Ign ACC Out (optional)       COLUMN:ACC → PDM30 ACC DI    18 AWG M22759/32 BRN          3.5ft
#40d  Ign SOL Out (crank request)  COLUMN:SOL → PDM30 START DI  18 AWG M22759/32 PPL          3.5ft
```

This deletes the existing `#33 Turn Signal Switch (1 wire ORN/BLU)`, `#41 Hazard Flasher (1 wire ORN/WHT)`, and `#40 Ignition Switch (1 wire ORN, 14 AWG)`. Net: **+9 wires**, retains traditional GM colors at the column for diagnostic continuity (Pink = IGN, Purple = SOL, etc.). The horn wire #48 retains its current cut-list entry but its FROM should change to "COLUMN:G" not "PDM30:OUT14"; PDM30 OUT14 becomes the relay-coil drive, not the slip-ring path.

---

## 6. Column-shift / transmission controls

**The K5 column is NOT a shift-position sensor.** Section 3B confirms the column shift mechanism is purely mechanical — a shift tube inside the outer jacket with two lower shift levers connected by rod linkage to the transmission:

> "Synchromesh — The synchromesh column is used on models with the standard transmission and column mounted shift levers. **The shift tube, within the outer column jacket, includes two lower shift levers for connection to the transmission control linkage.**"
> — 1977 LTSM, PDF p203 (§3B-7)

> "**A UTO M ATIC TRA NSM ISSIO N** — Available with column shift only, Locks the transmission and steering wheel while in park position and the lock cylinder is in 'Lock' position."
> — same page

There is **no electrical PRNDL sensor at the column.** Park/Neutral/Reverse/Drive position electrical signals come from a **neutral safety switch + back-up light switch on the transmission case itself**, not the column. The factory K5 used the TH350/TH400 case-mounted neutral safety switch (cut list #56) and reverse light switch (cut list #57) — both already enumerated.

**For the planned 6L80E swap with column shifter:** the 6L80E has an Internal Mode Switch (IMS) on its valve body — it reports PRNDL via CAN to the TCM (Holley 558-499 T43 in our build per receipts/2026-05-14_acceptance-three-decisions.md). The column shifter is purely mechanical (cable from column to 6L80E manual valve lever); position sensing is downstream of the manual valve, inside the transmission. **No new column wires for shift sensing.** This is a question we don't have to answer.

What we do need (already accounted): the mechanical cable adapter from the original column shift lever to the 6L80E manual valve. That's a Lokar / TCI part, not wiring scope.

---

## 7. Substrate gaps surfaced

1. **Cut list color drift** — current `K5_cut_list_v2.txt` puts every column wire under the "ORN" Tefzel-amendment color family. Proposal in §5 restores factory-canonical GM colors (PNK/PPL/BRN/etc.) at the column interface so Dave can identify wires by traditional diagnosis. Decision needed from Skylar: keep ORN-everything (sterile aerospace look, no factory-color reference) or restore canonical colors at the column (faster troubleshooting in 30 years)?
2. **1977 Wiring Diagram Booklet (Section 12)** is NOT on disk — only the chassis service manual. The 1978 ST-352 CK booklet is on disk (`booklets/ST_352_78_CK_Wiring/`) but only as PNG scans. **Action:** OCR/transcribe the 1978 booklet's column-page diagram (page index `p010.png` is the circuit-number table; the actual schematic of the column zone is on one of the larger schematic pages — likely p013/p015/p017). This is the canonical source to validate the AAW table against.
3. **Substrate inconsistency in 1978 booklet** — cell tabulation shows LH rear as both yellow (#18) and brown in different columns. AAW table breaks the tie: yellow = LH rear. File as `substrate_correction` receipt before promoting these wires to CONTRACT.
4. **Horn relay path** — current cut list #48 routes "Horn" 14 AWG from PDM30:OUT14 to engine bay. The factory pattern: horn relay is on the harness body (under dash), PDM30 drives the relay coil, the relay's high-current contact then drives the horn. Cut list #48 conflates these. **Action:** split #48 into #48a (PDM30 → relay coil, 22 AWG) and #48b (relay common → horn, 14 AWG).

---

## 8. PN summary for Dave (parts side)

| Part | Source | Status |
|---|---|---|
| Turn signal switch (replacement, OEM-style) | Standard Motor Products **TW-20** | $45 on BOM, not purchased |
| Ignition switch (replacement, OEM-style) | Standard Motor Products **US-14** | $20 on BOM, not purchased |
| Turn-signal harmonica connector body (column side, female 11-way Pack-Con) | LMC Truck / Classic Industries OEM replacement; or **American Autowire 510706 Bag G** ships the matching 14-way; **bare connector body Delphi/Packard 12191060 family** | NOT on shopping list — add |
| Turn-signal harmonica terminals (56-series female, 18-22 AWG) | Delphi/Packard 12089039 or Molex 63811 series; 11 needed plus spares | NOT on shopping list — add |
| Ignition switch connector body (5-way, SOL/ACC/GRD/BAT/IGN) | Delphi/Packard 56-series 5-way housing | NOT on shopping list — add |
| Ignition switch terminals (56-series female, 18 AWG for SOL/IGN/ACC, **10-12 AWG for BAT**) | Mixed-gauge from Packard 56-series catalog | NOT on shopping list — add |
| Horn slip-ring + brush | OEM column rebuild kit; LMC Truck 73-87 column rebuild PN family | already inside TW-20 install kit |

---

## Closure status

**PARTIAL** — turn-signal harmonica and ignition switch pin maps are cited end-to-end against two independent witnesses (AAW 510706 + Speedway/AAW 500684 + 1978 ST-352 circuit table). Column-shift question is closed (no electrical sensing at column). Cut-list expansion proposal is concrete and ready for Skylar to accept.

**Open unknowns:**
- Connector body + terminal PNs are family-cited but specific Delphi/Packard PNs need a final lookup against current LMC Truck or Classic Industries OEM-replacement listings before shopping. *Needs:* one round of catalog lookup before quoting to Dave.
- Final fate of factory ACC circuit (keep or abandon) is a build-config decision Skylar makes, not a research question.
- Horn relay-vs-direct architecture (PDM relay coil drive vs. PDM direct horn drive) is open; PDM30 OUT14 is a high-current channel (8A) and *could* drive the horn directly if the horn draws ≤8A, eliminating the relay. Worth a measurement on the truck's horn before committing.

---

## Citations

- **1977 LTSM** §3B (Steering), PDF pages 197–260 — `reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf`
- **1978 ST-352 CK Wiring booklet** circuit tabulation — `docs/wiring/booklets/ST_352_78_CK_Wiring/p008.png`, `p009.png`, `p010.png`
- **American Autowire 510706** install PDF "Table B" — https://api.americanautowire.com/shopify/instructions/510706_83-87_Chevy_and_GMC_Truck_Classic_Update_First_Design.pdf (saved 2026-05-17)
- **American Autowire 500684 / Speedway 91050423** ignition switch sheet — https://static.speedwaymotors.com/pdf/91050423instructions.pdf
- **chevroletforum.com** 72 Blazer wiring color order thread — https://chevroletforum.com/forum/k5-blazer-22/72-blazer-need-wiring-color-order-steering-column-harness-9024/
- **factory_harness_circuits** DB — `HORN_RELAY` (DK GRN 14 AWG), `HORN_BUTTON` (BLK 18 AWG), `IGN_RUN` (PNK 12 AWG), `IGN_RUN_START` (PNK/BLK 12 AWG), `START_SOLENOID` (PPL/WHT 12 AWG) — Supabase query 2026-05-17
- **`K5_cut_list_v2.txt`** current state (#33, #40, #41, #48 entries)
- **`K5_bom.txt`** — TW-20 ($45) and US-14 ($20) BOM lines
- **receipts/2026-05-14_acceptance-three-decisions.md** — Holley 558-499 T43 TCU for 6L80E (column-shift question depends on this)
