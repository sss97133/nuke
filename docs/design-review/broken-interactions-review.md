# Broken Interactions Review

Systematic audit of every broken user interaction in the Nuke frontend. These are not style opinions -- they are interactions that prevent the user from completing a task, trap them in a state they cannot escape, or make them close the tab.

---

## CRITICAL: Search Dropdown Freezes the Page

**Component:** `AIDataIngestionSearch.tsx` (lines 1317-2413)
**Severity:** Critical -- renders the app unusable

### The Problem

The search dropdown renders as an absolutely-positioned panel with `zIndex: 1203` inside a container at `zIndex: 1201`. But the header wrapper (`.header-wrapper`) is `z-index: 1000` and the search autocomplete dropdown (up to 24 results with 36px thumbnails each = 864px+ of content) renders inside the header's stacking context. The dropdown has `maxHeight: 420px` with `overflowY: auto`, so it scrolls internally -- but the header has `overflow: hidden` on the `.user-area-avatar` and the grid layout constrains width.

### Specific Failures

1. **Autocomplete dropdown renders under page content.** The dropdown's `position: absolute` + `top: 100%` places it below the 40px header, but the header-wrapper is `position: sticky` with `z-index: 1000`. Content below it (vehicle profile sub-header at `z-index: 900`, but other fixed elements at `z-index: 10000+`) can paint over the dropdown. The paper grain overlay on vehicle profile pages (`.vehicle-profile-page::after`) is `position: fixed; z-index: 9999` and covers the entire viewport -- this pseudo-element sits above the dropdown's `z-index: 1203` because the dropdown is inside the header's stacking context.

2. **onBlur race condition with click handlers.** Line 1469-1475: `onBlur` hides the autocomplete after a 200ms `setTimeout`. If the user's click on a dropdown item takes longer than 200ms to register (common on slow devices or when the browser is busy with the 300ms debounce search), the dropdown disappears before the click event fires. The `onMouseDown={(e) => e.preventDefault()}` pattern is used on some buttons but NOT on the autocomplete result items themselves (line 1825-1920). The result items use `onClick` without a corresponding `onMouseDown` preventDefault, so clicking a result races with the blur timeout.

3. **Multiple overlapping dropdown panels can render simultaneously.** The component renders up to 6 different dropdown panels in the same absolute position:
   - URL extraction banner (line 1519)
   - URL pre-extraction hint (line 1551)
   - VIN status panel (line 1581)
   - BROWSE make stats panel (line 1670)
   - Standard autocomplete dropdown (line 1783)
   - Actions menu (line 1971)

   The mutual exclusion logic at line 1783 (`currentIntent !== 'EXACT_URL' && currentIntent !== 'EXACT_VIN' && !(currentIntent === 'BROWSE' && ...)`) handles SOME conflicts, but if intent classification changes mid-keystroke (e.g., typing a URL that temporarily parses as a query), two panels can flash simultaneously. There is no single `activePanel` state -- each panel checks its own conditions independently.

4. **Autocomplete persists across navigation.** When a user selects a vehicle from autocomplete and navigates to `/vehicle/{id}`, the `showAutocomplete` state is not explicitly reset. The `useEffect` at line 275-378 checks `showPreview` but not route changes. If the user then focuses the search input on the new page, stale results from the previous query flash briefly before the 300ms debounce fires a new search.

**File:** `/Users/skylar/nuke/nuke_frontend/src/components/search/AIDataIngestionSearch.tsx`

---

## CRITICAL: Cmd+W Hijack Closes Vehicle Tab Instead of Browser Tab

**Component:** `VehicleTabBar.tsx` (line 33)
**Severity:** Critical -- violates platform conventions, data loss risk

The VehicleTabBar intercepts `Cmd+W` / `Ctrl+W` globally and calls `e.preventDefault()` to close a vehicle tab instead of the browser tab. This is hostile behavior:

- Users expect Cmd+W to close the browser tab. Hijacking it breaks muscle memory.
- If the user has unsaved work in a form on the page, they cannot use the standard shortcut to leave.
- The handler fires globally (`document.addEventListener('keydown')`) regardless of focus context -- it fires even when the user is typing in an input field, text area, or any other element.
- There is no guard for `e.target instanceof HTMLInputElement` on the Cmd+W path (that guard only exists for the `[` and `]` shortcuts at line 40).
- If no vehicle tabs are open, the shortcut falls through to the browser default, creating inconsistent behavior.

**File:** `/Users/skylar/nuke/nuke_frontend/src/components/layout/VehicleTabBar.tsx`

