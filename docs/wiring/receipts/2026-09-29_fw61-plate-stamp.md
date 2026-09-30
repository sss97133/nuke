---
id: 2026-09-29_fw61-plate-stamp
change_type: research
scope: docs/wiring/calc-data/cad/fab/fw61_adapter_plate.py, its tracked outputs in fab/fw61_adapter_plate/ (STEP, gasket STEP, DXF, SVG; regenerated), docs/wiring/calc-data/cad/fab/index_v5.py (lint)
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "the 61 pin connector should be placed at the original fuse box hole with a cnc'd adapater plate" (2026-09-29, receipt 2026-09-29_owner-calls-one-61pin-at-fusebox-hole); on the opening: "you go find the measurements" (relayed by the pieces lane)
---

# The 61-pin adapter plate: stamped outputs, the receptacle's panel limit, and the fuse-box opening (still not sourced)

## What changed
- **Every tracked output carries a stamp.**
  - What it holds: the first 12 hex characters of `fw61_adapter_plate.py`'s git blob hash, and the script's inputs.
  - The inputs are the opening with its basis, the fastening, the plate and gasket thickness, the receptacle's panel
    limit, the plate size, the hole pattern and the cutout.
  - Where it goes:
    - STEP (plate and gasket): the header's FILE_DESCRIPTION.
    - DXF: 999 comments at the top.
    - SVG: `<metadata>`.
- **A stale output fails the lint.**
  - `fw61_adapter_plate.py --check` reports any output whose stamp does not match the current script and parameters.
  - index_v5.py runs the same check and fails the same way.
  - The old outputs failed it (they had no stamp). The regenerated ones pass.
- **The receptacle's panel limit is on the drawing and checked.**
  - The MILNEC Series III catalog p.B-25 (PDF p.45) covers TX07, which is D38999/24, the jam-nut receptacle. For
    every shell size it gives "P Max Rear Panel .125 (3.2)", with the note "Max panel thickness will ensure proper
    coupling clearance".
  - The 1/8 in plate is exactly at that maximum, with no margin. The catalog's 3.2 mm is its inch value rounded.
  - The receptacle clamps the plate alone; the 1.5 mm gasket sits between the plate and the firewall.
