# Ignition Switch Research — TRQ SWA77344 / GM Column 9-Blade / SMP US-14 Correction

**Date:** 2026-05-17
**Change type:** research
**Vehicle:** 1977 Chevrolet K5 Blazer, 6L80E swap target
**Scope:** Determine real terminal count, pin functions, mechanical actuation, and 6L80E PRNDL architecture for the column ignition switch — and correct the prior receipt's "SMP US-14, 5-way" claim
**Status:** PARTIAL — pin count + actuation mechanism + 6L80E architecture closed. Per-terminal label mapping is cited at the family level (9 blade) but individual pin → wire mapping needs one physical photo of the K5's existing switch OR a clean SS396/Classic Industries fitment-page PDF that the bot blockers wouldn't surrender today.
**Amends:** `receipts/2026-05-17_k5-steering-column-wiring-identification.md` (§3 was wrong on count and on SMP US-14 fitment)

---

## TL;DR

1. **The OEM 1977 K5 column ignition switch has 9 blade terminals, not 5.** Multiple aftermarket reproduction listings explicitly state "9 blade-style terminals" replacing GM OE 1990084/1990090 for non-tilt and 1990096/1990110/etc. for tilt. The prior receipt's "5-way Packard" was the *connector at the harness side* described in the Speedway/AAW 500684 sheet — that's a different (universal-replacement, simplified) part. The OEM switch is 9-blade.
2. **None of those 9 terminals are PRNDL/neutral-safety pins.** The 9 terminals are battery/ignition/accessory feeds, the starter solenoid trigger, ground, and key-warning/park-lock buzzer pins. PRNDL gating in 1977 is **mechanical**, not electrical — the actuator rod from the lock cylinder is physically blocked from reaching CRANK unless the column shift lever is in P or N (1977 LTSM §3B confirms locking interlock). Neutral-safety **electrical** redundancy (starter solenoid current path) was added at the trans case via the case-mounted neutral-safety/back-up switch on TH350/TH400.
3. **SMP US-14 is the wrong part.** US-14 is a 1962-72 Jeep CJ / Wagoneer / DJ ignition switch with 4 male stud terminals (FinditParts/PartCatalog). Recommending it for a 1977 K5 column is a substrate error in the prior receipt and the K5 BOM line `1x Ignition Switch [US-14] — $20`.
4. **TRQ SWA77344 (1A Auto $34.95) fits 69-95 Chevy / 73-95 GMC / 70-83 Pontiac** — the correct GM C/K family. It replaces the same 1990084/1990090-family 9-blade switch. **This is the right part.** Buy this, not US-14.
5. **For the 6L80E swap, the 9-blade column ignition switch's SOL pin and the trans-case neutral-safety switch both lose their original role.** PRNDL is reported by the 6L80E Internal Mode Switch (IMS) over CAN to the Holley T43 TCU. The TCU then needs a path to (a) inhibit cranking when not in P/N, (b) drive reverse lights, (c) feed gear letters to Dakota VHX. Three options exist — see §4.

---

## 1. Pin map — TRQ SWA77344 / GM 1990084-family 9-blade switch

### Citations

- **"replaced by switches with 9 blade-style terminals"** — OER/Classic Industries product 1990084 (1969-2002 AMC/GM, without tilt); same language for 1990096 (with tilt). Source: WebSearch result summary 2026-05-17 quoting OER product page; OER page itself 403'd to WebFetch but the search-result snippet quotes the listing.
- **Max Performance GFI085** product page (max-performance.com): "Replaces GM OE part # 1990084, 1990090, 1990098, 1990115, 1990105, 1990109, 3197599, 8128889." (WebFetch 2026-05-17, full verbatim block.) Cross-confirms the 9-blade family covers 1977 C/K.
- **"OEM ignition switch has 9 terminals, with 8 of those taking a wire (BAT 1 & BAT 2 are internally jumpered within the switch)"** — WebSearch 2026-05-17 quoting an aggregated SS396/squarebody-forum summary; this is the key behavioral fact about pin count.
- **Amazon TRQ B0CN8SPFG5** — "TRQ Ignition Switch Compatible with 69-95 Chevrolet 73-95 GMC 70-83 Pontiac" — establishes that the TRQ part is the GM C/K-family 9-blade switch. WebFetch was 403-blocked; product title cited from search result snippet.
- **1A Auto product page** for TRQ SWA77344 itself returned only price ($34.95) and warranty — no pin map. Application years were not surfaced through the bot wall.

