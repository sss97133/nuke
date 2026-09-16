# Receipt — Connector Inspector COLORWAYS: adversarial review fixes

**Date:** 2026-06-11 · **Change type:** tooling/frontend (presentation layer only — zero data-path changes) · **Status:** executed · **Amends:** 2026-06-11_connector-colorways.md

## Directive
Adversarial review of the four shipped colorways, reviewer roleplaying the target adopter (one-man-shop harness builder). One ROOT defect + per-theme issues. Reviewer findings, quoted:

> **ROOT:** "the de-emphasis pattern dims TEXT along with FILL for secondary states (overflow, direct-feed, filtered-out, spare)." Named instances: "PAPER outer-ring tan-on-pink (~1.6:1)", "CAD filtered dark-amber-on-black letters", "SHOP's direct-feed footer gray-on-navy."
>
> **PAPER:** "spread the three warm pastels (salmon/wheat/pale-pink) apart in VALUE so groups are distinguishable across a bench; letters full black everywhere."
>
> **LEDGER:** "gauge-number color coding — either add a one-line legend in the table header explaining the rule … IF the coding encodes something real … Remove the identical red left-edge bar from every row (status stripes must vary or not exist). Render UNCUT as a plain cell value (mono text), not a web pill."
>
> **CAD:** "secondary-state letters to full white or bright amber; differentiate SELECTED (solid yellow fill, black text) from FILTERED (thin dim ring, white text) — different shapes AND clearly different brightness, not two ambers."
>
> **SHOP:** "rebuild with CAD's discipline — keep dark navy field but ONE accent family, white letters everywhere, no pastel fills (fills become dark desaturated chips with white text + colored ring for group identity). It must stop reading as a video game."

## Root cause (found in pixels, then in code)
The reviewer's PAPER "tan-on-pink" and CAD "dark-amber" letters were the **`ci-pulse` animation**: it animated `opacity` on the whole cavity `<g>` (chip + ring + letter together), so at the 0.55 trough a black letter on a salmon chip washed to gray-on-pale-pink (~1.6:1) and a CAD warn ring + white letter washed to dark-amber/gray. The same pattern existed statically: `textFill` switched to `inkFaint` for spare cavities, `onBadge` was a fixed per-theme color regardless of badge fill, and the direct-feed footer used `inkFaint` (SHOP `#666680` on navy ≈ 3:1).

