---
change_type: substrate_correction
scope: existing wiring cards, search and physical block-diagram gauge labels
unknowns: []
---

PR4070 corrected schedule/Excel aught labels under the source identity recorded
in `2026-11-26_primary-calculation-status.md` and chapter16. Existing selected
wire, connected-wire, search and physical-piece labels still expose numeric
keys, and the endpoint label truthiness condition hides stored key0 (1/0).

Extend the same presentation rule through the existing shared workspace label
helpers. Preserve ordinary AWG1/2/3, source values, null unknowns, physical record
IDs and conflict states. The selected-piece accessible label and conflict text
must both retain 1/0 versus 2/0 rather than showing numeric0 versus -1.
No gauge selection, physical quantity, route, device evidence or held manual
implementation is introduced. The original builder/order acceptance stays open.
