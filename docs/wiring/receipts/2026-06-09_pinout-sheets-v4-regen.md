---
id: 2026-06-09_pinout-sheets-v4-regen
date: 2026-06-09
change_type: regeneration
scope: scripts/generate_pinout_sheets.py + docs/wiring/output/pinouts/* (SVG/PNG/PDF)
status: APPLIED
amends:
  - 2026-06-09_pinout-sheets-m130-pdm30 (re-render against cut list v4)
---

# PINOUT SHEETS — regenerated from K5_cut_list_v4.txt

Executes the rendering side of `2026-06-09_cut-list-v4.md` (already APPLIED). No new
substrate decisions — this receipt only re-transcribes the v4 cut list onto the three sheets.

## Changes vs the v3-based sheets

**Conflicts CLEARED (now gray "RESOLVED v4" history notes, were orange):**
- A14 (AV1): shows ONLY #4c ETB TPS1 — #102 Oil Press double-assignment removed
- A16 (AV3): #112 Fuel Pressure — 2026-04-13 harness-spec AV map marked STALE
- A17 (AV4): #4d ETB TPS2 — same
- A25 (AV5): now #102 Oil Pressure (ECU), VIO 22 AWG (moved A14→A25 per v4)
- B02: camera-on-B02 ghost marked STALE (B02 = CMP; camera = PDM30:OUT15 #97)

**v4 wires landed on pins:**
- A31 (OUT_HB3) = #116 Dakota Tach; A32 (OUT_HB4) = #118 Dakota VSS/Speedo
- B17/B18 destination now includes T43 TCU via #125 CAN stub (22-vs-24 AWG gauge note)
- PDM OUT7: #126 E-Stopp dash trigger noted; OUT17/18: → floor dimmer COMMON + legs
  #85a/b #86a/b; OUT23: powers Holley T43; OUT27/28: #119/#120 Dakota taps;
  OUT29: #124 splice (ORN/RED collision with #117 — orange, genuine)

**Conflicts/TBDs REMAINING (orange):**
- B03/B04 CLT/IAT swap vs pdm_power_budget M130 list (v4 did not address)
- B06 AT4 reserved, no wire (v4 KNOWN GAPS)
- #INJ_PWR / #COIL_PWR PDM channels TBD
- #98 Fuel Level Sender AV pin unassigned (A25 now taken by #102) — v4 open item 1
- PDM-fed channel-unspecified: #55/#56/#57/#71/#94/#95
- ECU-FROM switch/digital inputs with no M130 pin (#33,36,37,39–46,53,98,100,105–107,111)

## Counts
- M130 A: 29 assigned / 5 spare (A23, A24, A26, A33, A34)
- M130 B: 12 assigned (incl. B06 AT4 reserved) / 14 spare
- PDM30: 30/30 channels used, 0 spare

## Render
`npm run wiring:pinouts` then rsvg-convert PNG @1700w + combined K5_pinouts.pdf.
PNGs visually inspected: no title-block overlap, note colors correct.
