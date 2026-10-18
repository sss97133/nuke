---
id: 2026-09-26_gm-manual-layout-section-1
date: 2026-09-26
change_type: presentation (owner surface), no wiring values changed
amends: 2026-09-26_book-rules-in-generator
scope: docs/wiring/calc-data/{manual_v5.py (new), kits_v5.py}, docs/wiring/output/manual/
status: APPLIED
owner surface: build book tab "Section 1 · Engine Harness" (4 page images, rev 2) + main tab link (rev 132) + stale 68102 ×20 → ×16 (rev 133)
---

# Section 1 drawn as a 1960s–90s GM factory manual

## Why
Owner, 2026-09-26: "ok im just not on board with the layout. i expect to see the layout exactly like how the repair manuals are of the 60-90s".
The Plug write-ups tab was a markdown page. The model is the GM books in our own library:
- **1977 LTSM:** running header, bold centred section heads, two justified columns, NOTE call-outs, "Fig. X-Y—" captions.
- **ST-352-78:** the Circuit Tabulation box.
- **1987 connector end views:** cavity table under each face, TYPICAL plus a cylinder table.

## What changed
- **`calc-data/manual_v5.py` (new)** renders US-letter pages (SVG → PNG 150 dpi + PDF, `K5_Harness_Manual.pdf`) from `k5_registry.json`:
  - **1-1:** contents (built from the pages that exist) and the general description;
  - **1-2, 1-3:** connector identification — 11 plugs, coil and injector drawn TYPICAL with their 8-cylinder table;
  - **1-4:** circuit tabulation.
- **Each figure lists what its plug takes, stamped:**
  - kits, plus terminals and seals counted from the same terminations the BOM counts;
  - its open items.
- **Each fact once:** an open item shared by 2+ plugs becomes a numbered note on 1-1.
  - Note 1: MP150 seal fit, on 5 plugs.
  - Note 2: knock terminal family.
- **Text follows the book's rules:**
  - Dave's words and `book_lint`;
  - GM abbreviations only on overflow;
  - American spelling, as GM printed it.
- **`kits_v5.py`:** `kit_stamps()`, `plug_parts()` and `plug_opens()` are pulled out so the book and the manual share one path. `BOOK_PLUGS.md` and `k5_registry.json` are byte-identical after the rebuild (diff against HEAD: none).

## Corrections made while checking the pages against the sources
- **Wire spec:** "20 gauge and heavier is M22759/32" was wrong. 10 AWG and heavier is /16 in the master. The sentence is now generated from the master.
- **"Shield drains at the M130 end only":** no source in the library, so it was removed. Kept: the solder sleeve on the drain (canon ch.16 §7.3).
- **"M130 and PDM30 mount in the cab":** the mount spot is open (state §3). It now reads as a NOTE: drawn for a cab mount, spot still open.
- **Circuit numbers:** had been stated as the label text. Label text is held for Dave's names (state 0f(e)), and the page now says so.
- **Build book main tab:** the Engine-plugs row said "add 68102 ×20", from the superseded device-ends receipt. Changed to ×16 (2 per injector), matching the dave-sheet-alignment receipt and the registry need.

## Verification
- **Rebuild:** `python3 docs/wiring/calc-data/reconcile_v5.py` then `python3 docs/wiring/calc-data/manual_v5.py` → 4 pages, lint passing.
- **Pages read as rendered:** every PNG was viewed after the last build; no truncated cells or overlaps.
- **Build book:** the doc read shows the new tab holding the 4 page images (blobs d8eb52e7, 8edac9b1, bd368b6d, 3695a134).
- **Rendered doc view not seen:** no Chrome browser is connected (`list_connected_browsers` = []).

## Open
- **Pages still to draw:** Specifications (pull tests, strip), Special Tools (crimpers, settings), the wiring diagram foldout from the master, and the 61-pin and M130 connector faces. Until they exist, the Plug write-ups tab stays because it holds the crimp settings and pull tests.
- **PDF link:** a markdown link to a PDF blob is stripped by the doc. The PDF is in the doc's asset store (f6d74066…) but has no link on the page.
