# Receipt: K5 system schematic page set (sheets 1-6, non-engine systems)

- **id:** 2026-06-09_system-schematic-pages
- **change_type:** artifact_generation
- **scope:** docs/wiring/output/schematics/ (new), scripts/generate_schematic_pages.py (new), package.json (`wiring:schematics`)
- **amends:** none (companion to 2026-06-09_pinout-sheets-m130-pdm30.md and the K5_S2_* engine pages)

## What

Six print-grade 2200x1700 SVG schematic sheets + PNG renders + combined PDF
(`K5_system_schematics.pdf`), covering every system NOT already on the K5_S2 engine-loom
pages: dash/controls, exterior lighting (incl. high-beam floor-dimmer topology), doors &
interior, audio, chassis/power/grounds, rear loom. Generator is stdlib-only Python;
rendering via rsvg-convert + qpdf.

## Citations (no value invented)

| Claim class | Source |
|---|---|
| Wire id / color / gauge / length / FROM pin | `output/K5_cut_list_v4.txt` (v4, 2026-06-09 — canonical) |
| PDM30 channel ↔ device, group composition, direct-wired list | `calc-data/pdm_power_budget.md` §A (authoritative 2026-04-05 plan) |
| Subsystem membership, shared-channel warnings, gaps (puddle lights, dimmer switch, E-Stopp legs, SGI-100BT, camera video) | `calc-data/subsystems.json` |
| Routing landmarks: FWG-MAIN (L16), FLOOR-RR (L24), frame rail (L25), tunnel (L28), door boots/door_crossing | `output/K5_wire_paths.yaml`, `output/K5_landmarks.yaml` |
| Ground points G3/G4/G5/G6/G8 + STAR_BAT_CHASSIS / STAR_BAT_ENG / STAR_ENG_FRAME / STAR_ECM_HEAD, gauges | `nuke_frontend/src/components/wiring/objectTraits.ts` ground_points |
| High-beam topology (OUT17/18 → dimmer COMMON → SPDT → lamp LOW/HIGH) | receipt `2026-05-14_decision-high-beam-floor-dimmer.md` via cut list v4 rows #85/#86/#85a/b/#86a/b |
| EE-audit FAILs (PDM BAT± 2 AWG < 150A; REAR-SUB 14 AWG; E-Stopp ch legs) | `calc-data/pdm_power_budget.md` §3 |

## Unknowns (surfaced ORANGE on the sheets, NOT resolved here)

All pre-existing substrate gaps, none created by this change; none block diagram generation:
battery side TBD; alternator capacity 250/220/150A fork; M130 switch-input pins TBD;
#98 AV pin unassigned; #94/#95/#55/#56/#57/#71/INJ_PWR/COIL_PWR channels unspecified vs
30/30-used plan; #124 color collision; #126 button PN; Dakota factory sender PNs;
dimmer switch / E-Stopp legs / puddle lights / camera video have no cut-list ids;
#125 22-vs-24 AWG stub; #86b 3-stripe remap; wire_paths marker-label drift.

## Verification

All 6 PNGs rendered; sheets 1, 2, 5, 6 + 2x crops of dense regions (sheet 1 source column,
sheet 6 junction) visually inspected for overlap/clipping — clean. PDF assembles 6 pages.
Regenerate: `npm run wiring:schematics`.
