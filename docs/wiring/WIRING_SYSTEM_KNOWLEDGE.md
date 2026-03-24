# Wiring Layer Overlay System — Knowledge Base

This document is the permanent reference for the wiring harness system.
Any agent working on wiring MUST read this before touching code or data.

---

## THE CORE ARCHITECTURE

### What We're Building
A system where every electrical part is a digital twin with documented endpoints (pins/wires/connectors). You place parts on a vehicle. The system derives the complete wiring harness — every wire, every pin assignment, every connector, every fuse. The harness is COMPUTED, not drawn.

### The Workshop Model
- **The Vehicle** = the ask. What needs work done.
- **The Workspace + Supplies** = supply chain. Parts, tools, materials.
- **The Intelligence** = what needs to be done. Templates, pin maps, circuit knowledge.

### The Implicit Knowledge Problem
When a client walks into a Motec dealer and says "I want Motec," half the job is already defined by the shop's expertise. The system encodes that implicit half — device pin maps, wire specs, connector standards, channel assignments. A JEGS harness doesn't have this. A Motec dealer does.

### Key Principle: Library First
Every data point must come from a real source — a service manual, a product datasheet, an invoice, a catalog. NEVER hallucinate technical data. Scaffolded data must be validated against authoritative sources before it's used in production.

---

## THE REFERENCE VEHICLE: 1977 K5 Blazer

- **Vehicle ID:** `e04bf9c5-b488-433b-be9a-3d307861d90b`
- **VIN:** CCL187Z210370
- **Owner/Client:** Scott (scott@li3go.com / sngtrading@gmail.com)
- **Builder:** NUKE LTD, 676 Wells Rd, Boulder City NV 89005
- **Wiring Subcontractor:** Desert Performance (desertperformance@cox.net, 702-513-8837), same address

### Build Spec
- Engine: Delmo Speed LS3 (cosmetic kit on GM LS3 crate engine)
- ECU: Motec (M130 or M150 — system computes which is needed from I/O count)
- PDM: Motec PDM30 (30 channels, currently at 30/30 with grouped small loads)
- Brakes: Bosch iBooster Gen 2 electric brake booster (salvage Tesla unit + Tulay connector kit)
- Gauges: Dakota Digital VHX-73C-PU (NO native CAN — uses Motec analog/PWM outputs)
- Fuel: Aeromotive A1000 pump (35A, dedicated relay, NOT through PDM)
- Parking brake: E-Stopp ESK001 electric actuator
- Steps: AMP Research PowerStep via Far From Stock P300 kit ($2,264) or Engineered Vintage ($848)
- Windows: Aftermarket conversion (Nu-Relics NR17380201 kit)
- Locks: Dorman 746-014 actuators
- Lighting: Full LED conversion (Truck-Lite 27270C headlights, United Pacific CTL7387LED tails)
- Audio: RetroSound Hermosa + Kicker speakers/amp/sub
- Camera: Rear backup, reverse-triggered

### Invoices (NUKE LTD → Client)
- SW77002 (10/2023): $42,379 — vehicle + parts
- SW77003 (02/2024): $18,946 — frame/drivetrain/suspension + paint
- SW77005 (09/2024): $28,540 — Desert Performance wiring $15K, trans $2,380, interior $5,645, engine peripherals $2,150, fuel/exhaust $2,010, brakes $655
- SW77006 (03/2025): $29,678 — labor $10K, Desert Performance wiring $5K, AMP steps $2,300, windows $1,800, wheels $4,264, tires $1,772, LED lighting $980, Delmo handles $350, machined pieces $2,350, CVF hinges $862

### Reference Invoice (Desert Performance → Howard Barton, different vehicle)
- Invoice #1190 (03/2019): $23,970 — complete Motec M130+PDM30 build on custom coupe
- Contains real Motec pricing: M130 $3,500, PDM30 $3,140, LTCD $844, GT101 $80ea, D510 $75ea, RBD-190 $300
- Labor rate: $65/hr, 50 hours install + programming, $750 dyno

---

## AUTHORITATIVE DATA SOURCES

