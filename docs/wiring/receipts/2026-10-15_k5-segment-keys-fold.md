---
id: 2026-10-15_k5-segment-keys-fold
change_type: substrate_correction
scope: supabase/migrations/20261015190000_k5_harness_segment_keys_fold.sql (key_harness_segments); docs/wiring/calc-data/load_map_rows.py (calls it after the conform); supabase/sql/test_k5_harness_segment_keys_fold.sql
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 30: a segment's wire part and option links are keyed after every load

**Gap.** Two segment keys were written once, by migrations:
- `wire_part_id`, the catalog's exact M22759 part for the wire's spec, gauge and MIL-STD-681 colour digits, by
  reshape v1 (20261014101500);
- option links (`wiring_decision_links` coupled_with), the option couplings of the segment's wire-end plugs, by
  RSI pass 1 (20261014113000).

The segments the conform makes for wires the loader adds get neither. Live as anon on 2026-10-15 18:08Z, after
passes 26 and 29 added 27 wires:
- segments keyed to a wire part read 398 / 670, with 29 keyable and unkeyed and 1 keyed to a part its wire no longer
  names;
- segments carrying an option link read 476 / 670, with 55 on coupled plugs and no link.

**Change:** `key_harness_segments(vehicle)` applies both rules to every live segment.
- **Wire part:** it keys a missing or stale part where the catalog holds the wire's exact part, and leaves a key the
  catalog cannot back alone.
- **Options:** it adds each option link the segment's plugs are coupled with and the segment does not carry.
- The loader calls it after the segments conform.

**Contract (PG17, on top of pass 28):**
- A new segment gets M22759/32-20-2 for a 20 AWG red /32 wire, plus its plug's option.
- A colour the catalog has no part for keeps its old key.
- The fold is idempotent, and visitors cannot call it.

**Expected live after the load:** wire part keys 398 → 427 / 670; option links 476 → 531 / 670. The 243 segments
with no catalog part are mostly April concept rows (no M22759 spec) and colours the catalog does not stock.
