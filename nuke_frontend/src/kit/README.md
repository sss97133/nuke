# The kit

The web has no UIKit. This folder is Nuke's: the only place type and layout are decided. A page
composes kit components and passes them typed facts. It cannot set a font size, a font family or
an inline style; `scripts/guardrails/design-violations.mjs` counts every attempt outside this folder
and `scripts/ci/verify.sh` fails a PR that adds one.

## Roles

Five text roles, in `kit.css`. The entity name is always the largest text on a page.

| Role | Face | Use |
|---|---|---|
| `entity` | Arial 700 20px | the thing the page is about |
| `measure` | Courier New 700 14px, tabular | a number or a recorded value |
| `body` | Arial 400 10px | prose |
| `caption` | Courier New 400 9px | clocks, coverage, provenance |
| `label` | Arial 700 8px, tracked caps | the name of a field |

These five numbers are the whole typographic argument. Change them here or not at all.

A list row keeps the same roles at list density: `<Text role="entity" dense>` (13 px) names the row
and `<Text role="measure" dense>` (12 px) carries its number. `dense` does nothing to body, caption or
label, whose sizes are already list sizes. Seven numbers in all, still only in `kit.css`.

## Inputs

`types.ts` holds the shapes a page may render. A `Claim` carries its source, clock and trust. A
`Measure` carries its method and `Coverage` (n of N grain, as of a clock) and shows a percentile
only when at least `RANK_FLOOR` peers were measured; below that it says `unranked` and the peer
count. A `GalleryImage` is typed `gate: 'approved'`, so an image the vision gate did not approve
cannot exist in a document.

## Containers

`Masthead` (entity and one headline result), `Strip` (dimension members with coverage), `Section`
(a titled block that must state its coverage), `Measures` (one stack's readings), `Facet` (a member
you can open), `ClaimView` (a value that is a button into its evidence).

## Adopting it

1. Render from a `ProfileDocument` (one typed read, one viewer, one clock), not from `vehicle as any`.
2. Replace a widget's inline styles with roles and containers. The ratchet count for the file drops.
3. Lower the floor in `scripts/ci/baseline.json` when a count goes down. Never raise it.
