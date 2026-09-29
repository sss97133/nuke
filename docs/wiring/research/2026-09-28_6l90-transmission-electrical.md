# 6L90 transmission: its own electrical, and the wires between it and the PCS TCM-2650 (2026-09-28)

Owner ask: "the wire harness is missing the pin out for the 6l90 ... and the electrical that's in the trans."
This is a research note. No registry, catalog or order row has changed.

Sources on file are in `reference_documents/component_drawings/` (page = PDF page). Four web pages were read
on 2026-09-28 with a one-page-per-host fetch; they are not yet in `calc-data/fetch_sources.py` URLS, so
`audit_citations.py` cannot check them until they are added there:
- EFI Connection, "6L80E 6L90E T43 TCM Transmission Connector Pigtail" — eficonnection.com/home/product/6l80e-6l90e-t43-tcm-transmission-connector-pigtail
- Zero Gravity, "TCM-2650 GM 6L50E 6L80E 6L90E Transmission Harness" — zerogravityperformance.com/product/tcm-2650-gm-6l50e-6l80e-6l90e-transmission-harness/
- PSI Conversion, "TCM-2650" — psiconversion.com/products/pcm-programming/transmissioncontrollers/TCM-2650.html
- Monster Transmission, "6L80 / 6L90 TEHCM Guide" — monstertransmission.com/blogs/news/6l80-6l90-tehcm-guide-...

## 1. The architecture: the computer is inside the transmission

The 6L90's transmission computer (T43 TCM) sits inside the case on the valve body. Together they are the
control solenoid valve assembly, called the TEHCM.

| Fact | Source |
|---|---|
| "This transmission is an electronically controlled unit with an internal TCM" that must be reprogrammed before operating | Moveras 31AS install manual p.4 |
| The control solenoid valve assembly is the "valve body and TCM or TEHCM"; the input/output speed sensor assembly and the position switch connector come off with it | Sonnax 6L80 ZIP kit p.5 |
| GM "combined the valve body, solenoids, pressure switches, and TCM into a single unit" | Monster Transmission TEHCM guide (web) |
| The internal mode switch (IMS) plugs into the solenoid body/TCM: "Install the manual shift Internal Mode Switch connector to Solenoid Body/TCM" | ATSG valve body p.86 (item 28) |
| IMS part number 24246427, updated mid-2007 for contact oxidation (DTC P1875) | ATRA 6L50/6L80/6L90 webinar p.12 |
| Speed sensors: 24265535 (previous design), 24265536 (Unigear output shaft, from March 2012); the two are not interchangeable, and the VIN picks which | ATRA p.14–15 |
| The IMS reports four range signals plus a P/N switch state; a bad IMS makes the TCM turn off all solenoids and default to 3rd or 6th | ATRA p.22–23 |
| The solenoids are named by their DTCs: SS1 (P0751), and the clutch pressure control solenoids (P0756, P0766, P0796, P2714, P2723) | ATRA p.24, p.37–38 |
| Fluid temperature is read by the TCM and shown on a scan tool (158–239 °F for the level check) | Moveras p.7 |

**What this means for the harness.** Every solenoid, pressure switch, speed sensor, the fluid temperature
sensor and the range switch wire to the TEHCM inside the case. **None of them is a K5 harness wire.** Our harness
ends at the one external case connector.

OPEN: the full internal list of solenoids and pressure switches by name, count and resistance. No document on
file itemizes it. Close by reading the GM 6L90 unit-repair section "Control Solenoid Valve Assembly", or a
GM Service Information electrical page for a 4WD 6L90 truck.

## 2. How the PCS TCM-2650 runs it: it talks to the factory TEHCM, it does not drive solenoids

- The PSI Conversion page (web) says the 6L80 and 6L90 "contain the factory transmission control module inside
  the valve body". It says the TCM-2650 "will allow the 6L80E, 6L90E ... transmission and factory controller to
  be installed in any vehicle".
- Our own ruling (`receipts/2026-07-12_6l80e-can-master-ruling.md` lines 12–17) has the TCM-2650 synthesize
  GM engine-computer traffic to the internal T43 on a private two-node GMLAN bus. The ruling also says the T43
  cannot be solenoid-driven externally. The PCS solenoid-driver products (TCM-2800/SimpleShift) stop at the 4L80E.
