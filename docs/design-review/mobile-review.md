# Mobile Experience Review

**Reviewer:** Mobile Director (design-deep-dive)
**Date:** 2026-04-05
**Scope:** Does the app actually work on a phone? Responsive layouts, touch targets, sticky stack, mobile nav coherence.
**Files examined:** 35+ CSS and component files across layout, styles, pages, and popups.

---

## Verdict

The app has *some* mobile infrastructure -- a bottom nav, a 768px breakpoint for the vehicle profile column stack, a `useIsMobile` hook, and a `HeaderPopover` that becomes a bottom sheet. But these are islands of mobile awareness in an app designed fundamentally for desktop. A real user on a phone will hit friction on nearly every screen.

---

## 1. What Works

### 1.1 Viewport Meta Tag
`index.html` includes a correct viewport meta: `width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content`. PWA meta tags (`apple-mobile-web-app-capable`, `manifest.json`) are present. `viewport-fit=cover` is correct for notch phones.

### 1.2 Mobile Bottom Nav
`MobileBottomNav.tsx` renders 5 items (Home, Search, +, Inbox, Profile) hidden on desktop via CSS, visible at `max-width: 768px`. The items have `min-height: 44px`, meeting Apple's minimum touch target. The "+" button has a clear visual distinction.

### 1.3 Vehicle Profile Column Stacking
At 768px, `.vp-columns` switches from `display: flex` (30/70 split) to `flex-direction: column` with both columns at `width: 100%`. Column divider is hidden. This is the right behavior.

### 1.4 HeaderPopover Bottom Sheet
`HeaderPopover.tsx` detects `useIsMobile()` and renders as a fixed bottom sheet with backdrop on mobile, versus an absolute dropdown on desktop. This is a genuine mobile-first pattern. Close button is well-sized (19px).

### 1.5 Safe Area Padding
`design-system.css` has `@supports (padding-top: constant(safe-area-inset-top))` on the body. This respects iPhone notch insets at the top and home bar at the bottom.

### 1.6 Mobile Image Gallery
`MobileImageGallery.tsx` implements touch swipe with `onTouchStart`/`onTouchEnd` and a 50px minimum swipe distance. This is mobile-native behavior.

### 1.7 VehicleTabBar Hides on Mobile
When `useIsMobile()` is true and there is 0 or 1 tab, the `VehicleTabBar` returns null. This avoids wasting vertical space for a single-tab scenario.

---

## 2. Critical Issues

### 2.1 CRITICAL: Typography Is Unreadable on Mobile

The design system mandates font sizes of 8-11px. These are fine on a dense desktop terminal; they are illegible on a phone. Key offenders:

| Element | Size | File |
|---------|------|------|
| ALL CAPS labels | 8-9px | unified-design-system.css |
| Vehicle profile body | 10px | vehicle-profile.css line 97 |
| Badge labels | 8px | vehicle-profile.css |
| Widget DB indicators | 8px | vehicle-profile.css |
| Pricing labels | 8px | vehicle-profile.css line 962 |
| Footer links | 10px | AppFooter.tsx |
| Landing product names | 9px | landing.css |

Mobile needs a floor of 14px for body text and 11-12px for labels. The current `--font-scale` CSS variable exists but is never used in a media query to bump sizes on mobile.

**Fix:** Add a `@media (max-width: 768px)` block that sets `--font-scale: 1.4` or introduces mobile-specific size overrides. The variable infrastructure already exists.

### 2.2 CRITICAL: Popup System Is Desktop-Only

`PopupContainer.tsx` uses:
- Mouse-drag positioning via `onMouseDown` + `document.addEventListener('mousemove')` -- no touch equivalents
- Fixed positioning with `calc(50% - ${width/2}px)` and `15vh + stack offset` -- assumes a wide viewport
- Title bar buttons are 16x16px -- well below Apple's 44px minimum touch target
- Resize handle (14x14px) at bottom-right uses mouse drag -- impossible on touch
- Mouse-based hover states (`onMouseEnter`/`onMouseLeave`) for all interactive elements

On a 375px iPhone, a 700px expanded popup (or even a default-width popup) will overflow. The `maxWidth: 'calc(100vw - 32px)'` constraint helps but the positioning math (`calc(50% - ${effectiveWidth/2}px + ${index * 20}px + ${dragOffset.x}px)`) can still push content off-screen.

**Fix:** On mobile, popups should become full-screen bottom sheets or full-screen overlays. The `HeaderPopover` pattern already does this correctly -- the popup system should follow it.

### 2.3 CRITICAL: Touch Targets Systematically Undersized

Multiple interactive elements are well below the 44x44px minimum:

| Element | Size | File |
|---------|------|------|
| Popup title bar buttons (+, minimize, close) | 16x16px | PopupContainer.tsx |
| Popup resize handle | 14x14px | PopupContainer.tsx |
| Tab close button | ~11px font, no min-height | VehicleTabBar.css |
| Search clear button | unspecified size | SearchBar.tsx |
| Badge pills | ~20px tall | vehicle-profile.css |
| Widget controls | inherits 8px font | vehicle-profile.css |
| Minimized dock bar close button | 16x16px | PopupContainer.tsx |
| Range slider thumbs | 8x8px | design-system.css line 3771 |

