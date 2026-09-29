# K5 fuel system: the regulator, the plumbing and fuel pressure sensing (2026-09-30)

Owner, 2026-09-29 (voice): "another point we never touched him was the fuel regulator I ordered an automotive one I don't
really know what it does do we have any sort of like way that we measure the fuel speed or do we just deal with that at the
throttle body and then mechanically position motive block"

Diagram: [`2026-09-30_fuel-system-plumbing.svg`](2026-09-30_fuel-system-plumbing.svg) (A: plumbing schematic, B: top view in
the twin's axes).

Web sources are saved as markdown in `reference_documents/web_snapshots/<host>__<slug>.md` (gitignored; fetched with
`calc-data/fetch_sources.py`, or as noted). Library PDFs are cited as `library: <name> p.N`. Photos and records are cited by
their Nuke DB id. Order details (numbers, dates, prices, sellers) are in the DB and Gmail, not here. Nothing was bought, no
registry file was edited and nothing was written to the database.

## Short answers

- **The regulator is an Aeromotive 13139, the A1000 Gen-II EFI regulator with ORB-08 ports.** It holds the fuel rails at one
  set pressure (35–75 psi, set by the screw on top) and sends whatever the engine doesn't use back to the tank.
- **The system is a return system, not returnless.** The Quantum H882 hanger has an 8AN feed and a 6AN return. Its returnless
  versions are sold "w/ Filter Regulator" and this build's packing slip lists none, so the Aeromotive is the regulator.
- **Fuel flow is not measured. The M130 calculates it.** It knows how much fuel it injects every cycle. It measures fuel
  pressure (the AEM sensor, already in the harness) and uses it to set how long each injector stays open.
- **The throttle body meters air, not fuel.** No fuel goes near it on this engine. The injectors sit in the intake runners at
  the heads.
- **Mount the regulator on the engine, at the front centre of the intake valley.** That is where it sits in the 2026-01-31
  photo. Use its own bracket or Aeromotive's LS bracket. Not on the block casting, not near the exhaust, not at the rear
  (the DEL-Stributor is there). Reasons in §5.
- **The fuel pressure sensor threads straight into the regulator's 1/8 NPT gauge port.** It is the same thread as the sensor.
- **Set 43.5 psi base with the vacuum hose on.** That is the injectors' rated pressure and where the P367 pump flows the most
  (§3).
- **Add a fuel temperature sensor, as a candidate:** `FT` in `options.yaml`. **Skip a flow meter** (§4).

## 1. What is on the truck and in the records

| Part | Exact part | Facts that matter here | Evidence |
|---|---|---|---|
| Regulator | **Aeromotive 13139**, A1000 Gen-II EFI | (2) ORB-08 inlet/outlet ports and (1) ORB-06 return port; 1/8″ NPT dedicated gauge port; 1:1 vacuum/boost reference; "Engineered for A1000 class and smaller pumps"; bracket included | Owner's order line "A1000 Gen-II EFI fuel pressure regulator – ORB-8" (Gmail; the photographed sales order is obs `65bff82a`). Aeromotive's table: 13138 = ORB-06, **13139 = ORB-08**, 13140 = ORB-10 (`aeromotiveinc.com__new-a1000-gen-ii-efi-regulator.md`). On the engine: IMG_6531, 2026-01-31, images `95eafee3`/`55340f05` (black Aeromotive body with the "A" logo, a brass plug in the front face, the reference nipple on the side) |
| | instructions | base range "35-75 PSI"; ORB ports use "NO THREAD SEALANT"; the 1/8″ NPT gauge port "does requires thread sealant"; 1/16″ NPT reference port, "If unused, please do not plug"; "Max Fuel Flow Range: Up to 150 GPH" | Aeromotive 13138/13139/13140 installation instructions p.2 (the "Download PDF" link on the product page; text copy `aeromotiveinc.com__13138-13139-13140-installation-instructions.md`) |
| Second regulator | YESHMA universal EFI regulator kit with a 0–100 psi gauge and 6AN fittings | not on the engine; not used in this design | owner's records (Gmail) |
| Tank hanger | **Quantum QFS-H882** "BUILD" + P367 + OET-PX-15.3 (packing-slip note; what OET-PX-15.3 is: unknown) | "8AN/6AN hanger"; supply 8AN, return 6AN (Quantum's answer, 04/27/2026); "Integrated check valve built into fuel pump outlet"; for the "31 Gallon Blazer/ Suburban Rear Center Mounted Tank"; "Submersible high pressure rubber hose included". The returnless versions are the "w/ Filter Regulator" options; this build lists none | `www.highflowfuel.com__ls-swap-fuel-pump-hanger-for-1973-1991-blazer-…-qfs-h882-qfs.md`; packing slip photo `vehicle_documents 208ab00c`; in the tank: IMG_1100, 2024-09-30 (images `38e5267c`, `9c8c5f05`): the lid carries two tubes ending in AN male flares plus two plain tubes; IMG_1062 (`a29b4be2`): tubes point forward |
| Pump | **P367**, read as Quantum HFP-367 (registry, 2026-09-26 device ends) | 164 L/h and 4.6 A at 45 psi; 145 L/h and 5.1 A at 60 psi; test voltage not stated | `www.highflowfuel.com__fuel-pump-oem-replacement-hfp-367-qfs.md` |
| Fuel rails | **Holley 534-209** "Hi-Flow" rails for LS1/LS2/LS3/LS6/L99 factory intakes | "machined to accept -8 (3/4-16) O-ring fittings" at both ends of each rail; "(4) -6 to 3/4-16 O-ring adapters" included; 5/8″ passage; brackets 49R3142 for LS2/LS3/L99; "534-212 - Bracket kit, required when upgrading to (EV1/Bosch style) performance injectors on LS2, LS3, or L99"; step 16: "Add a grounding strap for each fuel rail" | `www.holley.com__534-209.md`; Holley 199R10582 p.1, p.3, p.4 (`documents.holley.com__199r10582rev4.md`); Holley shipment in the DB (receipt items, 534-209); IMG_6531: both front ports open (O-ring threads visible), rear ends fitted with black caps or fittings (not readable) |
| Injectors | **Siemens Deka FI114961** (registry INJ-1…8), long style 60 mm, EV1, 12.5 Ω | 60 lb/h = 630 cc/min = 453 g/min at 43.5 psi (300 kPa); 85.7 lb/h = 900 cc/min at 87 psi | `siemensdeka.com__60lbh-siemens-deka-high-impedance-long-style-with-ev1-connector-fi114961-60mm.md` |
| Fuel PSI sensor (registry FUELP) | **AEM 30-2131-100** | 0–100 psig, 0.5–4.5 V (0.04 V per psi); 1/8″-27 NPT male, 15/16″ hex; 14.7 ft-lbf; −20 to 105 °C; < ±3 % FS (±3 psi); brass body, 316L wetted; "Packard 3-Pin" with mating plug and pins; "not recommended for use with methanol" | AEM 10-2131 Rev C (`documents.aemelectronics.com__ebf9109…`) |
| Filters | **none on record.** The in-tank strainer on the P367: not confirmed | the 1977 truck had "a woven plastic fuel filter in the fuel tank on the lower end of the pick-up pipe" | library: 1977 Light Truck Service Manual p.533 |
| Frame lines | a fuel line kit and frame clips were fitted (build log, work_record obs `6f07f9b1`, `c0e4c9f3`) | **type, size and side not recorded.** IMG_0179 (`c10cc91f`, 2024-08-25) shows two bare lines clipped along a front frame rail; fuel or brake is not visible | DB |
| Also in the photo record | Aeromotive Phantom 340 universal in-tank pump box, 18688 "6"-11" Depth" (IMG_0221, `e7703633`, 2024-08-27) | no purchase or install record; not part of this design unless the owner says so | DB |

## 2. What the regulator does

- The pump runs at full speed whenever the engine runs and pushes more fuel than the engine can use. The regulator is a
  spring-loaded valve at the end of the fuel rails. Below its set pressure it stays shut. At the set pressure it opens
  just enough to send the extra fuel down the return line to the tank. That holds the rails at one pressure no matter how
  much the injectors take. Aeromotive calls the port "bypass or return" and says the return "MUST" go "back to the top of
  the fuel tank" (instructions p.2–3). The H882's 6AN return is on the lid.
- **The small nipple on the side is the vacuum reference.** With a hose to the intake manifold, it "will raise fuel pressure
  with boost and reduce it with vacuum ... on a ratio of 1:1" (instructions p.2). That keeps the push across each injector
  (rail minus manifold) the same at idle and at full throttle. Without the hose it holds the base pressure only.
  Aeromotive: leave it open, never plug it.
- **The screw on top sets the base pressure.** Clockwise raises it; set it with the vacuum hose off, then lock the jam nut
  (instructions p.4–5, steps 14–15).
- It does not decide how much fuel goes in. The M130 does, by how long it holds each injector open.

## 3. What the M130 needs, and what it does with the pressure sensor

**The throttle body meters air, not fuel.** The pedal moves the throttle (drive-by-wire, GM 12699160). The throttle lets air
in. The M130 measures what that air is (manifold pressure and intake air temperature, through its engine model) and
injects the matching fuel at each intake port. MoTeC lists the package's model inputs as "engine displacement, fuel
density+molar mass, stoichiometric ratio and injector characteristics" and "engine load modelling based on inlet manifold
pressure and inlet manifold temperature" (MoTeC GPR datasheet, part 23072, p.1, `www.milspecwiring.com__GPR_M1_Package.md`).
On the carbureted 1977 engine the carburetor did the metering. On this LS3 the M130 does it at the injectors.

**How the sensor corrects fueling.** An injector is a valve. How much fuel it passes while open depends on the pressure
pushing fuel through it, the rail pressure minus the manifold pressure.
- The M130 calculates that difference. MoTeC's own release notes name the calculation: "Faulty MAP sensor causing incorrect
  calculation of differential pressure bug fixed", and the secondary-injector "Differential Pressure calculation" is
  "related to the Fuel Pressure" (MoTeC Online, GPR-DI Proportional Pump package release notes,
  `moteconline.motec.com.au__ViewVariant.md`; a GPR-family package).
- MoTeC's flex-fuel guide says injector "fuel volumes and pulse widths" are "calculated using ... Fuel Pressure and Fuel
  Temperature" (M1 Flex Fuel User Guide v1.0, Feb 2017, p.3, `assets.motec.com.au__M1_Flex_Fuel_User_Guide_249c316b37.md`).
- So the sensor changes the **injector open time (pulse width), not the injection timing.** Higher pressure gives a shorter
  open time for the same fuel, lower pressure a longer one.
- With the AEM sensor wired (#112 to A16), pump sag at full throttle or a drifting regulator is corrected on the spot, and
  the pressure is logged and visible in M1 Tune. If the Dakota ever runs on the BIM-EFI-1 path (state 0c), fuel pressure is
  one of the readings the BIM takes from the M1 stream (`DAKOTA_VHX_ARCHITECTURE.md`, BIM manual p.29 list).

**Base pressure: set 43.5 psi (3.0 bar) with the vacuum reference connected.**
1. The injectors are rated at 43.5 psi: 60 lb/h each (Siemens).
2. The pump flows more at the lower pressure: 164 L/h at 45 psi against 145 L/h at 60 psi, and draws 4.6 A instead of 5.1 A
   (Quantum).
3. It is inside the regulator's range, 35–75 psi (instructions p.2; the web page says 40–75 psi).
4. Aeromotive's own guide: "OEM EFI return style engines run at approximately 43 psi vacuum off, returnless engines at 60
   psi" (instructions p.4, step 14).

GM's 58–60 psi "constant" figure is written for GM's own controllers. The E-ROD sheet says "This is what the control system
has been developed to run" and "Don't ... Vacuum reference the fuel system" (library: LS3 E-ROD 19435339 p.1). GM's
long-block sheet says "check the information included in your engine control system for the actual pressure requirement"
(library: GM 19420381 sheet 1). The same sheet gives 60 psi on sheet 1 and 58 psi on sheet 3. The M130 measures the pressure
and corrects for it, so it does not need GM's number.

**Flow check (numbers, sourced):**

| Check | Value | Source |
|---|---|---|
| GM pump requirement, LS3 E-ROD | "Minimum 40 gph @ 400 kPa" | library: LS3 E-ROD 19435339 p.1 |
| GM pump requirement, LS3 / LS376 long-block family | "45 gallons per hour (GPH) @ the recommended pressure" | library: GM 19420381 sheet 3 |
| Holley's LS EFI requirement (its own ECU kits) | "255 liters/hour ... at 45 PSI" | `documents.holley.com__199r10762rev1.md` §7.1 |
| P367 at 45 psi | 164 L/h = 43.3 gal/h | Quantum; 3.785 L/gal |
| P367 at 60 psi | 145 L/h = 38.3 gal/h | Quantum |
| Injector capacity at 43.5 psi | 8 × 60 = 480 lb/h | Siemens |
| Fuel at GM's 40 gal/h, as mass | 40 × 3.785 L × 0.719 kg/L = 108.9 kg/h = 240 lb/h, 50 % of injector capacity (270 lb/h and 56 % at 45 gal/h) | density 0.719 g/cc from Siemens' own pair, 453 g/min = 630 cc/min |
| Injector flow at 58 psi | 60 × √(58/43.5) = 69.3 lb/h. Siemens' two points follow the square-root law within 1 %: 85.7/60 = 1.43 against √2 = 1.41 | Siemens |

**Verdict:**
- At its 45 psi rating point, the one nearest the 43.5 psi setting, the P367 clears GM's LS3 E-ROD figure: 43.3 against
  40 gal/h.
- At 58–60 psi it does not: 38.3 against 40.
- It is under GM's long-block family figure (45 gal/h) at any pressure, and well under Holley's 255 L/h.
- The injectors have room at either pressure.
- **Run 43.5 psi referenced and read fuel pressure on the first full-throttle pull.** If the pressure sags there, or the
  engine is built up later, the pump is the limit. Quantum sells the same H882 with a "255LPH Quantum Pump" (H882 page,
  pump options). A bigger pump draws more current, so #66 and the PDM15 OUT5 limit must then be re-sized from that pump's
  published draw (not on record).

## 4. Is fuel flow measured? Flow meter and fuel temperature

- **Calculated, not measured.** The M130 works out the fuel volume for every injection from its model (§3), so it knows
  what it has injected. MoTeC's release notes name a "Fuel Used Correction" parameter in the package's fuel-used
  calculation (`moteconline.motec.com.au__ViewVariant.md`). The tank sender (#98) is a separate channel ("Fuel Tank Level" in
  the package's optional sensors, GPR datasheet p.3); it shows what is left in the tank.
- **Flow meter: not worth having on this truck.**
  - The package can read a "Fuel Flow Supply Sensor and Fuel Flow Return Sensor" (GPR datasheet p.2). A return system needs
    both, because most of the pumped fuel comes straight back, and the engine's use is the small difference.
  - They would take the M130's last two spare digital inputs (B10 UDIG5, B11 UDIG6; registry pinout).
  - Closed-loop lambda (LTCD with two LSU 4.9) already proves the fueling is right, and the pressure sensor shows whether
    the pump keeps up.
  - Not added.
- **Fuel temperature: worth having, cheap, not needed to run.**
  - The M1 corrects fuel density for temperature ("Fuel Properties Coefficient of Thermal Expansion – Fuel density correction
    for temperature", Flex Fuel guide p.5) and uses fuel temperature in the pulse-width calculation (p.3).
  - MoTeC's own GPR pinout for the M130 gives an AT input the example use "Fuel Temperature Sensor" (connector B,
    `www.motec.com.au__GPR.md`).
  - In a return system the fuel circulates through the hot engine bay and back. Aeromotive notes that recirculation leaves
    "less time for fuel cool down" as the tank empties (library: Aeromotive A1000 11101 installation p.6).
  - Cost: M130 B6 (AT4, spare), two wires and a tee in the return.
  - Recorded as candidate **FT** in `calc-data/catalog/options.yaml`. The sensor is not picked. Two sourced paths:
    - MoTeC #55001 = Bosch 0 280 130 026: M12 × 1.5, M1 predefined calibration, plug MoTeC #64004
      (`www.motec.com.au__Water%20Temperature%20Sensor.md`). MoTeC lists it for water; fuel service is not stated.
    - The GM 13577379 flex-fuel sensor on a spare UDIG. It gives temperature and ethanol content on one input (Flex Fuel
      guide p.7–8).

## 5. Where the regulator mounts (the "block" question)

**On the engine, at the front centre of the intake valley, where it sits in IMG_6531.**
- Bolt it with the bracket that comes with it ("Mounting Bracket Included: Yes") or Aeromotive's LS bracket for this
  regulator, 13702 series, "Center / Intake Valley" (`aeromotiveinc.com__bracket-for-aeromotive-13138-13139-and-13140-ls-fuel-regulators.md`).
- Not on the block casting, not near the exhaust.
- The twin already has it there: `E3_FuelPressReg_asbuilt`, centre (0.000, −1.970, 1.015).

Why there:
1. **After the rails.** Aeromotive: "Positioning the regulator after the fuel rail is recommended for performance
   applications" and Figure 1-2 for "V8 engines with duel fuel rails" (instructions p.3–4). Holley draws the same order for
   its own rails with an aftermarket regulator (199R10582 p.5, Figure 8). Both rails' front ports end within about 0.17 m of
   this spot (twin rails at x ±0.159, front ends y −1.992 / −1.968). The two rail-to-regulator hoses stay short and move with
   the engine.
2. **Two crossings only.** Just the feed in and the return out cross between the frame and the engine. Each crossing has
   to be flexible hose, because the engine moves on its mounts. GM's own layout puts "Flexible hoses ... at fuel tank fuel,
   vapor and return lines and fuel pump" (library: 1977 LTSM p.582).
3. **Farthest from the exhaust.** The valley centre is about 0.22 m sideways from the nearest exhaust flange (twin: flanges
   at |x| 0.25–0.315), well past GM's rule "Do not use fuel hose ... within 4 inches of any part of the exhaust system"
   (LTSM p.582).
4. **Short vacuum hose.** The reference hose to the intake is a few inches long.
5. **Reachable.** The gauge port and the adjusting screw face the front with the hood up, and the pressure sensor lives in
   that port.
6. **The rear centre is taken.** The DEL-Stributor coils fill it (twin coil anchors y −1.556 to −1.464). The rails' rear ends
   sit within about 0.01 m of the firewall line in the twin.

**What it costs.**
- Heat and vibration. Aeromotive's generic warning says fuel parts "MUST be located as far from heat sources as possible,
  like exhaust, engine block, etc." (instructions p.1), yet it sells the LS valley bracket for this regulator.
- While the engine runs, fuel flows through the regulator. After a hot shutdown it heat-soaks. The AEM sensor in it is rated
  to 105 °C, so measure the regulator after a hot shutdown (bench item).
- **The alternative** is a chassis mount on the inner fender or firewall. It is cooler and quieter. But the rail outlets must
  then come off the engine as well (one or two more flexible hoses), the vacuum hose gets long, and the firewall is already
  full:
  - driver side: the iBooster and the 61-pin (x 0.50, y −1.46);
  - passenger side: the battery-corner question (state 0ag(d)).

**Correction for the state file:** row 0ag(h) says the regulator sits in the DEL-Stributor's rear-centre spot. The photo
puts it at the front centre above the water-pump manifold, and the twin lane corrected itself the same way
(`docs/wiring/twin/HANDOFF.md` item 9). Flagged in the receipt, not edited in place.

## 6. The plumbing

The layout is **Aeromotive Figure 1-2, adapted** (diagram, panel A). Fuel goes tank → filter → Y → both rails' rear ports →
both rails' front ports → regulator → return to the tank.

| Step | From → to | Line | Ports and fittings (makers' documents) |
|---|---|---|---|
| 1 | hanger feed → frame | −8 flexible hose, rated for fuel, ≥ 150 psi after the pump | H882 8AN male; −8 hose end. "high pressure (150 psi minimum) fuel line" (library: Aeromotive A1000 11101 p.3, steps 6–7) |
| 2 | along the frame → filter → frame at the firewall | −8 (the fitted 2024 kit: **size and type to confirm**). Steel lines to "GM Specification 123M or its equivalent. Under no condition use copper or aluminum tubing" (LTSM p.582) | — |
| 3 | 10 µm post-pump filter | in the feed on the frame rail ahead of the tank, reachable from below | not owned; part not picked. "All systems should contain a 10 micron post filter after the fuel pump" (Holley 199R10762 §7.1); Aeromotive names its 10-micron fabric filters 12301 / 12310 for the pump outlet side (library: A1000 11101 p.8, bulletin #101) |
| 4 | frame → engine, at the firewall | −8 flexible hose | — |
| 5 | Y block → both rails' rear ports | two −6 hoses | Aeromotive Y blocks 15620, 15674 or 15675 (library: A1000 11101 p.3, step 7; port sizes not in the document, pick at order time); Holley's included −6 to 3/4-16 O-ring adapters at the rails |
| 6 | both rails' front ports → regulator side ports | two −6 hoses | Holley −6 adapters at the rails; Aeromotive 15605 ORB-08 → AN-06 at the regulator (or 15607 ORB-08 → AN-08) |
| 7 | regulator bottom return → frame | −6 hose along the top of the engine to the firewall, then −6 flexible hose down to the frame | Aeromotive 15606 ORB-06 → AN-06 (or 15649 ORB-06 → AN-08) |
| 8 | along the frame → hanger return | −6, same rail as the feed | H882 6AN male |
| 9 | gauge port → pressure sensor | AEM 30-2131-100 threads straight in | 1/8″ NPT both; thread sealant on the NPT (instructions p.2); 14.7 ft-lbf (AEM) |
| 10 | reference nipple → intake vacuum | vacuum hose | 1/16″ NPT nipple on the regulator (replacement 15630, instructions p.5); the intake port that feeds it is the pieces lane's (the intake identity is still open, state 0ag(g)) |
| 11 | vent tube on the lid → vent | vapor hose | canister or vent valve: owner call (the 1977 truck vented to a charcoal canister, LTSM p.582) |

**Fallback, if the rear of the rails won't take hoses at mock-up** (firewall and DEL-Stributor): Aeromotive Figure 1-1.
- The feed goes into one regulator side port. The other side port feeds both rails' front ports.
- Both rear ports get plugs: 3/4-16 O-ring, the same thread as ORB-08. Aeromotive 15618 is its ORB-08 port plug
  (instructions p.2), and Holley 534-211 includes one 3/4-16 plug.
- Aeromotive allows this: "may be configured for a 'returnless' type of engine/fuel rail", with the return "STILL" going to
  the tank (instructions p.3).

**Rules for every line:**
- Route clear of suspension, driveline and exhaust, and protect from road debris (A1000 11101 p.3).
- Secure to the frame "to prevent chafing" (LTSM p.582).
- No fuel hose within 4 in of the exhaust (LTSM p.582).
- ORB ports take the O-ring and "NO THREAD SEALANT" (instructions p.2).
- Prime by cycling the key and check for leaks before starting (Holley 199R10582 p.5, step 21; Aeromotive instructions p.4,
  steps 12–13).

**Lengths:** estimate only, from the twin. Hanger (y 1.45) to the firewall zone (y −1.30) is about 3.1 m each for the feed and
the return frame runs. The engine-side hoses are 0.25–1.0 m each. Cut last, per Dave's method.

## 7. Positions in the twin

Axes: +x driver, −y forward, +z up, metres. Front axle y −1.896, rear axle y 0.807, firewall about y −1.46. Twin v4 is
`~/k5-harness-pull/K5_harness_workspace_v4.blend` (read headless, not saved). The 33 anchors in
`calc-data/twin_engine_anchors.json` match its `K5H_E3_Anchors` and v3's to within 1 mm.

| Item | x | y | z | Basis |
|---|---|---|---|---|
| Regulator, as built | 0.000 | −1.970 | ≈1.03 (bottom ≈0.97, stud top ≈1.09) | Centre from twin `E3_FuelPressReg_asbuilt` (from IMG_6531). Aeromotive publishes no dimensions. **Estimate, ±15 %:** about 120 mm tall with the adjuster stud; cap Ø ≈ 55 mm; lower block ≈ 75 mm wide × 56 mm tall. Scaled from Aeromotive's product-page photos by the ORB-08 port (3/4-16 thread, 19.05 mm). IMG_6531 agrees against the M8 flange bolts beside it. Measure the part in hand. The twin's 60 × 60 × 70 mm box is short |
| Regulator ports (maker photos) | — | — | — | 2 × ORB-08 on the lower block's left and right faces, axes ±x, ≈ 25 mm above the bottom. ORB-06 return on the bottom face, axis −z. The 1/16 NPT vacuum nipple on the +x side at the cap base (≈ 66 mm above the bottom). The stock bracket is on the back face (+y) |
| Fuel PSI sensor port: the regulator's 1/8 NPT gauge port | 0.000 | −2.008 (port) → −2.052 (plug face) | 0.983 | The port is centred on the front (logo) face, ≈ 13 mm above the bottom (maker's front photo, same scale). **Thread axis −y**, so the sensor points forward. AEM drawing: 2.15 in overall with 0.40 in of thread (10-2131 Rev C), so about 44 mm sticks out. The Packard plug is at the tip. If the water-pump manifold is in the way at mock-up, the regulator turns 90° on its bracket |
| Rail L (driver): front port / rear port | 0.159 | −1.992 / −1.472 | 1.084 | twin `E3_FuelRail_L` |
| Rail R (passenger): front port / rear port | −0.159 | −1.968 / −1.448 | 1.084 | twin `E3_FuelRail_R` |
| Y block, PROPOSED | 0.00 | −1.50 | 1.15 | behind the intake between the rails' rear ends; fit at mock-up |
| Vacuum source | 0.00 | −1.57 | 1.063 | twin `map` anchor, a placeholder (port location not recorded) |
| FT candidate, tee in the return | 0.00 | −1.97 | 0.95 | below the regulator's return port |
| Hoses frame ↔ engine, PROPOSED | 0.30 | −1.43 | 0.95 | behind the engine at the firewall, clear of the 61-pin |
| Frame run feed + return, PROPOSED | 0.39–0.42 | 1.00 → −1.25 | 0.60–0.66 | driver rail (twin frame web x 0.36–0.43), beside the pump wires (`K5H_Trunk_Fuel`, landmarks L25/L27); **side to confirm** |
| Filter, PROPOSED | 0.40 | 0.20 | 0.62 | driver rail between the transmission crossmember and the rear axle |
| Hanger top (feed, return, vent) | 0.15 | 1.45 | 0.60 | twin `K5H_FuelPump_Sender` (placeholder, not photo-matched) |
| Tank | −0.425…0.425 | 1.175…1.725 | 0.33…0.57 | twin `K5H_FuelTank` |
| 61-pin bulkhead | 0.50 | −1.46 | 0.90 | twin v4 `FIREWALL-ENGINE` / `FIREWALL-CABIN` |
| Exhaust flanges | ±0.25…0.315 | −1.934…−1.505 | 0.815…0.88 | twin `E3_ExhFlange_*` |
| Exhaust collectors / tails | ±0.297…0.373 | −1.71…−1.07 | 0.50…0.58 | twin `E3_Collector_*`, `E3_Exhaust_Tail_*`. Placeholders; the real route aft is unknown. On the rail's inboard face these come within 0.10 m of a fuel line, so the lines take the rail's top or outboard face there |

## 8. Wiring consequences

Gauges and specs are from the canon: 22 AWG = M22759/16-22, 12–20 AWG = M22759/32 (chapters/16 §1.5).
- **Fuel PSI (#112 signal → M130 A16 AV3; #112r 5 V → A02; #112g 0 V → B16).** 22 AWG M22759/16, 61-pin cavities y / h / g,
  plug: the AEM "Packard 3-Pin" with pins in the kit.
  - Unchanged, except the device end now has a place: the regulator's gauge port at (0.000, −2.008, 0.983), thread axis −y (§7).
  - Rough twin path from the 61-pin along the driver rail: about 1.1 m, 4.4 ft with the 20 % engine pad. That is consistent
    with the cut-list 4.6 ft estimate; harness-cad measures it (its `ENG-FUELP` branch joint is at (0.03, −1.985, 1.12)).
  - Pin letters are still open (read the AEM drawing before crimping).
- **Pump + (#66) and − (PUMP_GND).** 14 AWG M22759/32 red and black. #66 from PDM15 OUT5 (20 A pair, pigtails A9 + A17),
  limit 7 A (registry `pdm_settings`). PUMP_GND runs in the loom to GND-BANK-ENG (state §1 row 56).
  - Load: 4.6 A at 45 psi, 5.1 A at 60 psi (Quantum). At the recommended setting the pump draws ≤ 4.6 A.
  - The M130 switches the pump through the PDM15 over CAN. MoTeC: "the PDM output goes active when the CAN channel from the
    M1 goes active ... the PDM is essentially acting as a switch" (M1 to PDM CAN Messaging v1.0 p.8). The package has a "Fuel
    pump switched output" (GPR datasheet p.2).
  - No change, unless the pump is changed (§3).
- **FT candidate.**
  - Signal → M130 B6 (AT4, spare; 1k pull-up to SEN_5V_B per MoTeC's M130 pinout), plus a 0 V wire.
  - 2 × 22 AWG M22759/16, through 2 of the 3 spare 61-pin cavities (d, t, u). Only 1 is needed if its 0 V joins #112g on the
    engine side (Dave's call).
  - Nothing is designed until the owner decides.
- **Rail ground straps.** Holley says to add one per rail, from an intake bolt to a rail mounting bolt (199R10582 p.4,
  step 16). They are bonding straps on the engine, not harness wires. Part not picked.
- **The regulator has no wires.**

## 9. Open

**Only the owner can answer:**
1. The fuel lines fitted with the frame clips: which frame rail, and are they steel (what size) or AN hose? One photo at the
   tank end settles it.
2. The exhaust: single or dual, and which side does it run to the back? That sets the rail and the face the fuel lines use
   (the 4 in rule).
3. The pump: run the P367 at 43.5 psi and check the pressure at full throttle (recommended), or fit Quantum's 255 L/h pump in
   the same H882 while the tank is easy to reach? This is a money call.
4. The Aeromotive Phantom 340 in the 2024-08-27 photo: is it for this truck?
5. The tank vent: charcoal canister or vent valve?
6. Candidate FT (fuel temperature): yes or no.

**Bench checks for the builder:**
- The P367's in-tank strainer.
- The Deka long-style EV1 injectors against the rail brackets: Holley needs 534-212 on LS2/LS3/L99 bosses, so this depends
  on which intake is on the engine (state 0ag(g)).
- Room for the Y and the hoses at the rails' rear ports: Figure 1-2 or the Figure 1-1 fallback.
- Regulator temperature after a hot shutdown, against the AEM's 105 °C.
- The AEM pin letters.
- What "OET-PX-15.3" on the Quantum slip is.

## Sources

- Aeromotive A1000 Gen-II regulator page (13138/13139/13140 table, fittings, bracket) and its installation instructions
  (7 pp.); Aeromotive LS regulator bracket 13702 page.
- Quantum QFS-H882 hanger page with Q&A; Quantum HFP-367 pump page.
- Holley 534-209 page and instructions 199R10582 (rev. 3-25-13); Holley LS Terminator MPFI manual 199R10762 §7.1.
- Siemens Deka FI114961 page.
- AEM 10-2131 Rev C.
- MoTeC: GPR datasheet 23072 (7 Sep 2021); GPR product page (M130 pinout); M1 Flex Fuel User Guide v1.0; M1 to PDM CAN
  Messaging v1.0; MoTeC Online GPR-DI Proportional Pump release notes; Water Temperature Sensor #55001.
- Library: 1977 Light Truck Service Manual pp.533, 582; LS3 E-ROD 19435339; GM 19420381 LS3/LS376 long block specifications;
  Aeromotive A1000 11101 installation.
- Nuke DB:
  - images `95eafee3`, `55340f05` (IMG_6531), `38e5267c`, `9c8c5f05` (IMG_1100), `a29b4be2` (IMG_1062), `c10cc91f` (IMG_0179),
    `e7703633` (IMG_0221);
  - observations `65bff82a`, `6f07f9b1`, `c0e4c9f3`;
  - `vehicle_documents 208ab00c`.
- Twin v4 (harness-cad) and `docs/wiring/twin/HANDOFF.md`.
