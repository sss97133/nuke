# The removable fiberglass top: disconnect, solar, lighting, cameras and finish — 1977 K5 (research, 2026-09-30)

- **Ask (owner, 2026-09-29):** "we need a really cool disconnect if we're gonna be running anything on the fiberglass top so
  the cargo lights ... dreamed of doing solar panel install should be crazy and the problem is probably we had to run fat ass
  wires to it ... but we need to actually do like the lighting design and we didn't do that and then how do we finish the roof
  doing insulate it or delete it raw there's a lot of questions on the fiberglass what we do with it and like do we put any
  cameras or anything in it"
- **Change type:** research. Every add-on is written as a CANDIDATE option in `calc-data/catalog/options.yaml` (TOP-DISC,
  TOP-SOLAR, TOP-LIGHT, TOP-LIGHT-SIDE, CANKEY, TOP-CAM, TOP-FINISH). Nothing is decided and nothing was bought or messaged
  outside the agent lanes. The registry, `mounts.yaml`, the map rows and the state file were not edited.
- **Sources:** each web source gives its URL and the fetch date (2026-09-29 unless stated). Saved copies stay out of the
  public repo. Local documents are cited by path and page.
- **Numbers:** gauges, drops and fuse checks follow the canon rules: conductor resistance from ch.16 §1.8, bundled ampacity from
  ch.16 §2.3, fuse ≥ 1.25 × load and ≤ 0.85 × the conductor's rating from ch.17 §17.1.3, and drop ≤ 3 % from ch.16 §2.4.
  Lengths are estimates until tape item T-15 is taped (wiring/geometry, PR #417).

## Short answers

| Question | Answer |
|---|---|
| The disconnect | One round **MIL-DTL-38999 Series III, shell 17, insert 26** (26 × size-20 contacts), the same family as the 61-pin firewall connector. The receptacle has pins and sits on the body at the **lower rear pillar**, where GM put the top's own dome-lamp disconnect. The plug has sockets and hangs on a pigtail from the top. It couples with one turn, the body side gets a cover on a wire rope, and the plug parks in a stowage receptacle on the top. 14 of 26 contacts are used and 12 are spare. |
| Solar size | **One rigid 235 W, 72-cell panel on a low rack** (Victron SPM042357203, 1350 × 880 mm) and a **Victron SmartSolar MPPT 75/15** beside the YellowTop. The MPPT charges alongside the Orion; nothing replaces the Orion. Expect about 1.05 kWh a day as a year average (78 Ah) and 37 Ah a day in December. |
| The "fat wires" | **16 AWG.** A series string keeps the current at the panel's 6 A, so the whole solar run is 16 AWG. The only heavy wire is a 3 ft pair of 10 AWG from the MPPT to the battery. |
| Lighting | The CHMSL goes outside on the top's rear header. The cargo lamp goes on the top's ceiling. Two Baja S1 work/scene lamps go in the rear header corners on PDM30 OUT21, which **conflicts with the power-lock candidate PL** (§3.2). Side scene lamps are optional and need a cab-side output that doesn't exist yet. The dome lamp and clearance lamps go on the steel half-cab roof, so they never cross the disconnect. The switches are a MoTeC CAN keypad, which uses no PDM inputs. |
| Camera | One **rear high-mount camera** on the top's header (EchoMaster PHD5N1, flush, CVBS, mirrored image). It feeds input 1 of options-rd's VS41 switcher, whose output goes to the mirror's CH2. A forward camera on the top could not see the hood. |
| Finish | **Butyl on the flat panels, a closed-cell thermal layer, and removable headliner panels**, with the top harness in the moulded rib channels behind them. The "insulation COMPLETE" row does **not** cover the top: no photo shows insulation on the top or the cab roof. |

## 0. What the top is (the facts everything below rests on)

- **It is a rear top, not a full roof.** The 1977 manual clamps the top "against the steel cab" and bolts it to the body sides and
  to "the top-to-header panel attaching brackets". Removal lowers the tailgate glass and the door glass, then slides the top
  "rearward approximately 18"" (1977 Light Truck Service Manual, `reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf`
  PDF p.155; the contents on p.130 list the section at 2D-29). So the front seats sit under a **steel half-cab roof**, and only the
  rear seat and cargo area sit under the fiberglass.
- **Photos (photos lane, 2026-09-29, `vehicle_images` on e08bf694):**
  - The top's underside is bare cream moulded fiberglass with moulded stiffening ribs, and there is a small courtesy lamp above the
    quarter window (images c086b5f9, e4432a6e; 2021-06-12).
  - The outside is white, with two-pane sliding quarter windows and the tailgate glass. There is no rack, roof lamp or extra hole
    (33ebfbdd, 00dbacd8, 7912b58d).
  - The half-cab roof is bare painted steel with a dome-lamp wire at its centre (61df4ea0 2024-10-12, 029da4ae, d2c5f364 2024-12-12).
  - The top has been off in every photo since 2025-09-20.
- **GM's own lamp in the top.**
  - The 1977 bulb chart lists "Dome Lamps ... Utility & Suburban 1 × 211-2, 12 CP" (1977 LTSM PDF p.838).
  - The 1978 C-K wiring booklet feeds "DOME LAMPS-BLAZER RPO CB8 & SUBURBAN" through a 2-way connector 8905978/8905979 marked
    "BLAZER RPO-CB8" on circuits 156 (white) and 140 (orange) (`reference_documents/wiring_diagram_booklets/pages/1978_CK_A1_cab_engine_chassis_main.png`,
    lower right).
  - The 1987 manual's top removal starts with "Access plate (108) and dome lamp wiring harness". Figure 17 puts that plate at the
    foot of the top's rear pillar, at the corner of the tailgate opening (1987 Light Duty Truck Service Manual PDF p.1363, 10A5-12;
    Fig. 18 on p.1364 shows the rear guide pins).
  - What RPO CB8 meant in 1978 is unknown. The later GM RPO list uses CB8 for a different roof (GM_RPO_Master_List.pdf p.69).
