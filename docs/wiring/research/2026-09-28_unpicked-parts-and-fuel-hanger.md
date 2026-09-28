# Unpicked parts and the fuel hanger plug (2026-09-28)

Owner, 2026-09-28: "whats your problem with the fuel hanger.... resolve it obviously we dont mind upgrading the plugs."

Every source below is a saved snapshot in `reference_documents/web_snapshots/<host>__<slug>.md`, fetched with
`calc-data/fetch_sources.py`, or a PDF already on file. Product images are in `reference_documents/product_images/`,
with their URLs in `sources.json`. Nothing was bought and no registry or catalog file was edited.

## 1. Fuel hanger (Quantum QFS-H882: FUEL-PUMP, FUEL-LEVEL)

**Stock plug: unknown, so it is replaced.**
- Quantum's H882 page says only that the hanger works "without splicing electrical connectors inside the tank"
  (`www.highflowfuel.com__ls-swap-fuel-pump-hanger-for-1973-1991-blazer-…-qfs-h882-qfs.md`).
- The sibling H880 page says: "Wiring: 14 gauge 'Walbro style' 255LPH/340LPH pigtail included". Those pigtails
  sit in the tank (`www.highflowfuel.com__qfs-squarebody-1973-1987-…-v30.md`).
- Neither page shows the lid's top connector. The eBay listing (`www.ebay.com__163439408565.md`) has ended and has
  no text.

**What we do at the tank top:**
1. **Pass-through: Quantum QFS-BKCN-GM bulkhead connector.** It has four terminals at "up to 14 amps per
   terminal", a Viton O-ring, a stainless retainer clip, and fits "GM/Delphi pump-on-a-stick senders featuring a
   keyed 10mm hole" (`www.highflowfuel.com__qfs-performance-bulkhead-connector-fitting-qfs-bkcn-gm.md`).
   - The four terminals take exactly our four wires: pump +, pump −, sender signal and sender ground.
   - The pump draws 5.1 A at 60 psi. That figure is cited on the FUEL-PUMP endpoint to
     https://www.highflowfuel.com/fuel-pump-oem-replacement-hfp-367-qfs/ by URL only; no snapshot is saved. It is
     well under 14 A per terminal.
2. **Fallback if the lid cannot take the keyed 10 mm hole: QFS-BKCN-01 gland.**
   - It passes "[2] 10 gauge wires … and a 3rd smaller gauge wire" and is sealed top and bottom with "E85/gasoline
     safe PTFE (teflon) washers". It needs a 3/4 in hole (`www.highflowfuel.com__quantum-fuel-cell-electrical-bulkhead-fitting-…-teflon-washers.md`).
   - With the gland, the sender ground goes to a lid screw outside the tank. Dakota allows this: "Connect the FUEL -
     terminal to the fuel level sensor body or a mounting screw" (VHX manual 650314:P p.11).
3. **Above the lid: a short pigtail from the bulkhead to two sealed Deutsch plugs.**
   - **Pump pair (14 AWG): Deutsch DTP 2-way**, size 12 contacts 0460-204-12141 / 0462-203-12141, 14–12 AWG. The
     `dtp` family in `catalog/families.yaml` covers these.
   - **Sender twisted pair: Deutsch DT 2-way**, size 16 contacts 0460-202-16141 / 0462-201-16141, 20–16 AWG, 13 A.
     The `dt` family covers these.
     - #117 is 22 AWG, which is below the DT range. Run the sender pair in 20 AWG, or double #117 over.
     - The registry decides which.
4. **Grounds, from Dakota VHX manual p.11:**
   - The pump is "externally grounded to the vehicle chassis". PUMP_GND already runs to the ground star.
   - FUEL − goes "only direct to the fuel level sensor", never to chassis.
   - Run the sender as "a twisted pair".