### GM Service Manual (IN THE DATABASE)
- **Table:** `service_manual_chunks` — 3,406 chunks, OCR'd from 1973 Light Duty Truck Service Manual
- **Critical Section:** 8C "Instrument Panel and Gages" pages 46-51 contain the COMPLETE Electrical Circuit Identification Table — 500+ circuits with exact wire colors and functions
- **This table is extracted to:** `gm_circuit_identification` — 109 key circuits as structured data
- **Wiring Diagrams:** Section 8C pages 52-80 contain 29 pages of CK Series wiring diagrams with real wire colors, gauges, and connector callouts (TEXT is OCR'd, IMAGES not yet extracted)

### Key GM Manual Sections for Wiring
| Section | Content | Chunks |
|---------|---------|--------|
| 6D | Engine Electrical — alternator, starter, ignition switch pinout | 253 |
| 8C | Instrument Panel — Circuit ID table, 29 pages wiring diagrams | 179 |
| 8/8A | Electrical Body & Chassis — lighting, fusible links | 129 |
| 12 | Electrical Body & Chassis — headlamp diagnosis, fusible links | 45 |
| 1A/1B | Heater/AC — blower circuit, AC compressor, pressure switches | 198 |
| 3B4 | Steering Columns — turn signal switch, ignition switch, horn | 138 |

### ProWire USA Catalog (IN THE DATABASE)
- **Table:** `catalog_parts` — 9,649 parts indexed
- **Coverage:** 1,046 have images (11%), 0 have dimensions
- **Motec connectors priced:** M150 complete kit $56.21, DTM 2-pin $3.27 through 12-pin $12.81
- **Wire priced:** TXL $0.05-0.20/ft, Tefzel $0.73-1.90/ft by gauge
- **Key mapping:** ProWire SKU M150-CONN-KIT = all 4 Motec ECU connectors with 120 terminals
- **Tools:** MFT terminating header M150 $150, Daniels AF8 crimp tool $674

### Invoice Learned Pricing (IN THE DATABASE)
- **Table:** `invoice_learned_pricing` — 33 entries from Desert Performance #1190
- **Real Motec prices:** M130 $3,500, PDM30 $3,140, LTCD $844
- **Real labor rate:** $65/hr for installation + programming

---

## MICRO-SUPPLIER NETWORK

These are one-man shops that drop products on Instagram. Their catalogs are NOT scrapeable like ProWire. Products need manual entry backed by photo/reel evidence.

| Supplier | What They Make | How to Order | Registered |
|----------|---------------|-------------|-----------|
| Desert Performance | Motec wiring harnesses, complete builds | Phone/email, Boulder City NV | ✓ |
| Delmo Speed | LS engine dress-up kits (DEL S3) | delmospeed.com (Shopify) | ✓ |
| Davis Off Road | Squarebody step kits, fab work | davisoffroad.com / Instagram | ✓ |
| Engineered Vintage | AMP step mount kits, tow hooks, winch mounts | engineeredvintage.com (Shopify) | ✓ |
| JL Fabrication | Custom brackets, fab pieces | jlfabrication.com / Instagram | ✓ |
| Far From Stock | AMP PowerStep custom kits | farfromstockstore.com | ✓ |
| Tulay Wire Werks | Bosch iBooster connector kits, harnesses | tulayswirewerks.com | ✓ |
| Retrofit Innovations | Bosch iBooster units (salvage/refurb) | retrofitinnovations.com | ✓ |

---

## CRITICAL ENGINEERING DECISIONS (LEARNED THIS SESSION)

### Devices NOT controlled by PDM
These are direct-wired to battery with their own relay or direct connection:
- Alternator (220A — IS the power source)
- Starter motor (200A peak — momentary, relay-triggered)
- Battery disconnect RBD-190 (190A continuous — IS the master switch)
- Fuel pump Aeromotive A1000 (35A — dedicated 30A relay, Aeromotive 16301 wiring kit)
- Bosch iBooster (40A peak — dedicated relay, integrated ECU)
- Amplifier (30A — direct fused battery wire)
- ECU, PDM, wideband controller, display (powered by PDM but not ON a PDM output channel)
- All sensors (powered from ECU 5V reference, not PDM)
- All injectors and coils (powered from PDM rail channels, individual control from ECU)

### PDM Channel Grouping
Small loads that share a single PDM channel:
- `markers_clearance`: 8 devices (4 side markers + 3 cab clearance + license plate) = 3.2A total
- `park_tail`: 4 devices (2 parking + 2 tail lights) = 6A total
- `interior_courtesy`: 5 devices (dome + footwell + under-dash + underhood + cargo) = 2.5A total
- `backup`: 4 devices (2 backup lights + third brake + rear camera) = 4.7A total
- `turn_brake_left/right`: separate channels for independent turn signal control

### ECU Model is a Variable, Not a Constant
The system presents OPTIONS, not a single answer. The M130 is a legitimate choice for many builds — it's cheaper, smaller, and can be expanded with multiple PDMs and CAN-connected modules.

**Configuration spectrum:**
- **M130 + PDM30 (tight build):** Minimum viable Motec. Fewer I/O but sufficient for a basic LS swap. Can keep factory gauge cluster with dual senders. Cost-conscious but still professional grade.
- **M130 + PDM30 + PDM15:** Expand I/O by adding a second PDM on CAN bus. More channels without upgrading ECU.
- **M150 + PDM30 (full integration):** More I/O, more CAN buses, more firmware options. Needed for traction control, wheel speed inputs, advanced features.
- **M150 + PDM30 + C125 (no compromise):** Full Motec ecosystem with dedicated display. Everything on CAN.

The compute engine should present ALL viable configurations with cost deltas, not just the minimum ECU that fits. "M130 handles your current I/O for $3,500. M150 adds 40% more I/O headroom for $5,500. Here's what each gets you."

**The factory sensor question:** Vintage trucks already have oil pressure, coolant temp, and fuel level senders feeding factory gauges. A tight build can keep those senders for gauges while adding separate Motec sensors for the ECU. Dual senders, dual purpose. Not elegant, but it means you can run Motec engine management without replacing the gauge cluster — the cheapest path to professional engine control.

**M130 pin map:** NEEDS TO BE ADDED to device_pin_maps alongside the M150. The M130 has fewer pins/connectors but shares the same Superseal connector system. Until the M130 map is in the system, we can only compute M150+ configurations.

### Wire Color Assignment
Colors are deterministic by function group, not random:
- Injectors: GRN (with stripe sequence for individual cylinders)
- Ignition coils: WHT
- Crank/cam sensors: BLU/WHT (shielded)
- Temp sensors: TAN
- Pressure/analog: VIO
- CAN bus: WHT/GRN high, GRN/WHT low
- Grounds: BLK

### LS3 Sensor Part Numbers (Validated)
| Sensor | ACDelco PN | GM OEM PN | Pins | Connector |
|--------|-----------|-----------|------|-----------|
| Crank position | 213-4573 | 12615626 | 3 | Metri-Pack gray |
| Cam position | 213-3826 | 12591720 | 3 | Metri-Pack |
| Knock (×2) | 213-1576 | 12623730 | 2 | Sealed 2-pin |
| Coolant temp | 213-4514 | 19236568 | 2 | Metri-Pack |
| Oil pressure | D1846A | 12673134 | 3 | Oval sealed |
| MAP | — | 55573248 | 3 | Bosch 3-pin |
| Injectors (×8) | 217-2425 | 12576341 | 2 | EV6/USCAR |
| Ignition coils (×8) | D510C | 12611424 | 4 | Push-to-seat |
| Throttle body | — | 12605109 | 6 | GM DBW 6-pin |

**D510C not D585.** LS3 uses the square flat coil. D585 is Gen III truck. NOT interchangeable without adapters.

**6-pin throttle body not 8-pin.** LS3 uses 6-pin DBW. Gen III used 8-pin. NOT pin-compatible.

---

## DATABASE TABLES

### Wiring-Specific Tables (created this session)
| Table | Rows | Purpose |
|-------|------|---------|
| wire_specifications | 11 | Wire types GPT → MIL-W-22759/44 with tier/temp/voltage |
| connector_specifications | 12 | Connector families Weatherpack → Autosport AS |
| device_pin_maps | 241 | M130 (60) + M150 (120) + PDM30 (61) — ALL VALIDATED from MoTeC datasheets |
| factory_harness_circuits | 71 | Squarebody factory circuits — VALIDATED against GM manual |
| gm_circuit_identification | 109 | GM Circuit ID table — authoritative reference |
| upgrade_templates | 0 | Upgrade template definitions (not yet populated) |
| upgrade_circuit_actions | 0 | What templates do to factory circuits |
| upgrade_new_circuits | 0 | New circuits from templates |
| vehicle_wiring_overlays | 1 | K5 overlay record |
| vehicle_circuit_measurements | 0 | Physical measurements on vehicle |
| vehicle_custom_circuits | 0 | Custom one-off circuits |
| vehicle_build_manifest | 115 | K5 build — every device with endpoints, prices, positions |
| invoice_learned_pricing | 33 | Real prices from Desert Performance invoice |

### Edge Functions
| Function | Status | Purpose |
|----------|--------|---------|
| compute-wiring-overlay | LIVE | Recompute harness from manifest: ECU model, PDM channels, wires, warnings |
| generate-cut-list | LIVE | Wire-by-wire bench document (110 wires, 805 ft for K5) |
| generate-connector-schedule | LIVE | Pin-by-pin for M130/PDM30 connectors |
| generate-wiring-bom | LIVE | Full BOM with catalog linkage ($19,966 K5 estimate) |

---

## WHAT'S SCAFFOLDED vs VALIDATED

| Data | Status | Source |
|------|--------|--------|
| Factory harness circuits (71) | ✅ VALIDATED | GM Service Manual Section 8C Circuit ID Table (40 MATCH, 3 corrected, 17 corrections total) |
| GM Circuit ID table (219) | ✅ FROM SOURCE | Directly extracted from OCR'd manual pages 8C-46 through 8C-51 |
| Invoice pricing (49) | ✅ FROM SOURCE | Desert Performance #1190 + NUKE SW77005/SW77006 |
| ProWire connector prices (19) | ✅ FROM SOURCE | prowireusa.com product pages |
| Wire specifications (11) | ✅ CLOSE | Based on real mil-spec standards |
| Connector specifications (12) | ✅ CLOSE | Based on manufacturer data |
| LS3 sensor part numbers | ✅ FROM SOURCE | ACDelco/GM part numbers verified |
| Build manifest devices (115) | ⚠️ MIXED | 67% avg — part numbers from research, positions estimated |
| M130 pin map (60) | ✅ VALIDATED | MoTeC M1 ECU Hardware Tech Note p16 — REPLACED ALL SCAFFOLDED DATA |
| M150 pin map (120) | ✅ VALIDATED | MoTeC M1 ECU Hardware Tech Note p24 — REPLACED ALL SCAFFOLDED DATA |
| PDM30 pin map (61) | ✅ VALIDATED | MoTeC PDM User Manual p39 — 8x20A (dual-pin), 22x8A, 16 switch inputs, CAN, M6 stud |

### PIN MAP VALIDATION (2026-03-23) — CRITICAL FIX
The M130 and M150 pin maps were **completely replaced**. Every pin in the scaffolded data was WRONG. The scaffold had the right pin TYPES but completely wrong pin POSITIONS. Example: scaffolded M130 had injectors on A1-A8 — real pinout has them on A19-A22 and A27-A30. Using the scaffolded data would have fried components.

**Key discovery:** M150 Connectors C+D have IDENTICAL pinout to M130 Connectors A+B. This means an M130 harness plugs directly into an M150 — you just add Connectors A+B for the additional I/O. Huge upgrade path implication.

**Source documents for validation:**
- MoTeC M1 ECU Hardware Tech Note: `https://www.motec.com.au/hessian/uploads/M1_ECU_Hardware_c2517380e4.pdf`
- M130 datasheet: `https://drostautosport.com/wp-content/uploads/2023/03/CDS13130-M130-ECU.pdf`
- M150 datasheet: `https://www.motec.com.au/filedownload.php/13150_m150_datasheet.pdf?docid=3717`

---

## 77NMD BROCHURE RENDERS
Located at: `/Users/skylar/Documents/2025/Automobile/77NMDbrochure/AG 77/`
- Frame composition (06.2) — chassis with engine, suspension, axles
- Engine composition (05.0) — Delmo Speed LS3 detail
- Interior composition (03.0) — dash, gauges, seats, door panels
- Full vehicle (02.0) — exterior 3/4 view with interior callout

These are MARKETING RENDERS, not engineering drawings. Professional workspace needs orthographic line drawings from the GM service manual (Section 8C wiring route diagrams). The text is OCR'd but images not yet extracted from the source PDFs.

---

## TIER SYSTEM FOR WIRING QUALITY

| Tier | Wire | Connectors | Sheathing | Construction | Cost Range |
|------|------|-----------|-----------|-------------|-----------|
| Consumer | GXL/TXL | Weatherpack, AMP | Split loom | Parallel bundle | $1-2K |
| Enthusiast | TXL | Superseal, DT | Braided | Parallel bundle | $3-5K |
| Professional | TXL/Tefzel | DTM, Superseal | DR-25 | Parallel bundle | $7-15K |
| Ultra | MIL-W-22759/32 | Autosport AS | DR-25 System 25 | Concentric twist | $15-30K+ |

The K5 build is targeting Professional tier (TXL wire, DTM connectors, DR-25 sheathing).