- **Dimensions** (geometry-scan, `calc-data/cad/dimensions.yaml`, PR #417):
  - fr88.body.bpillar.C-D: 1416 mm across the upper rear corners of the door openings. This is the width where the top meets the cab.
  - fr88.body.tailgate.top-A-B: 1657 mm ±8 mm across the tailgate opening's upper corners.
  - gm77.body.top.lower-holes-width: 63 in, low confidence.
  - The twin's mesh gives 1881 × 1855 mm overall, but that is the model only.
  - The flat roof area, crown, rib spacing, pillar section and the top's own weight are **unknown** (T-15).
- **Trait table gap.** `objectTraits.ts` has `Exterior_Roof` as thin sheet metal with a headliner channel, which is the steel
  roof. It has **no entry for the fiberglass top**. The wiring rule makes that a routing blocker, so a trait entry is proposed in §5.

## 1. The disconnect (TOP-DISC)

### 1.1 What it has to do

- **Owner's requirements:** round; sealed and vehicle-grade; quick to separate; rated for the solar current and the signal wires.
  The owner also allows other connectors only if they are round (receipt `2026-09-29_owner-calls-one-61pin-at-fusebox-hole.md`).
- **Loads it carries:**
  - solar 6.02 A on each pole (§2)
  - lamp feeds of 0.5, 2.0, 2.9 and 2.4 A, and a lamp return of up to 7.8 A (§3)
  - one camera feed with power, ground, video and braid (§4)
  - nav-comms puts its dish and antennas on the steel roof, so nothing of theirs crosses (nav-comms, 2026-09-29).
- **Canon rules that apply:**
  - crimp, don't solder (ch.16 §5.1)
  - parallel legs must be equal in length and termination (ch.16 §3.3)
  - the connector is deferred until the harness is mocked up (ch.18 §6), so the insert and cavity letters wait for the mock-up

### 1.2 Where it sits

| Spot | For | Against | Verdict |
|---|---|---|---|
| **Lower rear pillar, at the corner of the tailgate opening** | GM's own spot for the top's harness (1987 LDTSM Fig. 17). It is next to the rear loom, GND-SPLICE-REAR and the candidate round rear connector (mounts.yaml REAR-CONN: rear floor, driver side). The top's lamps, camera and panel feed are at the rear, so the top harness stays about 5 ft long. You reach it by lowering the tailgate, as in the 1987 step. | Rain and dust get in with the tailgate down or the top off; IP67 and the cover deal with that. The pigtail needs slack for the top's 18 in slide. | **Recommended.** Put it on the same side as REAR-CONN (driver side as drawn today). It follows that call. |
| Top-to-cab joint at the half-cab's rear edge | Close to the PDM30 in the cab. | The joint is a weatherstrip seal, so a connector breaks the seal. The top harness would have to run the full length of the top to reach the rear lamps. | Not recommended. |
| Tailgate header (the top's rear edge) | Right beside the CHMSL, camera and work lamps. | There is no body there; it is the tailgate opening. A connector there joins top to top, not top to body. | Not a disconnect spot. |

### 1.3 Connector families

| Family | Contacts and rating | Seal and coupling | Tooling | Cost (DigiKey, 2026-09-29) | Verdict |
|---|---|---|---|---|---|
| **MIL-DTL-38999 Series III, shell 17 insert 26** (D38999/20WE26PN receptacle + D38999/26WE26SN plug) | 26 × #20. A #20 contact carries 7.5 A with 20 AWG ("test ratings only"). The contact grommet seals on a 1.02–2.11 mm jacket. Service rating I, 850 V DC (MILNEC TX catalog Rev. 2235 pp.B-9, B-19). | IP67. "Mating is achieved with a single 360° turn of the ratchet coupling ring ... without the need for tools" (p.A-14). Covers with a wire rope and a stowage receptacle are both catalogued (pp.B-51, B-52). | The 61-pin's contacts (M39029/58-363 pins, /56-351 sockets) with AFM8 + K43 crimping and M81969/14-10 insertion (catalog/parts.yaml, tools.yaml). **No new tools.** | Amphenol receptacle $81.56 and plug $80.84 (Corsair $75.86 / $86.32; Milnec $513.22 / $385.82). Whether contacts are included isn't stated. | **Recommended.** It matches the firewall 61-pin, is milspec/aerospace (the owner's stated preference) and needs no new tooling. |
| Deutsch HD30, HD34-24-21PN + HD36-24-21SN | 17 × size 16 + 4 × size 12. The DT family rates those sizes at 13 A and 25 A (DT/DTM/DTP catalog, `component_drawings/DEUTSCH_DT_DTM_DTP_Catalog.pdf` p.1); HD30's own ratings weren't fetched. | IP67, bayonet lock with coupling nut, aluminium, −55 to +125 °C (DigiKey attributes for HD36-24-21SN). | HDT-48-00, the crimper for the DT plugs already planned at every lamp (tools.yaml). | Plug $26.10. | Good value alternative. It's a heavy-truck look, has fewer contacts, and the dust-cap part number wasn't checked. |
| MC4 pair for solar + a small round signal connector | The panel's own 900 mm MC4 leads (Victron datasheet) carry the PV. The lamps and camera go on a D38999 shell 13 or an HD10. | MC4 ratings weren't fetched. | Two tool families. | — | Not picked. It means three things to unplug, not one. |
| Hybrid D38999 insert with #16 contacts (15-97 = 8 × #20 + 4 × #16; 19-28 = 26 × #20 + 2 × #16, MILNEC p.B-19) | #16 carries 13 A with 16 AWG (p.B-9). | Same as above. | #16 needs tooling the build hasn't listed. catalog/tools.yaml has AFM8 + K43 for #20 only; MILNEC's own #16 tooling is TK101A with the TP104 turret. | — | Not needed. Two paralleled #20 contacts do the same job with tools already on the list. |
| Anderson SB power connector + a signal circular | — | — | — | — | Off the owner's rule: the SB is rectangular. |

### 1.4 Contact plan (counts, not letters; the letters wait for the mock-up)

| Function | Cavities | Current | Notes |
|---|---|---|---|
| PV+ | 2 (paralleled) | 6.02 A, about 3 A each | Two 20 AWG tails from a 16 AWG run, spliced with M81824/1-2 in the backshell. |
| PV− | 2 (paralleled) | 6.02 A | Same as PV+. PV− is never tied to a ground bank (Victron manual §4.4). |
| CHMSL (#93) | 1 | 0.5 A | The base wire gets a break here. |
| Cargo lamp (#74) | 1 | 2.0 A | The base wire gets a break here. |
| Work/scene lamps | 1 | 2.9 A | PDM30 OUT21, set at 4 A. One contact is rated 6.4 A at 85 %. |
| Side scene lamps | 1 | 2.4 A | Only with TOP-LIGHT-SIDE. |
| Lamp return | 2 (paralleled) | up to 7.8 A | Goes to GND-SPLICE-REAR through 16 AWG. |
| Camera: +12 V, ground, video, braid | 4 | about 0.3 A | The camera ground returns to GND-BANK-CAB, not to the rear bus (§4). |
| **Used / spare** | **14 / 12** | | Four of the spares are held for a top-mounted Starlink DC pair if the dish ever moves to the top. Empty cavities get MS27488-20-2 seal plugs (catalog d38999_20 family). |

- **Gender:** the body receptacle has pins, recessed in the scoop-proof shell (MILNEC p.A-14). The top plug has sockets, because the
  solar contacts are live whenever the sun is on the panel. This is shop practice, not a cited rule, and it's the builder's call.
- **Current:** the connector's heaviest total is about 14 A spread over 14 contacts. MILNEC warns that "a connector cannot
  withstand maximum current through all contacts continuously", but this total is nowhere near that.
- **Never unplug under PV load.** MILNEC publishes no current-breaking rating, so open the PV breaker at the MPPT first (§2.6).

### 1.5 Strain relief, boots and stowage

- **Body receptacle:**
  - MILNEC TX00W17-26PN-K2-02, which is D38999/20WE26PN with a boot adapter and straight shrink boot (K2, p.B-49) and a protective
    cover with mounting gasket (02).
  - Shell-17 flange 1.323 in (33.6 mm) square; mounting holes 1.062 in (27.0 mm) apart; front-mount cutout 1.016 in (25.8 mm);
    rear panel at most 0.234 in (5.9 mm) (p.B-24).
  - It mounts on a small plate on the body's inner panel at the pillar foot, like the 61-pin's CNC plate (harness-cad, #412).
- **Top plug:**
  - MILNEC TX06W17-26SN-K2, which is D38999/26WE26SN with a boot. Its OD is 1.406 in (35.7 mm) and its length 1.234 in (31.3 mm) (p.B-23).
  - The TXAB-17 boot adapter gives 0.750 in (19.1 mm) of cable clearance (p.B-49), enough for the roughly 10 mm top bundle.
  - Bond the boot with the RT125 epoxy the 61-pin already uses (catalog/parts.yaml).
- **Pigtail:**
  - About 12 in of service loop, clamped to the top's pillar at least every 18 in (ABYC E-11, via
    `research/2026-06-10_power_spine_builders_study.md` §1.3).
  - Use cushioned clamps or bonded mounts, never a bare edge.
- **When the top is off:**
  - The receptacle's cover goes on; it hangs on a wire rope.
  - The plug parks in a **TXCD-17W-02 stowage receptacle** (p.B-52: "Stowage or 'dummy' receptacles ... protecting and sealing
    plugs when not in use") mounted on the top's inner pillar.
  - The whole top harness (lamps, panel lead, camera) stays with the top.
- **Removal order:**
  1. Open the PV breaker.
  2. Uncouple the plug (one turn).
  3. Park the plug and cap the receptacle.
  4. Then follow GM's steps (1977 LTSM PDF p.155).

## 2. Solar (TOP-SOLAR)

### 2.1 What fits

The flat roof area is unknown. The table checks each option against the 1416 mm width at the cab joint (the narrowest published
width) and the model's 1881 mm length (model only).

| Option | Size and mass | Electrical at STC | Fit | Heat (§2.2) |
|---|---|---|---|---|
| **A. 1 × Victron BlueSolar SPM042357203, rigid, 72 cells** | 1350 × 880 × 30 mm; 12.48 kg; 900 mm MC4 leads | 235 W; Vmp 41.4 V, Imp 5.68 A; Voc 49.6 V, Isc 6.02 A; max series fuse 10 A; Voc −0.35 %/°C, Pmpp −0.45 %/°C; −40 to +85 °C | 880 mm across, 1350 mm along: **likely fits** | On a rack about 74 °C: inside the 85 °C rating |
| B. 2 × Solbian SP 32 flexible (Maxeon cells), in series | 1109 × 546 × 2 mm each; 1.5 kg each | 110 W each; Vmp 19.6 V, Imp 5.6 A; Voc 23.3 V, Isc 6.0 A; Voc −0.28 %/°C, Pmax −0.35 %/°C; −40 to +85 °C; max reverse current 12 A | 1092 mm across, 1109 mm along: fits | Bonded flat about 105 °C: **over the 85 °C rating** |
| B+. 2 × Solbian SP 44, in series | 1490 × 546 × 2 mm each; 2.0 kg each | 150 W each; Vmp 26.8 V; Voc 32.0 V; Isc 6.0 A | Needs 1.5 m of flat run: unknown | As B |
| C. 2 × Renogy RNG-100DB-H flexible, in series | 1219 × 546 × 2 mm each; 1.9 kg each; $149.99 each | 100 W each; Vmp 18.9 V, Imp 5.29 A; Voc 22.5 V, Isc 5.75 A; max series fuse 15 A; 36 cells; temperature coefficients not published | 1092 mm across, 1219 mm along: fits | As B. Renogy also says "Modules must be mounted using silicone structural adhesive ... grommets are only to be used for non-mobile applications" |

Sources:
- A: Victron "BlueSolar Monocrystalline Panels – Current models" datasheet
  (https://www.victronenergy.com/upload/documents/Datasheet-BlueSolar-Monocrystalline-Panels-current-models-EN.pdf).
- B and B+: Solbian SP series datasheet (https://www.solbian.eu/wp-content/uploads/2026/03/ENG_SP_datasheet.pdf).
- C: renogy.com product data for RNG-100DB-H-US.

Two rigid 130 W panels (1020 × 668 mm each) don't fit well. Side by side they need 1336 mm against the 1416 mm cab width, and
end to end they need 2040 mm.

### 2.2 Heat decides the mount (Las Vegas)

- **The model:** Sandia (King et al. 2004, SAND2004-3535), as published in the pvlib documentation
  (https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.temperature.sapm_module.html). Module temperature =
  E·exp(a + b·WS) + Tambient.
- **The inputs:**
  - irradiance 1000 W/m²
  - wind 1 m/s (parked)
  - ambient 47.6 °C, the July maximum in NASA POWER's 2001–2020 climatology for Las Vegas
    (https://power.larc.nasa.gov/api/temporal/climatology/point, parameters T2M_MAX / T2M_MIN / ALLSKY_SFC_SW_DWN, 36.17 N 115.14 W)
- **Results:**
  - Bonded flat to the fiberglass (the insulated-back case, a = −2.81, b = −0.0455): **105 °C** (100 °C at 3 m/s; 93 °C even at 35 °C ambient).
  - Close mount (glass/glass, a = −2.98, b = −0.0471): 96 °C.
  - Open rack (glass/polymer, a = −3.56, b = −0.075): **74 °C** (77 °C cell).
- **What it means:** both flexible options are rated −40 to +85 °C (Solbian and Renogy pages). Bonded to the top, they would run
  hotter than their rating on every summer afternoon.
  - Flexible panels on a ventilated standoff plate fall between the close-mount and open-rack cases. That setup isn't modelled,
    and it is marginal.
  - The model classes are glass-fronted; the flexible panels' fronts are polymer. So the numbers are an estimate of the class, not
    a measurement.
- **Recommendation:** option A, a rigid panel on a low rack. The rack, its attachment to the moulded ribs and the extra 12.48 kg
  on a top that people lift are open. They need T-15 and the top's weight.

### 2.3 Charge controller, and whether it shares or replaces the Orion

| Option | What it is | PV input | Effect on the Orion and the wires | Verdict |
|---|---|---|---|---|
| **M1. Victron SmartSolar MPPT 75/15 + keep the Orion-Tr 12/12-30** | 15 A; 220 W nominal on 12 V; 98 % peak; terminals 6 mm²/AWG10; IP43 electronics and IP22 connection area; 100 × 113 × 50 mm; 0.6 kg | 75 V max Voc; 15 A max Isc | Both units charge the YellowTop side by side, each regulating on battery voltage. Set the same AGM (YellowTop) settings in both. They can't be networked: the VE.Smart manual lists the Orion-Tr Smart as "No — Not yet supported". That table row names the isolated Orion; the non-isolated 12/12-30 isn't listed at all. | **Recommended.** Victron's own manual recommends "72 [cells] (2x 12V panel in series or 1x 24V panel)" for a 12 V battery on a 75 V controller (§4.3). |
| M2. SmartSolar MPPT 100/20 + keep the Orion | 20 A; 290 W nominal on 12 V; 100 × 131 × 60 mm; 0.65 kg | 100 V max | Same as M1. The fuse becomes 25–30 A (§4.2), still on 10 AWG with a 25 A fuse. | Use it for option B+ (Voc 69.5 V at the site's coldest is too close to 75 V). |
| M3. Replace the Orion with a combined DC-DC + MPPT, Renogy DCC50S | 50 A; $186.99; 9.6 × 5.7 × 3.0 in; 3.13 lb; "Max. Solar Input Voltage 25V" | 25 V max | Only one 12 V-class panel, or panels in parallel, fit under 25 V. Parallel doubles the current to 11.5 A, which needs 10 AWG and 4 × #20 per pole through the disconnect. Its 50 A output also re-sizes the Orion's cables. | **This is the "fat wire" design.** Not picked. |

Sources:
- M1: SmartSolar MPPT 75/10–100/20 datasheet
  (https://www.victronenergy.com/upload/documents/Datasheet-SmartSolar-charge-controller-MPPT-75-10,-75-15,-100-15,-100-20-EN.pdf)
  and manual Rev 10 02/2026
  (https://www.victronenergy.com/upload/documents/Manual_SmartSolar_MPPT_75-10_up_to_100-20/29694-MPPT_solar_charger_manual-pdf-en.pdf).
- M1 networking: VE.Smart Networking manual Rev 05 02/2024 p.4
  (https://www.victronenergy.com/upload/documents/VE.Smart_Networking/20723-VE_Smart_Networking-pdf-en.pdf).
- M3: renogy.com product data.

**A 235 W panel on a 220 W controller.** The datasheet's note 1a says "If more PV power is connected, the controller will limit
input power". On the rack at 74 °C, the panel's Pmpp coefficient (−0.45 %/°C) puts it at about 183 W (235 × (1 − 0.0045 × 49)), so
the 75/15 clips only on cool, bright days. The 100/20 (290 W) removes the clipping and costs a 25 A fuse instead of 20 A.

**Where the MPPT sits** (Victron §4.1): "within 3 meters from the battery, but never directly above the battery", vertical, with
the terminals down. It must also be dry: IP22 at the connection area, "never operate it in a wet environment" (§1.1), and "not
allowed to be mounted in a user accessible area", which calls for an enclosure or the MPPT WireBox (§1.1, §3.13, §4). It follows
the open YellowTop decision (mounts.yaml BATTERIES, asked 2026-09-29):
- **YellowTop in the bed:** the MPPT and the Orion both sit beside it. This is the short-wire case, and it also shortens the
  amplifier's 18.4 ft loop (CABLE_SIZING.md notes).
- **YellowTop in the engine bay:** the MPPT goes cab side like the Orion (mounts.yaml DCDC). Its 10 AWG battery pair then takes
  two Blue Sea 1003 CableClams.

### 2.4 Cable gauge (the "fat wires" number)

| Segment | Current | Gauge | Check |
|---|---|---|---|
| PV run, roof to MPPT, MPPT in the bed (about 8.5 ft each way) | 5.68 A Imp, 6.02 A Isc | **16 AWG M22759/32** | 0.46 V = 1.1 % of Vmp. Needs 10 A / 0.85 = 11.8 A of cable; 16 AWG bundled is 12.5 A. |
| PV run, MPPT cab side (about 17.5 ft each way) | same | **16 AWG** | 0.96 V = 2.3 %. 18 AWG would drop 3.0 % and fail the fuse check (10 A bundled). |
| Through TOP-DISC | same | 2 × 20 AWG tails into 2 × #20 per pole | About 3 A per contact. 10 A fuse ≤ 0.85 × 15 A. |
| MPPT to battery, 75/15 | 15 A | **10 AWG M22759/16**, 3 ft | 20 A fuse needs 23.5 A: 10 AWG bundled 30 A passes and 12 AWG (20 A) fails. The terminal takes AWG10 at most. 0.06 V. |
| Parallel alternative (M3), cab case | 10.6 A Imp | 10 AWG | 12 AWG drops 4.0 % and fails. 4 × #20 per pole. |

- **Strands:** Victron allows strands up to AWG26 (0.125 mm²) in its terminals (manual §1.2). M22759 10 AWG is 37/26, exactly at
  that limit; 16 AWG is 19/29 (ch.16 §1.8).
- **Cold Voc:** the site's coldest in NASA POWER's climatology is −5.8 °C, which gives Voc 54.9 V for option A, 50.6 V for B,
  69.5 V for B+ and 49.8 V for C. Renogy publishes no coefficient, so C uses Victron's −0.35 %/°C as a stand-in.
- **Energy:** a flat roof sees NASA POWER horizontal irradiance of 5.61 kWh/m²/day as a year average, 2.66 in December and 8.52 in
  June. With an **assumed** derate of 0.8 (temperature −10 %, controller and wiring −4 %, soil and mismatch −6 %; not measured),
  235 W gives 1.05 kWh/day (78 Ah at 13.5 V) on average, 0.50 kWh (37 Ah) in December and 1.60 kWh (119 Ah) in June.
  - The YellowTop's model is open. A D34/78 is 55 Ah (batterysales.com listing for Optima 8014-045), so the average day refills
    more than one whole battery.

### 2.5 Fusing at both ends

- **Battery end:** a 20 A fuse within 7 in of the YellowTop positive. Victron's range for the 75/15 is 20–25 A ("This is also the
  case even if the solar charger has already been equipped with an external fuse", §4.2), and the 7 in comes from ABYC E-11
  §11.10.1.1.1 (ch.17 §17.2).
  - A MIDI's smallest size is 30 A (cable_sizing_v5.py list), which is over Victron's 25 A maximum. So this is a blade or MAXI fuse
    in a sealed holder that takes 10 AWG. The holder part number is open.
- **PV end, at the MPPT input:**
  - **A 10 A fuse on PV+.** It is at least 1.25 × 1.25 × Isc (9.4 A), at most 0.85 × 16 AWG's 12.5 A, and equal to the panel's
    10 A maximum series fuse.
  - **A 2-pole DC breaker as the disconnect.** Victron §4.3 says "Provide a means to disconnect all current-carrying conductors of
    a photo-voltaic power source".
  - Why a fuse here and not at the panel: with one string, the panel can only push its own Isc. The only thing that can overload the
    16 AWG is the battery back-feeding through a failed MPPT, and the 20 A battery fuse is bigger than the 16 AWG's rating. This
    follows the canon's "protect the wire" rule (ch.17 §17.1).
  - The breaker needs a DC rating above the 57.4 V Voc at −20 °C. Its part number is open.
- **Grounding:** "The positive and negative of the PV array should not be grounded" and "Only one ground connection is allowed, and
  this should be near the battery" (§4.4). So PV− is its own insulated wire to the MPPT's PV− terminal, and MPPT BAT− goes to the
  YellowTop's negative, never to GND-SPLICE-REAR.

### 2.6 How the solar crosses the disconnect

- **Roof:** the panel's MC4 leads go through a sealed roof gland near the rear edge (part number open). Inside, M81824/1-3 step
  splices take them to 16 AWG Tefzel. That is the 16–12 AWG splice the PDM pigtails use (state row 0ac); the panel lead's gauge
  isn't on the datasheet, so confirm the fit at the bench. The panel's own leads stop at the gland; everything after it is Tefzel.
- **Down the pillar:** 16 AWG to the plug backshell, then two 20 AWG tails per pole into the plug's socket cavities, kept adjacent
  and away from the video pair.
- **Body side:** the tails join back into 16 AWG, then run to the PV fuse and breaker, then the MPPT.
- **Rule for the owner:** open the PV breaker before unplugging the top.

## 3. Lighting design (TOP-LIGHT, TOP-LIGHT-SIDE, CANKEY)

### 3.1 The plan

| Lamp | Where | Fixture | Light | Current | Size | Seal | PDM | Switch | Crosses TOP-DISC |
|---|---|---|---|---|---|---|---|---|---|
| CHMSL | Outside, top's rear header, centred above the tailgate glass | ORACLE 4514-003 (7 in linear module, red) | not published | 0.5 A (6 W; the same page also says 0.15 A) | 7 in long | IP68 | PDM30 OUT5 (existing #93) | brake (DIG14) | yes |
| Cargo | Top's ceiling, centred over the cargo floor, between the ribs | Truck-Lite 80251C (10 × 1 W LED) | not published | 2 A | 18.19 × 5.75 × 1.08 in overall with bracket; "will mount in 1'' deep pocket" | sealed | PDM30 OUT25 (existing #74) | door jambs DIG12/13 + a keypad button | yes |
| Work / scene, rear ×2 | Flush in the rear header corners, aimed back and down | Baja Designs S1 flush, work/scene lens | the reseller lists 2,375 lm for the spot lens; the work/scene lens figure isn't confirmed | 1.45 A each (20 W) | 2.1 in cube; 0.4 lb | IP69K; MIL-STD-810G; IK10 | **PDM30 OUT21 (B1), set at 4 A** | keypad (reverse too, if the owner wants) | yes |
| Side scene ×2 (optional) | Above the quarter windows on the top's sides | Truck-Lite 81335C (3 × 9 in perimeter light) | 1000 lm | 1.2 A each | 63.5 × 226 × 43 mm; 1.35 lb | not on the page | **its own 8 A output on a cab-side PDM that doesn't exist yet** (proposal, §3.2); not buildable as the registry stands | keypad | yes |
| Dome | Steel half-cab roof, centre (existing wire, image 029da4ae) | factory dome, 211-2 festoon or an LED | 12 CP, about 151 lm (1977 LTSM p.838; 12 × 4π) | 0.97 A (registry) | factory | — | PDM30 OUT25 | door jambs | no |
| Clearance L/C/R | Steel half-cab roof front edge, the C/K roof-marker spots | LMC 36-4483 set (36-4481 amber lens, 36-0368 LED bulb, harness 36-3770); LMC lists 5 per truck, the registry has 3 | — | ≤ 0.27 A each (the registry's 194 figure) | factory | — | PDM30 OUT19 (existing) | park | no |

Sources:
- CHMSL: https://www.oraclelights.com/products/linear-universal-led-3rd-brake-light-chmsl-module-red (2026-09-28).
- Cargo: https://www.truck-lite.com/80251c-1.html (2026-09-28). The listing's title says "2"x13"" but its dimension table gives 18.19 × 5.75 in, so check the part in hand.
- Rear work/scene: Summit Racing and Northridge4x4 listings for 381001. Baja's own page refused the fetch.
- Side scene: https://www.truck-lite.com/81335c.html.
- Clearance: https://www.lmctruck.com/lighting/cab-roof/cc-1973-87-roof-marker-lamp (2026-09-28). LMC lists "Chevy GMC 73-87", so fit on the K5 half-cab is to be confirmed.

- **Lamp ends:** every lamp ends in a sealed Deutsch DT plug, sockets on the harness side (`research/2026-09-28_lamp-sockets-led-sealed.md`).
- **Retired:** the factory courtesy lamp in the top above the quarter window (image e4432a6e).
- **CHMSL position:** the tailgate glass drops into the tailgate (the LMC tailgate page lists the tailgate window seals 38-6971/38-6972),
  so a lamp on the tailgate top would block it. The top's header is the spot mounts.yaml already offers ("rear edge of the top").

### 3.2 Wire sizes and output settings (TOP-LIGHT adds)

| Circuit | Load | Run | Feed drop | Output setting |
|---|---|---|---|---|
| Work lamps | 2.9 A | 20 AWG pin lead (1 ft), 16 AWG body (13 ft), 20 AWG tail + top (6 ft) | 0.38 V (2.7 %). All-20 AWG drops 0.56 V (4.0 %) and fails. | 4 A. The pin lead allows 6.8 A (MoTeC PDM manual printed p.48: 20 AWG = 8 A at 80 °C) and one #20 contact 6.4 A at 85 %. |
| Side lamps | 2.4 A | same pattern | 0.33 V (2.3 %) | 3 A on its own output. Sharing OUT21 would need 7 A, over the 6.8 A pin lead, so it fails. |
| Cargo #74 | 2.0 A | 20 AWG, 19 ft | 0.38 V (2.7 %) | unchanged. OUT25 stays at 4.73 A. Adding the options-rd puddle lamps is their open limit. |
| CHMSL #93 | 0.5 A | 20 AWG | 0.09 V | unchanged |
| Lamp return | 5.4–7.8 A | 20 AWG lamp grounds, then SPL-TOP-RTN, then 2 × #20, then 16 AWG (4 ft) to GND-SPLICE-REAR | 0.15 V | — |

- **Why the 16 AWG body run:** 8 A output pins take 24–20 AWG (PDM manual p.48) and #20 contacts take 20–24 AWG (MILNEC p.B-9).
  So the run steps up to 16 AWG between M81824/1-2 splices, the same pigtail method as the 20 A outputs (state row 0ac).
- **PDM capacity: a conflict.** No PDM30 output is free of a claim. The options_v5 ledger on main counts base and decided loads
  only:
  - the 20 A outputs are 6 of 8 used, and the spare OUT3 and OUT4 are named by PW;
  - the 8 A outputs are 21 of 22 used, and the spare OUT21 is named by PL.

  TOP-LIGHT takes OUT21 and says so: it lists `conflicts_with: [PL]` plus a CONFLICT line in its `limits`.
  - PL can't stay on OUT21 anyway. It needs 12 A, and an 8 A output's setting caps at 10 A (PDM manual p.24; the options_v5
    setting conflict).
  - Moving PL to a 20 A output puts it against PW.
  - Building all three together needs one more body-side output. That means a second body PDM, which fits the owner's "run multiple
    pdm" direction (state §1 row 54, 'Owner scope calls' 2026-09-24). It's a proposal.
- **TOP-LIGHT-SIDE is not buildable as the registry stands.**
  - Its second output would have to come from a cab-side PDM that doesn't exist.
  - The PDM15 is the engine-bay box in the registry (PDM15-A/B). Moving it to the cab is only an option in mounts.yaml, and the
    sealed-PDM32 idea (state row 0ah) keeps it in the bay.
  - Feeding the top from the engine bay would cross the firewall, where only the 61-pin goes.
- **Verdict:** with TOP-LIGHT and TOP-LIGHT-SIDE added, the candidates would take 7 PDM30 outputs against 3 spare (options_v5,
  2026-09-29). They didn't fit before either (5 against 3).

### 3.3 Switching: a CAN keypad (CANKEY)

- **Inputs are the constraint.** The PDM30's inputs are 14 of 16 used, and the two spares (DIG8, DIG16) are already wanted by AS
  and LO4 (capacity ledger).
- **What MoTeC's keypad does:** "Up to four MoTeC CAN Keypads can be configured to work with the PDM". Each button's three LEDs are
  driven by PDM channels (MoTeC PDM manual PN 63029 pp.19, 29). The keypad "continuously communicate[s] with the PDM, preventing the
  PDM from entering its low power standby mode" unless it is powered from a switched output (p.13).
- **Wiring:** power from OUT29 (the ignition group), ground to GND-BANK-CAB, and a CAN-H/L stub of 500 mm or less off the trunk.
  That's four wires.
- **Cost:** 8-button $574.00, 15-button $589.00, IP67, "only 4 wires required" (John Reed Racing listing,
  https://johnreedracing.com/products/motec-15-position-can-keypad).
- **Buttons for the top:** work lamps, side lamps, cargo on, and a top-lamps-off. The rest are free for AS, LO4 or others.
- **The cheap path:** one dash switch on DIG16, and then AS or LO4 loses its input.

## 4. Cameras on the top (TOP-CAM)

- **Screen and path (agreed with options-rd, 2026-09-29):**
  - The decided mirror monitor has "Video Input 2 Channel", CVBS "1Vp-p, 75 Ω", 9–32 V and 8 W. Its box includes a "Power Harness
    with Two Camera Inputs" (https://www.rearviewsafety.com/license-plate-backup-camera-system-rvs-7180355-ir.html, 2026-09-28).
  - CH1 is the plate camera on reverse. options-rd's MIRD candidate, a PAC VS41 4-camera switcher, feeds CH2.
  - **The top camera goes on VS41 input 1, the default view.** Without MIRD it would compete with the front camera (FC) for CH2,
    which is the owner's call.
- **Which camera:**

| Option | What | For | Against |
|---|---|---|---|
| **C1. EchoMaster PHD5N1, flush housing, rear header centre** | $159.00; AHD 720p or CVBS 480p selectable (set CVBS); 170°; IP67; mirrored image selectable; five housings including flush; 5-pin plug + 20 ft extension (https://catalog.echomaster.com/catalog/ahd-cameras/phd5n1) | Same maker as options-rd's mirror cameras. The mirrored image makes a real driving rear view above the cargo. It sits flush in the header beside the CHMSL. | Current and size aren't published; carried as ≤ 0.3 A until measured. |
| C2. Rear View Safety RVS-770613-class commercial camera | IP69K, "20G vibration rating, and a 100G shock rating", 130°, 18 IR LEDs, 12 V, 3.25 × 3 × 1 in with bracket (https://www.rearviewsafety.com/backup-camera-system-rvs-770613-nm.html; being replaced by KT-770M137D) | The toughest option; same brand as the mirror. | Bracket-mounted, not flush. Sold as a system; the plug and current weren't checked. |
| C3. No top camera | — | No cavities used. | No view over the cargo when it's loaded. |

- **Forward or side cameras on the top: no.** The top starts behind the steel half-cab roof, so a forward camera would look over
  the cab roof and not see the hood. The side views are options-rd's mirror cameras. The front camera belongs at the grille or
  bumper (options-rd FC).
- **Signal and power:**
  - CVBS video; power from PDM30 OUT23, in options-rd's RUN camera group (1.91 A before the VS41 and this camera).
  - The camera ground and the video braid return to GND-BANK-CAB beside the mirror/VS41, not to the rear bus. That way the lamps'
    return current can't shift the video ground; the rear bus sits one 10 AWG run (GND_RET_REAR) away from the cab bank.
- **Crossing the disconnect:**
  - The kit coax's centre and braid go on two #20 cavities, plus power and ground: 4 cavities in all.
  - The break is a few centimetres at 4.2 MHz baseband, which is electrically short.
  - If the coax centre is under 24 AWG, use MoTeC's doubled-wire method (C125 manual p.21, as in state row 0o) or an M81824/1-1
    step splice to a 22 AWG tail. Check it at the bench.

## 5. Roof finish (TOP-FINISH)

### 5.1 Is the top already insulated?

**No.** State §1 row 41 says "K5 insulation = COMPLETE (roof, firewall, floor)", but the owner's words behind it were "I've
already insulated the vehicle" (receipt `2026-05-23_ac-architecture-locked.md`); the word "roof" was the agent's.

The photos lane (2026-09-29) found:
- bare moulded fiberglass under the top (c086b5f9, e4432a6e; 2021-06-12)
- bare painted steel under the half-cab roof (61df4ea0 2024-10-12; d2c5f364 2024-12-12)
- Kilmat butyl only on the cargo-tub walls (b69462f8, bfbdd718 2026-01-31; 8265dd8f, acdce472 2026-02-01)

So the lock covers neither the top nor, on the photos to December 2024, the cab roof. This is surfaced as a substrate
inconsistency in the receipt. The state row was not edited.

### 5.2 Options

| Option | Materials (price, date) | Weight | Sound and heat (maker's claims, not measured) | Wiring effect |
|---|---|---|---|---|
| F1. Raw: clean the gelcoat and leave it | none | 0 | none. The bare shell is left as it is. | The harness is exposed. Run it in DR-25 along the moulded ribs, clipped at least every 18 in (ABYC E-11) on bonded mounts: Click Bond cable-tie mount kit, 4 mounts + adhesive, $97.75 (aircraftspruce.com 04-06000). "eliminate welding or drilling ... leakproof" (Aircraft Spruce listing). No holes in the gelcoat. |
| F2. Spray: Lizard Skin Sound Control, then Ceramic Insulation (Sound Control first; raybuck listing) | Ceramic Insulation 1 gal $89.95 covers 22–25 sq ft at .040–.060 in (raybuck.com, LSCI1). Sound Control not priced. | 15 lb pail per gallon wet; the dry-film weight isn't published | "can reduce heat transfer by up to 30 degrees F" | Harness and bonded mounts go on the bare fiberglass first; mask them, then spray. The runs stay exposed. |
| **F3. Butyl on the flats + a closed-cell thermal layer + removable headliner panels** | Dynamat Xtreme bulk pack 36 sq ft $239.95 (dynamat.com); thermal layer and panel material not picked. The Tops Online ABS board ($199–$349) is made for the cab's factory headliner, not the top. | not published by Dynamat; weigh a sheet of the tub's Kilmat stock | Dynamat claims "9-18 dB reduction" for a full install | **The harness runs in the rib channels behind the panels**, in DR-25 on bonded mounts, with service loops at every lamp cut-out and at the pillar. The panels come off for service. |

Sources: Tops Online (https://www.topsonline.com/automotive-headliners/chevrolet-trucks-suvs/chevrolet-blazer-k5-blazer-full-size-suv-1977-through-1991/replacement-headliner-for-1977-through-1991-models-b-red-with-factory-headliner-red-b);
Dynamat (https://www.dynamat.com/products/dynamat-xtreme/).

- **Recommendation: F3.**
  - It is the only option that deals with both noise and heat.
  - It gives the top harness a protected, serviceable channel.
  - It hides the rack's backing plates if the panel goes on a rack.
- **F2 is the light alternative. F1 is fine only if the owner wants the exposed look.**
- **Either way the harness goes in before any insulation.**
- **Open:** the inside area, the rib spacing, the top's weight and the panel material all wait for T-15 and a weigh-in.

### 5.3 Trait entry the routing needs (proposed, not added)

`objectTraits.ts` should gain an entry for the removable top before any route is drawn, for example:

```
Exterior_Top_Removable: {
  category: 'body', material: fiberglass (moulded, gelcoat outside),
  channel_along: true (the moulded rib channels),
  pierceability: 'sealed grommets and roof glands only; prefer bonded mounts over holes',
  notes: 'removable; GM disconnect at the lower rear pillar (1987 LDTSM Fig. 17); the rear header carries the CHMSL, work lamps and camera',
}
```

It is a frontend data file, so it goes to the lead as a separate change.

## 6. Open questions only Skylar can answer (one batch)

1. **Is the top on or off in summer?** Solar on the top only works while the top is on. The photos show it off for the whole
   build (2025-09 → 2026-02).
2. **Where does the YellowTop live?** (asked 2026-09-29) The bed puts the MPPT and Orion beside it with short wires. The engine bay
   means the MPPT goes cab side with two more power pass-throughs.
3. **Solar look:** a rigid 235 W panel on a low rack (recommended: 74 °C modelled) or flush flexible panels (sleeker, but about
   105 °C modelled on a hot day, over their 85 °C rating)?
4. **Finish:** headliner panels (recommended), sprayed coating, or raw?
5. **PDM outputs:** OUT21 is the PDM30's only spare 8 A output, and both the power locks (PL) and the top work lamps name it.
   - Which one gets it?
   - Do you want a second body PDM ("run multiple pdm", state §1 row 54) for the extras?
   - Without one, the side scene lamps can't be built.
6. **Switches:** a MoTeC keypad ($574) or one dash switch on DIG16?
7. **Clearance lamps:** 3 (as in the registry) or the factory 5, on the steel cab roof's front edge?
8. **Top camera:** yes or no? It goes on the VS41 if MIRD goes in; otherwise it competes with the front camera for the mirror.

To tape (T-15, on the truck): the flat roof size and crown, the rib spacing, the rear pillar section and height, where the plug's
pigtail would lie, and the top's weight (bathroom scale under one end, twice).

## 7. Sources (fetched 2026-09-29 unless stated)

- **1977 Light Truck Service Manual** (`reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf`):
  - PDF p.155, Removable Top – Folding Top; contents p.130 lists it at 2D-29
  - PDF p.838, lamp bulb data
- **1987 Light Duty Truck Service Manual** (`reference_documents/k5_factory_docs/1987_Light_Duty_Truck_Service_Manual.pdf`):
  PDF p.1363 (10A5-12, Fig. 17) and p.1364 (Fig. 18).
- **ST-352-78 C-K wiring booklet foldout A-1**
  (`reference_documents/wiring_diagram_booklets/pages/1978_CK_A1_cab_engine_chassis_main.png`).
- **GM RPO master list** (`reference_documents/k5_factory_docs/GM_RPO_Master_List.pdf`), p.69.
- **MILNEC TX Series (MIL-DTL-38999 Series III) catalog Rev. 2235**
  (`reference_documents/component_drawings/MILNEC_D38999_series_III_catalog.pdf`):
  - pp.A-14, B-9, B-10, B-19, B-23, B-24, B-49, B-51, B-52
- **DigiKey searches:**
  - D38999/20WE26PN and D38999/26WE26SN (https://www.digikey.com/en/products/result?keywords=D38999%2F20WE26PN, ...26WE26SN)
  - HD36-24-21SN (https://www.digikey.com/en/products/detail/te-connectivity-deutsch-ict-connectors/HD36-24-21SN/25975435)
- **Deutsch DT/DTM/DTP catalog** (`reference_documents/component_drawings/DEUTSCH_DT_DTM_DTP_Catalog.pdf`), p.1.
- **Victron:**
  - BlueSolar Monocrystalline current-models datasheet
  - SmartSolar MPPT 75/10–100/20 datasheet
  - SmartSolar manual Rev 10 02/2026: §1.1, §1.2, §3.11, §3.13, §4.1–§4.4
  - VE.Smart Networking manual Rev 05 02/2024, p.4
  - Orion-Tr Smart manual (web_snapshots, 2026-09-28)
  - URLs are in §2.
- **Solbian SP series datasheet** (https://www.solbian.eu/wp-content/uploads/2026/03/ENG_SP_datasheet.pdf).
- **Renogy product data:**
  - RNG-100DB-H-US and DCC50S (renogy.com product JSON and search API)
- **NASA POWER climatology, Las Vegas 36.17 N 115.14 W, 2001–2020** (API v2.10.0): ALLSKY_SFC_SW_DWN, T2M_MAX, T2M_MIN.
- **Sandia module temperature model** (King et al. 2004, SAND2004-3535), via the pvlib `sapm_module` documentation.
- **MoTeC PDM user manual PN 63029** (Oct 2021) (`reference_documents/component_drawings/motec_pdm_user_manual.pdf`):
  pp.13, 19, 23–24, 29, 48–49.
- **Lamps:**
  - Truck-Lite 80251C (2026-09-28), 81335C, and the 81-Series high-output work light sheet
    (https://www.truck-lite.com/media/trucklite/Downloads/81-Series-High-Output-Work-Lights.pdf)
  - ORACLE 4514-003 (2026-09-28)
  - LMC roof marker lamp and Blazer tailgate pages (2026-09-28)
  - Lumitec Mini Rail2 (2026-09-28)
  - Baja Designs S1 flush reseller listings (Summit Racing, Northridge4x4)
- **Cameras:**
  - EchoMaster PHD5N1 (options-rd snapshot)
  - Rear View Safety RVS-7180355-IR (2026-09-28) and RVS-770613-NM
- **Keypad:** John Reed Racing MoTeC CAN keypad listing.
- **Finish:**
  - Dynamat Xtreme
  - raybuck.com Lizard Skin Ceramic Insulation LSCI1
  - Aircraft Spruce 04-06000 (Click Bond)
  - Tops Online ABS headliner
- **Lanes (2026-09-29):**
  - photos (image evidence)
  - geometry-scan (dimensions.yaml, T-15, PR #417)
  - options-rd (VS41, OUT23 group, PR #416)
  - nav-comms (dish and antennas on the steel roof)
