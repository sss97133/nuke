---
id: 2026-09-29_book-rebuilds-after-options-growth
change_type: generator_fix
scope: calc-data/manual_v5.py (page_specs, readiness_blocks), catalog/options.yaml (STEP-DCMD name), regenerated OPTIONS.md, WIRE_CHECKS.json, k5_registry.json
found_by: lead, 2026-09-29, running the full chain after the option lanes merged
---

# The build book rebuilds again after the option lanes merged

After the option lanes merged (steps, nav and comms, wheel speed, seats, fuel), the chain
`reconcile_v5.py → check_plug_ends.py --wires → options_v5.py → manual_v5.py` stopped at the last step:
`manual_v5.py` refused to write the book, with 235 rule faults. Three causes:

1. **Specifications page (1-19).** The options table grew past its page, and `Page.table` continued it on 1-20.
   `page_specs` then drew the readiness and fill tables on 1-19, at the height where the options table had
   ended on 1-20, so they printed over the options rows (the overprint faults), and 1-20 carried only 5 lines
   (the continuation-page fault). Fix: `page_specs` follows each table onto the page it ended on (`.tail`),
   and a table title moves to the next page with the table if its header and first rows won't fit.
2. **Contents page (1-1).** The General Description listed every candidate option by name. With 30 or more
   candidates the text ran past the page. Fix: it now gives the number of candidates and points to the
   Specifications page, which lists each one with its wire count.
3. **Book wording.** The STEP-DCMD option's name said "(the PDM15, per the registry)". The book's rule bans
   repo words ("registry"). New name: "Power steps on the PDM15 through two Haltech DCMD H-bridges, ...".
   The remap caveat stays in the option's `limits`, which the book does not print.

## Result

- `manual_v5.py`: no rule faults. The book is 20 pages, 30 diagram sheets and 7 DC primary pages. The
  Specifications page now runs onto 1-20: the end of the options table, then readiness by section, then
  connector and channel fill, then the candidate-demand notes.
- `check_plug_ends.py --wires` still exits 1, the same as on main before this change. Every failure is in the April
  concept population, which is retired on the map but still in the registry source. R13 locked fails on 34 wires: 23
  relay designs, 10 from the superseded April bulkhead scheme, and 1 second fan. It also fails on 11 April device-list
  rows: an electric water pump, relays, a second fan, and separate TPS sensors on the Gen V throttle body. R12
  firewall fails on 35 wires. The v5 active and implied wires have no failures. Retiring those rows is a registry-pass
  item; the pieces lane has taken it, together with the wires that have no ends.
- After #423 (fuel) merged: the registry has 174 active wires (27 retired), 243 April-concept, 246 implied, 178
  endpoints and 945 wire ends. OPTIONS.md and the registry's options now include the step, nav and comms,
  wheel-speed, seat and fuel candidates.

## Running the chain in a fresh worktree

Three inputs are gitignored and exist only in the main checkout: `docs/wiring/output/lego-book/`, the
`docs/wiring/build-plan/*.csv` files (and the other wiring CSVs), and
`reference_documents/component_drawings/motec_m1_hardware_techspec.pdf`. Link them into the worktree before
running the chain. They were linked for this run and not committed.

## Unknowns

None for this change. It changes layout and wording only. Every count is still computed from the registry.
