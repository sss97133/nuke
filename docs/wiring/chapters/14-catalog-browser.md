# Chapter 14: The Catalog Browser

## What It Does

Search, filter, and place parts from the supply chain directly onto a vehicle build. The catalog browser is the interface between the supply chain (Chapter 4) and the build manifest (Chapter 5).

## Data Sources

| Source | Parts | Coverage | API |
|--------|-------|----------|-----|
| ProWire USA | 9,649 | Motec connectors, wire, tools | Scraped product pages |
| Invoice learned pricing | 49 | Real Motec component prices | Database |
| Micro-suppliers | ~50 | AMP steps, iBooster, dress-up | Manual entry |
| ACDelco/GM | ~20 | LS3 sensors and actuators | Part number lookup |

## Browse Experience

### Search
Type "M130 connector" → returns:
- M130-CONN-KIT ($35) — 2 Superseal connectors + 60 terminals
- MFT terminating header M130 ($150) — required assembly tool
- Daniels AF8 crimp tool ($674) — mil-spec crimp for Superseal terminals

### Filter
- By device type: ECU, PDM, sensor, actuator, connector, wire, tool
- By supplier: ProWire, Desert Performance, Engineered Vintage, etc.
- By status: in-stock, backordered, quote-required
- By build: show only parts needed for current vehicle

### Place
Click "Add to Build" on a part:
1. Part added to `vehicle_build_manifest` with position, endpoints, supplier
2. Compute engine re-runs — new wires, updated PDM channels, revised BOM
3. Delta report: "+3 wires, +1 PDM channel, +$350"

## Current State

The catalog exists as data (`catalog_parts` table, 9,649 entries). What's built:
- Part records with names, SKUs, prices (where available)
- 1,046 product images (11%)
- Invoice-learned pricing for 49 key components
- Supplier registry with 8 micro-suppliers

What's not built:
- Frontend browse/search UI
- "Add to Build" integration with manifest
- Inventory tracking (stock levels, lead times)
- Price comparison across suppliers
- Auto-ordering via Shopify/email APIs

## The Long Game

The catalog browser becomes the revenue layer. When a builder places a Motec M130 through Nuke, we earn a referral or margin. When they order DTM connectors from ProWire through our interface, we track the commission. The catalog browser is how parts flow from suppliers through Nuke to builds.
