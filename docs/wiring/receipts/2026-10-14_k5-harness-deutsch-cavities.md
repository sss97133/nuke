---
id: 2026-10-14_k5-harness-deutsch-cavities
change_type: data_model
scope: six cited Deutsch DT / DTP cavity models; K5 wire ends on Deutsch plugs keyed to them
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261014234500_k5_harness_deutsch_cavities.sql
contract: supabase/sql/test_k5_harness_deutsch_cavities.sql (PG17, run by the db-contracts CI job)
---

# RSI pass 9: Deutsch cavities

**Gap.** After pass 2, 295 of the 884 K5 wire ends on live segments were keyed to a cavity. 49 more sit in Deutsch DT
or DTP housings, measured read-only 2026-10-14. Each such plug names its housing part numbers, and the build rows number
its cavities 1-N:

| Plug | Housing |
|---|---|
| Door pass-throughs | DT 8-way |
| Door power pass-throughs | DTP 4-way |
| Retired body bulkheads A and B | DT 12-way (A and B key) |
| Retired body bulkhead C | DT 6-way |
| Retired body bulkhead P | DTP 4-way |
| Fuel level sender | DT 2-way |
| Fuel pump | DTP 2-way |

**Source.** Each housing's stored vendor page (customconnectorkits.com, captured 2026-09-28) states its cavity count in
the product heading, for example "DT04-08PA - DEUTSCH DT 8 Way Gray Receptacle Connector, A Key".

**Method: numbering only.** Deutsch numbers its cavities on the housing face, and the build rows use the same numbers.
Positions are not transcribed from a drawing. A layout serves both halves of a pair, so it carries no housing part.

**Result:** 49 of 49 keyable ends keyed; the K5 cavity keys go from 295 to 344 of 884. The WIDEBAND plug names no part
number, so its 4 ends stay unkeyed.

**Unknowns:** none.
