# Design-Inputs Recon — CAD sources, as-built photo survey, install practice

**Date:** 2026-06-09 · 4-agent recon + synthesis (workflow wf_00ad5747-10c)
**Why:** Skylar directive — professional design-prep: real CAD of real components, as-built truth from his own photos, pro install practice. Feeds the digital-twin workspace `~/k5-harness-pull/K5_harness_workspace_v2.blend`.

# K5 Digital-Twin Recon Brief — 1977 K5 / LS3 / M130 + PDM30

## A) ACQUIRE NOW — ranked by routing impact

| # | Item | URL | Format | Cost |
|---|------|-----|--------|------|
| 1 | **MoTeC M130 dimensioned drawing** (107.5x127.5x38.7mm, 97.5x75mm hole pattern, 18° connector exit) | motec.com.au/filedownload.php/13130_m130_datasheet.pdf?docid=3716 (p.3) | PDF 2D | Free |
| 2 | **M130 STEP via Dana OpenECU** — "M1XX Assembly," asset 78730 (same M1 hardware) | openecu.com/download/m130-cad-model/ → dml.dana.com library | STEP | Free (Dana portal login) |
| 3 | **MoTeC PDM30 dimensioned drawing** — same case family, adds M6 stud at 17.9mm projection | motec.com.au/filedownload.php/14103_PDM30_datasheet.pdf?docid=3130 (p.2) | PDF 2D | Free (no STEP exists; surface CAD by request to MoTeC only) |
| 4 | **GM LS7 Engine, Chad Dixon** — gold-standard LS solid (11,858 dl); swap-equivalent to LS3 for mounts/bellhousing/envelope; **also your source for the 90mm 4-bolt DBW throttle body and fuel rail + injector stack (extract from STEP)** | grabcad.com/library/gm-ls7-engine-1 | SLDPRT/SLDASM + STEP/IGES | Free (GrabCAD acct) |
| 5 | **GM LS1/LS2/LS3 Engine, Chad Dixon** — LS3-specific; corroborated 1:1 by the community full-scale print split. API returned null for the slug — verify in a browser; #4 is the fallback | grabcad.com/library/gm-ls1-ls2-ls3-engine-1 | SLDPRT/STEP | Free |
| 6 | **iBooster Gen 2 (Honda Accord) scan + reference model** — your unit is already on the driver firewall; this is the clearance competitor for everything on that side. Pair with EVcreate Gen2 flange drawings (60x80mm pattern) at evcreate.com/installing-the-ibooster/ | grabcad.com/library/ibooster-gen-2-honda-accord-1 | STEP/IGES + STL | Free |
| 7 | **GM LS2/LS3 coil 12570616** — reverse-engineered from scan; same body/72mm bolt spacing as your 12611424/D510C | grabcad.com/library/gm-ls2-ls3-ignition-coil-12570616-1 | STEP/IGES | Free |
| 8 | **Bosch EV6 injector** (grabcad.com/library/bosch-ev6-fuel-injector) + **LS3 38mm short injector** (grabcad.com/library/ls3-injector-38mm-1) — LS3 uses the short EV6/EV14 body, 0.565" lower O-ring; check which model you stack | GrabCAD | SolidWorks | Free |
| 9 | **GM 6L80E, Matthew Waye** — accurate exterior envelope; **2WD Commodore tail** — substitute the 4WD output/adapter face (no 4WD 6L80 CAD exists anywhere) | grabcad.com/library/gm-6l80e-transmission-1 | SW + STEP/IGES | Free |
| 10 | **NP205 + NP203 doubler, Josh Roidt** — "close enough to model a chassis around"; passenger-drop, 32-spline input — verify against your 6L80 adapter. If the build is NP241: nearest is the NP261HD scan (grabcad.com/library/np261-hd-gm-transfer-case-1), rough space-claim only | grabcad.com/library/new-process-np205-and-np203-transfer-case-doubler-1 | Rhino + STEP/IGES | Free |
| 11 | **C6 LS3 accessory-drive 3D scan** — measured reality incl. engine mounts; but see correction D4 — your bay runs CVF, so this is mockup-grade only | grabcad.com/library/gm-chevy-ls3-corvette-accessory-drive-scan-1 | STL | Free |
| 12 | **Holley 300-131 dims PDF** — no CAD exists; the PDF carries enough to block a space-claim solid in 20 min (5.42" flange height @ 0°, 2.50x1.15" ports, 4150 flange) | documents.holley.com/858dcc6c824863a5240745eb5e4bb76345aa93d6.pdf | PDF | Free |
| 13 | **Dakota Digital VHX-73C-PU dims** — 12.075x4.472" housing, control box 5.5x3.5x1"; no depth published (ask DD support) | dakotadigital.com/img/dVHX-73C-PU.png | PNG | Free |

