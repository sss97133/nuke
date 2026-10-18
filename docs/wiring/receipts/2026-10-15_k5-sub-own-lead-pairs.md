---
id: 2026-10-15_k5-sub-own-lead-pairs
change_type: substrate_correction
scope: docs/wiring/calc-data/reconcile_v5.py (implied rows 30c/30d; SUB_JMP_P/N retired); catalog/endpoints.yaml (SUB, SUB-2, AMP); catalog/pin_tables/{SUB,SUB-2,AMP}.yaml; k5_registry.json, WIRE_CHECKS.json and OPTIONS.md regenerated
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 29: each woofer takes its own pair of the amp's sub harness

**Gap.** The design paralleled the two JBL Club 102SL woofers with jumpers (SUB_JMP_P/N, 10 AWG) from woofer 1's push
terminals to woofer 2's. That put two 10 AWG wires in each of woofer 1's push terminals, and the registry modelled the
pair as a stub splice beside each terminal with no part that fits ("SUB + / - push terminal", splice None). The device
terminal research of 2026-10-15 (~/nuke-logs/k5-rsi-20261014/device_terminal_facts.md) found:
- **The push terminal can't take both wires.** JBL's Club shallow-subwoofer owner's manual
  (web_snapshots/www.sonicelectronix.com__club10_12.md) says the push terminals take bare or tinned wire from 14 to
  8 AWG, through one connection hole. Two 10 AWG wires are 20,760 CM against 8 AWG's 16,510.
- **No splice can join them either.** No MiniSeal stub splice takes 10 AWG: TE/Raychem D-609-05 tops out at
  6,755 CMA.

**Evidence for the fix:** the JL VX700/5i connection guide (web_snapshots/www.retailspecs.com__VXi_700_5_MAN.md,
Subwoofer Output Harness) says "Two pairs of wire leads are included to facilitate multiple subwoofer wiring. Both
positive and both negative wire leads are connected in parallel inside the harness" (brown +, brown/white −). The two
woofers stay paralleled at 4 ohm each, 2 ohm on the 300 W sub channel, as the design intends. The paralleling moves
inside the amp's harness.

**Change:**
- #30c (+) and #30d (−) run from the amp's second sub lead pair to woofer 2: 10 AWG M22759/16, red and black (the
  carted spool), 18.4 ft as #30a/#30b because both woofers sit in one box.
- SUB_JMP_P and SUB_JMP_N retire, with the reason recorded; they stay in retired_implied.
- SUB's pin table keeps one wire per push terminal and drops `splice_point` and its open bench question. AMP gains
  the pair 2 leads and drops the open "owner's call" item, which is an engineering call this evidence settles.

**Result (regenerated; a second rebuild is byte-identical):**
- Splices 54 → 52: the two impossible sub splices are gone.
- BOM: M22759/16 10 AWG red and black each 21.2 → 42.3 ft. Woofer 2's own run replaces a jumper that had no length.
- Wire checks: the counts are unchanged, and #30c/#30d pass R8 as the jumpers did.
- `diagram_v5.py --check` exits 0.

**Unknowns:** the amp's mount spot (cargo area, open on AMP), which sets the real run length of all four sub
wires. Once it is placed, the 18.4 ft estimate (the zone estimate #30a carries) is replaced.
