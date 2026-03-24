# Chapter 11: The Bill of Materials

## What It Is

Every part needed to build the complete wiring harness, with catalog linkage, real pricing from invoices and ProWire, supplier identification, and purchase status tracking.

## Edge Function

**`generate-wiring-bom`** — deployed and live.

**Input:** `vehicle_id` (UUID)
**Output:** JSON or plain text
**Pipeline:** Load manifest → compute overlay → cross-reference `catalog_parts` and `invoice_learned_pricing` → group by category

### Invocation
```bash
curl -X POST "$SUPABASE_URL/functions/v1/generate-wiring-bom" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id": "e04bf9c5-b488-433b-be9a-3d307861d90b", "format": "text"}'
```

## K5 Output Summary

| Metric | Value |
|--------|-------|
| Total estimated cost | $19,966 |
| Parts cost | $16,391 |
| Labor cost | $3,575 (55 hrs × $65/hr) |
| Items priced | 94 |
| Items needing quotes | 18 |
| Items purchased | 30 |
| Items still needed | 85 |

### Cost Breakdown by Category

| Category | Items | Subtotal | Notes |
|----------|-------|----------|-------|
| Motec System | 3 | $6,675 | M130 $3,500 + PDM30 $3,140 + connector kit $35 |
| Sensors | 18 | $651 | 14 priced, 4 need quotes |
| Actuators | 22 | $3,210 | Coils, injectors, throttle body, motors |
| Lighting | 15 | $1,890 | LED conversion complete |
| Connectors | 12 | $485 | DTM kits from ProWire |
| Wire | 11 | $890 | TXL by gauge, shielded, twisted pair |
| Protection | 8 | $340 | DR-25 tubing, heat shrink, split loom |
| Hardware | 5 | $250 | Grommets, clamps, tie points |
| Labor | 1 | $3,575 | 55 hours at $65/hr (Desert Perf rate) |

### Purchase Status

The BOM tracks three states:
- **PURCHASED** (30 items): Already bought, backed by invoice line items. M130, PDM30, throttle body, starter, alternator, all lighting, wheels, tires.
- **NEEDED** (85 items): Must order. Sensors, connectors, wire spools, protection materials.
- **QUOTE** (18 items): No price available. TPS (integrated in throttle body), AC pressure switches, fuel pressure sensor, oil temp sensor, some specialty connectors.

### Price Sources

Every price in the BOM traces to one of three sources:
1. **Invoice learned pricing** (49 entries) — real prices from Desert Performance Invoice #1190 and NUKE LTD invoices SW77002-SW77006
2. **ProWire catalog** (9,649 parts) — online prices for connectors, wire, tools
3. **Estimate** — flagged with `(est)`, based on typical market pricing for the part category

### ECU Cost Impact

The BOM computes the ECU model from I/O requirements. For the K5 build:
- **M130**: $3,500 — handles all current I/O with headroom
- **M150**: $5,500 — 40% more I/O, 3 CAN buses, needed only for traction control or advanced features
- **Delta**: $2,000 saved by using M130

This cost impact propagates: M130 uses a different connector kit (2 connectors vs 4), different harness termination tools, and potentially different unterminated harness from Fischer Motorsports.
