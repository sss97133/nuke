# Mil-Spec Wiring & Heat-Shrink Protocols — K5 Reference

**Author:** Claude (Opus 4.7) acting as mil-spec / MoTeC integrator / 1960s-80s GM engineer
**Date:** 2026-05-21
**Status:** Research document. Workshop content. Citations below; verify against actual datasheets before binding into the substrate.

## Why this exists

The K5 engine harness is mil-spec end-to-end: M22759 Tefzel + DR-25 + SCL + Raychem boots + D38999 firewall + MoTeC Superseal at the ECU/PDM. The cut list captured the wire-level properties (gauge, color, length, spec, terminals). The substrate did not capture the **heat-shrink stack** — what shrink goes where, in what order, what it transitions to, what the recovered diameters need to be. Without that, a wire is half-documented.

This document is the workshop-grade reference. It does two things:

1. Lays out the protocol stack from inside (conductor) to outside (boot) at every wire termination, splice, and bundle.
2. Maps each layer to the observation_properties Nuke needs to add to capture it as cited substrate.

Builders read §1–§8 to know what to build. Agents read §9 to know what to ingest.

---

## §1. Wire — M22759 series ("Tefzel")

M22759 is the umbrella mil-spec for ETFE-insulated wire. Two slash numbers are load-bearing for the K5:

| Slash | Conductor | Insulation | AWG range | Temp range | Wall |
|-------|-----------|------------|-----------|------------|------|
| M22759/16 | Tin-coated copper | ETFE (Tefzel) | 10–4 | −65 to +150 °C | normal |
| M22759/32 | Tin-coated copper | ETFE (Tefzel) | 22–12 | −65 to +150 °C | thin |

Both are irradiated cross-linked ETFE per SAE-AS22759 (formerly MIL-W-22759). The thin-wall /32 is the dominant choice for signal wiring in motorsport because the gauge-equivalent OD is ~30% smaller than PVC and TXL/GXL, which lets the bundle pass through tighter routing. The K5 cut list overwhelmingly uses /32; /16 appears only on power/ground feeds (battery, alternator, starter).

Color coding follows the AS22759 N-NN convention (base color + up to two stripe digits). For high-mix harnesses the practical limit is ~16 distinguishable solid+stripe combos before re-use; the K5 hits this with the AUDIO and ENGINE looms sharing some patterns.

---

## §2. Heat-shrink — the M23053 family

Heat shrink is M23053 (formerly MIL-I-23053, now SAE-AMS-DTL-23053). The "slash number" determines material, ratio, and adhesive lining. For the K5 build, four slash numbers matter:

| Slash | Material | Brand alias | Ratio | Adhesive? | Wall | Use |
|-------|----------|-------------|-------|-----------|------|-----|
| /4 Class 2 | Polyolefin | SCL (Raychem) | 2:1 | YES (dual wall) | medium | Termination seal, adhesive flow into voids |
| /4 Class 3 | Polyolefin | SCL, ATUM | 3:1, 4:1 | YES | medium | High-mismatch transitions (small wire → larger boot) |
| /5 | Polyolefin (thin) | RNF-100 | 2:1 | NO | thin | General insulation, label sleeves |
| /15 | Polyolefin | AS81765 boot family | 2:1+ | optional | molded shape | Y-splice / transition boots |
| /16 | Polyolefin (semi-rigid) | DR-25 (Raychem) | 2:1 | NO | medium-heavy | Bundle outer cover; fluid + abrasion + diesel resistant |
| /18 | PVDF (Kynar) | clear | 2:1 | (some with solder pre-form) | thin | Solder sleeves (transparent for solder-joint inspection) |

DR-25 (M23053/16) is the load-bearing outer layer. -75 to +150 °C, diesel/oil/hydraulic-fluid resistant, abrasion-rated for the most exposed bays. Recovered diameters from 1/16" (1.6 mm) to 4" (102 mm); 2:1 ratio means you start with double the supplied ID.

SCL (M23053/4 Class 2) is what seals every termination. The inner adhesive is hot-melt polyamide that **flows when shrunk** — it doesn't just shrink around the joint, it spreads into the void between the wire bundle and the boot wall, forming a fluid-tight seal. This is the "how it spreads" question: SCL spread is what makes the harness IP67 at every termination without using molded backshells.

---

## §3. The K5 termination stack — inside-out at a wire crimp

Every wire ending in a Superseal contact has a layered stack. The layers stack like skin and bone — inside to outside:

