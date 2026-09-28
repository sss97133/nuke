---
id: 2026-09-26_citations-checked-by-code
date: 2026-09-26
change_type: substrate_correction (citations) + new checks; wiring values unchanged except the items listed under "Changed"
amends: 2026-09-26_gm-manual-layout-section-1
scope: docs/wiring/calc-data/{audit_citations.py, check_plug_ends.py, fetch_sources.py (new); kits_v5.py; catalog/{parts,tools,endpoints}.yaml; k5_registry.json, DOSSIERS.md, BOOK_PLUGS.md}; .gitignore
status: APPLIED
owner surface: none yet. The owner surface is the K5 profile's wiring page once the data is in the database (owner 2026-09-26).
---

# Every "cited" field is checked by code against a saved copy of its source

## Why
The owner asked, 2026-09-26, "how are you to know any of the legitimacy of any data", and later "how good was todays work and how do you know its good".

A hand check of 14 random fields out of the 550 marked "cited" found:
- 3 fields checked out against a document we hold;
- 4 fields cited our own files;
- 7 fields cited documents nobody had saved.

The most-cited external source was "Glenair AS39029 Table I/II", stamped on 160 firewall fields. `kits_v5.py` hard-coded that citation, and no session had ever fetched the document (session-search: no matches).

## What was built
- **`fetch_sources.py`:** saves every cited web page through Firecrawl, one at a time:
  - 15 s between ProWire pages, 8 s elsewhere;
  - stops on a 403/429 from any host;
  - never saves a 4xx page.
  - Pages go to `reference_documents/web_snapshots/`, which is gitignored because the repo is public and this is third-party text.
  - Dave's M130 sheet is kept at `reference_documents/owner_docs/`, also gitignored.
  - 49 pages saved; no host blocked.
- **`audit_citations.py`:** for every cited field it opens the cited source (stored PDF text, a page snapshot, or Dave's xlsx) and looks for the field's own values: part numbers, M130 pins, measurements, selector settings, wire spec at gauge, colours. Each field gets one status: VERIFIED, PARTIAL, NOT_FOUND, STORED_PROSE, UNSTORED, NEVER_FETCHED or SELF_ONLY. Our own files count as design records, never as evidence.
- **`check_plug_ends.py`:** layer-2 rules on all 343 wire ends. Each rule answers PASS, FAIL or OPEN; OPEN names the missing input.
  - R1: the terminal's range includes the gauge. Doubled wires count 3 AWG heavier. PDM pigtails are checked against both the contact and the splice.
  - R2: cavity.
  - R3: a crimp tool is named.
  - R4: the tool has a selector setting for the gauge.
  - R5: a pull-test value exists.
  - R6: the M130 pin's function fits the job, read from the stored MoTeC datasheet pin table.
  - R7: the seal's insulation range holds the wire's outside diameter.

## Changed (with the source that justified each change)
- **Firewall rows no longer cite Glenair.** They now cite:
  - DMC's tooling page for M39029/56-351: AFM8 + K43; M81969/14-10 insertion/removal tool; 20–24 AWG.
  - DigiKey's M39029/56-351 and /58-363 pages: socket and pin, 20–24 AWG, size 20.
- **Two values nothing we hold supports became bench checks:**
  - The K43 selector numbers. DMC's K43 page says the data plate gives the selector position; the listing photo was never kept.
  - The "0.209 in" barrel depth.
- **Device-end rows cite the terminal's and seal's own pages** (ProWire p-506, p-2061, p-2268, p-3769; Custom Connector Kits 15366021; DigiKey M39029) instead of the plug's pinout source.
- **Wire rows cite every decision that shaped the wire,** not just the first.
- **Catalog (`parts.yaml`):**
  - seal insulation ranges: 15324976 1.3–2.1 mm (ConnectorID), 15324974 1.0–1.9 mm (ConnectorID), 15366021 1.2–1.9 mm (Custom Connector Kits);
  - wire outside diameters (ProWire /16 and /32 tables: /16-22 1.3 mm, /32-22 1.09 mm);
  - 68102 range 20–16 AWG (ProWire p-3769);
  - MiniSeal ranges 26–20 / 20–16 / 16–12 AWG (ProWire 3137CT page).
  - `tools.yaml`: the Metri-Pack crimper cites its own page (p-2104).
- **New open item on the throttle body.** The pin order for 12699160 is borrowed from other GM SENT bodies (MaxxECU: 12678223; rusefi: 12617792), and no saved source names 12699160. Bench step: meter the body before crimping.

## Measured
- **Citation audit, before → after:** VERIFIED 7 → 271 of the fields still marked cited (1.3% → 57.7%). NEVER_FETCHED 160 → 0. SELF_ONLY 123, our design records.
  - "Cited" fields went from 550 to 470 because 80 firewall strip rows are now honestly marked bench.
- **Plug-end rules:** 343 wire ends; 236 pass every rule; 0 FAIL; 107 have an OPEN.
  - Largest OPEN groups: coil and throttle-body kit terminals have no range or crimper yet (37), small ring terminals are unpicked (19), and there's no pull value for 18 AWG in the kit families.
- **R7 on today's design:** 15 PASS (GT150 seals on /16-22). 5 at the edge of the white Metri-Pack seal (crank, cam, MAP), the same bench check the book already listed. 8 have no diameter for the shielded cable's conductors.
- **R7 replay of the May lock (22 AWG = M22759/32):** 20 seal FAILs, e.g. CKP "M22759/32-22 is 1.09 mm; seal 15324976 takes 1.3–2.1 mm". The rule catches the mistake that took until 09-26 to find by hand.
- **Correction to what I told the owner earlier today.** I said the K43 selector setting "has no real source". The 09-25 receipt records it right after reading the positioner's data plate, and DMC confirms plates carry the settings. The accurate status is that its source was not kept, so it's a bench check (read the plate on arrival).

## Open
- **Still NOT_FOUND (10):**
  - device identities (coil D510C/12611424, TB 12699160) cite pages that don't name them; the owner's receipts would;
  - M27500 cable rows cite Dave's sheet for colour only;
  - CAN terminator and M85049/69-25N rows.
- **Not implemented:** housing-mates-device rule (needs the device connector PN on each endpoint).
- **The database load.** These statuses belong on each fact as it lands in `vehicle_observations` (citation fields exist there). That load is blocked on the owner's go for the schema links (see the chat on 09-26).