---

## HIGH: Paper Grain Overlay Blocks All Pointer Events on Vehicle Profile

**Component:** `vehicle-profile.css` (lines 115-123)
**Severity:** High -- renders vehicle profile partially unusable in edge cases

The vehicle profile page applies a fixed full-screen pseudo-element (`::after`) for a paper grain texture effect:

```css
.vehicle-profile-page::after {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none;
  z-index: 9999;
  opacity: 0.03;
}
```

This overlay is `pointer-events: none`, which should be fine. However, `z-index: 9999` means it sits above almost everything except the user dropdown (10001) and some modals. Any component that sets `pointer-events: auto` on a child inside this stacking context will find its clicks intercepted. The Toast container (`z-index: 9999`) and the Notification Center (`z-index: 1000`) both render below this overlay on vehicle profile pages.

The Notification Center specifically renders at `zIndex: 1000` as a fixed panel -- on the vehicle profile, it will paint behind the paper grain overlay and could be visually obscured or have interaction issues depending on browser compositing.

**File:** `/Users/skylar/nuke/nuke_frontend/src/styles/vehicle-profile.css`

---

## HIGH: Notification Center Has No Backdrop and No Escape Handler

**Component:** `NotificationCenter.tsx` (lines 310-325)
**Severity:** High -- user gets stuck with an open panel they cannot dismiss

The Notification Center renders as a `position: fixed` panel at `top: 60px; right: 16px; zIndex: 1000`. Problems:

1. **No backdrop.** Unlike the UserDropdown (which renders a `.user-dropdown-backdrop` at `z-index: 10000`), the Notification Center has no backdrop. Clicking outside the panel does nothing -- the user must find and click the close button inside the panel.

2. **No Escape key handler.** There is no `keydown` listener for Escape. The user cannot close the panel with the keyboard.

3. **z-index too low.** At `z-index: 1000`, it is at the same level as the sticky header. On vehicle profile pages, sticky sub-headers at `z-index: 900` and the barcode tooltip at `z-index: 1100` can paint around or over the notification panel. The paper grain pseudo-element at `z-index: 9999` paints over it entirely.

4. **No focus trap.** Tab key moves focus out of the panel and into the page behind it, with no way to tab back.

**File:** `/Users/skylar/nuke/nuke_frontend/src/components/notifications/NotificationCenter.tsx`

---

## HIGH: URL Paste Auto-Ingests Without User Confirmation

**Component:** `AIDataIngestionSearch.tsx` (lines 1418-1461)
**Severity:** High -- destructive action without consent

When a user pastes a URL into the search bar, the `onPaste` handler:
1. Normalizes the URL
2. If it looks like a vehicle listing, immediately calls `ingestVehicle({ url, enrich: true })` -- a server-side function that creates a vehicle record in the database
3. If it looks like an org website, immediately calls `createOrgFromUrlAndNavigate()`

There is zero user confirmation. The user pastes a URL to look at it, and the system immediately creates database records and navigates away. If the user pasted the wrong URL, they have created a spurious vehicle or organization record with no undo mechanism. This auto-fire behavior is triggered by `onPaste` (line 1418), not by pressing Enter.

The comment at line 1433 says "auto-ingest immediately (no extra Enter)" -- this was intentional, but it is a UX violation. The user did not ask to create a record; they pasted text into a search box.

**File:** `/Users/skylar/nuke/nuke_frontend/src/components/search/AIDataIngestionSearch.tsx`

---

## HIGH: z-index Chaos Across the Application

**Severity:** High -- overlays render in wrong order, modals behind other modals

The z-index values across the application are a complete mess. There are at least 12 different z-index tiers in use with no coordination:

| z-index | Component | File |
|---------|-----------|------|
| 99999 | OrgProfile custom toast | OrganizationProfile.tsx |
| 10003 | OrgInventory modals | OrganizationInventory.tsx |
| 10002 | Vehicles relationship modal | Vehicles.tsx |
| 10001 | User dropdown menu, profile dropdown, org ownership modal, hover cards | Multiple files |
| 10000 | User dropdown backdrop, profile dropdown backdrop, VehicleProfile ownership modal, ExtractionMonitor, various modals | Multiple files |
| 9999 | Toast container, paper grain overlay, vehicle profile sticky | Toast.tsx, vehicle-profile.css |
| 1203 | Search autocomplete dropdown | AIDataIngestionSearch.tsx |
| 1202 | Search extraction preview, wiring workbench, error overlay | AIDataIngestionSearch.tsx |
| 1201 | Search container | AIDataIngestionSearch.tsx |
| 1200 | Search actions menu | AIDataIngestionSearch.tsx |
| 1100 | Barcode tooltip, VP column floats | vehicle-profile.css |
| 1000 | Sticky header, notification center, various dropdowns | Multiple files |