- **The fix (the system's call, relayed by the pieces lane 2026-09-29).**
  - The plate stays 1/8 in 5052-H32, for stiffness at the fasteners.
  - The receptacle land is spot-faced on the jam-nut face to 0.110 in (2.794 mm) over Ø62. The jam nut is 59.0 mm
    across its corners.
  - The clamped thickness is then 0.381 mm under the .125 in maximum. That covers sheet tolerance and a coating.
  - The gasket is now a perimeter ring:
    - its outer edge is the plate outline, with the four fastener holes;
    - its inner edge is the opening grown 3 mm all round (parametric on the opening's shape);
    - so the receptacle clamps bare aluminium only.
  - The jam-nut face is drawn as the face away from the gasket. That puts the plate on the firewall's cab face, the
    receptacle's flange toward the engine bay through the opening, and the jam nut in the cab. If the builder mounts
    it the other way, the spot face moves to the other face.
  - The fallback, not drawn: a 0.100 in plate with no pocket.
  - SPOTFACE_T, SPOTFACE_D and GASKET_ID are in the parameters and the stamp.
  - The DXF adds a SPOTFACE_TO_2P79MM layer (the Ø62 pocket) and a GASKET_RING layer (the ring's cut outline).
  - `--check` also enforces the limits. It fails when:
    - the clamped thickness is over the maximum less 0.25 mm;
    - the spot face does not clear the jam nut;
    - the spot face reaches the gasket ring;
    - the spot face leaves no material.
- **The TX07 letters.** The page labels its dimensions by letter, not by feature. As read off its front view for shell
  25:
  - W, 2.188 in ±.016 (55.6), is the flange.
  - D, 2.323 in (59.0), and J, 2.017 in max (51.2), are the jam nut across its corners and its flats. J / cos 30° is D.
  - K is 1.759 in (44.7).
  - The script had called W the jam nut, and gave K as 1.812 in, which is not this page's number. Both are corrected;
    K is not used.
- **Citation corrected.** The cutout (H 1.760 in, A 1.710 in, shell 25) is from that TX07 page. The script had cited
  it as the "TX37" sheet.
- **The opening's basis is on the drawing:** NOT SOURCED. So is the sourced part of what is known about it.
- **Plate geometry.** The outline is unchanged: 135 × 135 × 3.175 mm, with 4 × Ø6.6 holes on 109.0. The spot face is
  the only new feature.

## The fuse-box opening: what is sourced, and what is not
**Sourced.** American Autowire's 510351 Dash Wiring Kit instructions (rev 1.0, sheet 1, read 2026-09-29 from
americanautowire.com's page for kit 510347) say three things:
- It is "the stock OEM bulkhead connector hole in the driver side of the firewall".
- The fuse panel fastens to the firewall with two screws through two stock holes: "Using the two mounting screws A
  ... attach the fuse panel to the firewall", with "A" marking the stock fuse box mounting holes.
- The instructions print no dimension for the hole or the two screw holes.

Three eBay listings for a "73-87 billet firewall wire harness bulkhead cover" agree on the two fasteners (read
2026-09-29):
- ebay.com/itm/127929208206
- ebay.com/itm/287411145633
- ebay.com/itm/326228745474

What they show:
- The cover mounts with two 1/4-20 machine screws, after drilling out the factory screw holes. It clamps the fuse panel
  on the far side.
- The product photos show the two screw holes at diagonal corners.
- None of them prints a dimension.

**The shape, from the illustration (not a measurement).** The lead rendered sheet 1 at 300 dpi, and its figure prints
no dimension. It shows the stock hole from the cab side, and the lead read these proportions off it:
- A trapezoid whose parallel sides are vertical, with rounded corners. The right side is the tall one: left : right is
  0.73.
- The width is 0.92 × the right side. The top and bottom edges slant symmetrically.
- The corner radius is 0.08 × the right side.
- The two "A" screw holes sit on a diagonal:
  - A1 is 12/212 of the right side right of the right edge, and 28/212 above the top-right corner.
  - A2 is 17/212 left of the left edge, and 30/212 below the bottom-left corner.
  - Each is drawn about 1/15 of the right side across.

The sheet is an illustration, possibly in perspective, so this is shape only. The drawing now shows that shape, with
the right side at the trait table's 4.0 in (ASSUMED). Every other opening number follows from the ratios, and all of
them are stamped.

**Not sourced:** the opening's size (so its real scale), the two holes' true positions, and the firewall's thickness.

**What was tried, and found nothing printed:**
- The 1973, 1977, 1981 and 1987 service manuals in the library. §8 and Fig. 8-1 describe the bulkhead fuse panel
  only.
- American Autowire's 510347 and 510351 instructions. The text layer has no numbers, and neither does the rendered
  figure (the lead read it).
- The billet bulkhead cover family on eBay: nine listings from several sellers, read as listing text on 2026-09-29.
  None prints a size. All say "1/4-20 machine screws", and some add "remove factory screws, drill the firewall". A
  used GM "fuse panel mount screw" listing gives no size either.
- The 1978 C-K wiring booklet, sheet A-1 (reference_documents/wiring_diagram_booklets/pages). It names the fuse panel
  "8917739 FUSE PANEL ASM". No listing for 8917739 gives an outline.
- Vendor search pages:
  - LMC Truck, Classic Industries, Brothers Trucks (now at CJ Pony Parts), Speedway Motors, ICT Billet, Ron Francis
    and Dirty Dingo (404);
  - eBay (four queries);
  - Etsy, Printables and Thingiverse.
- The forum.73-87chevytrucks.com search (five queries). No topic gives the opening's size.
- The 67-72chevytrucks.com board. Its search needs a login.

## Unknowns
- **The opening:** its size (the shape is the illustration's), the two fuse-panel screw holes' true positions and
  size, and the firewall thickness.
  - At the assumed scale, A2 lands on the plate's lower-left M6 hole and A1 at its top-right corner. So the real
    positions decide the plate's own fastener pattern: reuse the stock holes, or move the corner holes clear of them.
  - What closes it:
    - a tape or caliper reading at the truck (the builder);
    - or a photo of the bare opening with a scale in it;
    - or GM's 1977 C/K assembly manual page for the fuse panel, if it can be reached;
    - or one real dimension from any source (a block-off plate's cutout, the fuse panel's screw spacing). The ratios
      give the rest.
- **Which face gets the spot face.** The jam nut can go in the cab (drawn) or in the opening on the engine side. If it
  is in the opening, the opening must clear 59.0 mm across the jam nut's corners.

## Result
- **Outputs:** regenerated in place, and `--check` passes.
- **Index:** unchanged, and index_v5 now lints the stamps.
- **Drawing:**
  - It states the receptacle's limit and the spot face that meets it, with its reason.
  - It shows the gasket ring's inner edge.
  - It draws the opening in the illustration's shape and marks it "shape from AAW 510351 sheet 1 illustration; size
    NOT SOURCED", with A1 and A2 where the illustration puts them.
  - `--check` also fails if the receptacle's flange or jam nut does not clear the drawn opening.
  - It says what must be opened before cutting.
