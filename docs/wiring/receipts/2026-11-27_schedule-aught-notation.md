---
change_type: substrate_correction
scope: existing wiring schedule and XLSX gauge presentation
unknowns: []
---

The current schedule and Excel export display the stored numeric gauge key
verbatim. The existing aught key contract uses 0 for 1/0 and -1 for 2/0; an
internal negative key is not a useful wire-order label. The governing source
identity correction is `2026-11-26_primary-calculation-status.md`, grounded in
chapter16 and `research/2026-11-26_thermal-source-custody.md`. The numeric domain
is retained by the existing conditioned wire-reference owners.

One presentation helper maps the stored aught keys to their trade labels for
both the visible/searchable schedule and Excel cells. Ordinary positive gauges,
unknown values, record keys and numeric source rows retain their values. The
workbook stores aught labels as literal text, preserving a slash label through
an actual OOXML round trip. This selects no gauge, changes no physical source,
length, stock or supplier quantity and publishes none of the held extended
worksheet or evaluated-manual implementation.

Validation: the existing schedule contract exercises numeric-key preservation,
ordinary versus aught distinction, shared screen values and literal Excel
round-trip cells. The enforced repository gate and exact PR review/CI apply.
Original builder and order acceptance remains open.
