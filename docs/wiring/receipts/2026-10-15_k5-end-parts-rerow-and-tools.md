---
id: 2026-10-15_k5-end-parts-rerow-and-tools
change_type: substrate_correction
scope: supabase/migrations/20261015260000_k5_harness_deutsch_tool_catalog.sql (two catalog_parts rows + the key fold); supabase/sql/test_k5_harness_deutsch_tool_catalog.sql; docs/wiring/calc-data/load_map_rows.py (paged reads; changed wire ends re-written); docs/wiring/calc-data/catalog/tools.yaml (HDT-48-00 and 3137CT part maps); docs/wiring/calc-data/fetch_sources.py (+ the HDT-48-00 page); docs/wiring/calc-data/export_route_lengths.py (ordered view reads); registry rebuild (one source string)
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 41: wire ends follow the registry, and the Deutsch and MIL-splice ends get their crimp tool

**Gap (live as anon, 20:55Z):** 475 of 991 wire ends are keyed to a crimp tool.
- None of the 58 Deutsch ends is: 42 on DT 0460-202-16141, 12 on DTP 0460-204-12141 and 4 on DTM 0462-201/005-20141.
  The DT and DTP families' crimp step names the HDT-48-00 (families.yaml), but tools.yaml mapped it only to SSC-N.
- None of the 48 ends on M81824/1-2 and M81824/1-3 in-line splices is either. The 3137CT mapped only to D-609-03/04/05.

**Two loader faults behind it:**
- **An end was written once.** `load_map_rows.py` inserted a wire end only when its wire and plug had no live end. It
  never compared cavity, contact, seal, tool or family again, so a tool map added to tools.yaml would reach only ends
  written later. (Measured: today all 999 live v5 ends match the registry, so no drift has happened yet.)
- **Reads stopped at 1,000 rows.** The production API returns at most 1,000 rows a request, whatever the limit. Anon
  with limit=5000 on the K5's wire ends got 1,000. The loader's read of live ends has no limit, and there are 999 live
  ends with a wire. One more end and the read would truncate. The loader would then re-insert ends every run (the
  live-key index would refuse them) and miss stale ones.

**Change:**
- `API.get` pages by offset in a stable order (id, or the order the query gives) unless the query asks for 1,000 rows
  or fewer.
- An end whose cavity, contact, seal, tool or family differs from the registry is written again. The old row is
  superseded first (the live key is unique on wire + plug) and points at the new one. The resync fold moves segment ends
  by plug code, and the evidence and key folds follow by plug code.
- tools.yaml, each map cited to a saved vendor page:
  - HDT-48-00 gains the four Deutsch contacts. ProWire's HDT-48-00 page, fetched 2026-10-15 through fetch_sources.py,
    says "the ideal option when crimping any of the Deutsch size 20, 16, 12 solid contacts" and lists all four
    contacts as related items.
  - 3137CT gains M81824/1-1, M81824/1-2 and M81824/1-3. ProWire's MiniSeal page: "MIL-S-81824/1 qualification", "The
    recommended crimp tool is 3137 CT", "Butt: M81824/1 series".
- Migration: catalog_parts gains the HDT-48-00 and the 0462-005-20141 socket (sources only; no price, stock or maker
  claim), and the key fold runs.

**Dry run against live:** 106 ends are re-written, all for the tool alone: 48 to 3137CT and 58 to HDT-48-00.

**Expected live after the load:** wire ends keyed to a crimp tool go from 475 to about 581 of 991.

**Left open, with what closes them:**
- The 4 ends on 638TP and 610TP lugs. ProWire's own pages name the 4290-CT, 19284-0034 or 19294-0008 as their tools,
  not our 18840, so a tool pick is owed.
- The hi-temp rings 9906, 9912, 9916 and 9918. Their saved page names no tool.
- The 22 MiniSeal ends with no part number ("rail splice (in the kit)", "D-609 (gauge unknown)").
- The open, kit and GM-blade ends (no contact picked).

**Substrate note (not changed here):** families.yaml calls the HDT-48-00 crimp "solid-barrel 4-indent". The vendor
page says "the eight indents".
