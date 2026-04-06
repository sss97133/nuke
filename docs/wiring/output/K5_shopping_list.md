# Complete Shopping List -- 1977 Chevrolet K5 Blazer LS3/Motec M130

**Generated:** 4/5/2026
**Source data:** component_connectors DB, K5_cut_list.txt, K5_bom.txt, Ch.08 LS3 Sensors

---

## 1. M130 / PDM30 Mating Connectors

| Qty | Part Number | Description | Mates To | Est Price | Supplier |
|-----|-------------|-------------|----------|-----------|----------|
| 1x | MoTeC #65044 | Tyco Superseal 34-pin mating connector | M130 Connector A | $35 | Motec dealer / Desert Performance |
| 1x | Tyco Superseal 26-pin | Superseal 26-pin mating connector (ask Motec dealer for PN) | M130 Connector B | $30 | Motec dealer / Desert Performance |
| 1x | MoTeC #65044 | Tyco Superseal 34-pin mating connector | PDM30 Connector A | $35 | Motec dealer / Desert Performance |
| 1x | Tyco Superseal 26-pin | Superseal 26-pin mating connector | PDM30 Connector B | $30 | Motec dealer / Desert Performance |

**Subtotal: ~$130**

> NOTE: The BOM includes a $35 "M130 Connector Kit" that may cover the M130-A mating connector. Verify before ordering duplicates.

---

## 2. LS3 Sensor Pigtails (ICT Billet)

| Qty | Part Number | Description | Mates To | ECU Pin | Est Price | Supplier |
|-----|-------------|-------------|----------|---------|-----------|----------|
| 1x | WPCKP40 | Crank position sensor pigtail (Metri-Pack 3-pin gray) | GM 12615626 (58X CKP) | M130:B01 | $12 | ICT Billet |
| 1x | WPCMP30 | Cam position sensor pigtail (Metri-Pack 3-pin) | GM 12591720 (CMP) | M130:B02 | $12 | ICT Billet |
| 2x | WPKN040 | Knock sensor pigtail (2-pin sealed metric) | GM 12623730 (KS) | M130:B07, B13 | $10 ea | ICT Billet |
| 1x | WP0IL40 | Oil pressure sensor pigtail (3-pin oval sealed) | GM 12673134 (OPS) | M130:A14 | $10 | ICT Billet |
| 1x | WPCTS30 | Coolant temp sensor pigtail (Metri-Pack 2-pin sealed) | GM 19236568 (CLT) | M130:B04 | $10 | ICT Billet |

**Subtotal: ~$64**

> ICT Billet pigtails come with 12" pre-terminated leads. Plan extension wire lengths accordingly.

---

## 3. Injector Connectors (EV6/USCAR x8)

| Qty | Part Number | Description | Mates To | ECU Pins | Est Price | Supplier |
|-----|-------------|-------------|----------|----------|-----------|----------|
| 8x | WPINJ40 | EV6/USCAR injector pigtail (2-pin) | GM 12576341 injectors | M130:A19-A22, A27-A30 (INJ_PH1-8) | $8 ea | ICT Billet |
| | Alt: GM 13352241 | OEM injector connector | | | $6 ea | GM dealer |

**Subtotal: ~$64**

> Alternative: A pre-terminated injector sub-harness (8x EV6 connectors + trunk) from Wiring Specialties or Holley is ~$80-120 and saves build time.

---

## 4. Coil Connectors (D510C 4-pin x8)

| Qty | Part Number | Description | Mates To | ECU Pins | Est Price | Supplier |
|-----|-------------|-------------|----------|----------|-----------|----------|
| 8x | WPCOL40 | D510C 4-pin coil pigtail (push-to-seat) | ACDelco D510C coils | M130:A03-A08, A12-A13 (IGN_LS1-8) | $12 ea | ICT Billet |
| | Alt: GM 12162000 | OEM coil connector pigtail | | | $8 ea | GM dealer |

