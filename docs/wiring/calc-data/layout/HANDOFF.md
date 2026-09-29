# K5 Harness Layout: the workspace builder

Live: https://claude.ai/artifact/QVLCDvWkF2XJ6DABBodakh, version 11 (2026-09-29). It is private to the owner.
Lane: layout-ui. The page is built from sourced files only; nothing is typed into it by hand.

## What the page is

It is one engineering workspace, and everything in it cross-probes. Select anything and it lights up in every pane.

- **Left: the project tree.** Systems are the registry's subsystems. Under each system come its devices, then connectors, then pins. The tree can also switch to bundles, then segments, then wires.
- **Centre: one view at a time.**
  - Vehicle: top, side and bay in 2D, the 3D bay GLB, and harness-cad's labelled renders.
  - Connector: the connector face from `pins.json`.
  - Schematic: a per-circuit block diagram generated from the registry terminations.
  - Library: the six parts in true CAD, which is the content of the Parts Library page.
- **Right: structured properties.** Where each value came from sits behind the Sources toggle.
- **Bottom: linked tables.** Wire list, pin list, connectors, BOM with the cost layer, open items and notes.
- **Top strip.** First the decisions that need the owner, then coverage.
- **Kept from earlier versions:** the Ask box (`sample`), notes (`db` and `user`), masking (`$•••`, `order •••`), margins, and parts drawn to size with no dots.

## Build

```
python3 build.py            # snapshots inputs into in/, writes site/k5_layout.html plus site/{v,ph,3d,lib}/
python3 shot_ws.py shots_ws # headless screenshots of every view and the phone layout
python3 test/interact.py    # clicks through every pane and reports page errors
```

After building, publish `site/k5_layout.html` to the URL above. Use `root=site` and pass every file under `site/` except the page itself.

Inputs:
- From the pieces lane: `ends.py`, `pos.py`, `footprints.py`, `anchors.json`.
- From main: `k5_registry.json`, `part_media.yaml`, `mounts.yaml`, `part_models.yaml`, `parts.yaml`, `tape_list.yaml` and the suppliers files.
- From harness-cad: `routes.json` and the bay GLB.
- From the parts-artist: the samples, which are GLB, `pins.json` and `params.json`. Only the parts listed in the Parts Library's part list are read.
- From this lane: `sizes.py`, which holds the sourced envelopes, names, the decisions and the bay findings.

Every GLB is scanned for credential strings before it is embedded. The build refuses any GLB that contains one.

## Next

1. **Decision 1.** Link it to the pieces lane's list of the 13 wires once that list is on file. Until then it links only to the bulkheads and the 61-pin.
2. **Whole-truck 3D.** Swap in harness-cad's zone GLBs when they land. The Vehicle 3D view reads a single GLB now.
3. **Library.** Add parts as the pieces lane adds them to the Library part list. About 30 more samples, the Deutsch and bulkhead parts among them, are waiting on audit.
4. **Retiring pages.** The Parts Library, M130 review and bay sample pages become one-line pointers here. Only the pieces lane touches them, since it published them.