- The ZGP document supports this. Page 11 says the input shaft speed sensor "is inside the transmission and the speed is being sent
  to the TCM2650". Page 18 says digital-input behaviour "depends on how the TCM in the transmission is programmed", and tap shift
  works only "when the transmissions TCM is setup for Serial Tap". Page 19 says a gear output "must be properly configured
  in the GM TCM". Page 21 says "J1939 and GMLAN compatibility".
- There is no TEHCM delete or replacement internal harness in this design. The factory TEHCM stays.

**The ZGP rev 2 document, page by page.**

| Pages | Content |
|---|---|
| 1–5 | Software install and the USB-to-serial cable. Page 1 says the hardware is "TCM-2600/2650, Wiring Harness and the USB to COM adapter". |
| 6 | Inputs: TPS and engine RPM are required, from analog or CAN, never both. |
| 7–10 | TPS on analog input 1. RPM on speed input 3. |
| 11 | RPM wire is orange/black; black/white is for Hall sensors. Match RPM to the input-shaft speed read from the trans. |
| 12–13 | Analog inputs. Only 1 and 6 exist on this module. Table 4 allows analog 1 to piggyback an engine-computer sensor. |
| 13–14 | The harness gives +5 V (red/white, 20 AWG) and sensor ground (black/white, 20 AWG) for a dedicated TPS. |
| 14–17 | Manual-mode wiring examples. |
| 18 | Digital inputs, including brake. RPM is speed input 3. |
| 19–20 | Outputs: speedometer, gear-state PWM ("typically used for Neutral safety and Reverse Lights", ground only), fan, TCC-lock. |
| 21–23 | CAN and firmware. |

**The ZGP document has no connector drawing, no pin table and no fuse size.** The Zero Gravity harness page
(web) names the harness TCM-4610 "with Paddle Shifter Connector" and gives no pinout.

## 3. The wire list between the PCS harness and the transmission

The transmission side is one external connector: a Kostal 16-cavity plug, GM 15131300 / 19303772, pinout
below. Source: EFI Connection pigtail page (web). The same 19303772 number is already in registry note #125.

| Case cavity | Wire (OE) | Function | Gauge (OE pigtail) | PCS TCM-2650 side |
|---|---|---|---|---|
| 1 | RED/WHT | 12 V battery | 18 | OPEN |
| 4 | RED/WHT | 12 V battery | 18 | OPEN |
| 2 | BLK/WHT | ground | 18 | OPEN |
| 5 | BLK/WHT | ground | 18 | OPEN |
| 12 | PNK | 12 V switched ignition | 20 | OPEN |
| 9 | YEL | 12 V accessory | 20 | OPEN |
| 10, 14 | TAN/BLK | CAN+ (GMLAN high) | 20 | OPEN |
| 15 | TAN/BLK | CAN+, 120 Ω applied | 20 | OPEN |
| 8 | TAN | CAN− (GMLAN low), 120 Ω applied | 20 | OPEN |
| 11, 13 | TAN | CAN− | 20 | OPEN |
| 6 | WHT | stop lamp switch signal | 22 | OPEN |
| 7 | PPL | tap up/down signal | 22 | OPEN |
| 3 | ORN/BLK | park/neutral signal (output from the TEHCM) | 20 | OPEN |
| 16 | ORN/BLK | replicated TOS (output-speed) signal | 22 | OPEN |

- **Shielding.** None of these needs a shield: the speed sensors are internal. The GMLAN pair runs twisted,
  per the house CAN rule on sheet 1-28.
- **The PCS TCM-2650's own plug.** Its part number, cavity count and terminal are OPEN. The PCS-side pin for
  every row above is OPEN too. Neither is in any document on file.
- **How that closes.** Close both by reading the TCM-4610 harness drawing ("the harness drawing" that ZGP p.7
  refers to). Ask ZGP/PSI for it, or read the label and plug on the harness when it arrives.
- **Buy the harness.** The TCM-4610 harness is sold complete to the case connector. The build should buy it,
  not rebuild it, so our wires stop at its flying leads.

## 4. Vehicle-side interactions