Problems this creates:
- The OrgProfile custom toast (99999) renders above everything, including modals the user is interacting with
- The paper grain (9999) renders above the notification center (1000) and search dropdowns (1203)
- The Toast container (9999) and paper grain (9999) compete at the same level
- Search dropdowns (1203) render under the user dropdown backdrop (10000), which is correct, but also under the Toast container (9999), so toasts can cover search results
- Modals on the OrgProfile render at 10001 but the inventory modals render at 10003, meaning if both are open, the inventory modal wins regardless of which was opened first

**Fix:** Define a single z-index scale in the design system CSS and reference tokens everywhere. No inline z-index values.

---

## MEDIUM: Actions Menu (Ellipsis Button) Has No Keyboard Accessibility

**Component:** `AIDataIngestionSearch.tsx` (lines 1491-1514, 1970-2077)
**Severity:** Medium -- keyboard-only users cannot access image attachment or critique mode

The `...` button in the search bar opens an actions menu with IMG, CRIT, and GO buttons. Problems:

1. The menu is toggled by click only. There is no keyboard shortcut to open it.
2. When the menu is open, Tab does not move focus into the menu items. Focus stays on the input.
3. Pressing Escape closes the menu (line 1220), but only if the input has focus -- if the user somehow tabbed to the `...` button and pressed Escape, the handler on `handleKeyDown` (attached to the input) would not fire.
4. The actions menu renders at `zIndex: 1200`, which is BELOW the autocomplete dropdown (`zIndex: 1203`). If both are open, autocomplete covers the actions menu.

**File:** `/Users/skylar/nuke/nuke_frontend/src/components/search/AIDataIngestionSearch.tsx`

---

## MEDIUM: VehicleTabBar Active Tab Shows Only a Dot

**Component:** `VehicleTabBar.tsx` (line 102)
**Severity:** Medium -- user cannot identify which vehicle they are looking at

When a tab is active, the tab title is replaced with a bullet character `'●'`. The user sees a row of tabs where the active one shows just a dot and the inactive ones show titles. This is backwards -- the active tab is the one the user needs to identify at a glance. If they have 5 tabs open, they cannot tell which vehicle is currently displayed without checking the page content.

**File:** `/Users/skylar/nuke/nuke_frontend/src/components/layout/VehicleTabBar.tsx`

---

## MEDIUM: Toast Notifications on OrgProfile Are a Custom Implementation

**Component:** `OrganizationProfile.tsx` (lines 1992-2019)
**Severity:** Medium -- inconsistent behavior, no dismiss, wrong position

The OrganizationProfile page implements its own toast system using `ReactDOM.createPortal` with custom state management, instead of using the global `useToast()` hook from `Toast.tsx`. This means:

1. These toasts render at `z-index: 99999` (higher than everything else) while the global toasts render at `z-index: 9999`
2. These toasts appear at bottom-right; global toasts appear at top-right
3. These toasts have `pointerEvents: 'none'` on the container with `pointerEvents: 'all'` on individual toasts, but there is no onClick handler to dismiss them
4. These toasts use custom colors (`#1a472a`, `#7f1d1d`) instead of the design system CSS variables
5. These toasts use `boxShadow` which violates the zero-shadow design rule

**File:** `/Users/skylar/nuke/nuke_frontend/src/pages/OrganizationProfile.tsx`

---

## MEDIUM: Search Input onPaste Prevents Default for URLs, Breaking Clipboard Behavior

**Component:** `AIDataIngestionSearch.tsx` (lines 1418-1461)
**Severity:** Medium -- user cannot paste-and-edit a URL

The `onPaste` handler calls `e.preventDefault()` for any URL-like input (line 1424). This means:
1. The pasted text is programmatically set via `setInput(normalized)` instead of being inserted at the cursor position
2. If the user had selected a portion of existing text and pasted to replace it, the entire input is replaced, not just the selection
3. If the paste is a URL, the auto-ingest fires immediately (see the HIGH issue above), giving the user no chance to edit the URL before submission
4. Non-URL pastes work normally, creating inconsistent paste behavior

**File:** `/Users/skylar/nuke/nuke_frontend/src/components/search/AIDataIngestionSearch.tsx`

---

## MEDIUM: Global Paste Handler Captures All Image Pastes

