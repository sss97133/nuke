---
id: 2026-05-14_decision-companion-ground-wires
date: 2026-05-14
change_type: decision_proposal
scope: docs/wiring/output/K5_cut_list_v2.txt + chapters/05-build-manifest.md
status: PROPOSED — needs Skylar approval before applying
amends: none
---

# Architectural decision: companion ground wires for analog sensors

Skylar must accept/modify/reject this proposal before it ships. I'm proposing it as the agent's best-available judgment with citations; final call is his.

## The problem

`chapters/05-build-manifest.md` §"ECU-Connected Signal Types" specifies wire counts per signal type:

- `analog_5v` = 3 wires (5V reference + signal + ground)
- `analog_temp` = 2 wires (signal + ground)
- `ecu_crank_cam` = 3 wires (5V + signal + ground, shielded)

`K5_cut_list_v2.txt` enumerates ONLY the signal wire for these signal types. The companion 5V-reference and ground-return wires are absent from the cut list. Result: every analog sensor closure surfaces a missing-companion-wire gap.

**Wires affected (estimated):**

| Signal type | Wires | Expected count | Cut list count | Missing |
|---|---|---|---|---|
| analog_temp (AT inputs) | #109 IAT, #110 CLT, #113 OTS | 2 each = 6 | 3 | 3 ground returns |
| analog_5v (AV inputs) | #102 OPS, #108 MAP, #112 Fuel P | 3 each = 9 | 3 | 6 (5V refs + grounds) |
| ecu_crank_cam (UDIG shielded) | #99 CKP, #101 CMP | 3 each = 6 | 2 each shielded 2C | Shield drain enumeration |
| **Total missing** | | **21** | **~10** | **~11 wires** |

(Plus power-side wires for coils #5-#24 and injectors #13-#20 — separate question covered below.)

## Two possible answers

### Option A: Pigtail-bundled convention (current implicit state)

**Premise:** Sensor pigtails (WPCTS30, WPCKP40, etc.) come with both leads pre-terminated. The cut list intentionally enumerates only the signal lead because:
- Procurement is "buy the pigtail" (covers both wires)
- The ground return lead is identical in spec, length, and routing — listing both is duplicative

**Required:** Document the convention in `chapters/05-build-manifest.md` and add a note to `K5_cut_list_v2.txt` header: "Cut list enumerates signal wires only; pigtail-supplied ground returns terminate at SEN_0V_A/B per pullup pairing (see K5_connector_schedule.txt)."

**Pros:** No new wire IDs. Pigtail purchases cover the wires. Builder-friendly when using stock pigtails.

**Cons:** Terminal counts at M130 are still wrong (every AT input needs a SEN_0V termination that the cut list doesn't track). Routing distance for ground returns can differ from signal if the pigtail is too short to reach SEN_0V (12" leads, may need extension). Hides the actual harness complexity.

### Option B: Enumerate as separate cut list IDs ⭐ proposed

**Premise:** Every physical wire that needs a terminal at the M130 end deserves its own cut list ID. The pigtail provides ONE termination (sensor end); the other end (M130 end) needs its own terminal and routing entry.

**Required:** Add ground-return wire IDs to `K5_cut_list_v2.txt`:
- #109g — Companion ground for IAT (#109) → M130:B15 (SEN_0V_A)
- #110g — Companion ground for CLT (#110) → M130:B16 (SEN_0V_B)
- #113g — Companion ground for OTS (#113) → M130:B15 (SEN_0V_A)
- #102g + #102r — Ground + 5V ref for OPS (#102, analog_5v) — 2 companion wires
- #108g + #108r — Ground + 5V ref for MAP (#108) — 2 companion wires
- #112g + #112r — Ground + 5V ref for FPS (#112) — 2 companion wires

Wire spec for all companions: 22 AWG M22759/32, BLK (for grounds), WHT (for 5V refs) or per existing convention. Length: same as signal wire (same physical run). Terminations: Superseal at M130 end, pigtail-bundled at sensor end.

**Pros:** Accurate terminal counts. Real routing entries for each conductor. Closure ratio jumps on every affected wire (the 6/14 → ~9/14 jump I projected). Matches how WireViz expects multi-conductor cables to be enumerated.

**Cons:** ~11 new cut list IDs to add. The 123-wire count becomes ~134. Builder confusion potential if pigtails are used without realizing the ground is "covered."

## Proposed decision: Option B (enumerate)

**Rationale:**
1. **Terminal counts must be right.** The Superseal terminal order at M130 side depends on knowing every wire that lands at M130 — not just signal wires. Option A leaves ~11 terminal counts wrong.
2. **Routing accuracy.** Ground returns from sensor pigtails don't always route the same as signal — the pigtail's 12" lead may need extension or a different break point. Tracking as separate wires captures this.
3. **WireViz alignment.** The diagram pipeline expects each conductor enumerated; Option A requires special-casing the pigtail-bundled convention in the diagram generator.
4. **Cite-or-unknown rule applies.** Option A creates implicit wires that aren't anywhere in writing. Option B makes them explicit and citable.

**Naming convention proposed:**
- `Ng` = ground return for wire N (e.g., #109g)
- `Nr` = 5V reference companion for wire N (analog_5v sensors only, e.g., #108r)
- `Ns` = shield drain (e.g., #99s) — for SHIELDED 2C wires
- All companion wires inherit signal wire's length, routing path, bundle assignment

**Impact on KPI:** New wire IDs increase the denominator. 134 wires × 14 fields = 1,876 cells (up from 1,722). Numerator jumps as each new companion wire has 6-9 fields immediately cited from its parent.

## What this receipt doesn't do

This receipt **proposes** the decision; it does **not** edit `K5_cut_list_v2.txt`. After Skylar approves, a separate `change_type: substrate_amendment` receipt will:
- Add the ~11 new wire IDs to the cut list
- Update `chapters/05-build-manifest.md` to document the naming convention
- Regenerate WireViz YAML / SVGs for the engine loom (the affected wires are all engine-loom analog sensors)
- Roll up the new closure ratios in existing receipts

## Decision needed from Skylar

- [ ] Accept Option B (enumerate as separate IDs)
- [ ] Accept Option A (document pigtail-bundled convention; no new IDs)
- [ ] Modify: specify a different naming scheme or scope
