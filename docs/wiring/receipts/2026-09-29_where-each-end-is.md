---
id: 2026-09-29_where-each-end-is
change_type: research
scope: docs/wiring/calc-data/catalog/mounts.yaml (new `ends:` list; boxes untouched), mounts_v5.py (lint + JSON), nuke_frontend/public/wiring/k5-mounts.json
author: claude-opus-5-5 (pieces lane, session ebc425ad)
owner_words: "can we map it all out all the end points accurately" / "its our job to define the positions" (2026-09-29)
---

# Where each end is on the truck (all 178 registry endpoints)

## What changed
- `catalog/mounts.yaml` gains `ends:`, one entry per live registry endpoint (178 of 178). The id is the endpoint id,
  which is the map's node code. Each entry has where it is in plain words, its zone and its status. Every reason has a
  source. `follows:` names the box it sits by.
- `mounts_v5.py` lints the ends with the boxes' rules and writes them to `k5-mounts.json` as `ends`, keyed by id. The
  build fails on an unsourced reason, an unknown status, an open or flagged end that doesn't say what's open, an id that
  is not a registry endpoint, or a `follows` that names nothing. An endpoint with no end prints a warning.
- The boxes are unchanged. The panel still reads `boxes`; the React side for `ends` comes next (main).

## Counts
- fixed_by_engine 19: the LS3's sensor bosses, the injector ports, the starter, the transmission and transfer-case parts.
- decided 66: factory spots kept (1977 manual pages), bought kits' own spots, and locked rows.
- proposed 32 and open 54: every open end says what decides it.
- flag 7: the unsealed engine power box and the dropped Deutsch body plate.

## Sources used
Swap Specialties LS installation instructions pp.4–6, GM 6.0L (Gen IV) sensor locations sheet pp.1–2, LS3 E-ROD guide
p.7, the 1977 Light Truck Service Manual (pp.87–88, 121, 227–228, 241, 408, 518, 533, 779–790, 802–803, 833), the 1978 C-K
wiring booklet p.16, Holley's mid-mount fitment guide pp.7, 10 and 15, the Dakota VHX manual pp.4, 8 and 9, the AMP
Research guide p.6, state rows and the registry.

## Corrections found (not applied here; listed in the PR)
- The crank sensor is on the passenger side of the block, behind the starter, not on the front cover. Three places
  are wrong: the registry text, the map anchor in load_map_rows.py and state §4's "CKP AND CMP on FRONT timing cover".
  Only the cam sensor is on the front cover.
- The loader and book anchors still put the 61-pin at H3 and the M130/PDM30 on the passenger side; #407 moved the 61-pin
  to the driver-side fuse-box hole.

## Unknowns (in the entries, not guessed)
Which intake is on the engine; the oil cooler adapter (oil temp and the Dakota oil sender); the battery corner; where
the power boxes go; the A/C plumbing; the washer tank, CHMSL, cargo lamp, outlets and audio spots; the underhood lamp's
factory spot; whether the license plate sits on the bumper or the tailgate.
