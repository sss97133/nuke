# Receipt — Wiring Competence Canon (chapters 16-18 + pre-flight gate)

**Date:** 2026-06-18 · **Change type:** canon / capability-build (consolidation, not new design) · **Status:** executed

## Why
Across a long K5 wiring session an agent produced pinouts / diagrams / schedules that the builder (Dave / Desert Performance) shredded one after another — body circuits on the engine-only firewall connector, "ETB" jargon, a FUSED starter (cranking is exempt), an ugly hand-rolled diagram. Root cause, every time: **produced before grounding.** The answers were already in the repo. Skylar named it: "imposter." This receipt installs the cure.

## What this is
A competence-foundation workflow (`wf_f053b1be-683`) audited our substrate against a pro-wiring curriculum and found **5 of 6 domains already STRONG** — ~70-80% of the trade competence is already in our docs. The fix is therefore **consolidation + a gate**, not construction, and it lives in the existing manual (no new island).

## Changes
1. **Three cited canon chapters** (drafted + adversarially citation-audited via `wf_b2accc9b-ab3`, all `fix_then_ship`, fixes applied):
   - `chapters/16-wire-and-protection-canon.md` — wire (/16 vs /32), gauge sizing + the which-chart rule, parallel-conductor doctrine, the impossible "0 AWG /16" resolution, crimp-not-solder, the M23053/DR-25/SCL tree, the A-620 pull-force table.
   - `chapters/17-power-architecture-ecu-pdm.md` — protect-the-wire, OCP 7/40/72in + cranking exemption, battery→isolator→stud→PDM topology, MoTeC isolator + ECU-shutdown secondary, star ground, ECU-is-derived + signal-type→wire expansion, lifelines, engine-vs-body segmentation.
   - `chapters/18-construction-and-segmentation.md` — design-first order of operations, concentric-twist DESIGN, Dave's calculate-first/cut-last, the 1:1 formboard jig, the lug/heat-shrink stack, the D38999 #20-only firewall rule.
   - Each rule is an atom ending in a citation or an explicit `(UNKNOWN — needs ingestion: …)`. The adversarial auditors caught the canon's own integrity risks (an uncited "corrected twist" fact, a "both cross-linked" overstatement, a mis-attributed "2 AWG", line/path-pointer errors) — all fixed.

2. **Substrate corrections** (in `chapters/appendix-b-corrections.md` + transparent inline `> SUPERSEDED` markers, originals retained):
   - `03-tier-system.md:46` — concentric twist "alternating-direction" → WRONG; correct = same direction, same pitch. Replacement value **PENDING INGESTION** (HP Academy / MIL-W-22759) — not fabricated.
   - `output/K5_harness_protection_catalog.md:627` — 22 AWG pull-force 10 lbf → 8 lbf (A-620; src `research/2026-05-21_milspec_heatshrink_protocols.md:157`).
   - `output/K5_wire_spec_and_costs.md:138` — 4 AWG "welding/marine" → M22759/16 (Tefzel lock; src `K5_WIRING_STATE.md:21`).
   - NOTE: the two `output/*` files are generated artifacts — re-emit these markers from their generator on next regen.

3. **Locked decisions** added to `K5_WIRING_STATE.md` §1: the canon+gate, DC-primary topology (battery→isolator→stud, starter unfused, isolator+ECU-shutdown, star ground), DC-primary gauge (Dave 2 AWG OR 2×4 AWG /16 parallel; "0 AWG /16" superseded), engine-only firewall (body circuits migrate, resolving the row-43 overflow), and Dave's vocabulary as the deliverable standard.

4. **Pre-flight gate** wired into `.claude/rules/wiring-receipt.md` (the ⛔ block) + pointer in `wiring-wire-closure-protocol.md`, so every future agent-form hits it before producing. Memory: `feedback_competence_lives_in_substrate_ground_first.md`.

## Open / unknown (honest)
- **External ingestion targets** (prioritized; HP Academy needs Skylar's BYOK login): IPC/WHMA-A-620 Ch.19 pull table + Class defs · HP Academy Pro Motorsport Wiring (twist-layer design, 1:1 formboard) · ProWire/AS22759 /16+/32 datasheets (settles 0 AWG) · MoTeC PDM Manager + M1 GPR · TE/Deutsch Autosport+DTM · MIL-38999 mixed-insert tables · ABYC E-11 + AS50881 · AMS-DTL-23053 slash sheets · K5 load datasheets + **CVF alternator PN + LS3 starter cranking spec**.
- **Twist replacement rule** is marked UNKNOWN-pending-ingestion in all three chapters (the wrong claim is superseded; the correct value awaits a real source).
- **DC-primary gauge** reconcile to Dave's number at mockup.
- **Engine-only firewall**: body circuits identified; regenerate the connector sheets engine-only (frees the overflow) — not yet executed.
- The connector build sheets are still **v4** (missing the v4.2 ECU lifelines + APS pins) — regenerate from v4.2.

## Citations
Workflows `wf_f053b1be-683` (competence foundation) + `wf_b2accc9b-ab3` (canon build, per-chapter adversarial citation audit). Substrate: `research/2026-06-10_power_spine_builders_study.md`, `research/2026-05-21_milspec_heatshrink_protocols.md`, `reference/{connectors,sensors,motec,accessories}/*_REPORT.md`, `K5_WIRING_STATE.md`, `K5_EE_AUDIT.md`, `K5_wire_spec_and_costs.md`.
