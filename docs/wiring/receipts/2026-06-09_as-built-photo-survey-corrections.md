# Receipt — As-built photo survey: corrections + closures

**Date:** 2026-06-09
**Change type:** research + substrate_correction (evidence from Skylar's own photo substrate + 4-agent design-inputs recon)
**Source:** `docs/wiring/research/2026-06-09_design-inputs-recon.md` (full brief with URLs); DB images cited inline.

## Closed / confirmed (from photos of THE truck, 2026-01-31 batch)

1. **iBooster Gen 2: INSTALLED.** Driver-side firewall on the factory booster pad, adapter plate + custom master cylinder with twin billet reservoirs, one hard line started, prop valve present. Pigtail coiled and UNTERMINATED (Tulay connector not wired). DB images `40e5e5f9`, `dff584e9`. Closes the §4 "iBooster footprint" unknown to photogrammetry-measurable; position no longer assumed.
2. **M130: NOT mounted.** Firewall is bare except the iBooster and a gold heat-shield panel on the passenger side (the only prepared surface there). Position remains OPEN; substrate self-conflicts (state file says passenger firewall; `devices.json` says dash).
3. **Grommets: ZERO fitted.** Column hole open, large upper-driver pass-through open, unfitted cowl-lip holes. The §3.1 boundary question is physically uncommitted — nothing is drilled wrong.
4. **Engine dress as-built:** Holley aluminum intake + **4150-flange throttle body with drum air cleaner**, Holley EFI rails, **CVF Racing accessory drive (BANDO 6PK1930 belt), alternator LOW DRIVER side, NO A/C compressor fitted**, shorty headers, 6L80E + transfer case in, fuel tank in with pump pigtail unterminated.

## Corrections (substrate was wrong)

5. **Battery "driver-front per Skylar image" is POISONED.** That image is a different blue carbureted squarebody from the misattributed 2026-02-03 telegram batch. No battery/tray on either side in the real photos. `K5_WIRING_STATE.md` §4 battery line amended; A4 in the derived-landmarks YAML amended. **Battery side is an open decision for Skylar.** L14/L15 mirror-flip if passenger wins.
6. **CKP location was a Gen III pattern.** `K5_landmarks.yaml` L10 says "CKP at bellhousing rear"; LS3 is Gen IV — crank AND cam sensors are on the FRONT timing cover. Corroborated by the build's own BOM PNs (CKP 12615626, CMP 12591720 — both Gen IV front-cover sensors) and recon research. L10 re-derived at the front cover: **23.7 → 32.5 in**; total computed harness now **916.1 ft**. `K5_dimensions_atoms.yaml`'s open-unknown note "crank rear, cam front" carries the same stale pattern — needs its own amendment.
7. **Accessory drive: atoms claim "Holley Mid-Mount — Skylar's confirmed accessory drive" (`K5_dimensions_atoms.yaml` holley_midmount section). As-built photos show CVF Racing installed and belted.** Also: recon's SKU check says Holley 20-200 is Gen V LT (LS-correct mid-mounts are 20-185/186) — moot either way. Atoms section needs amendment; the C6/Holley accessory envelopes in the model are mockup-grade until the CVF drive is scanned/measured. Alternator position in the model corrected-by-evidence to low driver side **(affects L14)** — model still shows the old passenger-upper placement; flagged for the next model pass with the CVF geometry.
8. **Throttle body conflict:** locked decision says 90mm DBW GM 12605109 (4-bolt round); photos show a 4150-flange TB + drum cleaner. Either a 4150-flange DBW unit is the real plan, or the GM 90mm + adapter, or the current TB is mock-up. **Skylar to confirm** before the TB end of the over-intake loom is modeled as final.

## MoTeC environment constraints pulled into the record (routing-relevant)

- M130: not a sealed-bay ECU — "protected location, occasional splash only," 85°C ceiling, no rigid mount to undamped vibrating structure; budget **60–80 mm clearance below the connector face** for the 18° Superseal exit + boot. Cabin side is the supported reading; bay side requires splash/heat shielding away from headers.
- PDM30: runs hot; closed under-dash pocket is a disqualifier at this continuous load — needs ventilation/heatsinking; validate with a **CAN-logged 30-min heat soak**. Under-dash PDM forces a 4–2 AWG always-hot feed through the firewall (sealed bulkhead, isolator rated for starter current, secondary kill to an ECU shutdown input).
- M130 + PDM30 share the same Tyco connector family (#65044/#65045) and the same 97.5×75 mm hole pattern — one crimp tool, shareable bracket geometry.
- Coil trunk doctrine: 8 primaries = one switched trunk down the manifold, **opposite side of the intake from the shielded CKP/CMP pairs**; LS3 trigger sensors are 5V hall (Gen III 12V patterns are swap-killers); shields land at ECU end only.

## Open questions FOR SKYLAR (one answer each)

Q1. **Battery side** — driver front vs passenger core support?
Q2. **Throttle body** — what's the actual DBW plan (4150-flange DBW vs GM 90mm + adapter)? One photo of the TB or the box label settles it.
Q3. **Coils** — is the DEL-Stributor cluster in hand/installed, and where does it mount? (No photo evidence found; vendor listed sold out; zero published drawings.)
Q4. **What's behind the gold heat-shield panel** on the passenger firewall — before committing the M130 bracket there?

## Next acquisition steps (from the brief's ACQUIRE list, top of stack)

GrabCAD LS7/LS3 engine solids (free, full detail, includes the 90mm DBW TB + rails), M130 STEP via Dana OpenECU portal, MoTeC dimensioned PDFs (M130 p.3, PDM30 p.2), iBooster Gen 2 STEP + EVcreate flange drawings, 6L80E (2WD tail — sub the 4WD output), NP205. **Scan the engine bay NOW while it's this empty** — Scaniverse photogrammetry with taped scale references; every component added occludes geometry. Full URLs in `research/2026-06-09_design-inputs-recon.md`.
