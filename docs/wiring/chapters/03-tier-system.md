# Chapter 3: The Tier System

## What Separates a $2K Harness from a $30K Harness

The difference is real and measurable across five dimensions: wire, sheathing, connectors, construction method, and crimping. Each tier represents a quality level with specific materials and techniques.

## The Four Tiers

### Consumer ($1,000 - $2,000)
**Who:** Painless Performance, American Autowire Classic Update kits
**Wire:** GXL or TXL (cross-linked polyethylene, 125°C)
**Connectors:** Weatherpack, Metri-Pack, AMP Superseal
**Sheathing:** Split loom or expandable braided sleeving
**Construction:** Parallel bundle — wires run side by side, held with zip ties or tape
**Crimping:** Generic ratcheting crimp tools ($50-80)

This is what 90% of squarebody owners install. It works. It's reliable for street use. The wires are labeled every 3-5 inches. The fuse panel is modern ATC blade fuses replacing factory glass tube fuses and fusible links. For a truck that gets driven on weekends and to shows, this is perfectly adequate.

### Enthusiast ($3,000 - $5,000)
**Who:** Custom builds by competent shops, American Autowire Highway 22 Plus
**Wire:** TXL (thin-wall cross-linked, 125°C)
**Connectors:** Superseal 1.0 (Motec OEM), Deutsch DT
**Sheathing:** Braided sleeving or DR-25 in critical areas
**Construction:** Parallel bundle with more attention to routing and branch points
**Crimping:** Indent crimp or generic ratchet

The step up from consumer is better connectors (sealed, vibration-resistant) and thinner-wall wire that packs tighter. The Superseal 1.0 is what Motec uses on all their ECUs — it's the entry point to the Motec ecosystem.

### Professional ($7,500 - $15,000)
**Who:** Desert Performance, GSpeed, dedicated Motec dealers
**Wire:** TXL or MIL-W-22759/32 Tefzel (cross-linked ETFE, 150°C)
**Connectors:** Deutsch DTM (motorsport grade, gold contacts available), Superseal for ECU
**Sheathing:** Raychem DR-25 heat shrink tubing throughout
**Construction:** Parallel bundle with professional routing, proper service loops at connectors
**Crimping:** Daniels indent tools or quality ratchet with correct dies

This is where Desert Performance operates. The K5 Blazer build is at this tier. DR-25 provides chemical resistance, abrasion protection, and a professional finished appearance. DTM connectors handle vibration and thermal cycling far better than Weatherpack. The wire may be Tefzel — thinner insulation, lighter weight, dramatically better chemical and abrasion resistance than TXL.

The custom engine harness ($3,000) and chassis harness ($3,000) from Desert Performance's Barton invoice are professional-tier builds.

### Ultra ($15,000 - $30,000+)
**Who:** F1 teams, Le Mans prototypes, concours-level hot rods
**Wire:** MIL-W-22759/32 or /44 (silver-plated ETFE, 150-200°C)
**Connectors:** Deutsch Autosport AS (aluminum shell, gold contacts, fluorosilicone seals)
**Sheathing:** Raychem System 25 — DR-25 + molded boots + RT125 epoxy = fully sealed, watertight
**Construction:** Concentric twist — wires twisted in alternating-direction layers around a core wire
**Crimping:** Daniels AFM8 with position-specific turrets, every crimp pull-tested

A single Autosport bulkhead connector costs $300-500. A typical harness uses 15-30 of them. Connector cost alone: $5,000-$15,000. Labor for concentric-twist construction: 200+ hours at $100-150/hour. This tier exists for vehicles where failure is not an option (racing) or where the documentation and craftsmanship justify the price premium (six-figure collector cars).

## Why the Tier Matters to the System

The tier selection changes the BOM, not the circuit list. The same 110 wires run between the same 115 devices regardless of tier. What changes:

| Component | Professional | Ultra |
|-----------|-------------|-------|
| M150 connector kit (4) | ProWire M150-CONN-KIT $56 | Custom Autosport AS ~$2,000 |
| DTM 4-pin (×10) | ProWire DTM4-N $6.16 ea = $62 | Autosport 4-pin ~$300 ea = $3,000 |
| Wire (800 ft) | TXL ~$0.15/ft = $120 | Tefzel /32 ~$0.85/ft = $680 |
| Sheathing | DR-25 ~$200 | DR-25 + boots + epoxy ~$800 |
| Crimp tools | DTM crimp $50 | Daniels AF8 + positioners $1,200 |
| Labor (100 hrs) | $65/hr = $6,500 | $125/hr × 200 hrs = $25,000 |
| **Total harness** | **~$7,000** | **~$33,000** |

Same vehicle. Same circuits. Same endpoints. Different materials and methods. The system should let you toggle between tiers and see the BOM and cost update in real time.

## Wire Types Reference

See `wire_specifications` table for complete data. Key types:

| Type | Temp | Insulation | Wall | Tier | Cost/ft |
|------|------|-----------|------|------|---------|
| GPT | 80°C | PVC | 0.015" | Factory | $0.08 |
| GXL | 125°C | Cross-linked PE | 0.010" | Consumer | $0.15 |
| TXL | 125°C | Thin-wall XL PE | 0.008" | Enthusiast | $0.20 |
| MIL-W-22759/32 | 150°C | Cross-linked ETFE | 0.005" | Professional | $0.85 |
| MIL-W-22759/44 | 200°C | XL ETFE, silver plate | 0.005" | Ultra | $1.50 |

## Connector Families Reference

See `connector_specifications` table. Key families:

| Family | Shell | Contacts | Sealing | Tier | Cost |
|--------|-------|---------|---------|------|------|
| Weatherpack | Nylon | Tin | Silicone | Consumer | $1-8 |
| Deutsch DT | Nylon 66 | Tin | Silicone | Enthusiast | $3-25 |
| Superseal 1.0 | Nylon | Tin | Silicone | Enthusiast | $5-25 |
| Deutsch DTM | Nylon 66 | Gold avail | Silicone | Professional | $5-30 |
| Deutsch 369 | PEI/PEEK | Gold | Fluorosilicone | Professional | $15-50 |
| Autosport AS | Aluminum | Gold | Fluorosilicone | Ultra | $300-500 |
