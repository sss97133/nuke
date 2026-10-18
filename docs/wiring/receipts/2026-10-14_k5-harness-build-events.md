---
id: 2026-10-14_k5-harness-build-events
change_type: data_model
scope: harness_build_events (new, append-only); log trigger on vehicle_custom_circuits.build_state; outcome measure on the SH scoreboard; one SH need
proposal: schema_proposals 6e3ceb06 (approved for build 2026-10-14 under owner direction)
case: docs/ledger/theory/data-machine-cases.md 13.12.2 / 13.12.3
migration: supabase/migrations/20261014233000_k5_harness_build_events.sql
contract: supabase/sql/test_k5_harness_build_events.sql (PG17, run by the db-contracts CI job)
---

# RSI pass 8: the build is logged

**Gap.** Stack SH's outcome layer was empty, and build progress had no log. `vehicle_custom_circuits.build_state`
(uncut, cut, terminated A, terminated B, routed, verified) was overwritten in place. Who cut a wire, and when, was lost
the moment it was written.

**Measured 2026-10-14:** 2,469 rows (528 live), none past 'uncut'. Since #1215 only the vehicle's signed-in owner, and
the service role, may change the state. The log starts before the first cut.

**Change:**
- `harness_build_events` gets one row per change: from, to, who (`auth.uid()` and the role) and when.
  - It is append-only; `vein_append_only` refuses updates and deletes.
  - It is readable where the vehicle is public or the reader owns it.
  - Only the trigger writes it.
- An AFTER UPDATE OF build_state trigger on `vehicle_custom_circuits` logs every change from every write path. A write
  that doesn't change the state logs nothing.
- New scoreboard measure: "decided wires with a recorded build step".

**Next, as the scoreboard names it:** cut lengths (`measured_length_ft`) graded against the plans. That is the
prediction layer's grade.

**Unknowns:** none.
