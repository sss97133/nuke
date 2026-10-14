---
id: 2026-10-14_k5-harness-model-tab
change_type: feature
scope: v_harness_coverage.grain; MODEL tab on the wiring page (owner only), kit Measures per layer
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261014235500_k5_harness_scoreboard_grain.sql
contract: supabase/sql/test_k5_harness_scoreboard_grain.sql (db-contracts); nuke_frontend/src/components/wiring/model/harnessScoreboard.test.ts (vitest)
---

# RSI pass 10: the model shown where the owner works

The owner, on the harness data model: "I wish you could show it to me in all of its glory." His surface for this is the
vehicle's wiring page, not an artifact (owner, 2026-09-26). The harness scoreboard (`v_harness_coverage`, stack SH) had
no reader on that page.

**Change:**
- **Database.** `v_harness_coverage` gains a last column, `grain`, saying what each measure counts: segments, wire
  ends, nets, GM circuits, factory circuits or wires.
  - The grains come from an explicit table of the 22 measures.
  - The contract fails if any measure lacks a grain, so a new measure must name one.
  - The rows, their values and the read-only grants are unchanged.
- **Frontend.** A MODEL tab on the wiring page, owner only. Visitors see only the MAP tab, by the owner's
  2026-09-29 rule that other people see results, not process.
  - It renders one kit `Measures` block per layer of the data machine, in stack order (log → outcome).
  - Every number shows "n of N grain · date", with no percentages.
  - Data comes from one typed read (`useHarnessScoreboard`) through a pure mapper (`toLayers`), tested in vitest.
  - The old overlay engine's header chips (ECU, cost) are hidden on this tab, as on MAP.
  - No new inline styles; the design ratchet counts went down.

**Unknowns:** none.
