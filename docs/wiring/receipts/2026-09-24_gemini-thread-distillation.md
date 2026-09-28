---
date: 2026-09-24
change_type: research
scope: K5 A/C subsystem + power architecture + wiring BOM — distillation of an external-AI transcript
amends:
  - 2026-05-23_ac-architecture-locked
  - 2026-06-09_as-built-photo-survey-corrections
status: Skylar verbal (owner statements in the Gemini thread + Claude session 2026-09-24); agent adjudication of every AI claim against substrate
---

# Receipt — Gemini AI Mode K5 thread (2026-09-24): owner facts kept, AI claims adjudicated, A/C order recorded

**Source:** Google AI Mode (Gemini) thread, 98 turns, saved three ways in `~/Downloads/gemini/` (`index.html`, the long-titled `.html`, `Untitled.rtfd` — same thread). `T##` below = turn number in that thread. Order facts come from Skylar's eBay order-confirmation screenshot (`Untitled.rtfd/80__…jpg`), not from the AI's tracker.

**Rule applied:** the thread's value is Skylar's own testimony (facts, decisions, requirements, and the errors he caught) plus the one real purchase. Gemini's part numbers, amp figures, pin assignments, and BOMs are **not substrate** — each was checked against our library/DB/canon below. Anything not verified stays a lead, never a spec.

---

## 1. ORDERED — eBay, paid 2026-09-24 (Google Pay, buyer `1508nuke`, ship to 707 Yucca St, Boulder City NV)

| eBay order | Seller | Item (listing title, abridged) | eBay item | Price |
|---|---|---|---|---|
| 10-15210-67139 | autopartstd | 4 Seasons A/C Evaporator Core Front, 1976-1977 K5 Blazer | 146144798182 | $128.84 |
| 10-15210-67140 | jcwhitney | GPD 1411597 "A/C Accumulator" for Blazer/Suburban/K5/C10 | 124110356073 | $31.49 |
| 10-15210-67141 | autopartsupreme | A/C Orifice Tube 4 Seasons 38904 | 298251803285 | $25.22 |
| 10-15210-67142 | kmcautoparts | HVAC Blower Motor 4 Seasons 35587 | 406732859496 | $23.02 |
| 10-15210-67143 | joe888ca | Continental Elite Gatorback 4060672, 6PK1710 serpentine belt | 257506270992 | $22.94 |
| 10-15210-67144 | autoepar | 6.5 ft #6/#8/#10 A/C hoses + beadlock fittings | 357798902699 | $139.99 |
| 10-15210-67145 | automotive_budget | Sanden 7176 compressor w/ clutch, 6GR, SD7B10 swing mount, new | 151435180305 | $279.00 |
| 10-15210-67146 | autopartsgeek3 | 1975-1980 K5 Blazer A/C condenser 52132SGMC | 195899928289 | $133.99 |
| 10-15210-67147 | bold_auto_parts | A/C accumulator, C/K/Suburban/Blazer/Jimmy V6 V8 | 256476771126 | $35.95 |

Items $820.44 + shipping $11.00 + tax $68.71 = **$900.15** (sums check to the confirmation).

**Verify on arrival** (the cart screenshots showed free returns on the compressor, condenser, evaporator, GPD, and Bold listings):
- **Condenser 52132SGMC** — the title does not say parallel-flow. Gemini called it "parallel-flow" with no evidence (T50). The 2026-05-23 lock requires a parallel-flow aluminum condenser. Look at the core; if it's serpentine, it misses the lock.
- **Blower 4 Seasons 35587** — the ordered listing is *not* the 366510374494 listing Skylar saw "clearly shows a wheel" (T56); Gemini's T82 tracker said "35513" — wrong. Whether a wheel is in the box: UNKNOWN until opened.
- **GPD 1411597** — listing title says accumulator; the listing photo is a U-shaped tube (Skylar, T58). Confirm which line it is and whether it routes with the LS3 layout.
- **Belt 6PK1710** — Holley's own spec for the complete A/C mid-mount kit is **BANDO 6PK1715** (Holley install guide pp.1–2 parts list, `reference_documents/component_drawings/Holley_20-185_Mid_Mount_Install_Guide.pdf`). The 6PK1710 came from Gemini's "~1700–1715 mm" guess (T47). Fit-check on install.
- **Compressor fit** — Holley lists its own SD7 for the mid-mount as **199-102 (natural) / 199-104 (black) / 199-106 (polished)** with adapter manifold **199-202** (guide pp.1–2). Whether the Sanden 7176 matches the Holley ears/ports: UNKNOWN — confirm at mock-up.