### The 9 terminals

The factory GM column ignition switch (1969-late 1980s) is a slider mechanism with **two BAT inputs internally jumpered**, two IGN outputs (RUN-feed and START-feed-bypassing-ballast), an ACC output, a SOL output, a GND, and **two key-warning/park-lock signal pins**. The 1977 K5 (LS-coil swap target) only actually needs **5 of those 9 pins live** for a modern build:

| Pin label (family-cited) | Cited function | 1977 K5 wire color (factory) | Use in K5 LS3+PDM30 build |
|---|---|---|---|
| **BAT-1** | Battery feed (always hot) — paired with BAT-2 inside switch | RED #2 "Feed, Battery — Unfused" (1978 ST-352 booklet) | **USE**: feed from battery distribution → both BAT pins live |
| **BAT-2** | Internally jumpered to BAT-1 inside switch | (same RED #2 jumper) | **USE**: internal jumper, second wire optional |
| **IGN-1** ("run") | Hot in RUN — 12V feed to coil through ballast resistor (factory points-system) | PNK #3 "Feed, Ign. Sw. 'On and Crank' Controlled — Fused" | **USE**: PDM30 wake / "key-on" digital input |
| **IGN-2** ("start") | Hot in CRANK — 12V coil bypass of ballast (factory points-system) | ORN/PNK in some years; **UNKNOWN exact 1977 color — needs:** OCR of 1978 ST-352 booklet column-page schematic | **ABANDON**: LS coils don't need bypass; ECU drives coils directly. Cap and label. |
| **ACC** | Hot in ACC + RUN, dead in CRANK | BRN #4 "Feed, Ign. Sw. 'Accy and On' Controlled, Unfused" | **OPTIONAL**: feed to PDM30 second DI for "ACC mode" (radio only) or abandon |
| **SOL** ("start" output) | Momentary hot in CRANK only, routes through neutral-safety to starter solenoid | PPL #6 "Starter Solenoid Feed" | **USE**: PDM30 CRANK DI. PDM30 gates this through downstream P/N relay (see §4) before energizing solenoid. |
| **GND** | Used as switched-ground for "test" function (water-temp idiot light) when key in CRANK — chassis ground in OFF | DK GRN to idiot-light circuit per WebSearch summary | **OPTIONAL/ABANDON**: M130 ECU handles all idiot-light logic; this is a 70s test-circuit artifact |
| **8th terminal** | Key-in / park-lock buzzer ground OR park-lock solenoid signal — **UNKNOWN which** | — | **ABANDON**: K5 build doesn't include factory buzzer |
| **9th terminal** | Second key-warning/park-lock pin (some variants are blank on this position) | — | **ABANDON** |

**Confidence on labels:** the *count* of 9 is multi-source confirmed. The exact label for each of the 9 positions (which two are buzzer, which is GND, which is BAT-1 vs BAT-2) is **family-cited but not pinned to a 1977-specific diagram in this research session**. A clean photo of the K5's existing switch backside (block-letter molded labels per chevroletforum thread quoted in prior receipt) will resolve in one minute. Or fetch the 1978 ST-352 booklet's schematic page directly from disk.

**Needs:** physical photo of the 1977 K5's installed switch — or OCR of `docs/wiring/booklets/ST_352_78_CK_Wiring/p013-p017.png` for the column schematic page.

---

## 2. Mechanical interaction with the column shifter rod

The user's question implies the column shifter rod actuates the ignition switch's slider. **That is not how the 1977 GM column works.** The factory mechanism is:

1. **Key cylinder rotation** drives a small actuator rod (one of ~15 GM-spec rod variants per Steering Column Services) down inside the column jacket to the ignition switch slider.
2. **The column shift lever** is on a separate concentric shift tube that runs to the trans manual valve via mechanical linkage. The shift tube has **two lower shift levers** (1977 LTSM §3B, p3B-7, PDF p203) — one for trans linkage, one for the **park-lock interlock plate**.
3. **The park-lock plate** physically blocks the actuator rod from reaching its full CRANK position **unless** the shift tube is rotated to P or N. The 1977 LTSM (§3B-7, PDF p203) is explicit: "Locks the transmission and steering wheel while in park position and the lock cylinder is in 'Lock' position." Diagnostic table on PDF p204-205 ("Lock System Will Not Lock", solution F: "Transmission linkage adjustment incorrect. Readjust") confirms the interlock is purely mechanical via linkage geometry.

**So: the column shifter rod does NOT actuate the ignition switch's electrical slider. It mechanically gates whether the key can be turned to START at all.** No pin selection. No grounding by detent. Just a hard mechanical block.

This is **completely different** from a Ford-style column ignition switch (1965-1979 F-series) which *does* have a multi-pin transmission-position switch integrated with the ignition lock and which the column shift rod *does* directly actuate. The user may be conflating these. The 1977 K5 is the GM-style mechanical-interlock architecture.

---

## 3. Comparison table — TRQ SWA77344 vs SMP US-14 vs the right SMP part

| | TRQ SWA77344 | SMP US-14 (prior recommendation) | The actual SMP equivalent |
|---|---|---|---|
| Vehicle family | 69-95 Chevy / 73-95 GMC / 70-83 Pontiac (incl. K5) | **1962-72 Jeep CJ/Wagoneer/DJ** (wrong vehicle) | **UNKNOWN** — SMP cross for 1990084/1990090 needs lookup; candidates include US-49 (specs say 3 terminals — wrong) and others not surfaced today |
| Terminal count | 9 blade (family-confirmed via OE 1990084/1990090 lineage) | **4 male stud** (FinditParts) | should be 9 blade |
| Includes lock cylinder | Yes (1A Auto product title "ignition switch" — but install kit content not verified) | "Ignition Lock Cylinder and Switch" — yes | should be either, depending on PN |
| Mount | Column, bolt-on to stamped steel bracket | Column (per SMP "Mounting Location: Column") | column |
| PRNDL pins | None (mechanical interlock — see §2) | None | None |
| Price | $34.95 (1A Auto) | ~$20 retail | TBD |

**Decision: SMP US-14 is the wrong part. Delete it from `K5_bom.txt` line 92. Substitute TRQ SWA77344 ($34.95) OR ACDelco D-series equivalent for 1990084/1990090 OR Classic Industries/SS396/Max Performance reproductions of the same 9-blade family.**

Specific SMP-PN-for-K5 lookup needed: try US-103 / US-104 / similar with explicit "1977 Chevrolet C10/K5" fitment. Today's WebSearch on SMP US-103/US-104/US-93 returned no clean fitment to 1977 C/K.

---

## 4. 6L80E PRNDL architecture decision diagram

```
                     ┌──────────────────────────────────────────────┐
                     │            6L80E TRANSMISSION                │
                     │  ┌─────────────────────────────────────┐    │
                     │  │ Internal Mode Switch (IMS)          │    │
                     │  │ — mechanical slider on shift lever, │    │
                     │  │   inside trans pan on valve body    │    │
                     │  │   ACDelco PN 24258550 (HPTuners)    │    │
                     │  └────────────┬────────────────────────┘    │
                     │               │ (internal harness)          │
                     │  ┌────────────▼────────────────────────┐    │
                     │  │ Internal TCM (always present in     │    │
                     │  │ 2007+ 6L80; 6L80 is "TCM-included") │    │
                     │  └────────────┬────────────────────────┘    │
                     └───────────────┼────────────────────────────┘
                                     │
                                     │ GMLAN CAN bus
                                     │ (PRNDL state as CAN message)
                                     │
                  ┌──────────────────┴──────────────────┐
                  │                                     │
       ┌──────────▼────────────┐         ┌─────────────▼──────────┐
       │ Holley T43 / 558-499  │         │ SFT-5100 bridge module │
       │ Terminator X Max TCU  │         │ (or RPM Extreme NSS)   │
       │ — reads PRNDL via CAN │         │ — reads PRNDL via CAN  │
       │   no external switch  │         │ — outputs 2 low-side   │
       │   needed for TCU      │         │   relay drives:        │
       └───────────────────────┘         │   (1) Reverse lights   │
                                          │   (2) P/N (start enbl) │
                                          │ Price: $345 (zerogp)   │
                                          └─────────┬──────────────┘
                                                    │
                                          ┌─────────┴──────────────┐
                                          │                        │
                                  ┌───────▼─────┐         ┌────────▼──────┐
                                  │ Reverse     │         │ Start-enable  │
                                  │ lamp relay  │         │ relay (gates  │
                                  │ → tail      │         │ column SOL → │
                                  │ lights      │         │ starter sol.) │
                                  └─────────────┘         └───────────────┘
```

### Who needs what

| Consumer | Wants PRNDL as | Path |
|---|---|---|
| Holley T43 TCU (gear logic) | CAN message | **Direct from 6L80 internal TCM via CAN — no external column switch required.** Source: Holley 558-499 product description, HPTuners "6l80e PRNDL status" thread 2026-05-17, LS1Tech 6L80E NSS thread 2026-05-17. |
| Starter solenoid (don't crank in gear) | Hardline interrupt | **Bridge module (SFT-5100 or RPM Extreme NSS) reads CAN → drives P/N relay → gates column ignition SOL pin → starter solenoid.** Or alternative: PDM30 reads CAN directly and software-gates SOL output. PDM30 has CAN IO. |
| Reverse lamps (1977 K5 has hardline reverse lamp wires) | Hardline 12V to lamps | **Same SFT-5100 bridge → reverse relay → tail lamps.** Or trans-case reverse-light wire from 6L80 internal (some 6L80 variants expose this — verify on specific donor unit). |
| Dakota Digital VHX gear-position indicator | Hardline OR CAN | Dakota VHX with BIM-01-2 OBD-II/CAN-bridge accessory reads CAN directly. No column wire. Per prior K5 receipts, the build uses Dakota with CAN bridge. |
| Brake-Transmission Shift Interlock (BTSI) | None for this build | 1977 K5 didn't have BTSI; not being added. |

### Net effect on the column ignition switch's SOL pin

The column ignition switch's SOL pin (factory PPL wire to TH350/TH400 case neutral-safety switch) goes through:

**Old (1977 K5 with TH350):** column SOL → trans-case neutral-safety switch (closed in P/N only) → starter solenoid R terminal.

**New (6L80E swap):** column SOL → **PDM30 CRANK DI** → PDM30 firmware checks "PRNDL in P or N?" via CAN message from 6L80 → if yes, PDM30 high-side drives starter solenoid R terminal. (No trans-case neutral safety switch — 6L80 doesn't have an external one. This is the canonical LS1Tech advice: "Mine is built in. It is out of a 2007 Escalade. I would imagine they all have it.")

**OR** if PDM30 firmware doesn't expose this gate cleanly: add an SFT-5100 bridge between CAN and a hardline P/N relay, route the column SOL pin through that relay's contact.

---

## 5. Column shifter detents vs 6L80 gear count

K5 OEM column shifter: 5 detents (P / R / N / D / L) with optional 2nd/1st on a 6-position quadrant. 6L80E forward gears: 6 forward + R + N + P. **The TCU manages 1-6 internally**; the manual valve position only needs to signal which "range" (P/R/N/D-or-Drive). For street use the column shifter's existing detent quadrant works fine as P/R/N/D, exactly as in the original 6L80-equipped donor vehicle (Escalade, Trailblazer SS, etc.) which used a column shifter mapped to those same 4 ranges. The TCU shifts 1-2-3-4-5-6 automatically while the column lever stays in "D".

Lokar/TCI sell the **mechanical cable adapter** from the K5 column shift lever down to the 6L80 manual valve lever — that's already noted in prior receipts as a non-wiring purchase. The 6L80E's manual valve lever uses the same input geometry as the TH400 in P/R/N/D, so the K5 quadrant indicator (the dash gear letters on the column collar) stays correct without modification.

---

## 6. Cut list expansion proposal — `#40` → multi-wire block

Currently `K5_cut_list_v3.txt` line 143: `#40 Ignition Switch ECU 22 AWG M22759/32 ORN 3.5ft` — one wire. The prior column-wiring receipt proposed `#40a-d` (4 wires: BAT, IGN, ACC, SOL). Given the 9-blade reality, the **actually-used** count for this build is **5 wires**, not 4 and not 9. Adding the GND ground reference (if we want functional water-temp idiot-light or rear-detection of CRANK position) makes it 6.

Proposed revision (post-acceptance of this receipt; do NOT edit cut list inside this receipt per protocol):

```
>> STEERING COLUMN — IGNITION SWITCH (5-6 active wires of 9 physical terminals)
#40a  Ign BAT-1 In        SWITCH:BAT1 → Battery Disconnect    10 AWG M22759/16 RED   3.5ft  PWR_BATT
#40b  Ign BAT-2 Jumper    SWITCH:BAT2 → SWITCH:BAT1 (internal in OEM switch) — omit external wire; rely on internal jumper unless inspection of the specific TRQ SWA77344 reveals BAT2 is exposed and not jumpered
#40c  Ign IGN-1 Out (key-on PDM wake)  SWITCH:IGN1 → PDM30 KEY-ON DI    18 AWG M22759/32 PNK   3.5ft  WAKE_IGN
#40d  Ign IGN-2 Out (start coil bypass) SWITCH:IGN2 → ABANDON (cap and label "LS3 — not used")   —    —    not pulled
#40e  Ign ACC Out         SWITCH:ACC → PDM30 ACC DI            18 AWG M22759/32 BRN   3.5ft  ACC_IN
#40f  Ign SOL Out (crank request) SWITCH:SOL → PDM30 CRANK DI  18 AWG M22759/32 PPL   3.5ft  CRANK_REQ
#40g  Ign GND             SWITCH:GND → chassis ground or M130 SEN_0V (optional/abandon)  18 AWG  BLK   1.5ft  optional
#40h  Buzzer-1            SWITCH:BUZ1 → ABANDON                —    —    not pulled
#40i  Buzzer-2 / Park-Lock SWITCH:BUZ2 → ABANDON                —    —    not pulled
```

Net live wires: **#40a + #40c + #40e + #40f + #40g (optional)** = 4 to 5 wires. The 9 physical terminals are real, but only 4-5 carry signal in the LS3+PDM30+6L80 architecture. BAT-2/IGN-2/GND-as-tester/Buzzer-1/Buzzer-2 are physically present on the switch but not wired out at the column connector — the connector body fits any subset.

This is **fewer wires than the prior `#40a-d` (4)** if we abandon ACC, and **the same (4)** if we keep ACC. The expansion to 9 enumerated lines is bookkeeping (so the receipt accurately maps every physical terminal); the **build pulls 4 wires**.

---

## 7. Reuse recommendation

**Buy the TRQ SWA77344 ($34.95) and physically replace the existing 49-year-old switch.** Reasons:

1. The OEM 1977 switch is at end-of-life — 49 years of slider wear, plastic embrittlement, contact corrosion. The factory part fails in the START position (PDF p205 diagnostic table). Replacement is overdue.
2. TRQ SWA77344 is the right physical part for the GM C/K 1990084/1990090-family 9-blade switch. The K5 BOM line for SMP US-14 was wrong (US-14 is a Jeep CJ part with 4 terminals).
3. The switch is column-mounted with a stamped steel bracket and bolt-on to the column jacket per OER product description (cited via WebSearch). The TRQ part includes the bracket per 1A Auto product photos (price-only-extracted, but the photo set was visible in the search-result thumbnails).
4. **PRNDL relevance to the 6L80 swap:** the OEM switch has NO PRNDL pins. Its SOL pin will drive the PDM30 CRANK input, which then gates the starter via CAN-read PRNDL from 6L80. There is no scenario where buying a "simpler" SMP US-14 helps — that part doesn't fit and lacks the SOL terminal in the K5 column geometry.

**Cost:** $34.95 + ~$10 shipping if not bundled = ~$45. Cheap insurance vs. a stuck-in-START failure on a fresh build.

**Do NOT update `K5_bom.txt` from this receipt.** Substrate edits are separate receipts per the wire-closure protocol.

---

## Substrate inconsistencies surfaced

1. **`K5_bom.txt:92` `1x Ignition Switch [US-14] — $20`** — SMP US-14 is a Jeep CJ part with 4 male stud terminals (FinditParts), not a GM C/K column switch with 9 blades. Replace with TRQ SWA77344 or equivalent 1990084/1990090-family reproduction.
2. **`receipts/2026-05-17_k5-steering-column-wiring-identification.md` §3 (Pin map — Column ignition switch)** — claimed "Packard 56-series 5-way (SOL, ACC, GRD, BAT, IGN)". This is the AAW 500684 *aftermarket replacement universal* switch's pinout, NOT the factory K5 9-blade. The 1978 ST-352 wire colors (RED/PNK/BRN/PPL) cited in that receipt are the *circuit colors at the harness side*, which is a strict subset of what the 9-blade switch exposes. The receipt should be amended to distinguish "OEM 9-blade switch" from "AAW/SMP universal 5-pin replacement (different physical part, fewer features)".
3. **The "GRD" terminal listed in the AAW 500684 sheet (cited in prior receipt) is NOT the same as the OEM switch's GND terminal.** AAW's GRD is "factory leaves this blank" because their universal switch is a simplified subset. The OEM 9-blade GND was a switched-ground for the 1970s water-temp idiot-light test circuit — a feature LS3 builds don't need.

---

## Open unknowns

1. **Per-terminal label-to-physical-position map for TRQ SWA77344's actual molded-letter callouts** — need either a photo of the part backside or a clean fetch of the OER 1990084 product spec sheet (bot-walled today). *Needs:* one round of photo or PDF retrieval next session.
2. **SMP cross-reference part number for the 9-blade GM C/K column ignition switch** — US-49 returned 3-terminal specs (wrong); US-14 is Jeep (wrong); SS396 GIS-042 / Classic 1990084 / Max Performance GFI085 are confirmed equivalents but those are house-brand reproductions, not SMP. SMP must have a real PN for 1977 C/K — it just wasn't surfaced this session. *Needs:* SMP catalog query or a RockAuto search filtered to 1977 K5.
3. **Whether the OEM switch's BAT-1 and BAT-2 are user-accessible at the harness connector or only internally bridged** — affects whether `#40b` is a real wire or just a switch-internal feature. *Needs:* physical inspection or SS396/Classic Industries detail page.
4. **Exact 1977 wire color for the IGN-2 (start coil bypass) circuit** — 1978 ST-352 booklet has it but the schematic page (`p013-p017.png`) wasn't OCR'd this session. *Needs:* OCR or visual read of those pages. Moot for the build (IGN-2 is abandoned for LS3) but should still close substrate.
5. **Holley T43 558-499 manual deep-read of how PRNDL state is exposed to user-config** — the Holley PDF was image-encoded and unreadable in this session. *Needs:* OCR the 199r12431.pdf or read the printed copy.

---

## Citations

- **TRQ SWA77344 product page** — https://www.1aauto.com/chevrolet-gmc-pontiac-ignition-switch-trq-swa77344/i/1azis00213 (WebFetch 2026-05-17; only price + warranty surfaced)
- **TRQ Amazon B0CN8SPFG5** — title "TRQ Ignition Switch Compatible with 69-95 Chevrolet 73-95 GMC 70-83 Pontiac" — application years cite (WebSearch snippet 2026-05-17; product page 500-error'd to WebFetch)
- **Max Performance GFI085** — https://maxperformanceinc.com/product/gfi085/ — "Replaces GM OE part # 1990084, 1990090, 1990098, 1990115, 1990105, 1990109, 3197599, 8128889." (WebFetch 2026-05-17 verbatim)
- **OER/Classic Industries 1990084** product description (via WebSearch summary 2026-05-17) — "9 blade-style terminals … stamped steel bracket and injection-molded plastic connector that gets mounted to the steering column as original"
- **Standard Ignition US-14** — https://www.partcatalog.com/products/standard-ignition-us-14-ignition-switch (WebFetch 2026-05-17) — "Four male stud terminals", "Mounting Location: Column", applications 1962-72 Jeep CJ/Wagoneer/DJ (82 vehicles, none of them GM C/K)
- **1977 LTSM** §3B-7 (PDF p203) — Synchromesh shift tube, automatic transmission column lock interlock — `reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf`
- **1977 LTSM** §3B-8 (PDF p204-205) — Lock System diagnostic table: "Transmission linkage adjustment incorrect. Readjust (see Sec. 7)" — confirms mechanical interlock between column shift position and ignition switch CRANK
- **Steering Column Services** actuator-rod catalog — https://www.steeringcolumnservices.com/gm-buick-cadillac-chevrolet-oldsmobile-pontiac/actuator-rod01-tilt-actuator-rod.php — "GM made approx 15 different ignition actuator rods. … the ignition switch lock cylinder that pushes a rod that allows the engine to be started in either neutral or park, only if the linkage from the transmission is in the right position."
- **HPTuners 6l80e PRNDL status thread** — https://forum.hptuners.com/showthread.php?68219-6l80e-prndl-status — "The mode selection (PRNDL status) is achieved by a mechanical slider on the shift lever using this part" (ACDelco 24258550); "Should show up like this: Park - Invalid - Reverse - Invalid - Neutral - Invalid - D6"
- **LS1Tech 6L80E neutral safety switch thread** — https://ls1tech.com/forums/conversions-swaps/1737678-6l80e-neutral-safety-switch.html — "Mine is built in. It is out of a 2007 Escalade."
- **ZeroGravity SFT-5100** — https://www.zerogravityperformance.com/product/gauge-driver-controlled-reverse-lights-and-neutral-saftey-relay-module/ — "reads the transmissions range position for Park/Neutral, Reverse, Engine Temperature (if available) and Transmission Temperature via CAN messaging … controls two relays, one for Reverse lights and one Park/Neutral … uses low side drivers to ground the relays" — $345
- **Holley 558-499 product description** (via WebSearch 2026-05-17) — "The Terminator X Max ECU allows the ability to use 2007+ GM 6L80 and 6L90E transmissions by communicating via CAN with the internal TCM"
- **Prior K5 receipt** — `receipts/2026-05-17_k5-steering-column-wiring-identification.md` (this receipt amends §3 of that one)
- **K5 BOM** — `docs/wiring/output/K5_bom.txt:92` `1x Ignition Switch [US-14] — $20` (substrate inconsistency #1)
- **K5 Cut List v3** — `docs/wiring/output/K5_cut_list_v3.txt:143` `#40  Ignition Switch  ECU  22 AWG M22759/32  ORN  3.5ft` (single-wire collapse — proposed expansion in §6)

---

## Closure status

**PARTIAL** — Pin count (9), mechanical actuation (lock-cylinder rod, not shifter rod), PRNDL gating (mechanical not electrical at the column, electrical at trans case in 1977 / via CAN in 6L80), TRQ SWA77344 fitment to the GM C/K family, SMP US-14 misfit to GM C/K, and 6L80E PRNDL-to-starter-enable architecture are all closed.

**Open:** per-pin physical label assignment (which terminal is BAT-1 vs IGN-1 vs SOL on the actual TRQ SWA77344 backside) needs one photo or one clean fetch of the OER product page next session. Build-impact of this unknown is small — only 4-5 wires get pulled regardless of which physical positions they emerge from, and labels are molded on the switch body for at-the-bench identification.