**Component:** `AIDataIngestionSearch.tsx` (lines 620-638)
**Severity:** Medium -- image pastes in other inputs get captured by the search bar

A `window.addEventListener('paste', handlePaste)` listener (line 636) captures ALL paste events that contain images, regardless of which element has focus. If the user is pasting an image into a comment box, a description field, or any other textarea, the search bar will intercept it and attach it as a search image. There is no check for `e.target` or active element.

**File:** `/Users/skylar/nuke/nuke_frontend/src/components/search/AIDataIngestionSearch.tsx`

---

## MEDIUM: HomePage Renders Its Own Header, Duplicating AppHeader

**Component:** `HomePage.tsx` (lines 900-990)
**Severity:** Medium -- two search bars, two navigation systems

The HomePage renders its own header with its own search bar, its own NUKE wordmark, and its own navigation. The AppHeader with AIDataIngestionSearch is rendered by AppLayout wrapping the page. This means the user sees either:
- Two headers (if AppLayout wraps HomePage)
- A different header than every other page (if HomePage is rendered outside AppLayout)

The HomePage search has its own state, its own dropdown, and its own click-outside handler. It does not share any behavior with the AIDataIngestionSearch. Typing in one does not affect the other. The homepage search dropdown renders at `z-index: 10000` while the global search dropdown renders at `z-index: 1203`.

**File:** `/Users/skylar/nuke/nuke_frontend/src/pages/HomePage.tsx`

---

## LOW: Wiring Workbench Chat Has No Input After Initial Opening

**Component:** `AIDataIngestionSearch.tsx` (lines 2298-2366)
**Severity:** Low -- user opens a chat interface with no way to type follow-up messages

The Wiring Workbench is a chat-like panel that renders inside the search dropdown area. It shows messages from previous interactions, but there is no input field inside the panel. The user is expected to type follow-up messages in the main search input, which then routes through `processInput()` -> `isWiringIntent()` -> `runWiringWorkbench()`. This is not discoverable -- the chat panel looks like it should have its own input, but it does not.

**File:** `/Users/skylar/nuke/nuke_frontend/src/components/search/AIDataIngestionSearch.tsx`

---

## LOW: Vehicle Tab Middle-Click Close Has No Visual Feedback

**Component:** `VehicleTabBar.tsx` (lines 86-90)
**Severity:** Low -- middle-click works but user does not know it

The tab supports middle-click (auxClick, button === 1) to close. This is a good pattern borrowed from browser tabs, but there is no indication to the user that this shortcut exists. The `onAuxClick` is on the tab `div`, not on the close button, which is correct -- but the cursor does not change on hover to indicate the close-on-middle-click behavior.

**File:** `/Users/skylar/nuke/nuke_frontend/src/components/layout/VehicleTabBar.tsx`

---

## LOW: Error Overlay Has No Dismiss Mechanism Beyond Outside Click

**Component:** `AIDataIngestionSearch.tsx` (lines 2382-2399)
**Severity:** Low -- error messages persist until dismissed by obscure interaction

The error overlay renders below the search bar with `zIndex: 1202`. It can only be dismissed by:
1. Clicking outside the search container (which triggers the `anyPopoverOpen` mousedown handler at line 601)
2. Pressing Escape (which clears the error indirectly by setting `showPreview(false)` and `actionsOpen(false)` at line 1217-1222, but does NOT explicitly clear `error`)

Wait -- looking again: Escape at line 1217 does NOT clear `error`. The error overlay will persist through Escape presses. Only the outside-click handler at line 611 sets `setError(null)`. This means if the user is focused in the search input and presses Escape, the error stays visible. They must click somewhere else on the page.

**File:** `/Users/skylar/nuke/nuke_frontend/src/components/search/AIDataIngestionSearch.tsx`

---

## Summary of Fix Priorities

### Must Fix (users will close the tab)
1. Search dropdown z-index / paper grain overlay conflict -- search results invisible on vehicle profile
2. Cmd+W hijack -- remove entirely or make it opt-in
3. URL auto-ingest on paste -- require Enter to confirm

### Should Fix (broken but workaround exists)
4. Notification Center needs backdrop, Escape handler, and higher z-index
5. z-index scale needs a single source of truth
6. Global paste handler needs focus-target check
7. Actions menu keyboard accessibility
8. Active tab showing dot instead of title

### Clean Up (inconsistencies that erode trust)
9. OrgProfile custom toast -- use global useToast
10. Error overlay Escape handling
11. Wiring Workbench needs its own input
12. HomePage duplicate header/search