```
  conductor (strands of /32 copper)
    │
    └─ ETFE insulation (the Tefzel)
        │
        └─ [optional] Raychem S03 solder sleeve — shield drain or in-line splice
            │  Material: M23053/18 clear PVDF + internal fluxed solder preform
            │  Spec compliance: SAE-AS83519 (formerly MIL-S-83519)
            │  Inspection: thermochromic indicator turns from green to clear at wetting temp
            │
            └─ SCL inner shrink — M23053/4 Class 2
                │  Color: usually black, sometimes red/yellow for power
                │  Length: 1–1.5 in past the back of the contact
                │  Adhesive flow: ~20% of recovered ID into the bundle void
                │
                └─ DR-25 outer shrink — M23053/16
                    │  Color: black (default), white (label segments), yellow/red (special)
                    │  Length: covers the SCL transition + extends into the bundle for ~3 in
                    │  Adhesive bond to SCL: thermal weld at the overlap during shrink
                    │
                    └─ AS85049 backshell + boot (D38999 side only)
                        │  /88 = straight self-locking shield-band shrink-boot, Cat 3B
                        │  /90 = 90° shield-band shrink-sleeve, Cat 3B
                        │  /117 = 90° boot accommodation, Cat 3B
                        │
                        └─ Bundle continues to the next termination
```

The MoTeC Superseal connectors have NO formal AS-spec backshell (the AS85049 family is D38999-only). The accepted practice is a **built-up boot**: a 3:1 SCL or AS81765 transition boot covers the wire bundle, shrinks down to the back of the Superseal housing, and bonds to it via the SCL adhesive layer. The connector backshell is effectively the SCL + DR-25 layered transition itself.

---

## §4. The spread question — what "shrinks down to" actually means

When DR-25 says 2:1 ratio, it means: a piece supplied at 1.0" ID recovers to 0.5" ID **at minimum**. Free recovery (with no obstruction) can go below that — a 1.0" piece will recover to ~0.4" if it has nothing to grip.

For sizing at a termination, the **largest OD the boot has to cover** sets the supplied-size minimum, and the **smallest OD it has to grip** sets the recovered-size maximum. Worked example for an LS3 coil pack connection:

```
  Largest OD: bundle entering boot
    ~5 wires × 1.5 mm OD (M22759/32 18 AWG) ≈ 8 mm in a hex pack

  Smallest OD: coil connector back shell
    ~5 mm

  Boot supplied size: must be ≥ 8 mm ID at supplied → 3/8" SCL (9.5 mm supplied)
  Boot recovered:    must be ≤ 5 mm to grip → 3/8" SCL recovers to ~3.2 mm at 3:1
  Margin:            adequate
```

For a 2:1 ratio piece in the same scenario, the recovered minimum is 4.75 mm — too loose to grip the connector. Hence 3:1 SCL is the right choice here, not 2:1 DR-25.

**Rule of thumb (motorsport practice):** SCL 3:1 for the inner seal, DR-25 2:1 for the outer cover. The SCL handles the mismatch between bundle and connector; the DR-25 only has to cover the SCL.

---

## §5. Splices, branches, Y-junctions

The K5 cut list has 4 shielded sensor pairs (crank, cam, knock B1, knock B2). Each pair's shield drain terminates somewhere — typically to SEN_0V at the ECU. The termination is a **shield solder sleeve**:

- **Raychem S03 series** (M23053/18 + SAE-AS83519) — transparent PVDF with internal solder preform and side drain wire access slot. Sizes S03-01 through S03-08, indexed by wire OD.
- The drain wire enters through the side, the solder preform melts, the inspection-window stays clear so the joint is visible.

**Y-splices** and **branch points** (one trunk to multiple branches) use **AS81765/1 Type II transition boots** — molded polyolefin shapes with adhesive lining. Glenair calls their version "Full Nelson." They come in 1-to-2 (Y), 1-to-3 (W), and 1-to-4 (X) shapes, sized by trunk OD and branch OD totals.

The K5's specific Y-splices live at:
- Coil pack distribution (one +12V trunk → 8 coil branches)
- Injector distribution (one +12V trunk → 8 injector branches)
- The ground bus at the back of M130 (4 BAT_NEG pins commoned)
- ETB connector (one connector with 6 branches going to different M130 pins)

Each of these needs a transition boot PN documented as cited substrate, not invented per build.

---

## §6. Connector backshells — D38999 firewall

