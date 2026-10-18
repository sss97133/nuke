---
id: 2026-09-29_redact-order-data
change_type: privacy_redaction
scope: docs/wiring receipts, catalog/endpoints.yaml, calc-data/DOSSIERS.md, calc-data/k5_registry.json
found_by: layout-ui lane (first case), pieces lane (scan), 2026-09-29
---

# Redaction: purchase order numbers, buyer account, payment method and amounts out of the public repo

The repo is public (AGENTS.md invariant 4; CLAUDE.md "private data ... lives only in the database"). Five files
carried the owner's marketplace order numbers (19 occurrences, 14 orders), the amounts paid on those orders, and
one heading with the payment method, buyer account and ship-to. Each order is already a provenance record in
`vehicle_observations` (vehicle e08bf694); the text now cites the record (`order record obs:<id prefix>`), and the
amounts on those rows read `$•••` (the masking convention).

- Replaced: order numbers → record ids; amounts on order rows → `$•••`; the payment/buyer/ship-to parenthetical →
  "on the order records in the database".
- Not changed: listing titles, item ids of public listings, dates, part numbers.
- Still in git history: the original text. Rewriting history is destructive and is the owner's call.
- Not in this pass: the shop's business address in scripts and migrations (a public business address; flagged for
  the owner), and cart and price totals elsewhere in the state doc.