**Subtotal: ~$96**

> Coil wiring cross-reference (channel = cylinder, NOT firing order position):
> - A03=IGN_LS1=Cyl 1 (driver front), A04=IGN_LS2=Cyl 2 (pass front)
> - A05=IGN_LS3=Cyl 3 (driver #2), A06=IGN_LS4=Cyl 4 (pass #2)
> - A07=IGN_LS5=Cyl 5 (driver #3), A08=IGN_LS6=Cyl 6 (pass #3)
> - A12=IGN_LS7=Cyl 7 (driver rear), A13=IGN_LS8=Cyl 8 (pass rear)

---

## 5. Throttle Body Connector (6-pin)

| Qty | Part Number | Description | Mates To | ECU Pins | Est Price | Supplier |
|-----|-------------|-------------|----------|----------|-----------|----------|
| 1x | GM 13580085 | 6-pin sealed ETB mating connector | GM 12605109 (LS3 90mm ETB) | M130:A01/A18 (HB motor), A02/A09 (5V ref), B15/B16 (SEN_0V) | $25 | GM dealer / NZEFI |

**Subtotal: ~$25**

> Pin mapping: A=TAC_M2 (motor-), B=TAC_M1 (motor+), C=TPS1_SIG, D=TPS2_SIG, E=5V_REF, F=SIG_GND

---

## 6. MAP Sensor Connector (Bosch 3-pin)

| Qty | Part Number | Description | Mates To | ECU Pin | Est Price | Supplier |
|-----|-------------|-------------|----------|---------|-----------|----------|
| 1x | ACDelco PT2293 | Bosch 3-pin sealed mating connector | GM 55573248 (LS3 MAP) | M130:A15 (AV2) | $12 | Summit Racing / AutoZone |
| | Alt: Bosch 1928403966 | OEM Bosch mating connector | | | $10 | Bosch distributor |

**Subtotal: ~$12**

---

## 7. Inline Connectors (Deutsch DTM)

| Qty | Part Number | Description | Use | Est Price | Supplier |
|-----|-------------|-------------|-----|-----------|----------|
| 5x | DTM04-2P / DTM06-2S | 2-pin DTM connector pair | Single-wire breakpoints (fuel pump relay, iBooster relay, etc.) | $7 ea | Waytek Wire |
| 5x | DTM04-3P / DTM06-3S | 3-pin DTM connector pair | Sensor extensions (MAP, OPS, CKP) | $8 ea | Waytek Wire |
| 3x | DTM04-4P / DTM06-4S | 4-pin DTM connector pair | Coil sub-harness breakpoints | $9 ea | Waytek Wire |
| 2x | DTM04-6P / DTM06-6S | 6-pin DTM connector pair | Loom-to-loom junctions (firewall, rear body) | $11 ea | Waytek Wire |

**Subtotal: ~$104**

> DTM connectors are sealed (IP67) with wedgelocks. Use for any harness breakpoint where you might need to disconnect a sub-harness for service.

---

## 8. Ring Terminals for Grounds

| Qty | Part Number | Description | Use | Est Price | Supplier |
|-----|-------------|-------------|-----|-----------|----------|
| 1x | M6 ring terminal, 6 AWG | Heavy crimp ring terminal | PDM30 Connector C (VBATT_POS stud) | $2 | Any electrical supply |
| 4x | M6 ring terminal, 16 AWG | Crimp ring terminal | M130 A10/A11 (BAT_NEG1/2), PDM30 A26/B18 (VBATT_NEG) | $1 ea | Waytek Wire |
| 4x | M8 ring terminal, 8 AWG | Crimp ring terminal | Engine block ground strap, body grounds | $2 ea | Waytek Wire |
| 2x | M10 ring terminal, 4 AWG | Heavy ring terminal | Battery negative, starter ground | $3 ea | Waytek Wire |
| 6x | M6 ring terminal, 22 AWG | Small ring terminal | Sensor ground star points (M130 B15/B16 SEN_0V returns) | $0.50 ea | Waytek Wire |
| 2x | Ground strap, 12" braided | Tinned copper braided strap | Engine-to-frame, body-to-frame | $8 ea | Summit Racing |

**Subtotal: ~$39**

---

## 9. Shielded Cable Connectors

| Qty | Part Number | Description | Use | Est Price | Supplier |
|-----|-------------|-------------|-----|-----------|----------|
| -- | (no additional connectors) | Shield drain terminates into Superseal pin | CKP (B01), CMP (B02), KS1 (B07), KS2 (B13) | -- | -- |

> The 4 shielded runs (CKP, CMP, KS1, KS2) use 2-conductor shielded cable. The shield drain wire grounds to M130 B15/B16 (SEN_0V) at the ECU end and floats at the sensor end. The sensor-side pigtails (WPCKP40, WPCMP30, WPKN040) handle that termination. No special shielded-cable connectors needed beyond the Superseal terminals in Section 13.

**Subtotal: $0** (covered by pigtails in Sections 2-4 and terminals in Section 13)

---

## 10. Wire -- Every Gauge and Color

From the cut list wire purchase summary (113 wires, 830 ft total):

| Gauge | Length Needed | Order Qty | Colors | Est Price | Supplier |
|-------|-------------|-----------|--------|-----------|----------|
| 4 AWG TXL | 9 ft | 10 ft | 2 (ORN, ORN/WHT) | $12 | Waytek Wire |
| 8 AWG TXL | 23 ft | 25 ft | 2 (ORN/VIO, ORN/RED) | $15 | Waytek Wire |
| 10 AWG TXL | 23 ft | 25 ft | 2 (ORN, ORN/BLU) | $14 | Waytek Wire |
| 12 AWG TXL | 28 ft | 50 ft | 5 (DK BLU, DK BLU/WHT, ORN/BLK/BLU, ORN/WHT, ORN/BLK) | $18 | Waytek Wire |
| 14 AWG TXL | 124 ft | 200 ft | 12 colors | $28 | Waytek Wire |
| 16 AWG TXL | 21 ft | 25 ft | 3 (LT GRN, LT GRN/WHT, ORN/BLK) | $8 | Waytek Wire |
| 18 AWG TXL | 354 ft | 400 ft | 30 colors | $24 | Waytek Wire |
| 20 AWG TXL | 120 ft | 200 ft | 18 colors | $16 | Waytek Wire |
| 22 AWG TXL | 107 ft | 200 ft | 15 colors | $14 | Waytek Wire |
| 22 AWG Twisted Pair | 4 ft | 10 ft | 1 (WHT/GRN + GRN/WHT) | $5 | Waytek Wire |
| 22 AWG Shielded 2C | 18 ft | 25 ft | 4 runs (CKP, CMP, KS1, KS2) | $18 | Waytek Wire |

**Subtotal: ~$172**

> TXL is the correct automotive wire type (125C rated, thin-wall insulation). Do NOT substitute GPT, GXL, or SXL without checking temperature ratings. TXL is standard for underhood engine harness use.

---

## 11. Loom Material

| Qty | Part Number | Description | Use | Est Price | Supplier |
|-----|-------------|-------------|-----|-----------|----------|
| 20 ft | DR-25 3/4" | Raychem DR-25 heat shrink tubing | Engine loom main trunk | $35 | TE Connectivity / Waytek |
| 10 ft | DR-25 1/2" | Raychem DR-25 heat shrink tubing | Engine loom branches | $20 | TE Connectivity / Waytek |
| 10 ft | DR-25 3/8" | Raychem DR-25 heat shrink tubing | Sensor pigtail extensions | $15 | TE Connectivity / Waytek |
| 30 ft | Split loom 3/4" | Corrugated split loom | Rear loom (frame rail routing) | $12 | Summit Racing |
| 20 ft | Split loom 1/2" | Corrugated split loom | Dash loom, misc runs | $8 | Summit Racing |
| 3x rolls | Tesa 51036 | PET fleece harness tape (19mm x 25m) | All looms -- primary wrapping | $12 ea | Amazon / Waytek |
| 2x rolls | 3M Super 33+ | Vinyl electrical tape | Spot wraps, termination points | $5 ea | Any supply |
| 10 ft | Techflex braided sleeving 1" | Expandable braided sleeve | Visible engine bay runs (clean look) | $15 | Techflex |
| 5x | Adhesive-lined heat shrink, assorted | 3:1 ratio, 1/2" to 1" | Connector boot sealing, splice protection | $8 | Waytek Wire |

**Subtotal: ~$161**

---

## 12. Labels (Heat-Shrink Wire Labels)

| Qty | Part Number | Description | Use | Est Price | Supplier |
|-----|-------------|-------------|-----|-----------|----------|
| 1x pack | Brady BMP21-PLUS labels | Heat-shrink label cartridge (1/2") | Primary wire identification | $45 | Brady / Amazon |
| 1x pack | Brady M21-500-C-342 | Permasleeve heat-shrink labels (1/2" x 7') | 113 wire labels (both ends = 226 labels) | $35 | Brady / Amazon |
| | Alt: Brother HSe-231 | Heat-shrink tube cartridge for P-Touch | Budget option | $25 | Amazon |

**Subtotal: ~$80**

> Every wire MUST be labeled at both ends per the cut list wire numbers (#1 through #113). Labels should show: wire number, circuit name, and destination. Example: "#13 INJ1 M130:A19"

---

## 13. Terminals (Superseal Pins for M130/PDM30)

| Qty | Part Number | Description | Use | Est Price | Supplier |
|-----|-------------|-------------|-----|-----------|----------|
| 40x | TE 1-968857-1 | Superseal 1.5mm pin terminal (16-22 AWG) | M130 Connector A pins (34 + spares) | $0.80 ea | TE / Motec dealer |
| 30x | TE 1-968857-1 | Superseal 1.5mm pin terminal (16-22 AWG) | M130 Connector B pins (26 + spares) | $0.80 ea | TE / Motec dealer |
| 40x | TE 1-968857-1 | Superseal 1.5mm pin terminal (16-22 AWG) | PDM30 Connector A pins (34 + spares) | $0.80 ea | TE / Motec dealer |
| 30x | TE 1-968857-1 | Superseal 1.5mm pin terminal (16-22 AWG) | PDM30 Connector B pins (26 + spares) | $0.80 ea | TE / Motec dealer |
| 140x | TE seal plug | Superseal cavity seal (for unused pins) | Empty cavities on M130/PDM30 connectors | $0.30 ea | TE / Motec dealer |
| 1x | Superseal crimp tool | W-crimper for Superseal 1.5mm terminals | Proper crimps (NOT generic ratchet tool) | $85 | TE / Amazon |

**Subtotal: ~$239**

> CRITICAL: Superseal terminals require the correct W-crimp profile. Using a generic automotive crimper will produce unreliable connections. The TE W-tool or equivalent (Daniels AFM8 with correct positioner) is required. Motec dealers sometimes sell a budget crimp tool specifically for this purpose (~$45-85).

---

## 6L80E Transmission Connector

| Qty | Part Number | Description | Mates To | Est Price | Supplier |
|-----|-------------|-------------|----------|-----------|----------|
| 1x | 19303772 | Kostal LKS 1.5 16-pin harness connector | 6L80E T43 TCM (component side: 15131300) | $45 | GM dealer |

**Subtotal: ~$45**

> If using Holley 558-499 Transmission Control Kit, the T43 connector and wiring are included. Verify before ordering separately.

---

## Order Summary by Supplier

### Motec Dealer / Desert Performance
| Item | Qty | Price |
|------|-----|-------|
| MoTeC #65044 Superseal 34-pin | 2x | $70 |
| Tyco Superseal 26-pin mating | 2x | $60 |
| Superseal 1.5mm pin terminals | 140x | $112 |
| Superseal cavity seals | 140x | $42 |
| Superseal crimp tool | 1x | $85 |
| **Supplier total** | | **~$369** |

### ICT Billet
| Item | Qty | Price |
|------|-----|-------|
| WPCOL40 coil pigtail | 8x | $96 |
| WPINJ40 injector pigtail | 8x | $64 |
| WPCKP40 crank position | 1x | $12 |
| WPCMP30 cam position | 1x | $12 |
| WPKN040 knock sensor | 2x | $20 |
| WPCTS30 coolant temp | 1x | $10 |
| WP0IL40 oil pressure | 1x | $10 |
| **Supplier total** | | **~$224** |

### GM Dealer
| Item | Qty | Price |
|------|-----|-------|
| 13580085 ETB 6-pin connector | 1x | $25 |
| 19303772 T43 TCM 16-pin connector | 1x | $45 |
| **Supplier total** | | **~$70** |

### Waytek Wire (wire, terminals, loom, DTM connectors)
| Item | Qty | Price |
|------|-----|-------|
| TXL wire (all gauges, ~1,145 ft) | assorted | $172 |
| DTM connector pairs (2/3/4/6 pin) | 15x | $104 |
| Ring terminals (assorted) | 17x | $15 |
| Ground straps (12" braided) | 2x | $16 |
| DR-25 heat shrink (3 sizes) | 40 ft | $70 |
| Split loom (2 sizes) | 50 ft | $20 |
| Adhesive heat shrink assorted | 5x | $8 |
| **Supplier total** | | **~$405** |

### Summit Racing / Amazon / General
| Item | Qty | Price |
|------|-----|-------|
| ACDelco PT2293 MAP pigtail | 1x | $12 |
| Tesa 51036 harness tape | 3x | $36 |
| 3M Super 33+ electrical tape | 2x | $10 |
| Techflex braided sleeving | 10 ft | $15 |
| Brady heat-shrink labels | 2x | $80 |
| **Supplier total** | | **~$153** |

---

## Grand Total

| Category | Subtotal |
|----------|----------|
| 1. M130/PDM30 mating connectors | $130 |
| 2. LS3 sensor pigtails | $64 |
| 3. Injector connectors (x8) | $64 |
| 4. Coil connectors (x8) | $96 |
| 5. Throttle body connector | $25 |
| 6. MAP sensor connector | $12 |
| 7. Inline connectors (DTM) | $104 |
| 8. Ring terminals / grounds | $39 |
| 9. Shielded cable connectors | $0 |
| 10. Wire (all gauges) | $172 |
| 11. Loom material | $161 |
| 12. Labels | $80 |
| 13. Terminals (Superseal pins) | $239 |
| 6L80E transmission connector | $45 |
| **TOTAL** | **~$1,231** |

---

## Notes

- **Existing BOM overlap:** The K5_bom.txt already includes $35 for "M130 Connector Kit" and $105 for "DTM Connector Kits" ($140 total). The net new spend beyond what's in the BOM is approximately **~$1,091**.
- **Spares recommended:** Order 2-3 extra ICT pigtails (especially injector and coil), and 20% extra Superseal terminals. Crimping errors happen.
- **Tool requirements:** Superseal W-crimp tool ($85) is a one-time cost but non-negotiable. Deutsch DTM crimps can use a standard ratchet crimper (HDT-48-00 or equivalent, ~$40).
- **Wire colors:** The cut list specifies 89 distinct wire colors. Some exotic stripe combinations (e.g., ORN/BLK/RED, ORN/BLK/BLU) may need to be ordered from specialty automotive wire suppliers like Waytek, Allied Wire & Cable, or Del City.
- **Lead times:** Motec connectors and Superseal terminals may have 1-2 week lead times from dealers. ICT Billet typically ships same-day. Wire from Waytek ships same-day for stock colors.
