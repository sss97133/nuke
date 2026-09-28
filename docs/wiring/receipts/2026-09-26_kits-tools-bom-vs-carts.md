---
id: 2026-09-26_kits-tools-bom-vs-carts
date: 2026-09-26
change_type: substrate_extension
amends: 2026-09-26_registry-v5-phase0-reconcile
scope: docs/wiring/calc-data/{kits_v5.py, reconcile_v5.py, k5_registry.json, catalog/*.yaml, orders/*.json}
status: APPLIED (Phases 3 + 5, first pass, of ~/.claude/plans/replicated-hatching-sutherland.md; engine scope)
owner surface: Claude Doc "K5 Parts & Build Book" rev 111, section "Master list vs carts: engine plugs and kits (Sep 26)"
---

# The master list now builds the kits, names the tool per step, and checks the carts

## Why
Owner, 2026-09-26: "if we have a master list it should directly correspond to the parts order and the master should designate in the data which tools are present in every step… we should be able to perfectly articulate every[thing] except the exact cut lengths of the wires… and the turns and where we group heat shrink."

## What was built
- **Cart snapshots**, captured from the owner's carts (read-only; browser tab closed after):
  - `orders/prowire_Q27156_2026-09-26.json`: 96 lines, $3,620.23. The line sum equals the cart total.
  - `orders/digikey_2026-09-26.json`: 10 lines, $313.37. The four fuse lines' prices were not captured; their $38.57 sum is derived.
  - `orders/other_2026-09-26.json`: ICT, the eBay D38999 pair, the eBay AFM8 + K43, the Amazon Blue Sea 2019 + MS25171-3S. None bought.
- **Curated catalog** (`catalog/`). Every fact carries its source or `UNKNOWN: <what closes it>`.
  - `parts.yaml`: 70 codes, keyed exactly as the carts show them.
  - `tools.yaml`: 21 tools.
  - `families.yaml`: 10 termination families, each an ordered list of steps with the tool per step.
  - `endpoints.yaml`: 52 plugs, studs and ports, each with its kit.
- **`kits_v5.py`**, called by `reconcile_v5.py`, so one command rebuilds everything. It attaches these sections to `k5_registry.json`:
  - `endpoints`, `terminations` (315 wire ends), `splices`
  - `bom`, `carts`, `diff`, `tools`
  - It also writes `KITS_REPORT.md`, which is generated and gitignored.
  - The firewall cavity map is imported from `scripts/generate_connector_build_sheets.py`, not copied.
- **Registry decisions**: `DECISIONS` in `reconcile_v5.py`. The old value stays in each row's `conflicts`, and nothing is deleted.
  - #60 and #61 retired: superseded by #ECU_PWR (v4.1 receipt).
  - #25 retired: mechanical water pump (state 0f(a)).
  - #63/#6/#59/#PDM_BPOS: 0 → 2 AWG (state 0h, 0i). Lengths now come from the twin polylines (1.1 / 3.1 / 3.5 / 1.9 ft), replacing the 4.6 ft zone estimates.
  - #32: 8 → 4 AWG (17:30 addendum).
  - #30a/#30b: red/black (the carted colours).
  - Implied G1 gets its twin length of 3.5 ft. The UTC wires get Dave's CAN colours.

## Vendor facts gathered (ProWire, serial fetches 12–15 s apart, pages cached)
- **Sitemap and robots.** One `sitemap.xml` request gave product URLs. robots.txt disallows `/search`, so search was never used. One connection timeout at 14:27; a single probe at 14:36 returned 200, and fetching resumed. There were no 403s or 429s.
- **SSC-N (M130/PDM contact).** Tooling chart: AFM8 + K1S (M22520/2-02), selector 24→5, 22→6, 20→7, 18→8, 16→8 (60.16 lbf tested at 16 AWG). Alternatives: AF8 + TH1A, MH860 + 86-1S, HDT-48-00.
- **M800-KIT-N.** 34 + 26-way Key 1 housings plus 65 SSC-N. Fits M130 and PDM30; both datasheets list #65044/#65045.
- **Kit terminal ranges.**

  | Kit | Terminals / seals | Other contents |
  |---|---|---|
  | LS-CRANK / LS-CAM | 20–18 AWG | — |
  | 68201 knock | 18–16 AWG | — |
  | 68212 DBW | 20–22 AWG | TPA + axial lock |
  | COIL-CONN-LS2/7 | range not stated | 4 terminals, 4 seals, TPA |
  | 8CYLK-90 | **no terminals** | 8 housings + 8 90° boots + markers |

- **Tools and prices.**

  | Tool | Price | Note |
  |---|---|---|
  | K1S | $126.36 | |
  | GT150 crimper 15359996 | $156.49 | 22–16 AWG, wire + seal in one stroke |
  | Metri-Pack 150/280 crimper 12155975 | $110.40 | |
  | 3137CT (AD-1377) | $158.40 | Cavities 26–20 / 20–16 / 16–12 |
  | 18840 hex crimper | $147.01 | 238LTP: GREY die |
  | Stripmaster 45-1987 / 45-1611 | $313.54 each | |
  | New AFM8 | $698.06 | vs the eBay $50 |

- **Other facts.**
  - The 238LTP page lists CPA-100-3/4-BK, black, for negative lugs.
  - PRO-IDENT-KIT = MIL-STD-681 colour-ring markers.
  - RT125 epoxy is rated −55…+150 °C, IP68.
  - M-RJ45-CABLE (1 m panel Ethernet): $15.44.

## Findings (owner surface lists them with fixes)
1. Crank, cam and knock kit terminals don't cover 22 AWG (20–18 and 18–16).
2. 8CYLK-90 has no terminals: 16 needed, PN and crimper UNKNOWN.
3. Coil plugs have 4 cavities, but the registry has 1 trigger per coil. The +12 V, power-ground and low-reference branches are missing: 24 wires.
4. The 8 injector +12 V branches are missing.
5. M130 5 V/0 V pins carry 3–9 wires each. Four splices at the ECU; B15 and B16 need the yellow D-609-05, the top of its range.
6. PDM #51 (10 AWG) is past D-609-05's 12 AWG limit.
7. CAN #62 is 24 AWG in the registry; there is no 24 AWG in any cart.
8. No black CPA for negative lugs (ch.18 §7 layer 4).
9. The M130 Ethernet panel cable is in no cart.
10. **Firewall.** The engine-only rule (row 50) frees 9 cavities. 59 of 61 are then used, leaving 2 spare. ISO_KILL and the alternator sense wires are still unplaced.
- **Carts vs need.** Wire: 45 of 54 lines covered, 5 white prototype stock, 2 claimed by G2/G3 (no length), 2 short (24 AWG CAN). Parts: 32 covered, 15 formboard stock, 10 power chapter, 3 tools, 4 missing/open, 1 unclaimed (D-609-03 ×20).
- **Tools.** Priced tools to buy total $1,405.74. The EV1 crimper and the 2–8 AWG cable stripper are unpriced.

## Unknowns (each with its close path)
- Strip lengths for SSC-N, M39029 #20, GT150, the kit terminals and D-609. Close with the contact datasheets / ProWire.
- EV1 terminal PN + crimper; coil kit terminal range; crimper for the coil/DBW/knock kits. Close by asking ProWire.
- TB 12699160 cavity letters; coil pinout; pedal 6 vs 9 pin; Quantum hanger plug; alternator pigtail count. Close with owner photos.
- Lug torque per stud (Blue Sea 2019, Littelfuse MEGA/MIDI, starter, alternator, PDM M6). Close from the datasheets.
- G2/G3, UTC, ISO_KILL and PCS wire lengths. Close with the power/trans chapters and the twin.

## Deferred by design
Cut lengths, twist/turns, and the DR-25/SCL grouping are set at the formboard (owner 2026-09-26; canon ch.18 §6–8).

## Verification
- `python3 docs/wiring/calc-data/reconcile_v5.py` prints: 174 active (3 retired), 243 candidate, 19 implied, 52 endpoints, 315 wire ends.
- The ProWire snapshot line sum is $3,620.23, equal to the cart read-back. The DigiKey snapshot sums to $313.37, with the fuse sum derived.
- The owner doc was read back at rev 110 and corrected at rev 111: the DBW kit already takes 20–22 AWG, so only its crimper is asked.