## ROOT FIX — the text-on-chip law (global)
- **`colorways.ts`**: new `compositeOver(fg, bg, alpha)` (sRGB alpha blend — what the browser actually composites) and **`textOn(fill)`** — pure black or pure white, picked per chip **luminance** (max contrast), never per state. Documented as the TEXT-ON-CHIP LAW in the file header.
- **`FaceSkin.tsx`**: cavity letter color = `textOn(compositeOver(chipColor, bg, chipOpacity))` — always full contrast against what is actually rendered behind it. De-emphasis (spare/unoccupied) is now carried ONLY by fill saturation (`SPARE_FILL_OPACITY = 0.28`) and outline weight (occupied ring 2px, de-emphasized ring 1px, hollow).
- **Pulse never touches text**: `.ci-pulse` moved from the `<g>` to the chip `<circle>` (the letter is a sibling, stays crisp through the whole cycle); overflow buttons got a new `.ci-pulse-border` keyframe that animates **border-color only** (`ConnectorInspector.tsx`).
- **Direct-feed footer**: button text `inkFaint` → `inkMuted` (≥4.5:1 floor token); selected chip text via `textOn`. De-emphasis = the thin `rule()` border.
- **Badges everywhere** (FaceSkin wire card, TableSkin state pills, BuildSkin stepper): text = `textOn(buildState[s])` — the fixed `onBadge` token is **removed**. (It was silently wrong: PAPER's `#15151c` on the `#666680` uncut chip was 3.4:1.) BuildSkin's unreached stepper segments: `inkFaint` → `inkMuted`.
- Removed tokens: `onBadge`, `rowAccentEdge`, `cavityTextColor` (letter color is computed now; the 'ink' occupied-ring source reads `cw.ink`).

## Per-theme fixes
1. **PAPER** — palette value-spread (same hues, lightness pulled apart): drive `#F2BBBB`→`#DE8B8B` (mid-value salmon), power `#F8D9A8`→`#F6D9A0` (light wheat), sensor `#BBD3EE`→`#A8C6E8`, can `#BFEAEF`→`#C9EDF2`, spare `#ECECEC`→`#EFEFEC`. Letters full black on every chip (luminance-picked): drive 8.2:1, power 15.4:1, sensor 11.9:1, can 16.9:1, spare 18.2:1.
2. **LEDGER** — the gauge coding is REAL (`gaugeChangedFromSpec` — the derivation's vdrop upsize, same flag the detail card spells out as "SPEC N — VDROP UPSIZE"), so it stays and gets a legend in the table filter bar, rendered in the coding color itself so the legend is its own sample: "COLORED AWG = UPSIZED FROM SPEC (VDROP)". The 3px left-edge row bar is **removed** (mechanism deleted, not just disabled — `rowAccentEdge` token + `TD edge` prop gone). UNCUT renders as a plain mono cell value; pills only for states that actually happened (cut/term/routed/verified).
3. **CAD** — SELECTED = **solid accent-yellow chip + black letter** (`monochromeFace && selected` → fill `cw.accent`); everything else is a hollow chip with a **thin dim ring** (occupied `inkFaint` 2px, spare `border` 1px) + **pure white letter** via `textOn`. Conflict keeps the warn ring — now unambiguous vs selection: solid bright fill vs thin ring, different shape AND brightness.
4. **SHOP** — rebuilt with CAD's discipline on the navy field. Pastel fills gone; `functionGroupPalette` is now saturated identity colors (`#5CB3FF/#FF6666/#FFC04D/#5CE1E6`) rendered as **dark desaturated chips** (`faceFillOpacity 0.18` over `#1a1a2e` → e.g. sensor chip `#263654`) with **white letters** (11–16:1) and the saturated **group-color ring** (`faceOccupiedStroke: 'group'`). ONE accent family (the cyan `#00ddff`); orange/red/green remain semantic-only (warn/danger/ok). `borderStyle` standard→hairline — the 2px frames were part of the game-HUD feel. The "pixel-identical to the pre-colorway render" property from the parent receipt is deliberately superseded by this review.

## Contrast assert — kept and extended
`assertColorwayLegibility()` still checks the 11 token pairs (added `onAccent`-on-`accent`) and now ALSO asserts, at module load, **cavity-letter-vs-chip-fill ≥ 4.5:1 for every group color in every colorway** — at every fill strength FaceSkin actually renders (occupied `faceFillOpacity`, de-emphasized `SPARE_FILL_OPACITY`, full-strength hover/selection reveal) — plus badge-text-vs-badge-fill for all 6 build states. **4 colorways × (11 pairs + 6 groups × 3 alphas + 6 badges) = 140 checks, ALL PASS** (strict `npx tsx` run, failures: 0). Worst chip in the system: PAPER overflow 6.82:1.

## Files
- `nuke_frontend/src/components/wiring/connector-inspector/colorways.ts` — text-on-chip law (`compositeOver`/`textOn`/`SPARE_FILL_OPACITY`), PAPER value-spread, SHOP rebuild, token removals, extended assert.
- `connector-inspector/FaceSkin.tsx` — luminance-picked letters, ring-weight de-emphasis, CAD solid-selected, chip-only pulse, footer fix.
- `connector-inspector/TableSkin.tsx` — AWG legend, row edge bar removed, UNCUT plain mono, `textOn` pills.
- `connector-inspector/BuildSkin.tsx` — stepper text via `textOn`/`inkMuted`.
- `ConnectorInspector.tsx` — `ciPulse` scoped to chips, `ciPulseBorder` added.

NOT touched (parallel agent owns them): `HarnessWorkbench.tsx`, `PlanView2D.tsx`, `harnessDerivation.ts`.

## Verification
- `npx tsc --noEmit --skipLibCheck` = 0 errors; `npm run build` clean.
- Strict assert: `assertColorwayLegibility(true)` — 0 failures (140 checks).
- Re-screenshot, dev :5174, headless Chromium 1600×1000, FIREWALL cavity A selected, same paths (overwritten):
  - `docs/wiring/output/colorway_paper.png` — FACE, PAPER
  - `docs/wiring/output/colorway_ledger.png` — TABLE, LEDGER
  - `docs/wiring/output/colorway_ledger_face.png` — FACE, LEDGER
  - `docs/wiring/output/colorway_cad.png` — FACE, CAD
  - `docs/wiring/output/colorway_shop.png` — FACE, SHOP
- Screenshots read back at 2-4x zoom and confirmed: PAPER outer-ring letters crisp black on every chip **including conflict cavities mid-pulse**; CAD selected (solid yellow/black A) vs everything else (thin dim ring/white letter) unmistakable; SHOP direct-feed strip legible (`inkMuted` on navy), face reads as dark engineering print — dark chips, white letters, colored identity rings, no pastels.
- Console: no app errors (only unauthenticated 401/500 from build-state persistence in the headless session — pre-existing, unrelated).

## Unknowns
- None blocking. One note: the conflict pulse still dims the chip's warn RING at trough (attention animation on fill+ring) — letters are exempt per the law; if the ring dim ever bothers at the bench, split ring to its own non-animated element.
