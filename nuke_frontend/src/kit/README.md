# The kit

The web has no UIKit. This folder is Nuke's: the only place type and layout are decided. A page
composes kit components and passes them typed facts. It cannot set a font size, a font family or
an inline style; `scripts/guardrails/design-violations.mjs` counts every attempt outside this folder
and `scripts/ci/verify.sh` fails a PR that adds one.

## Roles

Six text roles, in `kit.css`. The entity name is the largest name on a page; a page may set its headline numbers (one,
or two side by side) as `figure`, which may be larger (2026-10-15: the live board's total, set as a sentence, "doesn't look real").

| Role | Face | Use |
|---|---|---|
| `entity` | System sans 700 24px | the thing the page is about |
| `figure` | System sans 700 34px (28px under 480px), tabular | a page's headline number (at most two) |
| `measure` | System sans 650 16px, tabular | a number or a recorded value |
| `body` | System sans 400 15px | prose |
| `caption` | System sans 400 12px | clocks, coverage, provenance |
| `label` | System sans 600 12px | the name of a field |

These six numbers are the whole typographic argument. Change them here or not at all.

A list row keeps the same roles at list density: `<Text role="entity" dense>` (14 px) names the row
and `<Text role="measure" dense>` (13 px) carries its number. `dense` does nothing to body, caption or
label, whose sizes are already list sizes. The shared styles honor the owner’s 2026-10-24 iOS direction; dense roles remain intentional for data lists.

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
