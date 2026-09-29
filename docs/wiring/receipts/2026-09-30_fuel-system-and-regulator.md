---
id: 2026-09-30_fuel-system-and-regulator
change_type: research
scope: docs/wiring/research/2026-09-30_fuel-system-and-regulator.md, docs/wiring/research/2026-09-30_fuel-system-plumbing.svg, docs/wiring/calc-data/catalog/options.yaml (candidate FT), docs/wiring/calc-data/fetch_sources.py (source list)
author: claude-opus-5-5 (fuel-system lane, session ebc425ad)
owner_words: "another point we never touched him was the fuel regulator I ordered an automotive one I don't really know what it does do we have any sort of like way that we measure the fuel speed or do we just deal with that at the throttle body and then mechanically position motive block" (2026-09-29)
---

# The fuel system: regulator identified, plumbing laid out, fuel pressure sensing placed

## Pre-flight gate
- Read `K5_WIRING_STATE.md` §1–4 and canon chapters 16, 17 and 18.
- Searched the library (`scripts/library_search.py`: fuel pressure, regulator, fuel used, fuel temperature, fuel line).
- Every number in the research doc carries its source. Where one is missing, the doc says unknown and names what would close
  it.
- Owner decisions are stated, not made: pump size, fuel-line side, tank vent, the FT candidate.
- Dave's vocabulary is used in prose ("fuel PSI", not FUELP).
- Physical routes are marked PROPOSED for the builder. Nothing is asserted complete.

## What changed
- **`research/2026-09-30_fuel-system-and-regulator.md`** answers the owner in plain words:
  - what the regulator is and does;
  - return vs returnless;
  - what the M130 does with fuel pressure;
  - measured vs calculated flow;
  - flow meter and fuel temperature;
  - where the regulator mounts and why;
  - the plumbing with sizes and fittings;
  - positions in the twin's axes;
  - the wiring consequences;
  - the open items.
- **`research/2026-09-30_fuel-system-plumbing.svg`**: panel A is the plumbing schematic; panel B is a top view in twin
  coordinates (frame, exhaust, engine, rails and regulator taken from twin v4).
- **`calc-data/catalog/options.yaml`**: new candidate **FT**, a fuel temperature sensor in the return at the regulator, to M130
  B6 (AT4).
  - Demand: 0 body crossings, 0 PDM30 outputs or inputs. Its 61-pin and M130 needs are in its notes.
  - The sensor is not picked.
  - Checked by running `options_v5.py` on a scratch copy of `calc-data`: FT parses and appears in the candidate demand. It was
    **not run in the repo**, because it rewrites `k5_registry.json`, and this lane does not edit the registry.
