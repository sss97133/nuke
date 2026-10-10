---
paths:
  - "nuke_frontend/src/**"
---

# Frontend Design System Rules

Canonical CSS: `src/styles/unified-design-system.css` (legacy `design-system.css` is frozen).

## Typography
- Arial only. Courier New for data/monospace.
- ALL CAPS labels at 8-9px

### Brand identity rendering (owner rule, 2026-10-08)

- A structured brand/make label uses available identity artwork programmatically. Vehicle makes use `components/common/MakeIdentity.tsx`; organization identity uses the existing `OrgLogo` renderer. This applies wherever brand identity is relevant, including discovery, filters, group headings and drill paths.
- `MakeIdentity` resolves the brand against the sourced artwork catalogue: wordmark first, otherwise emblem with readable name, otherwise plain text. Catalogue additions must become available to every consumer without adding page-specific brand lists. Preserve accessible names and text on asset failure.
- Treat lettering as identity artwork, not a replacement UI font. Arial/Courier remain the interface fonts. Compact labels and prose retain readable text; an adjacent emblem uses `MakeLogo`. Do not guess brands from arbitrary text or rewrite vehicle titles into logos.
- Reuse local attributed artwork and its theme variants. Reserve image dimensions and preserve contrast on selected surfaces. New surfaces consume the shared rule instead of inventing artwork or fetching logos independently.
- Vehicle headlines use year/make/model-specific identity artwork (owner correction, 2026-10-10). Use `VehicleIdentity` in the shared `MakeIdentity.tsx` owner and `vehicle-identities.json`: sourced period maker lettering, model nameplate and model emblem, each with its own verified model/year applicability. Vehicle year selects a documented range; it does not establish a badge's history. Unknown matches retain text. Do not substitute a modern make wordmark or approximate script font. Preserve the source chrome/enamel rather than recoloring it for themes. This supersedes the 2026-10-08 blanket prohibition on year-based selection.
- The local artwork catalogue uses a light/dark pair for colored wordmarks, or one verified monochrome wordmark that can be inverted. Keep that convention when registering artwork; absent theme metadata is not permission to recolor arbitrary logos.

## Visual
- Zero border-radius. Zero shadows. Zero gradients.
- 2px solid borders.
- Racing accents (Gulf, Martini, JPS, BRG, Papaya) as easter eggs only.

## Animation
- 180ms `cubic-bezier(0.16, 1, 0.3, 1)` — for interactions (hover, expand, drawer), not for hiding navigation latency.
- For navigation between pages: no fade transitions, no loading spinners. Use hover-prefetch + instant transition (McMaster-Carr pattern). See benchmark study.

## Performance Targets (McMaster-Carr benchmark)

Speed is a first-class doctrine concern. Targets (verified against `docs/library/intellectual/studies/2026-05-24_mcmaster-carr-speed-benchmark-study.md`):

| Metric | Target | Why |
|---|---|---|
| Time to First Byte | <200ms | Edge-cached HTML via Vercel |
| First Contentful Paint | <500ms | SSR or inlined critical CSS |
| Largest Contentful Paint | <1.5s | Fixed-dim images, no JS-blocking |
| Cumulative Layout Shift | <0.05 | Reserved space for all media |
| JS bundle per route | <150kb | Code-split per route |
| Hover → prefetch | required | react-router prefetch on hover |

Binding rules:
- Every `<img>` has explicit width/height (no CLS).
- Every internal `<Link>` prefetches on hover.
- No marketing copy on canonical pages — the data IS the page.
- Resist hero rotators, newsletter modals, promotional banners. McMaster has none. Neither do we.

## Sticky Stack (CRITICAL — read before touching any `position: sticky`)

The vehicle profile has a vertical stack of sticky elements. Their `top` values are cumulative — each layer must clear everything above it. **NEVER use raw px values for sticky positioning.**

The sticky stack is defined in `vehicle-profile.css` as named CSS custom properties:

```
--vp-h-site         42px   global header (NUKE + search)
--vp-h-tab-bar      28px   vehicle tab bar
--vp-h-sub          36px   sub-header (badge bar)
--vp-h-barcode      10px   barcode timeline strip

--vp-stick-tab-bar  = h-site                              (tab bar below header)
--vp-stick-sub      = h-site + h-tab-bar                  (sub-header below tab bar)
--vp-stick-barcode  = h-site + h-tab-bar + h-sub          (barcode below sub-header)
--vp-sticky-top     = h-site + h-tab-bar + h-sub + h-barcode  (columns below barcode)
```

Rules:
- Every sticky element MUST use a `--vp-stick-*` token for its `top` value
- To add a new sticky layer: add its height var, create its anchor var, update ALL anchors below it
- NEVER hardcode `top: 40px` or `top: calc(...)` inline — use the named token
- If you change ANY height in the stack, verify every anchor below it still adds up
- The tab bar CSS (`VehicleTabBar.css`) references `--vp-stick-tab-bar` with a fallback

## Horizontal Alignment
- All layout containers: `padding: 0 12px`
- Never inline `position: sticky` or `top:` in React — use CSS tokens only

## No Empty Shells
- Every widget MUST check for data before rendering. Return null if empty.
- Never render a CollapsibleWidget whose body says "No data available"
- If backend pipeline doesn't exist yet, don't render the widget

## Surgical Edits, Not Rewrites
- NEVER do a total file replacement on an existing component. Read it first. Understand what it does. Fix the specific issue.
- A bug fix is 3-10 lines of change, not a 400-line Write tool call.
- Before creating a new component, check if the functionality already exists in a different component that can be extended.
- Before creating a new database table, check if the data fits into an existing table (especially: vehicle_timeline, vehicle_observations, vehicle_images, work_orders, work_order_line_items).
- The vehicle profile is the CONVERGENCE POINT. Do not create parallel display systems. Feed data into the existing structures.
- Read `docs/library/technical/design-book/vehicle-profile-computation-surface.md` before touching any vehicle profile code.

## Reference Files
- Design reference: `~/Downloads/nuke-session-files/`
- Design book: `docs/library/technical/design-book/`

## Vehicle profile fact ownership — owner instruction, 2026-10-10

State each datum once on the page. Give it one primary owner; other sections should link to that owner or add a distinct computation. Do not repeat identity, sale result, dates, counts or scores across a masthead, chart label and evidence card. Before adding a tool, assay its population, units, clock and supported interpretation. An unexplained stored score or an average of unmatched configurations does not earn profile space; remove the surface rather than surrounding it with caveats.
