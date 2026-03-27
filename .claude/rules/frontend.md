---
paths:
  - "nuke_frontend/src/**"
---

# Frontend Design System Rules

Canonical CSS: `src/styles/unified-design-system.css` (legacy `design-system.css` is frozen).

## Typography
- Arial only. Courier New for data/monospace.
- ALL CAPS labels at 8-9px

## Visual
- Zero border-radius. Zero shadows. Zero gradients.
- 2px solid borders.
- Racing accents (Gulf, Martini, JPS, BRG, Papaya) as easter eggs only.

## Animation
- 180ms `cubic-bezier(0.16, 1, 0.3, 1)`

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

## Reference Files
- Design reference: `/Users/skylar/Downloads/nuke-session-files/`
- Design book: `docs/library/technical/design-book/`
