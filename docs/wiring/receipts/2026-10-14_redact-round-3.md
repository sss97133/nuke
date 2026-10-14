---
id: 2026-10-14_redact-round-3
change_type: privacy_redaction
amends: 2026-09-29_redact-order-numbers-round-2
scope: docs/wiring (state doc, WIRING_SYSTEM_KNOWLEDGE, chapter 07, four receipts, calc-data orders, kits_v5, regenerated-in-place k5_registry carts)
found_by: K5 full audit, records auditor, 2026-10-14 (lead skylar-17)
---

# Redaction, round 3: what rounds 1 and 2 missed

The repo is public (AGENTS.md invariant 4). The 2026-10-14 audit found these left after #437. Same standard as round 2:
totals and private transactions are masked `$•••`, per-item vendor list prices stay (they are market prices).

| What | Where | Now |
|---|---|---|
| Three price rows citing the other Desert Performance customer's 2019 invoice | `chapters/07-motec-ecosystem.md` lines 8, 88, 107 | `$•••` (appendix C and ch.04 were masked in round 1; this chapter was missed) |
| The wiring subcontractor's email and phone | `WIRING_SYSTEM_KNOWLEDGE.md` line 32 | "contact in the DB" |
| The client's surname | `receipts/2026-05-17_db-forensic-audit-k5-records.md` line 35 | "the client's" |
| The owner's ProWire cart id | state rows 0f, 0j, 0l, 0p; three receipts; `kits_v5.py` heading; the cart snapshot's file name and `account_cart` | "the ProWire cart"; file renamed `orders/prowire_2026-09-26.json`; `account_cart` null (the id stays in the DB's cart observations) |
| Cart totals the round-2 pass left in receipts and data | receipts 2026-09-25 (lines 11, 62, 118), 2026-09-26 dave-sheet (102), 2026-09-26 kits-tools (18); `total` in both cart snapshots and in `k5_registry.json['carts']` | `$•••` or removed; `kits_v5.py` copies `total` only when present, so a regeneration keeps it out |

`check_plug_ends.py` after the change: 939 ends, 432 pass all, 0 fail, 507 open (unchanged).

## Not changed: the owner's call
- **Three 2025-10-12 seed scripts in `scripts/`** (`blazer_build_complete.sql`, `import_scott_blazer_build.js`,
  `execute_blazer_build.js`, plus `update_blazer_totals.js`) carry the client build's priced line items (about 111
  amounts) under a vendor's business name. Round 2 retired a similar script because its rows were already in the
  database; here the target table `build_line_items` no longer exists, so deleting the scripts could lose the only
  copy outside git history. Owner decision: move the line items into the DB through a sanctioned writer and then
  retire the scripts, or keep them.
- **NUKE LTD's street address** appears in six files (WIRING_SYSTEM_KNOWLEDGE, appendices D and G, a 05-14 receipt,
  two output SVGs). Whether the shop address is public is the owner's call.
- Git history still holds the original text (rewriting history is destructive and the owner's call, as in round 2).