- **Neutral start and reverse.** There are two sources.
  - The TEHCM itself grounds case cavity 3 in park/neutral. The Holley harness exposes that as its yellow
    park/neutral wire, grounded in P/N and open in gear (Holley 558-499 p.3).
  - The PCS can also output a gear-state ground "typically used for Neutral safety and Reverse Lights" (ZGP p.19).
  - Our PCS_NS and PCS_REV use the PCS outputs, which is valid. There is no reverse wire on the case connector,
    so reverse must come from the PCS or from CAN.
  - OPEN: whether the TCM-4610 brings case cavity 3 out as a flying lead. Its drawing closes this.
- **Speedometer.** Two speed sources exist, so the Dakota SEN-01-5 sender is **possibly redundant**.
  - The PCS has a speedometer output. A digital output can also be set to repeat it for GM speedometers (ZGP p.19).
  - The case connector carries "replicated TOS" on cavity 16.
  - OPEN: the pulses per mile of either signal, and whether the VHX SPD SND input accepts it. The Dakota VHX
    manual's speed-input page plus the PCS drawing close this.
  - Keep wire #100 (M130 B08 speed sensor) until that is closed.
- **Gear display.** The PCS gear-state PWM output (ZGP p.19) could replace the GSS-3000 gear sender.
  - OPEN: whether the VHX GEAR input reads a PWM. Its 1-wire GSS protocol is Dakota's own.
- **CAN.** The PCS speaks J1939, GMLAN and PCS-proprietary CAN, receive and transmit selectable (ZGP p.6, p.21).
  - The locked ruling keeps the PCS–T43 link a private two-node bus, off the M130 trunk.
  - Sending gear or fluid temperature to the M130 needs a third CAN link, or the M130 on that private bus.
  - That changes the ruling and needs an M130 receive template for J1939 or GMLAN. It is an owner decision
    and is not proposed here.
- **Shifter.** The range is read mechanically: the manual shaft moves the IMS inside the case, and the TEHCM
  reads it (ATSG p.86; ATRA p.22–23).
  - A mechanical column or floor linkage to the manual shaft is enough. An electronic shifter is not required.
  - Tap shift is optional: case cavity 7, or the PCS digital inputs (ZGP p.18).
  - OPEN: the K5 column linkage geometry to the 6L90 manual shaft. That is a builder check.

## 5. Current and fuses

| Item | Value | Source |
|---|---|---|
| Transmission (TEHCM) power | "a constant battery source capable of supplying 5 amps"; "Supplies power to the transmission solenoids" | Holley 558-499 p.3 |
| PCS TCM-2650 supply fuse | not stated | ZGP rev 2, all 23 pages |
| Solenoid currents | not stated | every document on file |

- **Our 5 A PCS_BATT fuse.** It has no PCS source. It matches Holley's figure for the transmission's own
  solenoid supply.
- **OPEN: what PCS_BATT actually feeds.** It may feed only the PCS, or the PCS harness may also feed the
  transmission battery cavities 1 and 4 from it. If it feeds both, 5 A is at the limit Holley states for the
  transmission alone. The TCM-4610 drawing closes this.

## What the registry is missing or has wrong (for the wiring lead; nothing was changed)

1. **No PCS ground.** There is a PCS_BATT but no PCS_GND. ZGP p.2 says to set up "12V Battery, Ignition and
   Grounds" before connecting.
2. **No wires from the PCS to the transmission.** If the TCM-4610 is bought, those 16 circuits are in it, and
   the registry should carry it as one kit harness with its case-connector end, not 16 wires.
3. **Two stale Holley-era active rows.** Wire #58 powers "Holley 558-499 T43 module (3A)" from PDM30 OUT23.
   Wire #125 is the CAN stub to the T43. The 2026-07-12 ruling killed Holley and repurposed #125 as the PCS
   stub, but #58 still names Holley.
4. **PCS_TPS piggybacks the M130 pedal signal.** ZGP p.13 Table 4 allows analog 1 to piggyback. OPEN: whether
   the PCS black/white sensor ground must join the M130 sensor 0 V for a shared reference. The PCS harness
   drawing and a bench meter check close this.
5. **The "6L80E" text in the build book (sheet 1-15).** The state file §3 0a says the transmission is a 6L90.