The `design-system.css` does have a `@media (max-width: 767px)` block that forces `button { min-height: 32px }`, but 32px is still below Apple's 44px guideline, and the popup system uses inline styles that override it.

### 2.4 HIGH: Duplicate and Conflicting Mobile Bottom Nav Styles

The mobile bottom nav is defined in **two places** with different styles:

1. `unified-design-system.css` lines 1037-1080: `height: 56px`, `border-top: 2px solid`, `font-size: var(--fs-10)`, `min-height: 44px`
2. `design-system.css` lines 1455-1506: `height: 56px`, `backdrop-filter: blur(8px)`, `box-shadow`, `font-size: 9pt`

The unified version uses the design system's tokens and 2px border. The design-system.css version uses glassmorphism (`backdrop-filter: blur(8px)`), box shadow, and `pt` units (violating the "always px, never pt" rule stated in unified-design-system.css line 11). CSS cascade determines which applies, but this is fragile and confusing.

**Fix:** Delete the `design-system.css` version. The unified version is canonical per the frontend rules.

### 2.5 HIGH: Sticky Stack Collapses on Mobile

The vehicle profile has a 4-layer sticky stack consuming `42 + 28 + 36 + 10 = 116px` of vertical space at the top of the viewport. On a 667px iPhone 8 viewport, that is **17.4%** of the screen permanently occupied by navigation chrome before any content appears.

The mobile breakpoint in `vehicle-profile.css` does:
- Make sub-header wrap (`flex-wrap: wrap`) which can make it *taller*
- Make barcode strip `position: relative; top: auto` (un-stickied) -- good
- But the header (42px) and tab bar (28px) remain sticky

On mobile, 70px of sticky chrome is borderline acceptable. The barcode un-sticking is correct. But the sub-header wrapping to multiple lines could push this higher.

**Fix:** Consider hiding the vehicle tab bar on mobile entirely (it already hides for single-tab). Un-sticky the sub-header on mobile or collapse it to a single summary line.

### 2.6 HIGH: Search Overlay Assumes Desktop Width

`SearchOverlay.tsx` renders as an absolute dropdown below the search bar. On mobile, there is no width constraint or full-screen takeover. The keyboard footer (`navigate/select/close`) references keyboard shortcuts irrelevant on mobile. The search bar's `Cmd+K` badge is visible on mobile where it is meaningless.

**Fix:** On mobile, the search experience should be a full-screen overlay. Hide keyboard shortcut hints. The `mode='trigger'` variant in `SearchBar.tsx` shows a search icon + `Cmd+K` badge -- on mobile, just show the search icon.

### 2.7 HIGH: PWA manifest `start_url` Points to Wrong Path

`manifest.json` has `"start_url": "/tech"`. This is likely a legacy from the tech/capture subdomain. The main app is at `/`. A user who adds the app to their home screen will land on `/tech` which may not be a valid route.

**Fix:** Change `start_url` to `/`.

---

## 3. Medium Issues

### 3.1 No Hamburger Menu or Mobile Navigation Strategy

The desktop header is: `[NUKE] [command input (1fr)] [user avatar]`. On mobile at 767px, the only responsive change is `gap: 6px`. The command input shrinks but remains inline. There are no nav links visible in the header (they were removed -- "The command input IS the navigation").

This means:
- On mobile, the only way to navigate is the bottom nav (5 items) or the search/command input
- The bottom nav items (Home, Search, +, Inbox, Profile) cover the core paths
- But there is no way to reach Market, API, Auctions, Organizations, or any of the 80+ pages from the main nav

The bottom nav is the *only* mobile navigation. It works for core flows but is a dead end for secondary pages.

### 3.2 `design-system.css` Mobile Button Override Is Destructive

```css
@media (max-width: 767px) {
  .button, button {
    width: auto !important;
    max-width: 100% !important;
    padding: var(--space-2) var(--space-3) !important;
    font-size: 7pt !important;
    min-width: auto !important;
    min-height: 32px !important;
  }
}
```

This applies to **every** `<button>` element on mobile with `!important`. Problems:
- `font-size: 7pt` = ~9.3px -- even smaller than the design system's 8px minimum and uses the forbidden `pt` unit
- `min-height: 32px` is below the 44px touch target guideline
- The blanket `button` selector catches inline close buttons, icon buttons, tab buttons, and other elements that should not be resized

The comment in the CSS says "MUST stay inside @media -- was top-level before, broke every button on desktop." This was a fix that created a different problem.

### 3.3 Hero Image Height Fixed at 550px

`vehicle-profile.css` sets `--h-hero: 550px`. On a 375x667 iPhone, the hero image alone fills 82% of the viewport. The user must scroll past it to see any vehicle data.

**Fix:** Add `@media (max-width: 768px) { --h-hero: 280px; }` or use `min(550px, 50vh)`.

