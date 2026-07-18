# Receipt — Connector Inspector COLORWAYS: PAPER / LEDGER / CAD / SHOP

**Date:** 2026-06-11 · **Change type:** tooling/frontend (presentation layer only — zero data-path changes) · **Status:** executed · **Amends:** 2026-06-10_connector-inspector-skins.md (extends the skin system with a theme axis)

## Directive (Skylar)
> The adopters are hard-core one-man-shop harness engineers coming from Excel sheets and paper layouts — the UI must read as traditional engineering tooling, never gimmick. Winamp-skin model: same data, full visual swap, one click.

SKINS (FACE/TABLE/BUILD/PRINT) swap the *projection*; COLORWAYS swap the *visual register*. Both axes are orthogonal and URL-addressable: `?skin=` × `?cw=`.

## What
A token-driven theme layer over the entire Connector Inspector. One `Colorway` object (~30 tokens: chrome colors, fonts, face-render behavior, table behavior, border weight) threaded via React context through all four skins, the detail card, and the header chrome. Four colorways:

| ID | Register | Key moves |
|---|---|---|
| **PAPER** (DEFAULT) | printed connector sheet | white bg, faint graph-paper grid (0.5px SVG pattern lines), black ink + line-art, the python build-sheet print palette for function groups, hairline borders, Arial |
| **LEDGER** | spreadsheet | #F6F7F8 bg, cell-grid column rules, zebra stripes, system-ui font, near-black text; color ONLY as 3px left-edge row accents, group rings, and small swatches — face renders restrained tints (fill opacity 0.16, saturated ring) |
| **CAD** | black line-art | pure #000, thin white shell strokes, monochrome face (black fill / white ring / white label) with group color ONLY on hover/selection, dimension-yellow accent, crosshair cursor on the face canvas, Arial Narrow annotation register |
| **SHOP** | the original dark blue | every value extracted VERBATIM from the previous hardcoded constants — pixel-identical render when selected |

Switcher: compact swatch-dot picker (theme-bg/theme-accent half-blocks, active shows label) in the inspector header. State: `?cw=` URL param wins → `localStorage('nuke_ci_colorway')` fallback → PAPER default. One click, full swap, zero refetch (same ConnectorModel objects).

## Files
- `nuke_frontend/src/components/wiring/connector-inspector/colorways.ts` — NEW: token interface, four colorway definitions, `ColorwayContext`/`useColorway`, border helpers (`frame`/`rule` off the `borderStyle` token), and the legibility floor: `assertColorwayLegibility()` checks 10 text-bearing token pairs × 4 colorways ≥ 4.5:1 WCAG contrast at module load (constant-time; throws in strict mode, console.error in app). Verified: **all 40 pairs pass** (`npx tsx` strict run).
- `nuke_frontend/src/components/wiring/ConnectorInspector.tsx` — colorway resolution (URL/localStorage/default), context provider, picker UI, header chrome on tokens.
- `connector-inspector/FaceSkin.tsx` — tokens + PAPER graph-grid (real SVG `<pattern>` lines, not CSS gradients), CAD monochrome hover-reveal (`hoverKey` state), `faceCursor`, `faceFillOpacity`, `faceOccupiedStroke: 'ink' | 'group'`; detail card + wire card themed.
- `connector-inspector/TableSkin.tsx` — tokens + `tableStripe` zebra, `gridLine` column rules, `rowAccentEdge` 3px left-edge group accents (LEDGER only — SHOP/PAPER render no new chrome).
- `connector-inspector/BuildSkin.tsx`, `connector-inspector/PrintSkin.tsx` — tokens throughout (`okTint` verified-row tint, `barUncut` progress segment).
- `connector-inspector/useBuildState.ts` — `BUILD_STATE_COLORS` removed; build-state hues now live in the colorway (`buildState` token, shared across themes so yellow always means CUT at the bench; CAD lightens only `uncut` for black-field visibility).

NOT touched (parallel agent owns them): `HarnessWorkbench.tsx`, `PlanView2D.tsx`, `harnessDerivation.ts`. `ConnectorFaces.tsx` untouched — its `FILL` export still feeds the WORKBENCH tab; the inspector now reads group colors from colorway tokens instead (SHOP/PAPER palettes carry the same hex values, so nothing drifts).

## Grep verification — no hardcoded chrome
`grep -rnE '#[0-9a-fA-F]{3,8}\b'` over `connector-inspector/* + ConnectorInspector.tsx` hits only:
1. `colorways.ts` — the token registry itself (by design).
2. `colorCodes.ts` — **physical wire-insulation hexes** (BARE/NAT/CLR/BLACK/WHITE + fallback), delegating to `wiringTheme.ts WIRE_COLOR_HEX`. Deliberately NOT themed: a TAN/WHT wire is tan and white in every colorway — insulation is data, not chrome.
3. `buildConnectorModels.ts:125` — `MoTeC #65044/#65045` part numbers (false positive, not colors).

## Legibility floors
- ≥14px body text everywhere (unchanged from the skins receipt; picker labels are 14px).
- Cavity labels exempt to 11px at fit (SVG-scaled; unchanged).
- Contrast ≥ 4.5:1 for ink/inkMuted on bg/surface/elevated + accent/danger/warn/ok on bg, asserted in code at module load. `inkFaint` (tertiary/disabled) is exempt — SHOP's `#666680` predates the floor and is preserved verbatim per the pixel-identical requirement.

## Design-system notes
- Zero border-radius / shadows / gradients preserved. The picker swatch is two flex half-blocks, not a gradient; the PAPER grid is SVG `<pattern>` line geometry, not CSS gradient tricks.
- `.claude/rules/frontend.md` Arial/Courier rule holds for PAPER/SHOP; LEDGER's system-ui and CAD's Arial Narrow are the deliberate point of the colorway (the register IS the feature, per the audience directive). SHOP default-render is untouched.

## Verification
- `npx tsc --noEmit --skipLibCheck` = 0 errors; `npm run build` clean.
- Strict contrast run: `assertColorwayLegibility(true)` via tsx — ALL PAIRS PASS ≥ 4.5:1.
- Live on `/vehicle/e08bf694-970f-4cbe-8a74-8715158a0f2e/wiring?tab=connectors` (dev :5174), cavity A selected, headless Chromium 1600×1000:
  - `docs/wiring/output/colorway_paper.png` — FACE, PAPER
  - `docs/wiring/output/colorway_ledger.png` — TABLE, LEDGER (its home turf)
  - `docs/wiring/output/colorway_ledger_face.png` — FACE, LEDGER (restrained-palette proof)
  - `docs/wiring/output/colorway_cad.png` — FACE, CAD (monochrome + selection reveal)
  - `docs/wiring/output/colorway_shop.png` — FACE, SHOP (matches pre-change render)
- Fresh page load: no console errors; colorway picker + detail card live.

## Unknowns
- None blocking. One soft note: CAD's "condensed mono" annotation font is approximated with Arial Narrow + Courier New — no true condensed monospace ships cross-platform as a system font; a bundled webfont would be a separate (and probably unnecessary) change.
