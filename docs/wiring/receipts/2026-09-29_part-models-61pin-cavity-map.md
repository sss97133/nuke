---
id: 2026-09-29_part-models-61pin-cavity-map
change_type: research
amends: 2026-09-29_part-models-batch6
scope: docs/wiring/calc-data/cad/fab/fam_misc.py (the D38999 shell 25 halves), docs/wiring/calc-data/cad/fab/k5cad.py (pins.json wire side), docs/wiring/calc-data/catalog/part_models.yaml (regenerated)
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "the crimped connector is male female all that stuff needs to be 3-D colored properly so that we look at the plugs in super good detail" (2026-09-29, relayed by the pieces lane)
---

# The 61-pin halves get their 25-61 cavity map: every letter at its place, both faces, every wire in its cavity

## What changed
- **Cavity positions.** FIREWALL-ENGINE (D38999/26WJ61PN, pins) and FIREWALL-CABIN (D38999/24WJ61SN, sockets) now
  have all 61 cavities of the 25-61 arrangement.
  - Each cavity is cut into the insert face, and each is a pins.json row at its own position. The contact tip is at
    the insert's front face and the wire side at its rear.
  - Batch 5 had put every cavity at the bundle exit.
- **Wires.** The registry's 58 wires land in their cavities on both halves. d, t and u are listed empty.
  - A cavity's letter now matches case-sensitively. Batch 5 matched without case, so cavity A also took a's wire,
    M took m's, and so on.
  - Every wire now sits in exactly one cavity, the one its termination names.
- **Faces.** MILNEC draws the front face of the pin insert, and the plug's face reproduces that figure as seen from its
  mating face. The receptacle's face is its mirror, so each letter meets its mate.
  - In each half's own frame (mating face toward −Z, wires +Z, Y up), the plug's cavity X is the figure's −x and the
    receptacle's is +x.
  - Drawing both faces from their pins.json shows the plug matching the figure: A top right, Z top left, PP centre.
    The receptacle comes out mirrored.
- **k5cad.write_pins.** A row can give its wire side (`wire_at`) apart from its tip. Before, both were the same point.

## Sources
- **Positions.** From MILNEC's D38999 insert arrangements, p.B-22 (PDF p.4), arrangement 25-61, "Front face of pin
  insert shown".
  - The page is vector. Its 61 contact circles and the 61 letter labels were located with pdftocairo and pdftotext
    from the file on disk, so there is no pixel reading.
  - The letters follow the drawing's own spiral: A–Z without I, O and Q round the outside from the top right, then a–z
    without l and o, then AA–PP inward. Every printed label sits within 4.5 pt of the contact it names.
  - The pattern is centred on the centre contact PP. The drawn insert circle sits 1.1 pt off it.
- **Scale: ASSUMED.**
  - The drawn circle (65.80 pt) is set to Ø38.2, the insert diameter the batch-5 receptacle model draws (TX07's M, 43.4,
    less 2 × 2.6). The same scale is used on both halves.
  - What was tried for a sourced scale, and why each failed:
    - The arrangement pages print no reference circle or contact spacing.
    - TX07's front view is not to scale. Its D, W, J and K disagree with each other by up to 25 % when measured.
    - MIL-STD-1560 was not reached. everyspec's index page returned only its first items, and its search is a Google
      custom search, which is off the table.
  - **Needs:** the MIL-STD-1560 sheet for 25-61, or calipers on the insert.

## Unknowns
- **Scale.** The arrangement's absolute scale, as above. The positions are exact to the drawing but carry the scale's
  error.
- **Holes.** The cavity holes are drawn Ø1.2 and 3 deep (assumed). The M39029/58-363 pins and /56-351 sockets are
  still not drawn, because no slash-sheet dimensions are on file.
- **Key.** The master key's position relative to the receptacle's D-flat is not checked. The pattern is drawn with the
  figure's up as +Y.

## Result
- **Faces.** Both halves carry 61 cavities, and the build-time checks count them.
- **Wires.** 58 wires are mapped, each to exactly one cavity: its registry letter.
- **Index.** Unchanged: 193 models, 161 of 179 ends with a model, 126 complete. The two halves' unknowns now name the
  scale.
- **Scans.** No 32-hex run and no credential word in the new outputs.