**Not ordered** (the thread ended without them): anything on ProWire, batteries, pressure transducer or trinary switch, blower resistor (a $97.20 Four Seasons motor+resistor combo sat in the T52 cart screenshots; not in the final order), vacuum reservoir, Holley 199-202 manifold (may be in the A/C kit box — see §2a).

---

## 2. OWNER FACTS & DECISIONS (Skylar's words)

| # | Fact / decision | Source | vs substrate |
|---|---|---|---|
| a | **Accessory drive = Holley Mid-Mount, non-A/C, installed now. A Holley mid-mount A/C bracket is in a box in the truck. Kit mix-up being resolved. No effect on parts ordering or schematics.** | Skylar, Claude session 2026-09-24; T3/T14 ("holley mid mount… sd7 compressor") | **Supersedes** the as-built reading "CVF Racing (BANDO 6PK1930), no compressor" (2026-06-09 survey item 4/7, from 2026-01-31 photos) |
| b | Factory evaporator box is kept and rebuilt/upgraded (mounting points); the faceplate control unit, cable controls, and vacuum controls must be accounted for | T5 | Consistent with 2026-05-23 lock (factory housing retained) |
| c | Auxiliary condenser fan is "an opportunity"; goal is far more airflow | T5 | Lock already includes electric condenser fan |
| d | Throttle body: **DBW, GM 12699160** (Skylar ref "for 22-23 Silverado 2500 2832775"), mounted where the carb would be, pedal linked through the 61-pin | T75 | **Conflicts** with §1 locked "90mm DBW GM 12605109"; closes as-built Q2. Cut list #4c–#4f pin letters were taken from 12605109's connector — 12699160 pinout UNKNOWN, re-derive before terminating |
| e | Coils: 8× GM Delco 12611424 / D510C (12570616), clustered like a distributor behind the throttle body | T75 | Consistent with locked DEL-Stributor central mount; answers survey Q3 (shape) |
| f | Injectors: 8× Siemens Deka FI114961, 60 lb/650 cc | T75 | Consistent (receipt OCR: KM Racing Deka 650cc) |
| g | Fuel pump: in-tank, **Quantum Fuel Systems hanger QFS-H882-367**; "we need to know what it's pulling" | T75 | **Conflicts** with load schedule / ch.05 device "Aeromotive A1000" (12A cont) that sized #66 at 8 AWG (`K5_cut_list_v4_2.txt:111`). Pump model inside the hanger + draw: UNKNOWN |
| h | **"We aren't gonna run two 61 pin outs"** — one D38999 bulkhead only | T75 | Removes "2nd bulkhead" from the §1 D38999 overflow options; remaining = engine-only firewall re-seg (Dave) / rail consolidation / grommet |
| i | Turn-signal wiring stays in the column ("I think we can get away with") | T75 | New |
| j | Column/dash endpoints to integrate: neutral safety switch, ignition switch, turn-signal plug, light switch, Dakota gauges + box; possible duplicate sender wires "not a big deal maybe… depends on all the pins" | T75 | Dakota fork = state §3 0c (still open) |
| k | Transmission 6L90, controlled by PCS TCM-2650 | T76 | Consistent with 2026-07-12 ruling (PCS↔T43 private GMLAN; M130 bus untouched) |
| l | Radiator: Champion, **single** fan "labeled for LS3," draw unknown | T78 | **Conflicts** with cut list #21/#22 = two radiator fans on OUT1/OUT2 (`K5_cut_list_v4_2.txt:107-108`). If the single fan is ≤20 A, one 20 A channel frees up (PDM30 is 30/30; the coil +12V rail needs a 20 A channel per load schedule). If >20 A it needs paralleled outputs. Fan model: UNKNOWN |
| m | Headlights: LED conversion (Amazon bulbs) | T91 | Consistent with load schedule (LED 1.8 A low / 3.6 A high per lamp) |
| n | E-brake: E-Stopp electric | T89 | Consistent (#54, ESK001) |
| o | Accessory requirements: radio/sound, JBL speakers, amps, Dakota Digital, future detachable high-power winch (front more likely; rear feed "smart" but use case open), front/rear accessory plugs, laptop charging, Starlink, bug-out gear, easy lighting expansion like factory upfitter wiring; engine-as-generator floated as hypothetical | T36, T65, T91, T94 | Audio amp draw already flagged UNKNOWN / #32 likely undersized (load schedule) |
| p | **Winch is low priority** — "a lot less important than all the rest" | T81 | New |
| q | Harness from Tefzel; "all wiring to come from autowire" (read as ProWire USA — confirm); heavy-pull runs **not** multiple smaller gauges together; loomed "pragmatically and with sophistication to end points," not exposed singles | T62, T74 | Tefzel lock holds. Skylar's "no parallel smalls for heavy pull" leans the DC-primary open choice toward single conductor (0 AWG /16 or Dave's 2 AWG), away from 2×4 AWG parallel (canon ch.16 §4.3) — owner call still open |
| r | PDM replaces relays — "whats the point of having a pdm if you dont use it"; with many accessories "the rule of thumb in motec is to run multiple pdm" | T80, T90 | PDM30 is 30/30 with zero headroom (ch.17:150) → a 2nd PDM is the owner's stated direction; model/size not chosen |
| s | Dave (Desert Performance) runs "multi wire power through pdm… no wires fatter than 22 are going into the ecu or coming out of the pdms" (Skylar's recollection; attached Dave's `M130 ECU Overland Bronco (2).xlsx`) | T67 | **Needs Dave to confirm.** MoTeC PDM30 manual: 20 A outputs take "20# to 16#", 8 A outputs "24# to 20#" (`reference/motec/VALIDATION_REPORT.md:322-323`); 20 A outputs use 2 paralleled Superseal pins (`reference/connectors/CONNECTOR_DATA_REPORT.md:560-562`); cut list sets #ECU_PWR at 16 AWG as the Superseal cavity max (`K5_cut_list_v4_2.txt:351`) |
| t | Working rules: "completed" means confirmation it's ordered (T41); confidence per piece (T4); for MoTeC, calculate everything beforehand (T33); confirm A/C before buying harness material (T33); real availability > schematics (T59); exact product links, nomenclature is hard (T66) | as cited | Process, not spec |

