# Chapter 4: The Supply Chain

## ProWire USA — The Primary Catalog

ProWire USA (prowireusa.com) is the single largest source of Motec ecosystem parts available for online purchase. They carry everything from ECU connector kits to crimp tools to wire by the foot.

**Database state:**
- 9,649 parts indexed in `catalog_parts`
- 1,046 have images (11%)
- 0 have dimensional data
- 286 have names but no descriptions

### Key Product Categories

**Motec Connector Kits**
| SKU | Description | Price |
|-----|-------------|-------|
| M150-CONN-KIT | M150 ECU connector kit (4 connectors, 120 terminals) | $56.21 |
| DTM-2P-KIT | DTM 2-pin connector kit | $3.27 |
| DTM-3P-KIT | DTM 3-pin connector kit | $3.81 |
| DTM-4P-KIT | DTM 4-pin connector kit | $4.49 |
| DTM-6P-KIT | DTM 6-pin connector kit | $5.93 |
| DTM-8P-KIT | DTM 8-pin connector kit | $8.75 |
| DTM-12P-KIT | DTM 12-pin connector kit | $12.81 |

**Wire by the Foot**
| Type | Gauge Range | Price Range | Notes |
|------|-------------|-------------|-------|
| TXL | 22-10 AWG | $0.05-0.20/ft | Standard automotive, 125°C |
| Tefzel | 22-10 AWG | $0.73-1.90/ft | MIL-SPEC, 200°C, PTFE jacket |

**Tooling**
| Item | Price | Notes |
|------|-------|-------|
| MFT Terminating Header (M150) | $150 | Required for M150 connector assembly |
| Daniels AF8 Crimp Tool | $674 | Military-spec for Motec terminals |

### What's Missing from ProWire

- M130 connector kit (M130 uses different 34+26 Superseal vs M150's 34+34+26+26)
- Bulkhead connector kits for custom builds
- Pre-made sensor pigtails (aftermarket adapters for GM sensors → DTM)
- Heat shrink and DR-25 tubing
- Braided sheathing and split loom

## Micro-Supplier Network

These are one-man shops. No API, no catalog feed, no inventory system. You call a guy.

| Supplier | Specialty | Location | How to Order |
|----------|-----------|----------|-------------|
| Desert Performance | Motec harnesses, complete builds | Boulder City, NV | Phone/email. Motec dealer. |
| Delmo Speed | LS engine dress-up (DEL S3 kit) | delmospeed.com | Shopify store |
| Davis Off Road | Squarebody step kits, fab work | davisoffroad.com | Instagram DM |
| Engineered Vintage | AMP step mounts, tow hooks | engineeredvintage.com | Shopify store |
| JL Fabrication | Custom brackets, fab pieces | jlfabrication.com | Instagram DM |
| Far From Stock | AMP PowerStep custom kits | farfromstockstore.com | Online store |
| Tulay Wire Werks | Bosch iBooster connector kits | tulayswirewerks.com | Online store |
| Retrofit Innovations | Bosch iBooster units (salvage) | retrofitinnovations.com | Online store |

## Invoice-Learned Pricing

Real prices from real invoices, stored in `invoice_learned_pricing` (49 entries).

### Desert Performance reference invoice (Mar 2019)
Complete Motec M130+PDM30 build on a custom coupe. Total: $•••. Key prices (a third party's invoice: amounts private, $•••; redaction 2026-09-29):

| Item | Price | Notes |
|------|-------|-------|
| Motec M130 ECU with GPR firmware | $••• | Standalone ECU |
| Motec PDM30 | $••• | 30-channel power distribution |
| Motec LTCD wideband interface | $••• | Dual LSU4.9 lambda controller |
| Motec RBD-190 remote battery disconnect | $••• | 190A rated |
| Motec GT101 speed sensor | $••• ea (×4) | Hall effect |
| Motec 8-button keypad | $••• | Custom labeled |
| Custom engine harness (61-pin disconnect) | $••• | Desert Perf labor+materials |
| Chassis harness | $••• | Desert Perf labor+materials |
| Denso D510 coils | $••• ea (×8) | LS coil-on-plug |
| Installation + programming | $•••/hr (×50 hrs) | $••• total |
| Dyno + road tuning | $••• | Flat rate |

### NUKE LTD Invoices (K5 Blazer Build)
| Invoice | Date | Total | Key Items |
|---------|------|-------|-----------|
| Inv. 1 | Oct 2023 | (DB) | Vehicle + parts |
| Inv. 2 | Feb 2024 | (DB) | Frame/drivetrain/suspension + paint |
| Inv. 3 | Sep 2024 | (DB) | Desert Perf wiring, trans, interior |
| Inv. 4 | Mar 2025 | (DB) | Labor, Desert Perf wiring, AMP steps, wheels |

**Total K5 build cost through Inv. 4: in the DB (billed-and-paid ledger on the vehicle).**

## Supply Chain Automation Concept

The system tracks three states for every part in the BOM:
- **PURCHASED** — already bought, receipt exists
- **NEEDED** — must order before build can proceed
- **QUOTE** — no price available, requires supplier contact

The K5 BOM shows 30 PURCHASED, 85 NEEDED, 18 need QUOTES. The vision is: click "Order All Needed" → system groups by supplier → generates purchase orders → sends to each supplier's preferred channel (API for ProWire, email for Desert Perf, Shopify cart for Engineered Vintage).
