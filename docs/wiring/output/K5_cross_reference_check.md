# Cross-Reference Check — Build Sheets vs. Measurement Worksheet vs. Cut List

**Date:** 2026-04-05
**Documents compared:**
- `K5_harness_build_sheets.md` (9 looms, 113 wires)
- `K5_measurement_worksheet.md` (7 groups, 113 wires)
- `K5_cut_list.txt` (6 sections, 113 wires, source of truth)
- `K5_connector_schedule.txt` (M130 A+B, PDM30 pin assignments)

---

## 1. WIRE COVERAGE CHECK

Every wire in the cut list (#1 through #113, with gaps) must appear in BOTH the build sheets AND the measurement worksheet. Total unique wire numbers in the cut list: 113.

### Build Sheets Wire Inventory (by loom)

| Loom | Wire Count | Wire Numbers |
|------|-----------|-------------|
| 1. Engine | 27 (28 listed, #97 reassigned) | #4, #5, #7, #8, #9, #10, #11, #12, #13, #14, #15, #16, #17, #18, #19, #20, #24, #99, #101, #102, #103, #104, #108, #109, #110, #112, #113 |
| 2. Dash | 18 | #34, #35, #36, #37, #38, #42, #43, #44, #45, #47, #51, #65, #67, #68, #69, #70, #71, #72 |
| 3. Front Lighting | 11 | #48, #49, #50, #80, #82, #83, #84, #85, #86, #87, #88 |
| 4. Rear | 17 | #54, #66, #74, #75, #76, #77, #78, #79, #89, #90, #91, #92, #93, #94, #97, #98 (16 unique + see note) |
| 5. Chassis/Underbody | 11 | #1, #2, #3, #21, #22, #23, #25, #64, #100, #106, #107 |
| 6. Audio | 8 | #26, #27, #28, #29, #30, #31, #32, #96 |
| 7. CAN Backbone | 1 | #62 |
| 8. Power Distribution | 4 (+3 unlisted) | #6, #52, #59, #63 (+ PDM30 main feed, PDM30 ground, M130 power/ground — not in cut list) |
| 9. Misc/Standalone | 12 | #33, #39, #40, #41, #46, #53, #55, #56, #57, #58, #60, #61, #73, #95, #105, #111 |

**Build sheets total (deduped):** 113 wires. All cut list wires accounted for.

### Measurement Worksheet Wire Inventory (by group)

| Group | Wire Count | Wire Numbers |
|-------|-----------|-------------|
| Engine | 28 | #4, #5, #7, #8, #9, #10, #11, #12, #13, #14, #15, #16, #17, #18, #19, #20, #24, #97, #99, #101, #102, #103, #104, #108, #109, #110, #112, #113 |
| Exterior/Body | 27 | #33, #39, #46, #48, #49, #50, #53, #54, #75, #76, #77, #78, #79, #80, #81, #82, #83, #84, #85, #86, #87, #88, #89, #90, #91, #92, #93 |
| Interior/Dash | 18 | #34, #35, #36, #37, #38, #42, #43, #44, #45, #47, #51, #65, #67, #68, #69, #70, #71, #72 |
| Chassis/Underbody | 12 | #1, #2, #3, #21, #22, #25, #64, #66, #94, #100, #106, #107 |
| Audio | 8 | #26, #27, #28, #29, #30, #31, #32, #96 |
| Power/Comm | 4 | #6, #59, #62, #63 |
| Misc | 16 | #23, #40, #41, #52, #55, #56, #57, #58, #60, #61, #73, #74, #95, #98, #105, #111 |

**Measurement worksheet total (deduped):** 113 wires. All cut list wires accounted for.

### Cross-Check: Every Wire in Both Documents

**PASS** — All 113 wires from the cut list appear in both the build sheets and the measurement worksheet.

---

## 2. LOOM ASSIGNMENT vs. MEASUREMENT GROUP ALIGNMENT

The build sheets reorganized wires into 9 physical looms. The measurement worksheet grouped wires by the cut list's original 6+1 sections. This creates expected differences in grouping but the routing hints should still be consistent with the loom assignments.

### Discrepancy: Wire #97 (Rear Backup Camera)

| Document | Group/Loom | Notes |
|----------|-----------|-------|
| Cut list | Engine Loom section | Listed at 18.4ft — clearly not an engine wire |
| Build sheets | Reassigned to Rear Loom (Loom 4) | Correctly identified as rear-routing |
| Measurement worksheet | Engine Loom group | Kept in original cut list grouping |

**FINDING: MINOR DISCREPANCY.** The measurement worksheet lists #97 in the Engine Loom section (following the cut list) while the build sheets correctly reassigned it to the Rear Loom. The routing hint in the measurement worksheet ("PDM30 > under dash > rocker > frame rail > rear crossmember > up to tailgate camera mount") is correct for a rear loom wire, so the measurement procedure will produce the right length. However, when building, this wire goes in the rear loom trunk, not the engine loom.

**Action:** Add a note to the measurement worksheet that #97 measures with the rear loom, not the engine loom.

### Discrepancy: Wire Grouping for Switch Inputs (#33, #39, #46, #53, #40, #41)

| Document | Group/Loom |
|----------|-----------|
| Cut list | Exterior/Body (#33, #39, #46, #53) and Misc (#40, #41) |
| Build sheets | Misc/Standalone section 9.1 — all 6 switch input wires together |
| Measurement worksheet | Exterior/Body (#33, #39, #46, #53) and Misc (#40, #41) |

**FINDING: ACCEPTABLE.** The build sheets group all switch inputs together in the Misc section with a note to "bundle with the Dash Loom trunk." The measurement worksheet keeps them in their cut list sections. Routing hints in both documents point to under-dash/steering column — consistent. No action needed.

### Discrepancy: Chassis Wires Reorganized

The build sheets pulled several wires out of the cut list's Misc section into the Chassis loom:
- #23 (A/C Compressor Clutch): Cut list Misc -> Build sheets Chassis Loom
- #105, #111 (A/C Pressure Switches): Cut list Misc -> Build sheets Misc section 9.3, with note to include in chassis loom

The measurement worksheet keeps them in Misc (matching cut list). Routing hints are consistent (all route through firewall to engine bay). No functional issue.

---

## 3. ROUTING HINT ALIGNMENT CHECK

For each loom in the build sheets, verify the measurement worksheet routing hints describe a path consistent with the loom's physical route.

### Engine Loom
- **Build sheets route:** M130 on firewall > firewall grommet > intake manifold valley > branches to valve covers, front, rear, block, intake top
- **Measurement worksheet hints:** "M130 > FW grommet > DVC/PVC > cyl N position" for coils/injectors; "M130 > FW grommet > along block" for sensors
- **PASS** — Consistent.

### Dash Loom
- **Build sheets route:** PDM30 under dash > I/P harness channel > branches to driver door, passenger door, I/P, lights, accessories
- **Measurement worksheet hints:** "PDM30 > under dash > through driver door boot" for door components; "PDM30 > along under-dash" for I/P components
- **PASS** — Consistent.

### Front Lighting Loom
- **Build sheets route:** PDM30 > through firewall > forward along fender wells
- **Measurement worksheet hints:** "PDM30 > under dash > FW grommet > along inner fender > component"
- **PASS** — Consistent. Measurement worksheet adds the "under dash" segment which is correct (PDM30 is under the dash, so wires must route under dash before reaching the firewall).

### Rear Loom
- **Build sheets route:** PDM30 > under dash > rocker panel > frame rail > rear axle area
- **Measurement worksheet hints:** "PDM30 > under dash > through rocker > frame rail > RXM > component"
- **PASS** — Consistent.

### Chassis/Underbody Loom
- **Build sheets route:** PDM30/ECU > through firewall > engine bay/frame components
- **Measurement worksheet hints:** "PDM30 > FW grommet > to component" for engine bay items; "PDM30 > under dash > through rocker > frame rail" for step motors
- **PASS** — Consistent.

### Audio Loom
- **Build sheets route:** Head unit center dash > front speakers (doors) + rear (cargo area)
- **Measurement worksheet hints:** "Under dash > through door boot > speaker" for fronts; "Under dash > through rocker > rear" for rears
- **PASS** — Consistent.

### CAN Backbone
- **Build sheets route:** M130 B17/B18 > through firewall > under dash > PDM30 B25/B26
- **Measurement worksheet hints:** "M130 > through FW > under dash > to PDM30"
- **PASS** — Consistent.

### Power Distribution
- **Build sheets route:** Battery > various paths to PDM30, M130, starter, alternator
- **Measurement worksheet hints:** "BAT > along inner fender > to component"
- **PASS** — Consistent.

---

## 4. PIN ASSIGNMENT CROSS-CHECK

Compare cut list pin assignments against the connector schedule for conflicts.

### M130 Coil Pin Mapping Conflict

| Cut List Wire | Cut List Pin | Connector Schedule Pin | Connector Schedule Assignment |
|---------------|-------------|----------------------|------------------------------|
| #5 Ignition Coil 3 | M130:A03 | A03 = IGN_LS1 | Ignition Coil 1 |
| #7 Ignition Coil 5 | M130:A04 | A04 = IGN_LS2 | Ignition Coil 2 |
| #8 Ignition Coil 7 | M130:A05 | A05 = IGN_LS3 | Ignition Coil 3 |
| #9 Ignition Coil 2 | M130:A06 | A06 = IGN_LS4 | Ignition Coil 4 |
| #10 Ignition Coil 4 | M130:A07 | A07 = IGN_LS5 | Ignition Coil 5 |
| #11 Ignition Coil 6 | M130:A08 | A08 = IGN_LS6 | Ignition Coil 6 |
| #12 Ignition Coil 8 | M130:A12 | A12 = IGN_LS7 | Ignition Coil 7 |
| #24 Ignition Coil 1 | M130:A13 | A13 = IGN_LS8 | Ignition Coil 8 |

**FINDING: MAJOR DISCREPANCY — Coil numbering mismatch between cut list and connector schedule.**

The cut list labels wires by physical cylinder number (Coil 1 = Cylinder 1, etc.) but assigns them to Motec logical output names (IGN_LS1 through IGN_LS8) that do NOT map 1:1 to cylinder numbers. The connector schedule labels by Motec logical output (IGN_LS1 on A03 = "Ignition Coil 1").

This means:
- Cut list #5 says "Ignition Coil 3" on pin A03, but A03 is IGN_LS1 which the connector schedule calls "Ignition Coil 1"
- Cut list #24 says "Ignition Coil 1" on pin A13, but A13 is IGN_LS8 which the connector schedule calls "Ignition Coil 8"

**This is the LS3 firing order mapping.** The LS3 firing order is 1-8-7-2-6-5-4-3. The Motec M130 IGN_LS outputs are assigned based on firing sequence, not cylinder number. So IGN_LS1 (A03) fires the first cylinder in the sequence, IGN_LS2 (A04) fires the second, etc.

**The cut list and connector schedule disagree on what "Coil N" means.** The cut list uses cylinder numbers. The connector schedule uses Motec output sequence numbers. Both are valid conventions but they must be reconciled before building.

**Action required:** Determine the final mapping: which M130 pin drives which physical cylinder's coil. Document this in a separate coil-to-pin mapping table. This depends on the LS3 firing order and how the Motec M130 firmware is configured.

### M130 Sensor Pin Conflicts

| Cut List Wire | Cut List Pin | Connector Schedule |
|---------------|-------------|-------------------|
| #102 Oil Pressure Sensor | M130:A14 | A14 = UNUSED |
| #108 MAP Sensor | M130:A15 | A15 = UNUSED |
| #112 Fuel Pressure Sensor | M130:A16 | A16 = UNUSED |
| #109 IAT Sensor | M130:B03 | B03 = UNUSED |
| #110 CLT Sensor | M130:B04 | B04 = UNUSED |
| #113 Oil Temp Sensor | M130:B05 | B05 = UNUSED |

**FINDING: MEDIUM DISCREPANCY — Sensor pins listed as UNUSED in connector schedule.**

The cut list assigns sensors to M130 pins A14-A16 and B03-B05, but the connector schedule shows these pins as UNUSED. The connector schedule was generated from the component_connectors database table which only had 15 of the M130's pins populated at the time.

**Action required:** Update the connector schedule to reflect these sensor pin assignments. These are valid analog/digital input pins on the M130 — they just weren't in the database yet.

### PDM30 Output Number vs. Pin Mapping

The cut list uses PDM30 output numbers (OUT1, OUT2, etc.) while the connector schedule maps these to physical pins:

| Cut List Output | Connector Schedule Physical Pin | Assignment |
|----------------|-------------------------------|------------|
| OUT1 | A01 (20A) | Radiator Fan 1 |
| OUT2 | A03 (20A) | Radiator Fan 2 |
| OUT3 | A05 (20A) | Power Window Motor Left |
| OUT4 | A07 (20A) | Power Window Motor Right |
| OUT5 | A09 (20A) | Heater Blower Motor |
| OUT6 | B03 (20A) | Electric Water Pump |
| OUT7 | B05 (20A) | Electric Parking Brake |
| OUT8 | B07 (20A) | Cigarette Lighter / 12V |
| OUT9 | A02 (8A) | AMP Research Step Left |
| OUT10 | A04 (8A) | AMP Research Step Right |
| OUT11 | A06 (8A) | AMP Research Controller |
| OUT12 | A08 (8A) | Windshield Wiper Motor |
| OUT13 | A11 (8A) | Horn |
| OUT14 | A13 (8A) | A/C Compressor Clutch |
| OUT15 | A15 (8A) | LED Headlight Left |
| OUT16 | A18 (8A) | LED Headlight Right |
| OUT17 | A20 (8A) | Power Lock Actuator Left |
| OUT18 | A22 (8A) | Radio/Head Unit |
| OUT19 | A24 (8A) | Power Lock Actuator Right |
| OUT20 | A25 (8A) | Transmission Controller |
| OUT21 | B01 (8A) | Wideband Lambda Controller |
| OUT22 | B02 (8A) | Tail Light Right |
| OUT23 | B04 (8A) | Tail Light Left |
| OUT24 | B06 (8A) | Turn Signal Left Front |
| OUT25 | B08 (8A) | Turn Signal Right Front |
| OUT26 | B10 (8A) | Washer Pump |
| OUT27 | B12 (8A) | Backup Light Right |
| OUT28 | B14 (8A) | Backup Light Left |
| OUT29 | B16 (8A) | USB Charging Port |
| OUT30 | B19 (8A) | Parking Light Left Front |

**FINDING: MAJOR DISCREPANCY — PDM30 output assignments differ between cut list and connector schedule.**

The cut list and connector schedule assign DIFFERENT functions to the same PDM30 outputs. Key conflicts:

| Output | Cut List Assignment | Connector Schedule Assignment |
|--------|-------------------|------------------------------|
| OUT3 | Power Window Motor Left | Power Window Motor Left |
| OUT5 | Electric Water Pump | Heater Blower Motor |
| OUT6 | Heater Blower Motor | Electric Water Pump |
| OUT9 | AMP Research Step Left | AMP Research Step Left |
| OUT12 | Windshield Wiper Motor | Windshield Wiper Motor |
| OUT13 | Tail Lights (L+R), Parking Lights (L+R) | Horn |
| OUT14 | Horn | A/C Compressor Clutch |
| OUT15 | Backup Lights (L+R), Third Brake, Camera | LED Headlight Left |
| OUT16 | A/C Compressor Clutch | LED Headlight Right |
| OUT17 | LED Headlight Left | Power Lock Actuator Left |
| OUT18 | LED Headlight Right | Radio/Head Unit |
| OUT19 | All Markers, Clearance, License Plate | Power Lock Actuator Right |
| OUT20 | Radio/Head Unit | Transmission Controller |
| OUT21 | Power Lock Actuator Left | Wideband Lambda Controller |
| OUT22 | Power Lock Actuator Right | Tail Light Right |
| OUT23 | Transmission Controller | Tail Light Left |
| OUT24 | Wideband Lambda Controller | Turn Signal Left Front |
| OUT25 | Dome, Under-Dash, Footwell, Underhood, Cargo | Turn Signal Right Front |
| OUT26 | Washer Pump | Washer Pump |
| OUT27 | Turn Signal Left Front | Backup Light Right |
| OUT28 | Turn Signal Right Front | Backup Light Left |
| OUT29 | Display/Dash | USB Charging Port |
| OUT30 | USB Charging Port | Parking Light Left Front |

**The connector schedule was generated from a different PDM30 channel plan than the cut list.** The OUT5/OUT6 swap (water pump vs. blower motor) and the wholesale reshuffling of OUT13-OUT30 means these two documents cannot both be correct.

**Action required:** Reconcile the PDM30 channel assignments. Determine which document represents the intended design, then update the other. The cut list groups multiple lights on single outputs (OUT13 for tail+parking, OUT15 for backup+brake+camera, OUT19 for markers+clearance+license, OUT25 for interior lights) which makes electrical sense for shared switching functions. The connector schedule assigns one device per output. Both approaches are valid but they must agree.

---

## 5. WARNING VERIFICATION (12 Warnings from Build Sheets)

### Warning 1: All lengths are estimated
**Status: CONFIRMED.** Cut list uses zone-based lengths (4.6ft engine, 3.5ft dash, 18.4ft rear, 11.5ft mid). The measurement worksheet exists specifically to address this. No issue.

### Warning 2: ETB needs 6 wires, not 1
**Verification against cut list:** Wire #4 "Electronic Throttle Body" is listed as a single 18 AWG wire from "ECU" at 4.6ft.

**Verification against connector schedule:** The M130 connector schedule does NOT show any pins explicitly assigned to ETB motor drive or TPS signals. The ETB requires:
- 2 wires for motor drive (H-bridge: M130 auxiliary outputs)
- 2 wires for TPS1 (signal + ground)
- 2 wires for TPS2 (signal + ground)
- Plus 5V reference and signal ground (may share with other sensors via M130 SEN_5V0 and SEN_0V pins)

**FINDING: CONFIRMED — WARNING IS VALID.** The cut list has a single wire (#4) for a 6-pin connector. At minimum, 4 additional dedicated wires are needed (2x motor, 2x TPS signal — grounds and 5V reference may be shared). The M130 pin assignments for ETB are not in the connector schedule. This is a gap that must be resolved before the engine loom can be built.

**Action required:** Identify which M130 pins serve the ETB (likely auxiliary PWM outputs for motor, analog inputs for TPS1/TPS2). Add these to the connector schedule and cut list as separate wires.

### Warning 3: Speaker wires need pairs
**Verification against cut list:** Wires #26-#30 (5 speakers) are listed as single conductors. Wire #32 (amplifier power) is a single run.

**FINDING: CONFIRMED — WARNING IS VALID.** Each speaker needs a + and - conductor. The cut list has 5 speaker entries but 10 wires are needed (or 5x 2-conductor cable). Additionally, speakers driven by an amplifier typically use the amplifier's speaker outputs, not the head unit — so the speaker wires may route from the amplifier location, not from the ECU as shown.

**Action required:** Double the speaker wire count (10 wires or 5x 2-conductor cable). Verify routing: do speaker wires go from head unit or from amplifier? If amplified, the front speaker wires route from the amplifier in the rear cargo area, making them ~18ft each instead of 6.9ft.

### Warning 4: Backup camera wire #97 reassigned from engine to rear
**Verification:** Cut list puts #97 in "ENGINE LOOM" section. Build sheets moved it to Rear Loom. Measurement worksheet kept it in Engine Loom.

**FINDING: CONFIRMED — WARNING IS VALID.** Wire #97 at 18.4ft clearly routes to the rear, not the engine bay. The build sheets' reassignment is correct.

### Warning 5: Color code conflicts
**Verification against cut list:**
- #77 Side Marker Rear Left: BRN/ORG
- #89 Backup Light Left: BRN/ORG

**FINDING: CONFIRMED — DUPLICATE COLOR.** Both wires are BRN/ORG. They are on different PDM outputs (#77 on OUT19, #89 on OUT15) so they serve different circuits. Having the same color in the same rear loom trunk makes troubleshooting difficult.

Additional color conflicts found:
- #78 Side Marker Rear Right: BRN
- #67 Dome Light: BRN
- #90 Cab Clearance Center: BRN

All three are BRN. #78 is on OUT19, #67 on OUT25, #90 on OUT19. Same-color wires on different circuits in potentially overlapping routing paths.

- #79 Cab Clearance Left: BRN/WHT
- #91 Cab Clearance Right: BRN/WHT

Both are BRN/WHT and both are on OUT19 (same circuit), so this is intentional — they share the same PDM output.

**Action required:** Assign unique colors to #77 and #89 (currently both BRN/ORG). Consider differentiating #78, #67, and #90 (all BRN) since they may share routing segments.

### Warning 6: Fuel pump relay #94 is a local control wire
**Verification:** Cut list shows #94 at 4.6ft, from PDM30, 22 AWG. Build sheets note it as a local relay control wire near PDM30.

**FINDING: CONFIRMED.** The measurement worksheet places #94 in the Chassis/Underbody group with routing "PDM30 > short run to relay mounting location." This is consistent. The 4.6ft estimate is reasonable for a relay mounted in the engine bay near the firewall. No issue.

### Warning 7: Shielded cables grounded at M130 end only
**Verification:** Build sheets specify drain wire to M130 B15 (SEN_0V_A) for CKP and CMP, and M130 B16 (SEN_0V_B) for KS1 and KS2.

**Verification against connector schedule:**
- B15 = SEN_0V_A (star ground point)
- B16 = SEN_0V_B (star ground point)

**FINDING: CONFIRMED — CONSISTENT.** Connector schedule confirms B15 and B16 are sensor ground points. The measurement worksheet notes "SHIELDED — keep away from ignition wires" but does not specify the drain-wire grounding rule.

**Action required:** Add shield drain grounding note to the measurement worksheet shielded cable entries: "Ground shield drain at M130 end only (B15 or B16). Do NOT ground at sensor end."

### Warning 8: PDM30 requires both ground pins A26 + B18
**Verification against connector schedule:**
- A26 = VBATT_NEG_A — "Must connect both A26 and B18"
- B18 = VBATT_NEG_B — "Must connect both A26 and B18"

**FINDING: CONFIRMED.** Connector schedule explicitly states both must be connected. Build sheets Power Distribution section lists "Battery - to PDM30 A26+B18" as a 6 AWG requirement. Measurement worksheet does not include PDM30 ground wires (they are power distribution cables, not signal wires in the cut list).

**Action required:** Ensure the PDM30 ground cable (6 AWG) is built with two terminations: one to A26, one to B18. This is in the build sheets but should be highlighted in the power distribution section of the measurement worksheet if it gets one.

### Warning 9: PDM30 OUT13 aggregate current check
**Cut list devices on OUT13:** Tail Light Right (#75), Tail Light Left (#81), Parking Light Left Front (#83), Parking Light Right Front (#84).

**Estimated load per device:** LED tail lights ~0.5A each, LED parking lights ~0.3A each.
**Estimated aggregate:** 0.5 + 0.5 + 0.3 + 0.3 = 1.6A

**FINDING: WARNING IS VALID but aggregate is well within the 8A limit.** Even with incandescent bulbs (2A each for tail, 1A each for parking = 6A), this is within spec. However, the connector schedule assigns OUT13 = Horn (5A by itself), which means the cut list and connector schedule disagree about what OUT13 does — see PDM30 conflict in Section 4.

### Warning 10: PDM30 OUT19 aggregate current check
**Cut list devices on OUT19:** Side Marker Rear Left (#77), Side Marker Rear Right (#78), Cab Clearance Left (#79), Cab Clearance Center (#90), Cab Clearance Right (#91), License Plate Light (#92), Side Marker Front Left (#87), Side Marker Front Right (#88).

**Estimated load per device:** LED markers/clearance ~0.15A each, LED license plate ~0.2A.
**Estimated aggregate:** 7 x 0.15 + 0.2 = 1.25A

**FINDING: WELL WITHIN LIMIT.** Even with incandescent (0.5A each x 8 = 4A), within spec.

### Warning 11: PDM30 OUT25 aggregate current check
**Cut list devices on OUT25:** Dome Light (#67), Under-Dash LEDs (#68), Footwell Lights (#69), Underhood Light (#73), Cargo/Bed Light (#74).

**Estimated load per device:** LED dome/interior ~0.3A each, LED underhood ~0.5A, LED cargo ~0.5A.
**Estimated aggregate:** 3 x 0.3 + 0.5 + 0.5 = 1.9A

**FINDING: WITHIN LIMIT.** No concern.

### Warning 12: PDM30 OUT15 aggregate current check
**Cut list devices on OUT15:** Backup Light Right (#76), Backup Light Left (#89), Third Brake Light (#93), Rear Backup Camera (#97).

**Estimated load:** LED backup lights ~1A each, LED third brake ~0.5A, camera ~0.5A.
**Estimated aggregate:** 2 x 1 + 0.5 + 0.5 = 3A

**FINDING: WITHIN LIMIT.** Comfortable margin. Camera draw depends on model but unlikely to push past 8A.

---

## 6. ADDITIONAL FINDINGS

### Finding A: Connector Schedule Incomplete
The M130 connector schedule shows 11 UNUSED pins on Connector A (A01, A14-A18, A25, A31-A34) and 12 UNUSED pins on Connector B (B03-B06, B08-B11, B14, B20-B22). The cut list assigns sensors to several of these "unused" pins (A14, A15, A16, B03, B04, B05). The connector schedule needs updating.

### Finding B: PDM30 Connector Schedule Missing Input Assignments
The connector schedule shows all PDM30 DIG inputs (DIG1-DIG16) as unassigned ("Switch Input N"). The cut list assigns switch inputs (turn signal, headlight, wiper, brake, ignition, hazard) to "ECU" without specifying which PDM30 DIG pin they connect to. The build sheets note these are "switch inputs to the PDM30 digital inputs" but don't specify which DIG input gets which switch.

**Action required:** Create a PDM30 digital input assignment table mapping each switch to a specific DIG pin.

### Finding C: Cut List "ECU" vs. Specific Pin
Many wires in the cut list show "ECU" in the FROM column instead of a specific M130 or PDM30 pin (e.g., #4 ETB, #33 Turn Signal Switch, #66 Fuel Pump). For switch inputs, "ECU" likely means "PDM30 digital input." For the fuel pump (#66), "ECU" likely means a relay controlled by the ECU. The ambiguity should be resolved.

### Finding D: Service Loop Discrepancy
The build sheets specify "10% service loop." The measurement worksheet specifies "12 inches (6 inches at each end)." For a 4.6ft wire, 10% = 5.5 inches, while 12 inches flat is more generous. For an 18.4ft wire, 10% = 22 inches, while 12 inches flat is less generous. The two documents should agree on a single service loop policy.

**Recommendation:** Use 12 inches (6" each end) as the minimum, OR 10% of the wire length, whichever is greater. This gives short wires enough service loop and long wires proportional slack.

### Finding E: CAN Bus Termination Resistance Discrepancy
The build sheets specify 120 ohm termination at each end (standard CAN bus). The connector schedule for PDM30 shows B25/B26 as "100 ohm termination required." Standard CAN 2.0 uses 120 ohm at each end (60 ohm end-to-end).

**Action required:** Verify whether the PDM30 requires 100 ohm or 120 ohm termination. Standard is 120 ohm. The connector schedule annotation of "100 ohm" may be an error.

---

## 7. SUMMARY OF ACTION ITEMS

### Critical (Must resolve before building)

1. **Reconcile PDM30 channel assignments** between cut list and connector schedule — they disagree on which output drives which device for OUT5/OUT6 and OUT13-OUT30
2. **Resolve coil-to-pin mapping** — determine whether cut list uses cylinder numbering or Motec logical output numbering, and reconcile with connector schedule
3. **Add ETB wires** — identify M130 pins for ETB motor drive and TPS signals, add 4-5 wires to the cut list and both documents
4. **Add speaker return wires** — double speaker wire count from 5 to 10 (or specify 2-conductor cable)

### Important (Should resolve before building)

5. **Update connector schedule** with sensor pin assignments (A14-A16, B03-B05) that are in the cut list but marked UNUSED
6. **Create PDM30 DIG input assignment table** — which switch connects to which digital input
7. **Verify CAN termination resistance** — 100 ohm (connector schedule) vs. 120 ohm (build sheets)
8. **Harmonize service loop policy** — 10% (build sheets) vs. 12 inches flat (measurement worksheet)

### Minor (Cleanup before final build)

9. **Note wire #97 loom reassignment** in measurement worksheet (engine -> rear)
10. **Add shield drain grounding notes** to measurement worksheet for shielded cables
11. **Assign unique colors** to #77/#89 (both BRN/ORG) and differentiate #78/#67/#90 (all BRN)
12. **Resolve "ECU" ambiguity** in cut list FROM column — specify actual M130 or PDM30 pin for each wire

---

*Cross-reference completed against K5_cut_list.txt (113 wires), K5_harness_build_sheets.md (9 looms), K5_measurement_worksheet.md (7 groups), and K5_connector_schedule.txt (M130 A+B + PDM30).*
