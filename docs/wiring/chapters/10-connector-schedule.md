# Chapter 10: The Connector Schedule

## What It Is

Pin-by-pin documentation for every multi-pin connector in the harness. For each pin: what function it serves, what device it connects to, what gauge wire, and any special notes (shielded, high-current, unused).

## Edge Function

**`generate-connector-schedule`** — deployed and live.

**Input:** `vehicle_id` (UUID)
**Output:** JSON or plain text
**Pipeline:** Load manifest → compute overlay → map pins from `device_pin_maps` → assign devices

### Invocation
```bash
curl -X POST "$SUPABASE_URL/functions/v1/generate-connector-schedule" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id": "e04bf9c5-b488-433b-be9a-3d307861d90b", "format": "text"}'
```

## K5 Connector Map

### M130 Connector A (Superseal 34-pin)

**26 assigned / 8 unused**

| Pin | Function | Assigned To | Gauge | Notes |
|-----|----------|-------------|-------|-------|
| A1-A8 | Injector 1-8 Peak & Hold | Fuel Injectors 1-8 | 18ga | GM 12576341, EV6/USCAR connector |
| A9-A16 | Ignition 1-8 Low Side | D510C Coils 1-8 | 20ga | GM 12611424, 4-pin push-to-seat |
| A17 | Crank Input | Crank Position Sensor | 22ga | SHIELDED. GM 12615626 |
| A18 | Cam Input | Cam Position Sensor | 22ga | SHIELDED. GM 12591720 |
| A19-A26 | Half-Bridge 1-8 | — | — | UNUSED (no half-bridge loads assigned) |
| A27-A28 | Sensor Ground A/B | — | 18ga | Star ground points |
| A29-A30 | Power Ground A/B | — | 14ga | Star ground points |
| A31 | ECU Power Supply | — | 14ga | Direct from PDM |
| A32 | Battery Voltage Sense | — | 16ga | Direct battery reference |
| A33-A34 | 5V Sensor Supply A/B | — | 22ga | Reference voltage for all analog sensors |

**Half-bridge headroom:** 8 unused channels (A19-A26). These can drive motors, idle air control, PWM solenoids. The M130 has fewer half-bridge outputs than the M150, but this build needs only the throttle body (driven via ECU internally), so all 8 are spare.

### M130 Connector B (Superseal 26-pin)

**2 assigned / 24 unused**

| Pin | Function | Assigned To | Gauge | Notes |
|-----|----------|-------------|-------|-------|
| B20 | Knock 1 | Knock Sensor Bank 1 | 22ga | SHIELDED. GM 12623730. Drain to sensor ground. |
| B21 | Knock 2 | Knock Sensor Bank 2 | 22ga | SHIELDED. GM 12623730. Drain to sensor ground. |
| B1-B19, B22-B26 | Various analog/digital inputs | — | — | UNUSED |

**Massive input headroom.** Connector B is primarily analog and digital inputs. Only 2 of 26 pins are assigned, meaning the M130 has abundant capacity for additional sensors, switches, and monitoring circuits.

### PDM30 Channels (30/30 assigned)

| Channel | Assignment | Devices | Current | Notes |
|---------|-----------|---------|---------|-------|
| Ch1 | headlight_low_left | Headlight Low L | 4.2A | Truck-Lite 27270C |
| Ch2 | headlight_low_right | Headlight Low R | 4.2A | Truck-Lite 27270C |
| Ch3 | headlight_high_left | Headlight High L | 4.2A | Truck-Lite 27270C |
| Ch4 | headlight_high_right | Headlight High R | 4.2A | Truck-Lite 27270C |
| Ch5 | turn_brake_left | Turn/Brake LH | 3.6A | United Pacific |
| Ch6 | turn_brake_right | Turn/Brake RH | 3.6A | United Pacific |
| Ch7 | markers_clearance | 8 lights grouped | 3.2A | Side markers + cab clearance + license |
| Ch8 | park_tail | 4 lights grouped | 6.0A | Parking + tail lights |
| Ch9 | backup | 4 devices grouped | 4.7A | Backup lights + 3rd brake + camera |
| Ch10 | interior_courtesy | 5 lights grouped | 2.5A | Dome + footwell + underdash + underhood + cargo |
| Ch11-Ch30 | Various | Individual devices | Varies | Steps, locks, windows, HVAC, fuel pump relay, etc. |

**PDM at capacity.** All 30 channels are assigned. Adding any new electrically-controlled device requires either grouping with an existing channel or upgrading to PDM30 + PDM15 on CAN.

## Data Source Warning

The M130 and PDM30 pin maps in `device_pin_maps` are **SCAFFOLDED** from training data. Pin functions are directionally correct (A1-A8 = injectors) but exact signal types, current ratings, and connector pinouts need validation against the Motec M130 Wiring Manual. Desert Performance has this document.