5. **Sender range:** the VHX reads GM 0–90 Ω as its "GM 90" setting (manual p.23), plus CUSTOM. Quantum does not
   publish the H882 sender's ohms, so measure it empty and full with the VHX TEST screen (manual p.14, "Display
   sensor ohm reading") before choosing GM 90 or CUSTOM.

**Open items:**
- The part number of the BKCN-GM's top-side mating plug is not on Quantum's page. Read it off the part.
- Whether the H882 lid already has a keyed 10 mm hole: read at the bench.

## 2. Parts picked

| Endpoint | Pick (part number) | Vendor page (snapshot) | Connector / terminal | Current | Why |
|---|---|---|---|---|---|
| FUELP | AEM 30-2131-100, 0–100 psig, 0.5–4.5 V | `documents.aemelectronics.com__ebf9109…` (instructions 10-2131 Rev C), `www.aemelectronics.com__30-2130-100` (stainless twin, 30-2130-100) | "Packard 3-Pin", mating plug and pins included, "Pull to Seat" terminals; 1/8 NPT, 14.7 ft-lbf | 4.5 mA at 5 V | Cited range and plug, 316L wetted parts, 5 V supply matches M130 SEN_5V. Pin letters are in the PDF drawing, not its text: read before crimping. |
| FAN | SPAL 30107090, 16 in drop-in brushless, 2053 CFM, 17 × 17 in | `component_drawings/SPAL_Brushless_Fan_Wiring_Diagram.pdf` (table), `www.kartek.com__spal-30107090-…` | SPAL brushless plug; ProWire kit 30130628 has 2 large terminals for 12 ga, 2 small 20–18 ga for PWM control, 1 seal plug (`www.prowireusa.com__SPAL-BRUSHLESS-FAN-CONNECTOR-KIT-30130628`) | "roughly 25 amp max" (300 W) | One fan (owner T78). The 17 in housing matches the Champion 17 in core height. Brushless "does not pull an inrush". The 500 W 30107101 draws about 42 A. |
| AC-LP-SW | GM 15035084 (ACDelco 15-5720) clutch cycling switch | `parts.chevrolet.com__gm-genuine-parts-air-conditioning-clutch-cycling-switch-15035084` | 2 male pin terminals | signal | GM genuine accumulator-mounted cycling switch. **Fitment to the ordered Bold accumulator's switch port is not shown on the page: confirm the port thread on arrival.** |
| AC-HP-SW | Vintage Air 11079-VUS binary switch (low cut-out 30 psi, high cut-out 406 psi), 3/8-24 male | `www.summitracing.com__vta-11079-vus` | 2-wire switch (plug type not on the page) | signal | Covers high-pressure and loss-of-charge cut-out on the liquid line. The 2026-05-23 A/C lock names a trinary; the owner called the trinary "low value data" (2026-09-27). Needs a 3/8-24 port on the liquid line, from Vintage Air's in-line switch ports; their category page was 404. |
| TCASE-4WD-SW | Torque King QU30048 weather-proof NP205 indicator switch + QU90002 pigtail | `torqueking.com__qu30048-weather-proof-np205c-transfer-case-indicator-switch` | "twin pin type sealed electrical connectors"; hollow thread, 15/16 hex, max 16 lb-ft | signal | Replaces the fabricated bracket switch. It threads in "in place of a front output Poppet Plug", "normally ON switch that is specific to New Process NP205". **The fitment list starts at 1980 Blazer: confirm the poppet port on this 1977 case, and the closed-in-4WD sense with an ohmmeter.** |
| IGN-SWITCH | OER 1990096 (tilt) or 1990084 (non-tilt) | `www.oerparts.com__1990096`, `www.oerparts.com__1990084` | 9 blade terminals (receipts/2026-05-17 ignition research) | signal (PDM inputs) | Authentic GM-pattern repro for the 1977 column. **Tilt or non-tilt is read from the column (photo).** |
| HL-SW | USA1 1973-87 Square Body headlight switch (factory style) | `www.usa1industries.com__1973-87-square-body-chevy-gmc-truck-headlight-switch` | factory blade plug; "connecting directly to your existing wiring harness" | signal (PDM DIG2/DIG3) | Factory fit, knob and shaft; park / head / dash dimmer / dome functions. |
| TG-SW-DASH | Motor City K5 MCK5REARWINDOWSWITCH | `www.motorcityk5.com__i-13220-rear-power-tailgate-window-switch-on-dash-73-91-blazer` | 6 blades, "only top or bottom 3 will be used", loose blade terminals ("will not accept stock harness pigtail") | window motor | "The original 3 terminal switch is no longer available". This is the only current part for the dash location. |
| USB-PORT | Blue Sea 1045 dual USB, 4.8 A total, 9–32 V in, IP45 with cap | `www.bluesea.com__12_24V_DC_Dual_USB_Charger_4.8A_…` | leads (not on the page) | 4.8 A out at 5 V | Conformal-coated, dust cap, 1-1/8 in hole. |
| OUTLET-12V | Blue Sea 1011 dash socket with watertight cap | `www.bluesea.com__Dash_Socket_12V_DC_with_Watertight_Cap` | not on the page | 15 A max | Twist-lock plug, IP45 with cap, same 1-1/8 in hole as the USB. |
| FOOTWELL-LAMPS, UNDERDASH-LAMPS | Lumitec Mini Rail2, 101241 warm white | `www.lumiteclighting.com__mini-rail2-led-utility-light-2` | leads | 360 mA at 12 V, 95 lm | Sealed (the page says IP65), 10–30 V, colour-matched. |
| CARGO-LAMP | Truck-Lite 80251C, 80 Series 10-diode LED dome | `www.truck-lite.com__80251c-1` | "Hardwired, Stripped End" | 2 A | Die-cast aluminium, 1 in deep pocket. The .180 bullet version is 80255C. |
| CHMSL | ORACLE 4514-003 Linear Universal LED 3rd brake module, red, 7 in | `www.oraclelights.com__linear-universal-led-3rd-brake-light-chmsl-module-red` | "Power connector" (type not stated) | 6 W at 12–24 V | IP68 submersible. Truck-Lite 61500R was rejected: it is an amber strobe sold under an FMCSA commercial-vehicle exemption (`www.truck-lite.com__61500r`). |
| CLEARANCE-L/C/R | LMC 36-4481 amber lens + 36-4482 pad + 36-0368 amber LED bulb, harness 36-3770 | `www.lmctruck.com__cc-1973-87-roof-marker-lamp` | 194-type bulb in the LMC harness | LED bulb | Factory-correct 1973-87 roof marker. **LMC lists 5 lamps per truck; the registry has 3 (L/C/R). Registry call.** |
| FIREWALL-GROMMET | Blue Sea 1003 CableClam 1.40 in, max cable 0.56 in (14.22 mm) | `www.bluesea.com__CableClam_1.40in` | one cable per clam, bolted, waterproof | n/a | Serviceable sealed pass-through for the 2 AWG cables (Tefzel 2 AWG is inside 0.56 in). One clam per cable. The page's main use is antenna cable. |
| AMP-BLOCK | Blue Sea 2103 PowerPost Plus, 3/8-16 stud, 150 A, one for + and one for − | `www.bluesea.com__PowerPost_Plus_-_3_8in-16_Stud` | 2 AWG lug in, 4 AWG lug out on the stud (238LTP and a 4 AWG 3/8 lug) | 150 A DC | Lug-on-stud, not set screws. 150 A is at least 60 A. Insulated base. |

## 3. What is still open
- **Six product images were refused (403):** 1990096 and 1990084 (classicindustries CDN), and Blue Sea 1045, 1011,
  1003 and 2103 (Blue Sea CloudFront). The pages are saved; the images are not.
- **The Vintage Air in-line switch-port category page returned 404.** The liquid-line port part number is open.
- **Terminal types not stated on the vendor pages:** the USB and outlet leads, the Oracle power connector, and the
  AC-HP switch plug.
