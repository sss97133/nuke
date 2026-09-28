# Receipt: pin tables for 83 plugs; every wire end checked against its terminal's range; 28 range failures closed from physics

- **Date:** 2026-09-28 (night)
- **Change type:** catalog (`calc-data/catalog/pin_tables/*.yaml`, `families.yaml`, `parts.yaml`, `endpoints.yaml`) + toolchain (`kits_v5.py`, `reconcile_v5.py`, `power_v5.py`, `diagram_v5.py`, `diagram_sections_v5.py`) + pages
- **Follows:** `receipts/2026-09-28_dc-primary-cables-sized-from-physics.md`
- **Ask (owner, 2026-09-28):** "its not looking at if we arent in A tier or S tier.. those should be your indications to send off more repairs to the docs"; "2 and 4 is a physics answer not meatbag skylar answer.. all that means is the design isnt done."
  The previous receipt left 86 of 146 plugs with no pin table (their ends printed ○ and stamped OPEN). This pass repairs that.

## What changed
1. **83 pin-table overlays** (`catalog/pin_tables/<CODE>.yaml`, one per plug: family, wire → cavity, mate, open items, sources), written by two agents (cab 35, body 48) from the makers' documents on file (1978 C/K wiring booklet fold-outs, Blue Sea 7700 instructions, Nu-Relics instructions, JL/Dakota/Victron manuals, Truck-Lite and 4 Seasons pages). `kits_v5._y()` overlays them on `endpoints.yaml` (pins merge; sources/open extend; other keys replace).
2. **Five terminal families added** to `families.yaml`, each with a wire range so rule R1 can judge every end: `dt` (Deutsch size 16, 20–16 AWG), `dtp` (size 12, 14–12), `gm_blade` (Packard 56 series, 20–10), `screw_terminal` (22–6), `contura` (Blue Sea 2145 tabs, 16–14). `kits_v5.py` writes terminations for them (before this, the 16 plugs on the new families wrote none: 831 → 763 wire ends).
3. **Rule R1 (wire gauge inside the terminal's range) then failed 28 ends.** Each closed from a cited number, none from preference:

| ends | failure | physics | close |
|---|---|---|---|
| 8 (door pass-throughs) | 14 AWG window wires in a Deutsch DT 12-way (size 16, 20–16 AWG) | ACI window motor 11 A high load, 20 A stall (Nu-Relics 17383-2 page). 16 AWG carries 15 A at 80 °C (MoTeC PDM manual wiring table, PDF p.51): ceiling 0.85 × 15 = 12.8 A is under the floor 1.25 × 11 = 13.8 A (ch.17 §17.2.3). 14 AWG carries 22 A: ceiling 18.7 A. | 14 AWG stays; each door gets **two** pass-throughs: DTP 4-way (DTP04-4P + WP-4P / DTP06-4S + WP-4S, size 12 contacts 0460-204-12141 / 0462-203-12141) for the four window lines, DT 8-way (DT04-08PA + W8P / DT06-08SA + W8S, size 16 contacts) for lock feed, lock ground, lock bus A/B and the speaker pair, cavities 7–8 plugged 0413-204-2005. PDM30 OUT3/OUT4 current limit 15 A (open: set and bench the stall retry). New endpoints DOOR-L-PASS-P / DOOR-R-PASS-P. |
| 18 (factory switch blades) | 22 AWG switch-input wires into Packard 56-series terminals | 56-series female terminals are made 20–18, 16–14, 12 and 10 AWG (CE Auto Electric Supply page): no 22 AWG size. The signal is a switch-to-0V input at milliamps. | **20 AWG M22759/32** on #53, #121, #33, #46, #45, #42, #43, #67, BRK_SW_0V, IGN_SW_0V, IGN_RUN_B, IGN_START, HL_SW_0V, HL_SW_HEAD, HL_SW_PARK, TURN_SW_R, TURN_SW_0V, HORN_SW (`DECISIONS` / `IMPLIED_DECISIONS`, why = BLADE20; old value kept in `conflicts`). The PDM/M130 ends take it (Superseal 24–16; 8 A outputs 24#–20#, PDM manual p.9). |
| 1 (blower feed #51) | 12 AWG vs the family's provisional 20–14 range | 56 series has 12 and 10 AWG terminals (same page) | family range corrected to 20–10 |
| 1 (ISO_KILL) | 22 AWG signal wire recorded on the dash switch's 0.250 in tab (16–14 AWG) | Blue Sea 7700 instructions p.2: the switch's yellow wire is minimum 16 AWG; the M130 shutdown tap is a tee on that wire, not a second wire on tab 7 | new endpoint **SPL-ISO-YEL** (MiniSeal stub splice on the yellow; the yellow is not cut); ISO_KILL's from-end moved to it. Open: the sleeve size for a 16 + 22 AWG stub (Raychem D-609 datasheet by total CMA; the kit currently picks D-609-03 from the 22 AWG alone). |

4. Parts rows for the Deutsch contacts, housings, wedges and cavity plug (`parts.yaml`, vendor customconnectorkits, each with its page); a pass-through now counts a pin on one half and a socket on the other.
5. Book: the doors sheet draws both pass-throughs per door with their moulded cavities; the switches sheet 2 draws the stub splice; the DC primary sheet places ISO_KILL through it; the dash-switch pins print the 0.250 in quick-connect part; DIG6's designation lost a leaked header string; two notes that named the registry reworded (book lint).

## Sources saved (gitignored, `reference_documents/web_snapshots/`)
`www.customconnectorkits.com__dtp04-4p.md`, `www.customconnectorkits.com__dt04-08pa.md`, `www.ksvlooms.com__mated-dtp-connector-kits-4-way.md`, `ceautoelectricsupply.com__packard-56-series-female-terminals.md` (all HTTP 200, one every 8 s through Firecrawl). Already on file: `www.nu-relics.com__17383-2.md` (motor amp draws), `www.customconnectorkits.com__0460-202-16141.md`.

## Measured (after `reconcile_v5.py` → `check_plug_ends.py` → `options_v5.py` → `manual_v5.py`)
| measure | before this pass | after |
|---|---|---|
| wire ends with a termination row | 763 (new families wrote none) | **831** |
| ends passing every rule | 386 | **396** |
| ends failing any rule | 28 (all R1 range) | **0** |
| ends OPEN somewhere | 417 | 435 (the new families' strip lengths and crimpers are stamped OPEN, not guessed) |
| R1 range | 521 pass / 28 fail / 282 open | 549 pass / 0 fail / 282 open |
| engine-run set | 174 wires, 168 every-rule pass, 0 fail | unchanged |
| buildable harness readiness | 324 wires · L1 181 · L2 316 · L3 316 · L4 302 · L5 2 | unchanged |
| book | 50 pages, 0 lint | **50 pages** (18 text + 26 sheets + 6 DC primary), 0 lint, 476 link annotations in `output/manual/K5_Harness_Manual.pdf` |

The 11 R13 "locked" device failures and 34 wires are the April concept rows already ruled out by locked decisions (they leave the map); unchanged.

## Not done (named close paths)
- `harness_endpoints.family` CHECK constraint on the live table does not list the five new families; `load_map_rows.py` maps them to `unknown` until a one-file migration extends it (one commit, CI). The live map rows are not reloaded in this pass.
- gm_blade: the 56-series terminal part numbers by gauge and the open-barrel crimper are OPEN (not in the tool list); contura: the quick-connect part and crimper OPEN; screw_terminal: ring by stud OPEN.
- DT/DTP strip lengths: Deutsch contact datasheet.
- SPL-ISO-YEL sleeve size; PDM30 OUT3/OUT4 current limits set in PDM Manager.
- Implied-row colours print "?" on the sheets (the colour rule per function is still the naming/colour backlog item from review C23).