Skip paid meshes (RenderHub $58 LS3 etc.) — editorial-license visualization only, useless for fitment.

## B) AS-BUILT ANSWERS (from your own photos)

**Settled:**
- **iBooster: IN.** Driver-side firewall, factory booster pad, adapter + custom MC with twin billet reservoirs, one hard-line stub started, prop valve present. Pigtail coiled, unterminated — Tulay connector not wired. (DB images 40e5e5f9 + dff584e9, 2026-01-31; corroborates K5_WIRING_STATE.md:31.) Footprint is now photogrammetry-measurable.
- **M130: NOT mounted anywhere.** Firewall bare except iBooster and the passenger-side gold heat-shield panel — the only prepared surface on that side. Substrate conflicts with itself: K5_WIRING_STATE.md:82 says passenger firewall, devices.json says "dash." Decision still open.
- **Grommets: zero fitted.** Column hole open, large round pass-through open in upper driver firewall/cowl, unfitted small holes along the cowl lip. The grommet-vs-bulkhead boundary question (substrate open question #1) is physically uncommitted — nothing is drilled wrong yet.
- **Battery: NOT settled — and the prior belief is poisoned.** No battery or tray on either side in the 2026-01-31 photos. The "driver-front" image is a different blue carbureted squarebody from the misattributed 2026-02-03 telegram batch (reattribution task already spawned). Treat battery side as an open decision, not a fact.
- **Engine dress:** Holley aluminum intake + 4150-flange TB, Holley EFI rails, CVF accessory drive (alternator low driver-side), no AC compressor, shorty headers, trans + transfer case in, fuel tank in with pump pigtail unterminated.

**Needs one photo (or one answer) from you:**
1. **Coil packs** — plug wires visible, coils not. Is the DEL-Stributer cluster in hand/installed, and where does it mount? Nothing in the photo record shows them.
2. **Intake confirmation** — vision read "mid-rise"; recon assumed 300-131 single-plane. One straight-on shot of the manifold (or the box label) settles which casting to model.
3. **Battery side decision** — driver-front vs passenger core support. One word.
4. **Passenger firewall behind the gold heat shield** — what's under it / what it's protecting, before committing the M130 bracket there.

## C) SCAN RECOMMENDATION — iPhone, engine bay

- **App: Scaniverse** (HPA instructor pick, "works well" for engine-bay sections); Polycam acceptable, paid tier exports STEP directly.
- **Mode: photogrammetry, not LiDAR-only.** The controlled test (allaboutthebuild.com) found iPhone LiDAR on an engine bay "not usable"; photogrammetry workable but needs manual rescaling.
- **Workflow:** (1) Tape 2-3 known-dimension scale references in frame (machinist scale, printed scale bars at different depths). (2) Scan in overlapping sections: driver firewall/iBooster zone, passenger firewall/heat-shield zone, engine top, trans tunnel lip. Slow passes, even diffuse light, kill specular glare on the polished headers/radiator. (3) Export FBX/OBJ → Fusion 360 → rescale against references → overlay the GrabCAD solids from section A.
- **Use the scan for:** clearances, branch points, bracket placement, the M130/PDM30 bracket design against real firewall geometry.
- **Do NOT derive branch lengths from it.** Pro practice (HPA course) is string/rope mockup routed in the actual bay → 2D formboard. The scan is the clearance layer; the string is the length layer.
- If harness-grade surface geometry is ever needed (e.g., the iBooster firewall bracket), that's structured-light scanner territory (Revopoint MetroY-class), not iPhone.
- **Timing:** scan now, while the bay is this empty — every component added (column, AC compressor, battery tray) occludes geometry you'll want.

## D) PRACTICE CORRECTIONS

1. **M130 passenger firewall — KEEP, with conditions.** The M130 is not a sealed bay ECU: "protected location where only occasional water splashing occurs," 85°C internal ceiling, no solid mounting to vibrating/undamped structure. Cabin side of the firewall is the supported reading (commercial M1 mounts cluster in-cabin — kick panels). If bay side, it must be splash- and heat-shielded away from the headers. Budget **60-80mm below the connector face** for the 18° Superseal exit + boot bend radius. Torque 5 Nm. And resolve the firewall-vs-dash conflict in your own substrate first.
2. **PDM30 under dash — KEEP ONLY IF VENTILATED.** "Very hot during operation... well ventilated area, not against a hot surface." A closed under-dash pocket is the one disqualifier at your continuous load (fans + fuel pump + ignition). Mitigations: magnesium back face against bare metal as heatsink, off the heater box, fit the M6 stud insulating cap, **log PDM internal temp via CAN on a 30-minute heat soak** before calling it done. Routing consequence: under-dash PDM forces a **4-2 AWG always-hot feed through the firewall** — sealed bulkhead/grommet, isolator rated for starter current, secondary switch to an ECU shutdown input so the alternator can't keep it alive. Both Batt- pins to battery negative in 20#. Bonus: PDM30 and M130 share the same Tyco 34/26-pos connectors (#65044/#65045) and the same 97.5x75mm footprint — one crimp tool, shareable bracket geometry.
3. **Central coil cluster — routing doctrine, thin docs.** Del-Stributer has no published routing drawings (and is listed sold out — verify availability now). The 8 coil primaries become one switched trunk down the manifold; **keep it on the opposite side of the intake from the shielded CKP/CMP pairs.** Critical Gen IV detail: **LS3 crank/cam sensors are 5V hall** (Gen III was 12V) — reusing any Gen III harness pattern is a swap-killer. Shields land at the ECU end only, carried through splices. LS3 sensor placement (CKP/CMP front cover, knock on block sides) means trigger runs stay low and forward — the over-intake loom can be coils/injectors/TB only.
4. **Accessory drive — the recon target was wrong, and so was the SKU.** Holley 20-200 is Gen V LT, not LS; LS3-correct mid-mounts are 20-185/186 — but it's moot: **your photos show a CVF Racing drive already installed and belted (BANDO 6PK1930).** Stop hunting Holley CAD; the as-built drive gets captured by the Section C scan.
5. **Throttle body — possible target mismatch.** Photos show a **4150-flange TB with a drum air cleaner**; the CAD list targeted the GM 90mm 4-bolt DBW (12605109). Those are different flanges. Confirm the actual DBW plan (4150-flange DBW unit vs GM 90mm + adapter) before modeling either — ties into photo request B2.

## E) GAPS — found nowhere

- **Holley 300-131 intake CAD** — does not exist; model from the official dims PDF.
- **Holley Mid-Mount CAD** — none (also moot per D4).
- **4WD-tail 6L80E** — none anywhere; substitute the 4WD output manually.
- **NP241 CAD** — zero hits across GrabCAD/CGTrader/TurboSquid/STLFinder; scan-or-measure only.
- **GM 12605109 TB standalone** — extract from the LS7 assembly instead.
- **LS3 OE fuel rail standalone** — extract from engine assemblies; simple extrusion if exact geometry needed.
- **PDM30 STEP** — request via MoTeC dealer only.
- **DEL-Stributor drawings** — zero web presence under that name.
- **Tesla Model 3 (Gen2) iBooster firewall bracket CAD** — none; custom part from EVcreate flange drawing + GrabCAD scan (Gen1 Model X STEP on MyG37 is template-grade only).
- **E-Stopp ESK001** — text dims only (15"L x 2"W x 1.8"H actuator, 4.9x2.5x1.9" control box); no drawing, no CAD.
- **AMP Research PowerStep motor/controller dims** — nothing public; measure the physical parts.
- **Dakota Digital cluster depth** — not published; ask DD support.
- **GM LS3 dimensional drawings** — GM publishes none; install PDFs are spec text only (useful: 58 psi fuel, 45 GPH).
- **"HRC standard"** — not a citable spec; the documentable layup standards are HPA concentric-twist practice, RB Racing service-loop/boot/epoxy guide, and MIL-W-22759/44 + DR-25 materials.
- **TE/Aptiv connector CAD** — deliberately deferred per scope, not searched.

Cross-check before cutting metal: GrabCAD community models carry no accuracy warranty — verify bellhousing bolt circle and deck-to-pan height against a tape measure on the actual engine.