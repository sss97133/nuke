# Receipt: options (variants), the capacity ledger and readiness by layer

- **Date:** 2026-09-28
- **Change type:** toolchain (`docs/wiring/calc-data/`) + map rows (`wiring_decisions`, `wiring_decision_links`) + manual page
- **Follows:** `receipts/2026-09-27_owner-reply-grounds-isolator-batteries-dakota.md`
- **Ask (owner, 2026-09-28):** "the end points of the wiring harness ... when we throw in a feature like tailights, reverse
  lights, running lights, turn signals, secondary location of turn signals, license plate light, rear camera, front camera..
  those start the wiring. we need to be reactive that if we add any new feature that the harness responds accordingly. do you
  do this already"; "yet to decide if we doe electric windows, auto start"; "zuken this up a bit. look at how the pros are
  solving this stuff"; "its a parts list, pin out, cut list and assembly."

## What the pros call it (cited)
- Siemens Capital: "option and variant enabled ... composite 150% design and derivative/variant decomposition"; Capital
  ModularXC "automatic generation of buildable harness variants" from a 150% design (siemens.com Capital HarnessXC /
  ModularXC pages, read 2026-09-28).
- Zuken E3.series Harness Builder 2025: "options and variants ... BOMs and wire lists based on the active option and
  variant selection" (zuken.com, read 2026-09-28).
- So: the **composite** design carries every option; a **configuration** selects options; the **buildable** harness is
  derived. Each wire carries the option it belongs to. That is the mechanism, not a "feature layer".

## What was built
- `calc-data/catalog/options.yaml` — the option dictionary: BASE, AUD, STEPS, RC (decided); PW, PL, FC, AS, TS2, LO4
  (candidate). Every status cites the owner's words or the receipt. PW moved decided → candidate on the owner's 2026-09-28
  words; its history is kept on the row.
- `calc-data/options_v5.py` — assigns each wire its option (pattern, then subsystem, else BASE); readiness per wire in
  five layers (plugs known · both ends · crossing settled · terminals at both ends · material covered) plus length state;
  roll-ups by option, by section, configuration vs composite; the **capacity ledger** (61-pin, body bulkheads A/B/P,
  grommet, PDM30/PDM15 outputs by rating and inputs, M130 pins, ground banks, wire stock); and what the candidates
  would take from the spares. Writes `reg['options'|'readiness'|'capacity']` and `OPTIONS.md`.
  Run order: `reconcile_v5.py` → `check_plug_ends.py --wires` → `options_v5.py` → `manual_v5.py`.
- `manual_v5.py` — page 1-1 gains "Where the harness stands"; new page **1-5 Specifications** (options, readiness by
  section, connector and channel fill, candidate demand). Lint-clean.
- `load_map_rows.py` — one `wiring_decisions` row per option (`opt-<code>`, kind architecture; decided → status
  decided; candidate → status candidate, work_status needs_owner) with `coupled_with` links to every plug the option's
  wires touch. A status change supersedes the live row.

## Measured (registry after `options_v5.py`, 2026-09-28)
| set | wires | both ends | crossing | terminals both ends | material covered | length m / e / u |
|---|---|---|---|---|---|---|
| buildable (base + decided) | 312 | 304 | 308 | 285 | 2 | 5 / 173 / 134 |
| composite (every option) | 328 | 320 | 324 | 301 | 2 | 5 / 176 / 147 |

- Material covered = 2 of 312: the captured carts (2026-09-26) predate the 22 AWG → M22759/16 change and most terminal
  picks, so the kit diff reads almost everything as short. The carts must be regenerated from the registry (state 0l).
- Plugs known (L1) = 110 of 312: body-side plugs still carry family `open` (no device pin table read yet) — finish-line
  item 1a.

## Capacity ledger (facts)
| resource | capacity | used | spare |
|---|---|---|---|
| 61-pin engine bulkhead | 61 | 58 | c, t, u |
| body bulkhead A / B / P | 12 / 12 / 4 | 12 / 12 / 1 | 0 / 0 / 3 (P = size-12 power contacts) |
| PDM30 outputs 20 A / 8 A | 8 / 22 | 8 / 21 | 0 / 1 |
| PDM30 inputs | 16 | 14 | 2 (DIG8, DIG16) |
| PDM15 outputs 20 A / 8 A | 8 / 7 | 4 / 5 | 4 / 2 |
| PDM15 inputs | 16 | 2 | 14 |
| M130 pins | 60 | 49 | 11 |
Sources: PDM30 datasheet p.1 (16 inputs, 8 × 20 A, 22 × 8 A); PDM user manual comparison table (PDM15: 16 inputs, 8 × 20 A,
7 × 8 A; outputs 1–8 are the 20 A ones); kits_v5 firewall map; catalog/endpoints.yaml pins.

**Verdict on the candidates:** front camera + the rest would take 4 PDM30 outputs against 1 spare and 3 PDM30 inputs
against 2 spare — they do not fit on the cab PDM. The engine PDM15 has 6 spare outputs and 14 spare inputs, read over CAN.
Body signal crossings need bulkhead C (A and B are 12/12; P is the size-12 power connector).

## Also this session
- PCS TCM-2650 ZGP setup guide rev 2 (23 pp.) fetched from the Zero Gravity Dropbox (the Zero Gravity order email, 2024-09-11) and saved
  as `reference_documents/component_drawings/PCS_TCM-2650_ZGP_6speed_setup_configurable_tuning_rev2.pdf`. It has no
  4WD/low-range input and no harness pin drawing. Emailed Jim Miller (ZGP) for the harness drawing, a low-range flag, and the
  CAN broadcast (Gmail, 2026-09-28).
- Docs port to main (PR #361) and client-detail redaction (PR #362).

## Open (named close paths)
- Bulkhead C design (Deutsch DT 12-way, family of A/B) with the candidates' crossings reserved.
- Carts regenerated from the registry so L5 material means something.
- Body plug pin tables from the makers' documents (L1).
- The frontend `FeaturesPanel` / `deriveBodyConfig` (April 2026 K5Features toggles) is the stale precursor of this; it should
  read the option rows, not its own list.
