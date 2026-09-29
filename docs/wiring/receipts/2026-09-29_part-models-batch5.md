---
id: 2026-09-29_part-models-batch5
change_type: research
amends: 2026-09-29_part-models-power-hardware
scope: docs/wiring/calc-data/cad/fab/ (fam_misc.py, fam_rings.py new; fam_power.py), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json (both regenerated)
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "if a part doesnt have its 3d then the endpoint isnt complete" (2026-09-29, relayed by the pieces lane)
---

# Batch 5: panel ports, the 61-pin bulkhead halves, the 6L90 case connector, the fuel pressure sensor, and the rings and lugs

## What changed
- `cad/fab/fam_misc.py`:
  - Neutrik NC5FD-L-1 (PORT-UTC) and Neutrik NE8FDP (PORT-ETH).
  - D38999/24WJ61SN jam-nut receptacle with its M85049/69-25N adapter (FIREWALL-CABIN).
  - D38999/26WJ61PN plug with its adapter (FIREWALL-ENGINE).
  - The Kostal LKS 1.5 16-cavity pair (TRANS-CASE).
  - AEM 30-2131-100 (FUELP).
- `cad/fab/fam_rings.py` models every ring and lug the registry's terminations name for the ground banks, the power
  studs, the fan junction and the PDM studs:
  - ProWire lugs 238LTP, 2516LTP, 838TP, 638TP, 610TP, DL438 and DL214;
  - ProWire hi-temp rings 9906, 9912, 9918 and 9916.

  Each lands on the ends its terminations name.
- `fam_power.py`: GND-BANK-ENG, GND-BANK-CAB and PS-STUDS leave the unmodelled list, because they now have their
  rings. Their ends table still lists what is missing: the stud bank hardware, and the AMP kit's own ring.

## Sources
- **Neutrik** (maker drawings on file):
  - flange 26.00 × 31.00, holes Ø3.20 on 19.00 × 24.00, cutout ≥ Ø23.80;
  - NC5FD-L-1 depth 27.20, with 18.30 behind the flange;
  - NE8FDP 34.55 overall and 18.05 behind; the rear jack is 25.5 × 27.64.
- **D38999**: MILNEC Series III catalog.
  - p.45, TX07 / D38999/24, shell 25: W 55.6, D 59.0, K 44.7, J 51.2, M 43.4; P 3.2 max panel; H 44.7 / A 43.4
    D-hole; 32.5 max.
  - p.43, TX06 / D38999/26, shell 25: A 48.0, length 31.3, V M37×1.
  - Finish W is "Aluminum, olive drab cadmium".
- **Kostal**: LKS 1.5 POP p.2. The socket housing 09430010 (GM 19303772) is 39 × 42.7 × 50.3; the pin housing
  09330004 is 47.7 × 41 × 37.4.
- **AEM**: instructions 10-2131 Rev C: 2.15 in overall, 0.76, 0.40 thread, 15/16 hex, 1/8-27 NPT, brass body.
- **Rings and lugs**: ProWire's product pages (read 2026-09-29).
  - The lugs carry ProWire's dimension tables: barrel flare I, barrel I.D. C, tang width W, tang length F, barrel
    length D, overall length E, tang thickness T. These are basis `vendor`, because ProWire names no maker.
  - The hi-temp rings have no table. They are sized off ProWire's photo against the hole that clears the stud they
    take (±15 %).

## Unknowns
- **61-pin bulkhead**:
  - The 61 cavity positions (the 25-61 arrangement, MILNEC insert arrangements p.4) are not mapped. pins.json lists
    each registry cavity at the bundle exit.
  - The M85049/69-25N length is assumed (22 ± 8).
  - The 202K163-25-0 boot and the M39029 contacts are listed as missing: no dimensions on file.
- **Kostal pair**: only the envelopes are Kostal's. The round body and the lever are shape only.
- **AEM**: the kit's mating Packard 3-pin plug is not drawn.
- **Neutrik NE8FDP**: the RJ45 contacts are drawn at the jack's 1.02 pitch, as a design value.

## Still without a model (28 ends, reasons in the ends table)
- **MiniSeal splices (19 ends).**
  - MIL-S-81824/1 was not found on everyspec.com: the spec pages 404 and the index has no search.
  - TE's data sheet 2347480-1 opens only in a browser.
  - **The pieces lane offered to read it there.**
- **Blue Sea 5065 (6 ends).**
  - Blue Sea's product photo does not show the fuse, so there is no fuse to use as a ruler.
  - Littelfuse's ATO data sheet was not found at the tried address. Its printed ATO dimensions are still to fetch.
- **GND-SPLICE-REAR, COIL-GROUND-RINGS and STARTER-S.** Their rings are OPEN in the registry: stud size or thread to
  read at the bench.

## Proposed for the registry pass (not applied)
- **Stud bank hardware for GND-BANK-ENG (24 rings) and GND-BANK-CAB (21 rings).** Every ring they land is for a
  3/8 in stud.
  - Proposal: Blue Sea 2103 PowerPost Plus units. The part is modelled here from Blue Sea's drawing: 3/8-16 stud,
    150 A, eight screw terminals.
  - Split the rings across posts so that each carries no more than its stud stack takes.
  - The count per post is a bench call.
- **GND-SPLICE-REAR, COIL-GROUND-RINGS and STARTER-S.** No ring is proposed until the stud or boss is read. The LS3
  documents on file give no thread for the head ground boss.

## Result
- The index now has 104 models, and 59 of 178 ends have one, 50 of them complete.
- 28 more ends are listed with the reason they have no model.
- Every build-time check passes.