The K5 uses a **D38999/24WJ61SN** (Series III, jam-nut receptacle, 61 size-#20 contacts) for the firewall pass-through. The backshell selection from AS85049:

| AS85049 slash | Style | RFI/EMI | Boot accom | When to use |
|---------------|-------|---------|------------|-------------|
| /18D | Straight | Cat 2B | NO | Light-duty, no shielding |
| /85 | Straight, self-locking | Cat 3B (shield-band) | YES | Most builds |
| /88 | Straight, self-locking | Cat 3B (shield-band) | YES (shrink boot) | K5 standard |
| /90 | 90° | Cat 3B (shield-band) | YES (shrink sleeve) | When cable exit is sideways |
| /117 | 90° | Cat 3B (shield-band) | YES (boot) | Variant of /90 |

For the K5 firewall, the cable exit is straight back (engine-bay side faces forward), so **/88** is correct. Finish code is **W** (olive drab cadmium plated aluminum) matching the receptacle.

---

## §7. Crimp tooling cross-reference

[Already cited in `docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md §4`. Not repeated here.]

The relevant tools for the K5 are:
- **M22520/2-01 (AFM8)** + appropriate positioners — for both D38999 M39029/56-351 sockets and Superseal 1.0 3-1447221-x contacts
- **HDT-48-00** — TE official Superseal hand tool (alternative to AFM8 for Superseal)

Crimp force verification: pull test per IPC/WHMA-A-620 §19.1 (pull-test values per AWG: 16 AWG = 50 lbf min; 20 AWG = 13 lbf min; 22 AWG = 8 lbf min).

---

## §8. 1977 K5 factory protocol — what's on the OTHER side of the bulkhead

For context (and for any wire that crosses from engine-bay side to body side via D38999), the factory K5 body harness uses 1977-era GM protocols:

- **Insulation:** PVC (not Tefzel; lower temp rating; no oil/fuel resistance)
- **Splices:** Either crimped butt connectors with vinyl shrink sleeve, OR twist-and-tape (yes, still acceptable for low-current circuits on the body side)
- **Connectors:** Delphi/Packard Metri-Pack (53, 56, 280, 480, 630 series — already in `Delphi_Metri-Pack_Catalog.pdf`), Weatherpack (sealed), GT series for newer additions
- **Color codes:** 1977 GM factory used solid + tracer stripe, with a 19-color palette. The stripe convention is `<base>/<tracer>` (e.g. `BRN/WHT` = brown with white tracer). For the K5 wagon body, the legend is in the 1977 Chevrolet Light Duty Truck Service Manual (multiple reprints; the factory wiring diagram is on pages 8M-6 through 8M-30 of most editions).
- **Loom:** Convoluted plastic split-loom (the orange/black ribbed stuff), with electrical tape securing splice points. Heat shrink was NOT used on factory K5 body harness in 1977.
- **Routing:** Body harness routes under door sills, through B-pillar, across roof at headliner. Engine bay harness routes along inner fender, with grommets through firewall.

When mil-spec engine harness wire passes through the D38999 firewall and continues into the body, it transitions from /32 Tefzel to factory PVC at the bulkhead. The mil-spec heat-shrink stack STOPS at the firewall — body-side splices revert to factory protocol (crimp + vinyl sleeve).

This is by design: there's no reason to drag DR-25 across the entire vehicle when the body harness sees 80% lower temperatures and no oil exposure. It also keeps the body-harness rebuild approachable for any GM service tech.

---

## §9. Substrate gaps — what observation_properties needs to add

The current registry has 7 wiring properties (`wire_circuit_id`, `wire_color_code`, `wire_gauge_awg`, `wire_length_in`, `wire_specification`, `wire_terminal_pn_a`, `wire_terminal_pn_b`). The cells above identify the gaps. Filed as schema_proposals concurrently with this document.

**Proposed new wiring properties (per-wire, multi-cardinality with `discriminator_key='wire_id'`):**

| property_key | data_type | unit | What it captures | Example value |
|--------------|-----------|------|------------------|---------------|
| `wire_termination_a_protocol` | jsonb | — | The layered shrink stack at end-A as an array of layers (inside-out: solder_sleeve → SCL → DR-25 → boot). Each layer carries pn, spec, ratio, color, length_mm, adhesive | `[{layer:1, pn:"RNF-100-3/16-BK-STK", spec:"M23053/5", ...}]` |
| `wire_termination_b_protocol` | jsonb | — | Same for end-B | |
| `wire_label_text` | string | — | Printed text on white DR-25 label sleeve at each end (typical: wire ID + function abbreviation) | `"110 CLT"` |
| `wire_label_pn` | string | — | The label sleeve PN (white M23053/5 or /16 cut to size, printed on a Brady or Phoenix Contact thermal transfer printer) | `"DR-25-3/8-WH-STK"` |
| `wire_routing_landmarks` | jsonb | — | Array of landmark IDs from `K5_landmarks.yaml` the wire passes through | `["L01","L02","L03"]` |

**Proposed new bundle/loom properties (loom-cardinality, `discriminator_key='loom'`):**

| property_key | data_type | unit | What it captures | Example |
|--------------|-----------|------|------------------|---------|
| `loom_outer_jacket_pn` | string | — | Bundle-level DR-25 PN | `"DR-25-1-1/2-0-STK"` |
| `loom_outer_jacket_recovered_id_mm` | numeric | mm | Recovered ID of the bundle outer | `19.0` |

**Proposed new connector properties (per-connector instance, new discriminator):**

| property_key | data_type | unit | What it captures | Example |
|--------------|-----------|------|------------------|---------|
| `connector_backshell_pn` | string | — | AS85049 PN for D38999, or "Superseal-built-up" for MoTeC | `"AS85049/88-25W"` |
| `connector_boot_pn` | string | — | The boot covering the backshell transition | `"AS81765/1-25-Type-II-A"` |

**Proposed new entity — `splices` table (deferred to next migration):**

Splices are a NEW entity, not a property of one wire. Each splice has its own ID, type (in-line, Y, distribution), N input wires, M output wires, a single PN (the solder sleeve or transition boot), and a location landmark. This is the right shape but requires a new table and is filed as a separate schema_proposal (`add_observation_kind='splice'` plus the entity table).

---

## §10. Cited sources

- **Raychem DR-25 (M23053/16) datasheet:** [TE Connectivity product 5039264026](https://www.te.com/en/product-5039264026.html), [Idetrading product summary](https://idetrading.com/product-groups/shrink-tubing-from-te-connectivity-raychem/heat-shrink-tubing-with-specific-properties/dr-25-heat-shrink-tubing/), [Prowire DR-25 catalog](https://www.prowireusa.com/p-139-dr-25-3-32-tubing-thinwall.html)
- **SCL (M23053/4):** [Weico Class 3 SCL](https://www.weicowire.com/stl-m23053-4-class-3-110c-3-1-shrink-ratio-adhesive-lined-polyolefin-heat-shrink.html), [TefCap AMS-DTL-23053/4 reference](https://tefcap.com/sae-ams-dtl-23053-4-adhesive-lined-polyolefin/), [Electro Insulation M23053/4 page](https://www.electroinsulation.com/mil-spec/m23053-4.html)
- **Raychem S03 solder sleeves (AS83519):** [TE SolderSleeve shield terminators](https://www.te.com/en/products/wire-protection-and-management/interconnect-devices/soldersleeve-shield-terminators.html), [RaceSpec solder sleeves AS83519](https://racespeconline.com/products/solder-sleeves), [TE Raychem electrical interconnect products PDF](https://www.mouser.com/datasheet/2/418/8/ENG_DS_2347480_1_raychem_devices_0222-2997851.pdf)
- **AS81765 transition boots:** [Glenair "Full Nelson" Series 77 PDF](https://www.mouser.com/catalog/specsheets/glen-d-a0000021247-1.pdf), [SAE AS81765/1 Type II reference](https://www.e-aircraftsupply.com/specifications/1449/SAEAS817651-Type-II)
- **AS85049 backshells:** [Eaton/Sunbank AS85049 D38999 catalog PDF](https://www.eaton.com/content/dam/eaton/products/wiring-devices-and-connectivity/connectors-cable-assemblies/as85049-series/eaton-sunbank-AS85049-D38999-MILSpec-catalog-tf700-15-en-us.pdf), [SAE AS85049/88 spec](https://www.sae.org/standards/content/as85049/88/), [SAE AS85049/18D spec](https://www.sae.org/standards/content/as85049/18d/)
- **MIL-I-23053 family overview:** [3M heat shrink mil-spec FAQ PDF](https://multimedia.3m.com/mws/media/392046O/heat-shrink-military-specs-faqs.pdf), [EverySpec MIL-I-23053D](https://everyspec.com/MIL-SPECS/MIL-SPECS-MIL-I/MIL-I-23053D_36973/)
- **M22759 Tefzel wire:** [Prowire M22759/16 catalog](https://prowireusa.com//c-32-m22759-16.aspx), [XTRA M22759/32 product](https://xtramotorsport.com/motorsport-wiring/tefzel-wire/)
- **D38999 + Superseal + M39029 contacts:** see `docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md §5` for the full URL list (already cited)
- **MoTeC M1 hardware:** `reference_documents/component_drawings/motec_m1_hardware_techspec.pdf`, validated against M130 datasheet — see `docs/wiring/reference/motec/VALIDATION_REPORT.md`
- **1977 GM K5 factory service manual color codes:** Chevrolet 1977 Light Duty Truck Service Manual (multiple reprints in circulation; pages 8M-6 through 8M-30 of factory & Helm reprints carry the wiring diagrams)
