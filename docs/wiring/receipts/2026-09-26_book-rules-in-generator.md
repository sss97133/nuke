---
id: 2026-09-26_book-rules-in-generator
date: 2026-09-26
change_type: presentation (owner surface), no wiring values changed
amends: 2026-09-26_dave-sheet-alignment-22awg-m22759-16-dossiers
scope: docs/wiring/calc-data/{kits_v5.py, BOOK_PLUGS.md, k5_registry.json}
status: APPLIED
owner surface: build book "Plug write-ups" tab (rev 44, rebuilt from BOOK_PLUGS.md) + main tab M130 pinout (rev 131)
---

# The build book's rules live in the generator

## Why
Owner, 2026-09-26: "wh do designs always violate design". The Plug write-ups tab broke four rules:
- **Stamps:** the book's own rule is that every part carries HAVE / BUY NOW / YOUR PICK / LATER, and the tab had none.
- **Vocabulary:** it used cut-list codes (CLT, OPS, ETB, CKP, CMP, APS), against the locked rule "Dave's vocabulary is the deliverable standard".
- **Repetition:** tools and checks were repeated in all 14 plugs.
- **Sources:** it cited repo file names he can't open.

The M130 pinout had the same codes. **Root cause:** the pages were pasted from the repo view, and nothing checked them.

## What changed
- **`kits_v5.py` `book_md()`** renders the owner page itself (`BOOK_PLUGS.md`):
  - lead, then plug types (contact, crimp tool and setting) once;
  - pull tests and strip rule once;
  - tools once, each stamped and naming its real list (ProWire / DigiKey cart, eBay list, ICT link);
  - then each plug with only its own wires in Dave's words, its stamped open items, and plain sources with links where they exist;
  - the 61-pin section names its 4 cab ends still waiting on decisions.
- **`book_lint()`** fails the build on repo paths, cut-list codes, unstamped kits or tools, fractional kits, None or UNKNOWN. The M130 pinout goes through the same names and lint.
- **`dave_name()`** gives every wire a name in Dave's words ("coolant temp 0 V", "TPS signal (SENT)", "crank 6.3 V", "pedal track 1 5 V", "Dakota speedo", "ECU ground 1").

## Verification
- `python3 docs/wiring/calc-data/reconcile_v5.py` builds with the lint passing.
- The lint caught one leak during the build ("GM OPS SNDR" as a cab end), which now reads "Dakota VHX box".
- Every line of `BOOK_PLUGS.md` was read before publishing. The doc was then rebuilt section by section, and all 16 fills were acknowledged.
- **Rendered view not seen:** the Chrome extension has been disconnected since the reboot.
