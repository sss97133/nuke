# Chapter 9: The Cut List

## What It Is

A wire-by-wire bench document. Every wire in the harness, organized by physical section, with exact gauge, color, length, and routing notes. This is what gets printed and taped to the harness bench wall.

## Edge Function

**`generate-cut-list`** — deployed and live.

**Input:** `vehicle_id` (UUID)
**Output:** JSON or plain text (controlled by `format` parameter)
**Pipeline:** Load manifest → compute overlay → generate wires → organize by section

### Invocation
```bash
curl -X POST "$SUPABASE_URL/functions/v1/generate-cut-list" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id": "e04bf9c5-b488-433b-be9a-3d307861d90b", "format": "text"}'
```

## K5 Output Summary

| Metric | Value |
|--------|-------|
| Total wires | 110 |
| Total length | 805 ft |
| Shielded cables | 4 |
| Twisted pairs | 1 |
| Sections | 7 |

### Section Breakdown

| Section | Wires | Length | Key Circuits |
|---------|-------|--------|-------------|
| Engine Loom | 28 | 143 ft | 8 injectors, 8 coils, crank/cam, knock sensors, MAP, IAT, CLT |
| Exterior/Body | 27 | 241 ft | Headlights, markers, turn signals, tail lights, backup camera |
| Interior/Dash | 20 | 117 ft | Gauges, switches, keypad, dome light, HVAC controls |
| Chassis/Under | 10 | 60 ft | AMP steps, door locks/windows, fuel pump relay |
| Audio | 7 | 76 ft | Amp power, speaker runs, subwoofer, head unit |
| Power/Ground | 10 | 112 ft | Battery cables, ground straps, alternator charge, PDM feeds |
| Misc | 8 | 56 ft | CAN bus, iBooster, e-brake actuator, speed sensor |

### Wire Color Convention

Colors are deterministic by function group:
- **GRN** + stripe sequence: Fuel injectors (GRN, GRN/WHT, GRN/BLK, GRN/RED, GRN/BLU, GRN/YEL, GRN/VIO, GRN/ORG)
- **WHT** + stripe: Ignition coils
- **BLU/WHT**: Crank/cam sensors (shielded)
- **TAN** + stripe: Temperature sensors
- **VIO** + stripe: Pressure/analog sensors
- **WHT/GRN + GRN/WHT**: CAN bus high/low
- **BLK**: All grounds

### Wire Purchase Summary

The cut list generates a wire purchase summary — 11 gauge/type combinations with recommended spool sizes:

| Gauge | Type | Total Length | Recommended Spool |
|-------|------|-------------|-------------------|
| 22 AWG | TXL | 48 ft | 100 ft spool |
| 20 AWG | TXL | 195 ft | 250 ft spool |
| 18 AWG | TXL | 245 ft | 500 ft spool |
| 16 AWG | TXL | 32 ft | 50 ft spool |
| 14 AWG | TXL | 110 ft | 250 ft spool |
| 12 AWG | TXL | 85 ft | 100 ft spool |
| 10 AWG | TXL | 45 ft | 50 ft spool |
| 4 AWG | TXL | 35 ft | 50 ft spool |
| 22 AWG | Shielded 2C | 18 ft | 25 ft spool |
| 20 AWG | Twisted pair | 10 ft | 25 ft spool |

## How Wire Length Is Computed

Every wire's length is derived from the device positions in the manifest:

1. **Source position** — where the wire starts (ECU pin, PDM channel, switch)
2. **Destination position** — where it ends (sensor, actuator, load)
3. **Zone distance matrix** — pre-computed distances between vehicle zones (engine_bay → firewall = 2 ft, firewall → dash = 1.5 ft, dash → rear = 12 ft)
4. **Routing multiplier** — 1.15× for straight runs, 1.3× for complex routing
5. **Service loop** — +6 inches per connector for serviceability

Formula: `length = zone_distance × routing_multiplier + service_loops`