---

## 3. GEMINI CLAIMS — adjudicated against substrate

**Verified right (keep):**
- PDM30 total output **100 A continuous**; 20 A outputs 20 A cont / 115 A transient; 8 A outputs 8 A / 60 A (`VALIDATION_REPORT.md:310-316,462`). Skylar's "~150 A per PDM" (T35) and the 2026-05-23 receipt's "200 A bus / 400 A dual-PDM15" are **wrong** — corrected here. PDM15 total rating: UNKNOWN in substrate (Gemini's "80 A" unverified).
- Holley 199-102 / 199-104 = the mid-mount SD7 compressor (guide p.2).
- Holley mid-mount is bracket-less, accessories mount to the water pump manifold (guide p.1).
- Mil-spec wire color code 0–9 and the M22759/[slash]-[gauge]-[color] structure (canon ch.16 §1.7).
- Dakota interface for an aftermarket ECU is BIM-EFI-1, not BIM-01-2 (Gemini self-corrected T88; matches `DAKOTA_VHX_ARCHITECTURE.md` fork).

**Wrong (do not reuse):**
- Holley A/C adapter "199-201" → guide says **199-202**. Alternator pigtail "199-101" → guide says **197-400**. Belt "~1710" → guide says **BANDO 6PK1715**.
- "M22759/16 is cross-linked / preferred for signal wire; order /16 for 16–22 AWG" → /16 is extruded, not cross-linked; **lock is /32 for 12–22 AWG, /16 for 4–10 AWG** (canon ch.16 §1.1, §1.5). The ProWire cart built from this (e.g. M22759/16-16-8, M22759/16-10-9 White ×100 ft) contradicts the lock.
- "Superseal cavity maxes at 22 AWG" and "5 × 22 AWG pins = 25 A blower feed" → Superseal takes 22–16 AWG; PDM30 20 A outputs are 2 paralleled pins (refs in §2s).
- Relay-based blower/fan control (HELLA 40 A, 70 A fan relay, ground-trigger relays) and "bypass the PDM" for E-Stopp/headlights → contradicts the PDM architecture; Skylar rejected it (T80, T90). Cut list already puts #51 blower on OUT6, #21/#22 fans on OUT1/2, #54 E-Stopp on OUT7.
- **A/C pressure transducer on M130 B21/AV7, 5 V on A02, ground on B16** (T67) → **B21 is APS pedal track 1** in cut list v4.2 (`K5_cut_list_v4_2.txt:395`); AV7/AV8 were the **last free analog inputs** (`:380`). Gemini read its pin numbers (B3, B4, B8, B11, B17/B18, A1, A15, A16, A18, A31, A32, injectors A19–A30) off Dave's **Bronco** sheet ("Looking at your official Desert Performance M130 Pinout sheets," T67) — a different vehicle; none were checked against the K5 cut list. A31/A32 are already the Dakota tach/VSS mirrors (`:278,:280`).
- "The A/C pressure sensor is the last piece" ($200–300 MoTeC / $300 Honeywell) → the cut list already carries **#105/#111 A/C pressure *switch* low/high → ECU** (`K5_cut_list_v4_2.txt:159-160`), matching the 05-23 lock (trinary switch → M130 digital inputs). A transducer is not required, and no analog input is free for one.
- PCS TCM-2650 on the shared M130 CAN (T76, T88) → 2026-07-12 ruling: private PCS↔T43 GMLAN; M130 bus untouched.
- Four Seasons "35014" as the variable orifice (Skylar couldn't find it, T43) and "35017" as its correction (it is a fan motor — Skylar, T44).
- "GPD 1411597 is a duplicate accumulator" → it's a U-tube (Skylar, T58). Tracker "blower 35513 ordered" → 35587 was ordered. "[ORDERED]" statuses before any order existed (Skylar, T41–T42).
- ProWire stock counts and links: the "22 AWG white" link opened a 10 AWG blue page (Skylar, T69); "1,530 ft in stock" for M22759/16-16-8 vs the screenshot's 530 ft.
- ProWire "2 AWG Motorsport Battery Cable" (2CBL-RD/BK) for starter/alternator → not an M22759 part (Tefzel-only lock; big gauges are M22759/16 per canon ch.16 §1.4–1.5); load schedule says starter wants **0 AWG / 1-0, "2 AWG is a premature downgrade until run length measured"** (`output/wiring/K5-endpoint-load-schedule-2026-07-12.md`).
- Whole-car color-spool lists (T64–T98, growing from 7 spools to "2,080 ft") → invented. The substrate's derived answer already exists: `output/K5_MATERIALS_FORMBOARD.md` (2026-06-09) — prototype wire by gauge/spec, one color per gauge, Dave's stock first, **≈ $2,180 worst case + 3 quotes**, from the computed cut. It predates cut-list v4.1/v4.2 (at least +12 wires: 6 ECU/PDM lifelines, 6 APS) → regen needed.
- Connector/terminal/heat-shrink/DR-25/boot/epoxy lists → violate the 2026-05-11 connector deferral (only the D38999 is released). "Missing M130/PDM header plugs" → `K5_MATERIALS_FORMBOARD.md` §D records the mating kits as already owned per `K5_bom.txt` (verify in hand).
- Amp figures stated as fact: blower "22 A cont / 32 A inrush", clutch "3.8 A", 14" fan "16 A", fuel pump "exactly 5.1 A", 6L90 "10 A", coils "6 A", Holley alternator "150 A, >100 A at idle, C7 hairpin" → all unsourced. Grounded values live in the load schedule; alternator = the Holley mid-mount hairpin unit (Skylar T32; complete-kit PN 197-302/303/304 per guide pp.1–2), **output rating UNKNOWN** (still gates #59).
- MoTeC "Generator Mode" auto-start, 0.5 V/4.5 V GM-transducer scaling, "Group 34 is the largest that fits the tray," "O'Reilly can't crimp A/C beadlock" → invented or unverified.

**Unverified leads (not specs):** Sanden 7176 fit on the Holley manifold; vacuum reservoir + check valve for the factory vacuum controls; later-model/deeper blower wheel for more CFM; ACDelco 15-10622 accumulator jacket (PN unverified); Four Seasons 38904 as a variable orifice + fit in the 76–77 core; Aeroquip E-Z Clip as a crimp-free alternative; Gigavac GV200 contactor to arm winch plugs (winch is low priority, §2p); Odyssey/Optima Group 34 + dual-battery (battery choice still open — Skylar asked T59, never resolved).

**One substrate fact surfaced for the harness (from the Holley guide, not Gemini):** "The alternator and A/C compressor ground through the water pump manifold. If painting or coating the manifold, the mating surfaces must all be bare metal…" (guide p.4). Ground-path note for the alternator/clutch circuits.

---

## 4. OPEN — needs the truck, the owner, or Dave
1. Condenser type, blower wheel, GPD 1411597 identity, belt fit, compressor fit — on arrival (§1).
2. Fuel pump model inside QFS-H882-367 + its draw → re-derive #66 gauge (§2g).
3. Champion fan model + draw → #21 channel; #22 may retire (§2l).
4. A/C control inputs need pins: #105/#111 switches (+ evap temp per the 05-23 lock). No AV free; UDIG B08–B11/B14 are the candidates, one earmarked for the isolator shutdown (state §3 0b).
5. Dave: his ≤22 AWG into ECU / out of PDM practice vs MoTeC's 16–20 AWG on 20 A outputs (§2s).
6. Throttle body 12699160 connector pinout vs cut-list #4c–#4f (§2d).
7. Second PDM: model and split — owner decision (§2r).
8. Holley alternator output rating → #59.