### 3.4 Heatmap / Barcode Timeline Horizontal Scroll on Mobile

The heatmap and barcode timeline use `overflow-x: auto` on mobile. This is acceptable for a data-dense visualization, but there is no scroll indicator or hint that the content extends beyond the viewport. Users may not discover that the timeline is scrollable.

### 3.5 Landing Page Minimal Mobile Handling

`landing.css` has one `@media (max-width: 600px)` block that reduces hero padding and switches the product grid to single column. But the hero title is 11px with 4px letter-spacing, which is readable but tiny. The action buttons at 9px/16px padding are undersized for touch.

### 3.6 Mobile Bottom Nav Badge Position

The inbox badge on `MobileBottomNav.tsx` uses `position: absolute; top: -2; right: -2` with a 7px font in a 14x14 box. On mobile, this may overlap the adjacent nav item or be clipped by the container, especially on smaller devices.

### 3.7 Minimized Popup Dock Conflicts with Bottom Nav

The `PopupContainer` minimized dock renders at `position: fixed; bottom: 0`. The `MobileBottomNav` also renders at `position: fixed; bottom: 0; height: 56px`. The dock uses `z-index: 9100` and the bottom nav uses `z-index: 1000`, so the dock renders on top. But the bottom nav's 56px padding-bottom on `.main-content` does not account for minimized popups.

---

## 4. Low-Priority / Cosmetic

### 4.1 Hover States Everywhere, No Tap Feedback

Almost all interactive elements use `:hover` or `onMouseEnter`/`onMouseLeave`. On touch devices, these fire on the first tap but provide no visual feedback before the action completes. Consider adding `:active` states for immediate tap feedback.

### 4.2 `cursor: grab` and `cursor: pointer` Irrelevant on Touch

The popup title bar and resize handle set `cursor: grab` and `cursor: nwse-resize`. These are invisible on touch devices.

### 4.3 No `prefers-reduced-motion` Applied Globally

`vehicle-profile.css` has `@media (prefers-reduced-motion: reduce)` that disables transitions/animations for the vehicle profile page only. The rest of the app (landing, search, popups) does not respect this preference.

### 4.4 `transition: all 0.12s ease` on `*` Selector

`design-system.css` line 3714 applies `transition: all 0.12s ease` to every element. On mobile, this can cause layout jank during scrolling (transitioning `transform`, `opacity`, or `width` on every element during rapid scroll).

---

## 5. Summary of Recommendations

### Must-Fix (blocks mobile usability)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 1 | Mobile font scale -- bump `--font-scale` at 768px breakpoint | S | All text becomes readable |
| 2 | Popups as bottom sheets on mobile | M | Popups become usable |
| 3 | Touch target minimum 44px on mobile | M | Buttons become tappable |
| 4 | Fix PWA `start_url` to `/` | XS | PWA home screen works |
| 5 | Delete duplicate mobile bottom nav in design-system.css | XS | Remove style conflicts |

### Should-Fix (significantly improves experience)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 6 | Reduce hero image height on mobile | XS | Content visible above fold |
| 7 | Hide search keyboard shortcuts on mobile | XS | Less confusing UI |
| 8 | Fix `7pt` font-size in mobile button override | XS | Correct unit, readable size |
| 9 | Reduce sticky stack height on mobile | S | More content visible |
| 10 | Full-screen search overlay on mobile | M | Better search flow |

### Nice-to-Have

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 11 | Add `:active` tap feedback states | S | Better tactile response |
| 12 | Global `prefers-reduced-motion` | S | Accessibility |
| 13 | Scroll indicators on horizontal scrollers | S | Discoverability |
| 14 | Remove `* { transition: all }` | XS | Scroll performance |

---

## 6. Architecture Assessment

The app's mobile strategy is "responsive by subtraction" -- hide things, stack columns, and hope the desktop layout fits. There is no mobile-first design thinking. The few mobile-specific components (`MobileBottomNav`, `MobileImageGallery`, `HeaderPopover` bottom sheet) are good but isolated.

The fundamental tension: the design system is modeled after a Bloomberg terminal -- dense, 8-11px text, data-heavy panels, mouse-precision interactions. This aesthetic is the app's identity and strength on desktop. But it is architecturally hostile to mobile.

Two paths forward:
1. **Minimal viable mobile:** Fix the must-fix items above, accept that mobile is a read-only/browse experience, and do not try to make every feature work on a phone. The bottom nav + search + vehicle profile viewing would cover 90% of mobile use cases.
2. **Mobile-first redesign:** Build a parallel mobile shell with larger touch targets, simplified layouts, and mobile-native interaction patterns (bottom sheets, swipe gestures, full-screen modals). This is a major effort and probably not worth it until the platform has external users who demand it.

Recommendation: **Path 1.** Fix the 5 must-fix items, accept the Bloomberg terminal is a desktop experience, and make the core read path (search, browse, vehicle profile) functional on mobile. The capture feature (camera) is already mobile-native and works.