- **`calc-data/fetch_sources.py`**: 9 source URLs added (Aeromotive regulator page and LS bracket, Holley 534-209, MoTeC GPR
  datasheet, GPR page, Flex Fuel guide, M1-to-PDM guide, MoTeC Online release notes, MoTeC #55001).
  - Snapshots were saved to the gitignored `reference_documents/web_snapshots/`.
  - The two instruction PDFs sit behind hashed links, so their text copies were saved by hand
    (`aeromotiveinc.com__13138-13139-13140-installation-instructions.md`, `documents.holley.com__199r10582rev4.md`).

## Findings
1. **The regulator is Aeromotive 13139.**
   - The order line reads "ORB-8". Aeromotive's table maps ORB-08 to 13139.
   - The 2026-01-31 photo shows an Aeromotive Gen-II body at the front centre of the intake valley.
   - A second, universal YESHMA kit is also on record; it is not on the engine.
2. **The system is return style.** The Quantum H882 "BUILD" has an 8AN feed and a 6AN return and no filter-regulator. The
   Aeromotive is its regulator.
3. **Fuel flow is calculated by the M130, not measured.**
   - The fuel pressure sensor sets injector open time through the differential-pressure calculation.
   - MoTeC GPR datasheet, Flex Fuel guide p.3/p.5, MoTeC Online release notes.
4. **Mounting:** on the engine at the front centre of the intake valley (Aeromotive LS bracket 13702, "Center / Intake
   Valley"), after the rails (Aeromotive Fig. 1-2), with the AEM sensor in the regulator's 1/8 NPT gauge port.
5. **Base pressure: 43.5 psi, vacuum-referenced.**
   - It is the injectors' rating (Siemens FI114961, 60 lb/h at 43.5 psi).
   - The P367 flows 164 L/h at 45 psi against 145 L/h at 60 psi (Quantum).
6. **The P367 is marginal against GM's pump figures.**
   - At 45 psi it gives 43.3 gal/h: above the LS3 E-ROD's "Minimum 40 gph @ 400 kPa", under the long-block family's "45
     gallons per hour".
   - At 60 psi it gives 38.3 gal/h: under both.
   - It is well under Holley's 255 L/h for its LS kits.
   - Recommendation: run 43.5 psi and read pressure at full throttle. A bigger pump is the owner's money call.
7. **Flow meter: no.** It needs supply and return meters and takes the last two UDIGs. **Fuel temperature: candidate FT.**

## Substrate inconsistencies surfaced (not fixed inline)
- **State row 0ag(h)** says the Aeromotive regulator sits in the DEL-Stributor's rear-centre spot (IMG_6531). The photo puts
  it at the front centre above the water-pump manifold, and `docs/wiring/twin/HANDOFF.md` item 9 already corrected the twin
  lane's first reading. The state row needs the same correction.
- **Chapters 05 and 17 still size the fuel pump as the Aeromotive A1000:**
  - ch.17 §17.2 item 9 and the §17.5 table: "~12A draw; 30A kit/breaker basis", 8 AWG #66, MIDI 30–40 A;
  - ch.17 §17.8: "exceeds 20A channel max";
  - state §3 "Answered by library": "fuel pump (Aeromotive A1000, 35A) ... NOT PDM".
  - The registry moved to the Quantum P367: 5.1 A, #66 14 AWG from PDM15 OUT5, state rows 0o / 0v.
- **The regulator's base range:** Aeromotive's web page says 40–75 psi; its instructions say 35–75 psi.
- **GM 19420381** gives 60 psi (400 kPa) on sheet 1 and 58 psi on sheet 3.
- **`output/K5_wire_spec_and_costs.md:63`** says the M1 calculates "Fuel Used" from injector data, with no source. It is now
  cited: MoTeC Online release notes, "Fuel Used Correction".
- **The tank-top bulkhead plan** (`research/2026-09-28_unpicked-parts-and-fuel-hanger.md` §1: QFS-BKCN-GM) may be unneeded.
  IMG_1100 shows the H882 lid's wires already leaving through a blue cap into a corrugated loom. Bench read.
- **The twin's hanger** (`K5H_FuelPump_Sender`, x 0.15) is a placeholder, not photo-matched.

## Unknowns (each with its close path)
**Owner:**
- The fitted fuel line kit: side, type and size (one photo at the tank end).
- The exhaust route aft of the collectors. It sets the rail face the lines use, under the 4 in rule (LTSM p.582).
- The pump: P367 or Quantum's 255 L/h H882 option.
- The Phantom 340 box in the 2024-08-27 photo.
- The tank vent: canister or vent valve.
- FT: yes or no.

**Bench:**
- The P367's in-tank strainer.
- Injector height against the Holley brackets (534-212), which depends on the intake identity (state 0ag(g)).
- Clearance for hoses at the rails' rear ports (Fig. 1-2 or the Fig. 1-1 fallback).
- Regulator temperature after a hot shutdown, against the AEM's 105 °C.
- The AEM pin letters.
- The meaning of "OET-PX-15.3" on the Quantum slip.

**Parts not picked:** the 10 µm post-pump filter, the Y block (Aeromotive 15620, 15674 or 15675), the hose ends, the rail
ground straps (Holley 199R10582 step 16), the FT sensor.

## Not done
- No purchases, no database writes, no registry edit, no state-file edit.
- `options_v5.py` / `load_map_rows.py` were not run against the repo.
- Positions and line routes went to harness-cad and parts-artist.
