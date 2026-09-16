# Receipt: Print-grade pinout sheets — M130 A/B + PDM30

- **Date:** 2026-06-09
- **Change type:** diagram generation (derived artifact — no substrate modified)
- **Scope:** `docs/wiring/output/pinouts/` (new), `scripts/generate_pinout_sheets.py` (new, registered in package.json as `wiring:pinouts`)

## What was produced

Three 1700x2200 engineering pinout sheets (SVG + PNG @1700w + combined `K5_pinouts.pdf`):

1. `K5_pinout_M130A.svg/.png` — M130 Connector A (34-way), connector-face grid + full A01–A34 table
2. `K5_pinout_M130B.svg/.png` — M130 Connector B (26-way), B01–B26
3. `K5_pinout_PDM30.svg/.png` — PDM30 OUT1–OUT30 per the AUTHORITATIVE 2026-04-05 channel plan, with direct-wired footer block

## Citations (every pin/wire transcribed, none invented)

- Pin functions: `docs/wiring/calc-data/pdm_power_budget.md` §2 "M130 pin assignments in use"; PDM channels §1.A (AUTHORITATIVE plan, `K5_pdm30_channel_plan.md` 2026-04-05)
- Wires joined to pins: `docs/wiring/output/K5_cut_list_v3.txt` FROM column (incl. 2026-05-14 companion-wire addendum)
- A10/A11 BAT_NEG, B15/B16 SEN_0V_A/B, B17/B18 CAN: `docs/wiring/chapters/appendix-g-diagram-requirements-spec.md` lines 175, 195, 888–889
- Connector face: schematic 2-row grid, labeled "cavity numbering per MoTeC techspec — verify at mating face" (exact Superseal cavity geometry not in substrate — flagged on sheet, not invented)

## Substrate inconsistencies surfaced (rendered as orange conflict notes — NOT fixed inline)

| Where | Conflict |
|---|---|
| A14 (AV1) | Double-assigned **within cut list v3**: #4c ETB TPS1 + #102 Oil Pressure; harness spec says AV1 = Fuel Pressure |
| A16 (AV3) | Cut list: #112 Fuel Pressure; harness spec: Oil Pressure |
| A17 (AV4) | Cut list: #4d ETB TPS2; harness spec: TPS1 |
| A25 (AV5) | Harness spec: TPS2; no wire in cut list v3 (TPS2 routed to A17) |
| B02 (UDIG2) | CMP primary; Rear Backup Camera double-assignment from stale 2026-04-13 spec (camera pwr is PDM30:OUT15 #97 in cut list v3) |
| B03/B04 (AT1/AT2) | pdm_power_budget M130 list swaps CLT/IAT vs cut list v3 + appendix-g (sheets show cut list: B03=IAT, B04=CLT) |
| INJ_PWR / COIL_PWR | +12V rails — PDM channel TBD (cut list KNOWN GAPS) |
| #55/#56/#57/#71/#94/#95 | PDM-fed but no OUT channel specified in cut list v3 |
| Alternator | Capacity inconsistent across docs (250A / 220A / 150A) — noted on sheet 3 |

## Unknowns

None blocking — this is a rendering of existing substrate; all gaps above are surfaced on the sheets themselves as orange conflict/TBD annotations per the diagram directive.

## Regenerate

```bash
npm run wiring:pinouts   # or: python3 scripts/generate_pinout_sheets.py
cd docs/wiring/output/pinouts
for f in K5_pinout_M130A K5_pinout_M130B K5_pinout_PDM30; do rsvg-convert -w 1700 -o $f.png $f.svg; done
rsvg-convert -f pdf -o K5_pinouts.pdf K5_pinout_M130A.svg K5_pinout_M130B.svg K5_pinout_PDM30.svg
```
