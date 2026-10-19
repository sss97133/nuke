---
id: 2026-10-15_k5-wire-start-first-word
change_type: substrate_correction
scope: docs/wiring/calc-data/load_map_rows.py (the wire start's plug code falls back to the first word)
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 40: a wire starts at the plug its record names by its first word

**Gap.**
- Speaker lead 26a is chained in the model as AMP to SPK-FL plus DOOR-L-PASS to AMP. Live as anon at 20:12Z, its two
  routed segments sum to 28.2 ft against a 6.9 ft estimate. The physical run is AMP to DOOR-L-PASS to SPK-FL.
- The cause: the registry writes the start as "AMP CH1+". The loader's plug parse splits only on " (", ":", " ->" and
  " +", so "AMP CH1+" matched no plug. The fallback took the first end listed, DOOR-L-PASS, as the wire's start. The
  segment fold (conform_harness_segments) orders a wire's ends start, then pass-throughs, then far end, so the chain
  began at the door.
- Replaying the loader's parse over the registry (k5_registry.json at e33215065): 10 wires change their resolved
  start, all "AMP CH<n>±" or "AMP SUB±". Four of them have a pass-through: 26a, 26b, 27a, 27b. The other six have two
  ends, and the fallback already chose AMP.
- Every other wire with an unresolved start (61 of them, written "M130:A03", "PDM30:OUT14 (A13)" and so on) resolves
  through the ECU/PDM pin rule or the pin splice beside it.

**Change.** When the whole start text matches no plug, the parse tries its first word.

**Expected live after the load:**
- 4 wires are re-rowed, with their start at AMP.
- conform re-chains their segments AMP to DOOR-x-PASS to SPK-x. The two-hop plans clear to unknown, then the planner
  re-plans each hop from its route.
- The multi-drop door-lock buses (LOCK_BUS_A/B: one switch, two actuators, the other switch) remain a design-topology
  question. Their ends are a tree, not a chain, and they are not addressed here.
