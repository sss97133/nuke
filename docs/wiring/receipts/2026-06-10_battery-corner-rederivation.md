# Receipt — L14/L15 re-derivation: battery at passenger firewall corner

**Date:** 2026-06-10 · **Change type:** substrate_correction (clears the STALE flags from receipt 2026-06-10_cut-list-v4.1-ecu-lifelines.md)

Battery node = passenger firewall corner (owner working position, 2026-06-10). Alternator node corrected to as-built: CVF drive, LOW DRIVER side (2026-01-31 photos; the twin's passenger-upper Holley placement is superseded — model re-route owed next Blender session).

| Landmark | Was (driver-front placeholder) | Now | Method |
|---|---|---|---|
| L14 BAT+→ALT | 61.6" | **89.4"** (cross-car via core support) | analytic_polyline_derived — same waypoint vector math as the twin derivation; waypoints in receipt source |
| L15 BAT+→STR | 68.7" | **24.3"** (same-corner fender drop) | same |
| #PDM_BPOS feed | — | **16.7"** (corner → PDM zone) | same — feeds the v4.1 parallel-pair sizing |

Net effect run through `compute_wire_lengths.py`: #59 alternator and related power runs re-lengthed; short starter run also re-opens the gauge question in the build's favor (24" of cranking cable has far less drop than 69"). Spatial workbench (in flight) makes this whole class of receipt obsolete — drag the node, the system does this.
