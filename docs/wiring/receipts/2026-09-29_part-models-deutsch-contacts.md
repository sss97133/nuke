---
id: 2026-09-29_part-models-deutsch-contacts
change_type: research
amends: 2026-09-29_part-models-deutsch-family
scope: docs/wiring/calc-data/cad/fab/ (contacts.py new; fam_deutsch.py, k5cad.py), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json (both regenerated)
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "the crimped connector is male female all that stuff needs to be 3-D colored properly so that we look at the plugs in super good detail in addition to insulators of the plugs" (2026-09-29, relayed by the pieces lane)
---

# Deutsch contacts and sealing plugs as their own parts, seated in every housing; IBST-DIAG's implied wires

## What changed
- `cad/fab/contacts.py` builds each contact as a solid of revolution:
  - the barrel with its wire lead-in chamfer, bore and inspection hole;
  - the retention shoulder;
  - the body and the pin with its rounded mating end (pins), or the protective sleeve with its entry (sockets).

  There are eight parts:
  - 0460-202-16141 and 0462-201-16141 (size 16);
  - 0460-202-20141, 0462-201-20141 and 0462-005-20141 (size 20; the last has the purple band its photo shows);
  - 0460-204-12141 and 0462-203-12141 (size 12);
  - 0413-204-2005 (the red size-20 sealing plug).

  Each is also its own model, with a STEP, GLB, drawing and params.
- `fam_deutsch.py` seats the contacts:
  - Every housing gets a bore per cavity, pins in the receptacles and sockets in the plugs. The wedgelocks and seals
    stay separate solids.
  - In each end's mated pair, the contact in a cavity is the part number the registry names for that wire (0460 pins,
    0462 sockets), with the mating contact opposite it.
  - Spare cavities get the family's sealing plug where it is modelled (DTM). The size-16 plug 114017 has no photo or
    drawing on file, so DOOR-L/R-PASS cavities 7-8 are left empty and noted.
  - The IBST-DIAG cap takes four sealing plugs, per endpoints.yaml.
- IBST-DIAG's wires (IBST_CAN_H on cavity 1, IBST_CAN_L on cavity 2) are implied wires with no termination rows.
  `k5cad.write_pins` now falls back to the registry endpoint's own cavity map on the half the harness wires land in
  (DTM06-4S, "harness half" in endpoints.yaml).
- An end counts complete only when its contacts are modelled too: the family adds them to END_NEEDS.

## Sources
- **Pin diameter and plating** (maker): TE product pages 0460-202-16141 (1.59), 0460-202-20141 (1.0) and
  0460-204-12141 (2.4). All are "Interface Plating Nickel (Ni)".
- **Strip length** (maker): Deutsch contacts catalog p.125, the solid contact table (the size 20 / 16 / 12 ranges).
  customconnectorkits.com/cdn/shop/files/DEUTSCH_Contacts_Catalog.pdf, read 2026-09-29.
- **Shoulder depth behind the mouth**:
  - DT: 17.20 (maker), from the catalog p.128 PCB-pin table: "D", the contact shoulder to the end of the connector, for
    DT04-2P / DT04-3P. It is read as the mating end, because that puts the pin 4.3 mm into the socket at the
    photo-scaled nose depth. The DT 6, 8 and 12-way use the 2-way's figure (sibling).
  - DTP: 19.74 (maker), the table's size-12 "DT" row.
  - DTM: derived (design), so the pin enters the socket half its sleeve.
- **Lengths and diameters** (photo, ±5-10 %): the customconnectorkits photo of each part number, scaled from:
  - the TE pin diameter, for pins;
  - the matching pin's barrel, for sockets (the Common Contact System's one barrel per wire range, catalog p.120);
  - the size-20 barrel, for the sealing plug.

  Lengths are multiplied by 1.064 for the photos' camera tilt, read from the end-face ellipses.
- **Colours**: the photos' dominant colour (nickel, warm silver) and the red of the sealing plug.

## Findings
- **The catalog's solid-contact feature figure (p.121) shows a stainless-steel protective sleeve over the socket
  tines.** The sockets are modelled with it.
- **Cross-check of the 17.20 "D" figure:**
  - Read from the mating end, it matches the photo-scaled plug nose depth: the pin reaches 4.3 mm into the socket.
  - Read from the rear end (the way the PCB-pin figure's "End of Connector" arrow suggests), the pin tip would sit
    15.7 mm inside the shroud, which the DT06-2S nose (28.4 long) could not reach.
  - It is used as the mating-end figure and flagged. TE's DT04-2P customer drawing would settle it.

## Unknowns
- Contact lengths and diameters are photo-scaled; TE's contact drawings were not on file.
- 114017 (the size-16 sealing plug): no photo on customconnectorkits (404), and no drawing, so it is not modelled.

## Result
- 47 models in the index: 21 housings and gaskets, 8 contacts and plugs, 12 mated ends, and the 6 earlier parts.
- Every build-time check passes, including the new "pin enters its socket" check on every housing.
